import fs from 'node:fs/promises'
import { readlinkSync, unlinkSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assetError, validateGlb } from './glb.mjs'

const clone = (value) => structuredClone(value)
const textFields = ['name', 'category', 'source', 'creator', 'license']
function metadataFields(input, full = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw assetError('Metadata must be an object')
  const out = {}
  for (const key of textFields)
    if (key in input || full) {
      const value =
        input[key] ??
        (key === 'name'
          ? 'Imported model'
          : key === 'category'
            ? 'other'
            : 'unknown')
      if (
        typeof value !== 'string' ||
        value.length > 2048 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
      )
        throw assetError(`Invalid ${key}`)
      out[key] =
        value.trim() ||
        (key === 'name'
          ? 'Imported model'
          : key === 'category'
            ? 'other'
            : 'unknown')
    }
  return out
}
const vector = (v) =>
  Array.isArray(v) &&
  v.length === 3 &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n))
function measured(input) {
  const { bounds, stats, animations } = input
  if (
    !bounds ||
    !vector(bounds.min) ||
    !vector(bounds.max) ||
    bounds.min.some((n, i) => n > bounds.max[i])
  )
    throw assetError('Invalid measured bounds')
  if (
    !stats ||
    ['meshes', 'materials', 'triangles'].some(
      (k) => !Number.isSafeInteger(stats[k]) || stats[k] < 0,
    ) ||
    stats.meshes < 1
  )
    throw assetError('Invalid measured mesh statistics')
  if (
    !Array.isArray(animations) ||
    animations.length > 10000 ||
    animations.some((s) => typeof s !== 'string' || s.length > 2048)
  )
    throw assetError('Invalid animation names')
  return {
    bounds: clone(bounds),
    stats: {
      meshes: stats.meshes,
      materials: stats.materials,
      triangles: stats.triangles,
    },
    animations: [...new Set(animations)],
  }
}

