import * as THREE from 'three'
import { AssetPanel } from './panel.js'
import { AssetWorld } from './world.js'
import { assetRequest, assetPath } from './client.js'

/** Asset editing is independent of session/colony state; network writes own the save boundary. */
export async function mountAssetTools({ engine, rig, hud, colony, launch }) {
  const world = new AssetWorld(engine.scene, engine.renderer)
  let mode = null
  let saving = false
  let catalog = new Map()
  let placements = []
  let banner = null
  let down = null
  const notify = (text, error = false) => hud.toast(text, error ? 'err' : '')

  async function refreshWorld() {
    const data = await assetRequest()
    catalog = new Map(data.assets.map((asset) => [asset.id, asset]))
    placements = data.placements
    const currentIds = new Set(placements.map((p) => p.id))
    for (const id of world.items.keys()) if (!currentIds.has(id)) world.remove(id)
    const changed = placements.filter((p) => JSON.stringify(world.get(p.id)) !== JSON.stringify(p))
    const errors = await world.restore(changed, data.assets)
    if (errors.length) notify(`${errors.length} placed model(s) could not load. Open Assets to retry or remove them.`, true)
    return data
  }

  async function savePlacement(placement, asset) {
    // Retain the current model until persistence succeeds; rollback needs no network.
    const staged = await world.stage(placement, asset)
    if (!staged) throw new Error('Placement was cancelled. Try again.')
    try {
      const result = await assetRequest(`/placements/${encodeURIComponent(placement.id)}`, 'PUT', placement)
      if (!staged.commit()) throw new Error('Placement changed while saving. Reopen Assets to reload it.')
      catalog.set(asset.id, asset)
      placements = [...placements.filter((p) => p.id !== placement.id), result.placement]
      world.select(placement.id)
      return result.placement
    } catch (error) {
      staged.dispose()
      throw error
    }
  }

  function stopPlacement() {
    mode = null
    world.clearGhost()
    banner?.remove()
    banner = null
    engine.canvas.style.cursor = 'grab'
    rig.enabled = !panel.open
  }

  function positionAt(event) {
    const point = rig.groundPoint(event.clientX, event.clientY, new THREE.Vector3())
    if (!point) return null
    point.x = THREE.MathUtils.clamp(point.x, -82, 82)
    point.z = THREE.MathUtils.clamp(point.z, -82, 82)
    point.y = colony.groundAt(point.x, point.z)
    return point.toArray()
  }

  async function startPlacement(asset, placement) {
    stopPlacement()
    const point = rig.target.clone()
    point.y = colony.groundAt(point.x, point.z)
    placement = { ...placement, position: point.toArray() }
    await world.ghost(asset, placement)
    mode = { asset, placement }
    rig.enabled = false
    engine.canvas.style.cursor = 'crosshair'
    banner = document.createElement('div')
    banner.className = 'asset-placement-banner'
    banner.setAttribute('role', 'status')
    const text = document.createElement('p')
    text.textContent = `Place ${asset.name}: point at the ground and click. Escape cancels.`
    const cancel = document.createElement('button')
    cancel.className = 'btn'
    cancel.textContent = 'Cancel placement'
    cancel.onclick = () => { if (!saving) { stopPlacement(); panel.show() } }
    banner.append(text, cancel)
    engine.canvas.parentElement.append(banner)
  }

  const panel = new AssetPanel({
    onOpen: () => { rig.cancelInteraction(); rig.enabled = false; rig.orbiting = false },
    onClose: () => { rig.enabled = !mode },
    onPlace: startPlacement,
    onSavePlacement: savePlacement,
    onRemovePlacement: async (id) => {
      await assetRequest(`/placements/${encodeURIComponent(id)}`, 'DELETE')
      world.remove(id)
      placements = placements.filter((p) => p.id !== id)
    },
    onRefresh: refreshWorld,
    onFocus: (placement) => {
      if (!placement) return
      world.select(placement.id)
      rig.focus(new THREE.Vector3(...placement.position), { distance: 14 })
      panel.close(true)
    },
  })

  launch.addEventListener('click', () => {
    if (saving) return
    stopPlacement()
    panel.show()
  })

  // Capture protects both the camera's handlers and legacy colony picking below this layer.
  engine.canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY }
    if (mode || saving) { event.preventDefault(); event.stopImmediatePropagation() }
  }, true)
  engine.canvas.addEventListener('pointermove', (event) => {
    if (!mode) return
    event.stopImmediatePropagation()
    const position = positionAt(event)
    if (position) {
      mode.placement.position = position
      world.moveGhost(position)
    }
  }, true)
  engine.canvas.addEventListener('pointerup', async (event) => {
    if (event.button !== 0) return
    if (saving) { event.stopImmediatePropagation(); return }
    if (mode) {
      event.stopImmediatePropagation()
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return
      const position = positionAt(event)
      if (!position) return
      const { asset, placement } = mode
      placement.position = position
      saving = true
      try {
        await savePlacement(placement, asset)
        stopPlacement()
        notify('Asset placed. Click it to edit or swap the model.')
      } catch (error) { notify(error.message, true) }
      finally { saving = false }
      return
    }
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 || panel.open) return
    const rect = engine.canvas.getBoundingClientRect()
    const id = world.pick(engine.camera, { x: ((event.clientX - rect.left) / rect.width) * 2 - 1, y: -((event.clientY - rect.top) / rect.height) * 2 + 1 })
    if (id) {
      event.stopImmediatePropagation()
      world.select(id)
      panel.show(id)
    } else world.select(null)
  }, true)
  window.addEventListener('keydown', (event) => {
    if (panel.open) {
      // Native dialog owns Tab and Escape; stop legacy H/A/Enter/world shortcuts.
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); panel.close() }
      return
    }
    if (!mode) return
    event.stopImmediatePropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!saving) { stopPlacement(); panel.show() }
    }
  }, true)
  engine.add({ update(dt) { world.update(dt) } })
  await refreshWorld().catch((error) => notify(`Asset library unavailable: ${error.message}`, true))
  return { panel, world, refresh: refreshWorld }
}
