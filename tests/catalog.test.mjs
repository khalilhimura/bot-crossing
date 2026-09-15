import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { generateCatalog } from '../tools/build-catalog.mjs'
import { normalizeAsset } from '../src/assets/loader.js'

test('catalog describes every bundled model with stable selectors and credits', async () => {
  const catalog = await generateCatalog()
  assert.equal(catalog.length, 74)
  assert.equal(catalog.filter(a => a.id.startsWith('bundled:base:')).length, 57)
  assert.equal(catalog.filter(a => a.id.startsWith('bundled:forest:')).length, 16)
  const crew = catalog.find(a => a.id === 'bundled:crew')
  assert.equal(crew.selector, null)
  assert.equal(crew.animations.length, 15)
  for (const a of catalog) {
    assert.match(a.hash, /^[a-f0-9]{64}$/)
    assert.equal(a.license, 'CC0 1.0')
    assert.ok(a.stats.triangles > 0)
    assert.ok(a.bounds.max.every(Number.isFinite))
  }
})

test('normalization preserves authored transforms and grounds an independent wrapper', () => {
  const scene = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshStandardMaterial())
  mesh.position.set(8, 9, 10)
  scene.add(mesh)
  const asset = normalizeAsset({ scene, scenes: [scene], animations: [] })
  assert.deepEqual(mesh.position.toArray(), [8, 9, 10])
  assert.deepEqual(asset.root.position.toArray(), [0, 0, 0])
  assert.deepEqual(asset.bounds, { min: [7, 7, 7], max: [9, 11, 13] })
  const box = new THREE.Box3().setFromObject(asset.root)
  assert.deepEqual(box.min.toArray(), [-1, 0, -3])
  assert.deepEqual(box.max.toArray(), [1, 4, 3])
  assert.deepEqual(asset.stats, { meshes: 1, materials: 1, triangles: 12 })
  let disposed = 0
  mesh.geometry.addEventListener('dispose', () => disposed++)
  asset.dispose(); asset.dispose()
  assert.equal(disposed, 1)
})

test('selectors select top-level nodes and fail explicitly for missing names', () => {
  const scene = new THREE.Group()
  const a = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); a.name = 'First'
  const b = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); b.name = 'Second'
  scene.add(a,b)
  const loaded = normalizeAsset({scene, scenes:[scene], animations:[]}, 'First')
  assert.equal(loaded.stats.meshes, 1)
  assert.equal(loaded.root.children[0].children[0], a)
  loaded.dispose()
  assert.throws(() => normalizeAsset({scene, scenes:[scene], animations:[]}, 'Missing'), /not found/)
})

test('animations resolve original names beneath the placement wrapper', () => {
  const scene = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
  mesh.name = 'AnimatedMesh'
  scene.add(mesh)
  const clip = new THREE.AnimationClip('Move', 1, [new THREE.VectorKeyframeTrack('AnimatedMesh.position', [0, 1], [0, 0, 0, 0, 2, 0])])
  const loaded = normalizeAsset({scene, scenes:[scene], animations:[clip]})
  loaded.root.position.set(10, 0, 20)
  const mixer = new THREE.AnimationMixer(loaded.root)
  mixer.clipAction(loaded.clips[0]).play()
  mixer.update(0.5)
  assert.equal(mesh.position.y, 1)
  assert.deepEqual(loaded.root.position.toArray(), [10, 0, 20])
  mixer.stopAllAction()
  mixer.uncacheRoot(loaded.root)
  loaded.dispose()
})

test('disposing a bundle selection releases shared resources and unselected meshes once', () => {
  const scene = new THREE.Group()
  const material = new THREE.MeshBasicMaterial()
  const geometry = new THREE.BoxGeometry()
  const first = new THREE.Mesh(geometry, material); first.name = 'First'
  const second = new THREE.Mesh(geometry, material); second.name = 'Second'
  scene.add(first, second)
  let materials = 0, geometries = 0, textures = 0, images = 0
  material.map = new THREE.Texture({ close() { images++ } })
  material.addEventListener('dispose', () => materials++)
  geometry.addEventListener('dispose', () => geometries++)
  material.map.addEventListener('dispose', () => textures++)
  const loaded = normalizeAsset({scene, scenes:[scene], animations:[]}, 'First')
  loaded.dispose()
  loaded.dispose()
  assert.deepEqual([materials, geometries, textures, images], [1,1,1,1])
})

test('texture validation rejects swallowed decoder failures but ignores unused textures', async () => {
  const { validateTextureResources } = await import('../src/assets/loader.js')
  const material = new THREE.MeshStandardMaterial()
  const scene = new THREE.Group()
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  let valid = false
  const requested = []
  const gltf = { scene, parser: {
    associations: new Map([[material, { materials: 0 }]]),
    json: { materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 1 } } }] },
    plugins: {}, extensions: {},
    async getDependency(type, index) { requested.push(index); return valid ? new THREE.Texture() : null },
  } }
  await assert.rejects(validateTextureResources(gltf), /texture.*decode/i)
  valid = true
  await validateTextureResources(gltf)
  assert.deepEqual(requested, [1,1])
})