export function createAssetStore({ directory, catalog = [] }) {
  const stateFile = path.join(directory, 'registry.json'),
    files = path.join(directory, 'files')
  let state,
    bundled,
    queue = Promise.resolve()
  async function initialize() {
    await fs.mkdir(files, { recursive: true })
    bundled =
      typeof catalog === 'string'
        ? JSON.parse(
            await fs.readFile(catalog, 'utf8').catch((e) => {
              if (e.code === 'ENOENT') return '[]'
              throw e
            }),
          )
        : clone(catalog)
    if (!Array.isArray(bundled)) bundled = bundled.assets
    if (!Array.isArray(bundled))
      throw new Error('Invalid bundled asset catalog')
    let loaded
    try {
      loaded = JSON.parse(await fs.readFile(stateFile, 'utf8'))
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      loaded = { version: 1, assets: [], placements: [] }
    }
    if (
      loaded.version !== 1 ||
      !Array.isArray(loaded.assets) ||
      !Array.isArray(loaded.placements)
    )
      throw new Error(
        'Invalid asset registry; restore its backup before continuing',
      )
    // Pending previews survive restart so another open tab can complete them. Old
    // pending imports expire after seven days; unreferenced interrupted files clean up.
    const stale = loaded.assets.filter(
      (a) =>
        a.status === 'pending' &&
        Date.now() - (a.createdAt || 0) > 7 * 86400000,
    )
    if (stale.length) {
      loaded.assets = loaded.assets.filter((a) => !stale.includes(a))
      await persist(loaded)
    }
    state = loaded
    const live = new Set(state.assets.map((a) => `${a.hash}.glb`))
    for (const name of await fs.readdir(files))
      if (
        (/^[a-f0-9]{64}\.glb$/.test(name) && !live.has(name)) ||
        name.endsWith('.tmp')
      )
        await fs.rm(path.join(files, name), { force: true })
  }
  async function persist(next) {
    const temporary = stateFile + '.' + randomUUID() + '.tmp'
    try {
      const handle = await fs.open(temporary, 'wx')
      try {
        await handle.writeFile(JSON.stringify(next, null, 2))
        await handle.sync()
      } finally {
        await handle.close()
      }
      await fs.rename(temporary, stateFile)
    } finally {
      await fs.rm(temporary, { force: true })
    }
  }
  async function acquireLock() {
    await fs.mkdir(directory, { recursive: true })
    const lock = path.join(directory, '.transaction-lock'),
      owner = `${process.pid}-${randomUUID()}`,
      deadline = Date.now() + 15000
    while (true) {
      try {
        await fs.symlink(owner, lock)
        return async () => {
          if ((await fs.readlink(lock).catch(() => null)) === owner)
            await fs.unlink(lock)
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
      const holder = await fs.readlink(lock).catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      if (holder) {
        const pid = Number(holder.split('-')[0])
        let dead = false
        if (!Number.isSafeInteger(pid) || pid <= 0)
          throw assetError(
            'Invalid asset transaction lock; inspect the data directory',
            503,
          )
        try {
          process.kill(pid, 0)
        } catch (error) {
          if (error.code === 'ESRCH') dead = true
          else if (error.code !== 'EPERM') throw error
        }
        // Only a verified dead owner permits recovery. A slow live writer is never
        // evicted by a timeout. Compare the unique owner again before unlinking.
        if (dead) {
          try {
            if (readlinkSync(lock) === holder) unlinkSync(lock)
          } catch (error) {
            if (error.code !== 'ENOENT') throw error
          }
          continue
        }
      }
      if (Date.now() > deadline)
        throw assetError(
          'Asset storage is busy in another server; retry shortly',
          503,
        )
      await delay(15 + Math.random() * 25)
    }
  }
  function serial(fn) {
    const result = queue.then(async () => {
      const release = await acquireLock()
      try {
        await initialize()
        return await fn()
      } finally {
        await release()
      }
    })
    queue = result.catch(() => {})
    return result
  }
  async function mutate(fn) {
    const next = clone(state),
      result = await fn(next)
    await persist(next)
    state = next
    return clone(result)
  }
  const lookup = (id, s = state) =>
    s.assets.find((a) => a.id === id) || bundled.find((a) => a.id === id)
  function imported(id, s = state) {
    const asset = lookup(id, s)
    if (!asset) throw assetError('Asset not found', 404)
    if (asset.origin !== 'imported')
      throw assetError('Bundled assets cannot be changed', 403)
    return asset
  }
  function fileFor(asset) {
    if (!/^[a-f0-9]{64}$/.test(asset.hash))
      throw assetError('Invalid asset hash')
    return path.join(files, asset.hash + '.glb')
  }
  return {
    list: () =>
      serial(() =>
        clone({
          assets: [
            ...bundled,
            ...state.assets.filter((a) => a.status === 'ready'),
          ],
          placements: state.placements,
        }),
      ),
    upload: (bytes, name) =>
      serial(async () => {
        validateGlb(bytes)
        const hash = createHash('sha256').update(bytes).digest('hex')
        const existing = state.assets.find(
          (a) => a.hash === hash && a.status === 'ready',
        )
        if (existing) return { asset: clone(existing), duplicate: true }
        const id = randomUUID(),
          asset = {
            id,
            ...metadataFields(
              {
                name:
                  typeof name === 'string'
                    ? name.replace(/\.glb$/i, '')
                    : undefined,
              },
              true,
            ),
            origin: 'imported',
            url: `/api/assets/${id}/file`,
            selector: null,
            hash,
            bytes: bytes.length,
            bounds: null,
            stats: null,
            animations: [],
            status: 'pending',
            createdAt: Date.now(),
          }
        const file = fileFor(asset),
          temporary = file + '.tmp'
        try {
          const handle = await fs.open(temporary, 'w')
          try {
            await handle.writeFile(bytes)
            await handle.sync()
          } finally {
            await handle.close()
          }
          await fs.rename(temporary, file)
          return await mutate((next) => {
            next.assets.push(asset)
            return { asset, duplicate: false }
          })
        } catch (e) {
          await fs.rm(temporary, { force: true })
          if (!state.assets.some((a) => a.hash === hash))
            await fs.rm(file, { force: true })
          throw e
        }
      }),
    finalize: (id, input) =>
      serial(() =>
        mutate((next) => {
          const asset = imported(id, next)
          if (asset.status === 'ready') return asset
          const existing = next.assets.find(
            (a) => a.id !== id && a.hash === asset.hash && a.status === 'ready',
          )
          if (existing) {
            next.assets = next.assets.filter((a) => a.id !== id)
            return existing
          }
          Object.assign(asset, metadataFields(input, true), measured(input), {
            status: 'ready',
          })
          return asset
        }),
      ),
    update: (id, input) =>
      serial(() =>
        mutate((next) => {
          const asset = imported(id, next)
          Object.assign(asset, metadataFields(input))
          return asset
        }),
      ),
    binary: (id) =>
      serial(async () => {
        const asset = imported(id)
        return fs.readFile(fileFor(asset))
      }),
    remove: (id, cascade = false, pendingOnly = false) =>
      serial(async () => {
        const asset = lookup(id)
        if (pendingOnly && (!asset || asset.status !== 'pending'))
          return { ok: true }
        imported(id)
        if (state.placements.some((p) => p.assetId === id) && !cascade)
          throw assetError(
            'Asset is in use; remove its placements explicitly',
            409,
          )
        await mutate((next) => {
          next.assets = next.assets.filter((a) => a.id !== id)
          next.placements = next.placements.filter((p) => p.assetId !== id)
          return { ok: true }
        })
        if (!state.assets.some((a) => a.hash === asset.hash))
          await fs.rm(fileFor(asset), { force: true })
        return { ok: true }
      }),
    putPlacement: (data) =>
      serial(() =>
        mutate((next) => {
          if (
            !data ||
            typeof data !== 'object' ||
            typeof data.id !== 'string' ||
            !/^[a-zA-Z0-9_-]{1,100}$/.test(data.id)
          )
            throw assetError('Invalid placement id')
          const asset = lookup(data.assetId, next)
          if (!asset || asset.status !== 'ready')
            throw assetError('Ready asset not found', 404)
          if (!vector(data.position)) throw assetError('Invalid position')
          if (typeof data.yaw !== 'number' || !Number.isFinite(data.yaw))
            throw assetError('Invalid yaw')
          if (
            typeof data.scale !== 'number' ||
            !Number.isFinite(data.scale) ||
            data.scale <= 0
          )
            throw assetError('Invalid scale')
          if (
            typeof data.animation !== 'string' ||
            (data.animation && !asset.animations.includes(data.animation))
          )
            throw assetError('Invalid animation')
          const placement = {
            id: data.id,
            assetId: data.assetId,
            position: [...data.position],
            yaw: data.yaw,
            scale: data.scale,
            animation: data.animation,
          }
          const index = next.placements.findIndex((p) => p.id === data.id)
          if (index < 0) next.placements.push(placement)
          else next.placements[index] = placement
          return placement
        }),
      ),
    removePlacement: (id) =>
      serial(() =>
        mutate((next) => {
          if (!next.placements.some((p) => p.id === id))
            throw assetError('Placement not found', 404)
          next.placements = next.placements.filter((p) => p.id !== id)
          return { ok: true }
        }),
      ),
  }
}
