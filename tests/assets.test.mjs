import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { validateGlb } from '../server/assets/glb.mjs'
import { createAssetStore } from '../server/assets/store.mjs'
import { createAssetMiddleware } from '../server/assets/api.mjs'

function glb(extra = {}) {
  const raw = Buffer.from(
    JSON.stringify({
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      ...extra,
    }),
  )
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32)
  raw.copy(json)
  const out = Buffer.alloc(20 + json.length)
  out.writeUInt32LE(0x46546c67)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(json.length, 12)
  out.writeUInt32LE(0x4e4f534a, 16)
  json.copy(out, 20)
  return out
}
const metadata = {
  name: 'Tree',
  category: 'nature',
  source: 'unknown',
  creator: 'unknown',
  license: 'unknown',
  bounds: { min: [0, 0, 0], max: [1, 2, 1] },
  stats: { meshes: 1, materials: 1, triangles: 1 },
  animations: [],
}
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bc-assets-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return { directory, store: createAssetStore({ directory, catalog: [] }) }
}

test('GLB boundary rejects malformed files and non-self-contained resources', () => {
  assert.ok(validateGlb(glb()))
  for (const bytes of [Buffer.from('bad'), glb().subarray(0, 24)])
    assert.throws(() => validateGlb(bytes))
  const bad = glb()
  bad.writeUInt32LE(999999, 12)
  assert.throws(() => validateGlb(bad), /chunk/i)
  assert.throws(
    () =>
      validateGlb(
        glb({ buffers: [{ uri: 'https://example.com/x.bin', byteLength: 1 }] }),
      ),
    /self-contained/i,
  )
  assert.throws(
    () => validateGlb(glb({ images: [{ uri: '../secret.png' }] })),
    /self-contained/i,
  )
  assert.throws(
    () => validateGlb(glb({ extensionsRequired: ['UNSUPPORTED_thing'] })),
    /UNSUPPORTED_thing/,
  )
  assert.throws(() => validateGlb(glb({ scenes: [] })), /scene/i)
  assert.throws(() => validateGlb(glb({ scenes: [{ nodes: [9] }] })), /node/i)
  assert.ok(
    validateGlb(
      glb({
        extensionsRequired: [
          'KHR_draco_mesh_compression',
          'EXT_meshopt_compression',
          'KHR_texture_basisu',
        ],
      }),
    ),
  )
})
test('pending imports finalize, edit concurrently and survive restart', async (t) => {
  const { directory, store } = await fixture(t)
  const first = await store.upload(glb(), 'tree.glb')
  assert.equal(first.asset.status, 'pending')
  assert.equal((await store.list()).assets.length, 0)
  assert.deepEqual(await store.binary(first.asset.id), glb())
  assert.equal((await store.upload(glb(), 'other.glb')).duplicate, false)
  await store.finalize(first.asset.id, metadata)
  await Promise.all([
    store.update(first.asset.id, { name: 'New' }),
    store.update(first.asset.id, { creator: 'Artist' }),
  ])
  const restored = await createAssetStore({ directory, catalog: [] }).list()
  assert.equal(restored.assets[0].name, 'New')
  assert.equal(restored.assets[0].creator, 'Artist')
  assert.equal((await store.upload(glb(), 'again.glb')).asset.status, 'ready')
  await assert.rejects(
    store.update(first.asset.id, { name: { bad: 1 } }),
    /name/i,
  )
  await assert.rejects(store.binary('../registry.json'), /not found/i)
})
test('placements validate values, preserve asset restrictions and require explicit cascade', async (t) => {
  const { store } = await fixture(t)
  const { asset } = await store.upload(glb(), 'tree')
  await store.finalize(asset.id, metadata)
  const placement = {
    id: 'instance-1',
    assetId: asset.id,
    position: [1, 0, 2],
    yaw: 0,
    scale: 1,
    animation: '',
  }
  await store.putPlacement(placement)
  await assert.rejects(store.putPlacement({ ...placement, scale: 0 }), /scale/i)
  await assert.rejects(
    store.putPlacement({ ...placement, position: [NaN, 0, 0] }),
    /position/i,
  )
  await assert.rejects(
    store.putPlacement({ ...placement, animation: 'missing' }),
    /animation/i,
  )
  await assert.rejects(store.remove(asset.id, false), (e) => e.status === 409)
  await store.remove(asset.id, true)
  assert.deepEqual(await store.list(), { assets: [], placements: [] })
})
test('HTTP routes enforce exact origin and provide bounded actionable errors', async (t) => {
  const { store } = await fixture(t)
  const middleware = createAssetMiddleware(store)
  const server = http.createServer((req, res) => middleware(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const root = `http://127.0.0.1:${server.address().port}`
  for (const origin of [
    undefined,
    'http://127.0.0.1:1',
    'https://127.0.0.1:' + server.address().port,
  ]) {
    const response = await fetch(root + '/api/assets/import', {
      method: 'POST',
      headers: origin ? { Origin: origin } : {},
      body: glb(),
    })
    assert.equal(response.status, 403)
  }
  const response = await fetch(root + '/api/assets/import', {
    method: 'POST',
    headers: { Origin: root, 'X-Asset-Name': 'tree.glb' },
    body: glb(),
  })
  assert.equal(response.status, 201)
  const { asset } = await response.json()
  assert.equal((await fetch(root + asset.url)).status, 200)
  const finalize = await fetch(root + `/api/assets/${asset.id}/finalize`, {
    method: 'POST',
    headers: { Origin: root },
    body: JSON.stringify(metadata),
  })
  assert.equal(finalize.status, 200)
  const cancel = await fetch(root + `/api/assets/${asset.id}?pending=1`, {
    method: 'DELETE',
    headers: { Origin: root },
  })
  assert.equal(cancel.status, 200)
  assert.equal((await fetch(root + asset.url)).status, 200)

  const invalid = await fetch(root + `/api/assets/${asset.id}`, {
    method: 'PATCH',
    headers: { Origin: root },
    body: '{',
  })
  assert.equal(invalid.status, 400)
  assert.equal(
    (await fetch(root + '/api/assets/%2E%2E%2Fregistry.json/file')).status,
    404,
  )
})

test('real bundled files pass structural validation', async () => {
  for (const name of ['spacebase', 'forest', 'crew'])
    assert.ok(
      validateGlb(
        await fs.readFile(
          new URL(`../public/assets/${name}.glb`, import.meta.url),
        ),
      ),
    )
})
test('builtins are read-only and pending data survives restart', async (t) => {
  const { directory, store } = await fixture(t)
  const { asset } = await store.upload(glb(), '../<script>evil</script>.glb')
  assert.deepEqual(
    await createAssetStore({ directory, catalog: [] }).binary(asset.id),
    glb(),
  )
  const builtin = {
    ...metadata,
    id: 'bundled:crew',
    origin: 'bundled',
    status: 'ready',
  }
  const withBuiltin = createAssetStore({ directory, catalog: [builtin] })
  await assert.rejects(withBuiltin.remove(builtin.id), (e) => e.status === 403)
  await assert.rejects(
    withBuiltin.update(builtin.id, { name: 'bad' }),
    (e) => e.status === 403,
  )
  await assert.rejects(
    withBuiltin.putPlacement({
      id: 'pending',
      assetId: asset.id,
      position: [0, 0, 0],
      yaw: 0,
      scale: 1,
      animation: '',
    }),
    /Ready asset/,
  )
  await store.remove(asset.id)
  assert.equal((await store.list()).assets.length, 0)
})
test('oversize and invalid metadata requests leave state intact', async (t) => {
  const { store } = await fixture(t)
  await assert.rejects(
    store.upload(Buffer.alloc(50 * 1024 * 1024 + 1), 'huge'),
    (e) => e.status === 413,
  )
  const { asset } = await store.upload(glb(), 'model')
  await assert.rejects(
    store.finalize(asset.id, {
      ...metadata,
      bounds: { min: [1, 0, 0], max: [0, 1, 1] },
    }),
    /bounds/,
  )
  assert.deepEqual((await store.list()).assets, [])
  await store.finalize(asset.id, metadata)
  await assert.rejects(
    store.update(asset.id, { license: 'a'.repeat(2049) }),
    /license/,
  )
  assert.equal((await store.list()).assets[0].license, 'unknown')
})
test('concurrent pending imports remain independent and failure does not poison the queue', async (t) => {
  const { store } = await fixture(t)
  const imports = await Promise.all(
    Array.from({ length: 8 }, (_, i) => store.upload(glb(), 'name' + i)),
  )
  assert.equal(new Set(imports.map((item) => item.asset.id)).size, 8)
  assert.equal(imports.filter((item) => !item.duplicate).length, 8)
  await assert.rejects(store.finalize(imports[0].asset.id, { bad: true }))
  await store.finalize(imports[0].asset.id, metadata)
  assert.equal((await store.list()).assets.length, 1)
})
test('independent pending imports cannot cancel each other or a finalized asset', async (t) => {
  const { store } = await fixture(t)
  const first = await store.upload(glb(), 'first'),
    second = await store.upload(glb(), 'second')
  assert.notEqual(first.asset.id, second.asset.id)
  await store.remove(first.asset.id, false, true)
  assert.deepEqual(await store.binary(second.asset.id), glb())
  const ready = await store.finalize(second.asset.id, metadata)
  await store.remove(ready.id, false, true)
  assert.equal((await store.list()).assets.length, 1)
  const concurrentA = await store.upload(glb({ extras: { variant: 1 } }), 'a'),
    concurrentB = await store.upload(glb({ extras: { variant: 1 } }), 'b')
  const finalA = await store.finalize(concurrentA.asset.id, metadata)
  const finalB = await store.finalize(concurrentB.asset.id, {
    ...metadata,
    name: 'Must not replace',
  })
  assert.equal(finalA.id, finalB.id)
  assert.equal(finalB.name, metadata.name)
  assert.deepEqual(
    await store.binary(finalA.id),
    glb({ extras: { variant: 1 } }),
  )
})
test('two active stores preserve interleaved writes and referenced binaries', async (t) => {
  const { directory, store } = await fixture(t),
    second = createAssetStore({ directory, catalog: [] })
  await Promise.all([store.list(), second.list()])
  const [firstImport, secondImport] = await Promise.all([
    store.upload(glb(), 'a'),
    second.upload(glb({ extras: { variant: 2 } }), 'b'),
  ])
  await Promise.all([
    store.finalize(firstImport.asset.id, metadata),
    second.finalize(secondImport.asset.id, { ...metadata, name: 'Second' }),
  ])
  const third = createAssetStore({ directory, catalog: [] })
  assert.equal((await third.list()).assets.length, 2)
  assert.deepEqual(await third.binary(firstImport.asset.id), glb())
  assert.deepEqual(
    await third.binary(secondImport.asset.id),
    glb({ extras: { variant: 2 } }),
  )
})

test('separate server processes serialize imports and recover a crashed owner', async (t) => {
  const { directory, store } = await fixture(t)
  await store.list()
  const moduleUrl = new URL('../server/assets/store.mjs', import.meta.url).href
  const run = (variant) =>
    new Promise((resolve, reject) => {
      const script = `import {createAssetStore} from ${JSON.stringify(moduleUrl)};const store=createAssetStore({directory:${JSON.stringify(directory)},catalog:[]});const {asset}=await store.upload(Buffer.from(${JSON.stringify(glb({ extras: { variant } }).toString('base64'))},'base64'),'child');await store.finalize(asset.id,${JSON.stringify(metadata)});`
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', script],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      )
      let errors = ''
      child.stderr.on('data', (c) => (errors += c))
      child.on('error', reject)
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(errors)),
      )
    })
  await Promise.all([run(11), run(12), run(13)])
  assert.equal((await store.list()).assets.length, 3)
  const lock = path.join(directory, '.transaction-lock')
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import fs from 'node:fs/promises';await fs.symlink(process.pid+'-crash-test',${JSON.stringify(lock)});process.stdout.write('locked');setInterval(()=>{},10000);`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  await once(child.stdout, 'data')
  const died = once(child, 'exit')
  child.kill('SIGKILL')
  await died
  assert.equal((await store.list()).assets.length, 3)
  await assert.rejects(fs.lstat(lock), (e) => e.code === 'ENOENT')
})
