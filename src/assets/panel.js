import { AssetPreview } from './preview.js'
import { assetRequest, assetPath } from './client.js'
import './assets.css'

const button = (label, action, cls = '') => {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `btn ${cls}`
  el.textContent = label
  el.addEventListener('click', action)
  return el
}
const options = (select, values) => {
  select.replaceChildren(...values.map(([value, label]) => {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    return option
  }))
}

export class AssetPanel {
  constructor({ onOpen, onClose, onPlace, onSavePlacement, onRemovePlacement, onRefresh, onFocus }) {
    Object.assign(this, { onOpen, onClose, onPlace, onSavePlacement, onRemovePlacement, onRefresh, onFocus })
    this.assets = []
    this.placements = []
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'asset-dialog'
    this.dialog.setAttribute('aria-labelledby', 'asset-title')
    this.dialog.innerHTML = `
      <header class="asset-header"><div><h1 id="asset-title">Assets</h1><p>Choose a model. Make it part of your world.</p></div><button type="button" class="btn" data-action="close" aria-label="Close assets">Close</button></header>
      <div class="asset-status" role="status" aria-live="polite">Loading library…</div>
      <div class="asset-layout">
        <aside class="asset-library">
          <button type="button" class="btn primary asset-import" data-action="import">Import GLB</button>
          <input type="file" accept=".glb,model/gltf-binary" hidden aria-label="Choose GLB file">
          <p class="asset-drop-hint">Or drop a GLB here. Up to 50 MiB, with textures embedded.</p>
          <label>Search assets<input type="search" name="search" placeholder="Find a model…"></label>
          <label>Collection<select name="collection"><option value="all">All assets</option><option value="bundled">Bundled</option><option value="imported">Imported</option></select></label>
          <label>Category<select name="filter-category"><option value="all">All categories</option></select></label>
          <p class="asset-count"></p>
          <div class="asset-list" aria-label="Asset library"></div>
          <details class="asset-placements" open><summary>In the world <span class="asset-placement-count">0</span></summary><div class="asset-instance-list"></div></details>
        </aside>
        <section class="asset-detail" aria-label="Selected asset">
          <div class="asset-preview"></div>
          <p class="asset-preview-help">Drag to orbit · Scroll to zoom · Arrow keys turn, +/− zoom</p>
          <div class="asset-empty">Select a model to inspect it, or import your own GLB.</div>
          <div class="asset-inspector" hidden>
            <h2 class="asset-name"></h2><p class="asset-facts"></p><p class="asset-credit"></p>
            <label>Preview animation<select name="preview-animation"></select></label>
            <form class="asset-metadata">
              <label>Name<input name="name" required maxlength="120"></label>
              <label>Category<input name="category" maxlength="80" placeholder="Prop, nature, character…"></label>
              <label>Source<input name="source" maxlength="500" placeholder="Pack URL or Meshy task reference"></label>
              <div class="asset-pair"><label>Creator<input name="creator" maxlength="200"></label><label>Licence<input name="license" maxlength="200" placeholder="Unknown"></label></div>
              <div class="asset-actions"><button class="btn primary" type="submit" data-action="save-asset">Save changes</button><button class="btn" type="button" data-action="delete-asset">Delete asset</button></div>
            </form>
            <div class="asset-confirm" hidden></div>
            <div class="asset-actions"><button class="btn primary" type="button" data-action="place">Place in world</button></div>
            <form class="asset-transform">
              <h3 class="asset-transform-title">Placement</h3>
              <p class="asset-instance-note">Position and size apply to the placed instance.</p>
              <div class="asset-triple"><label>X<input name="x" type="number" step="any" min="-1000" max="1000" required></label><label>Y<input name="y" type="number" step="any" min="-1000" max="1000" required></label><label>Z<input name="z" type="number" step="any" min="-1000" max="1000" required></label></div>
              <div class="asset-pair"><label>Rotation (degrees)<input name="yaw" type="number" step="any" required></label><label>Scale<input name="scale" type="number" min="0.001" max="100" step="any" required></label></div>
              <label>World animation<select name="world-animation"></select></label>
              <div class="asset-actions"><button type="submit" class="btn" data-action="save-placement">Add at coordinates</button><button type="button" class="btn" data-action="move">Move in world</button><button type="button" class="btn" data-action="focus">Focus</button><button type="button" class="btn" data-action="remove-placement">Remove instance</button></div>
              <div class="asset-swap"><label>Replace instance with<select name="swap"></select></label><button type="button" class="btn" data-action="swap">Swap model</button></div>
            </form>
          </div>
        </section>
      </div>`
    document.body.append(this.dialog)
    this.$ = (query) => this.dialog.querySelector(query)
    this.field = (name) => this.$(`[name="${name}"]`)
    this.preview = new AssetPreview(this.$('.asset-preview'))
    this.wire()
  }

  get open() { return this.dialog.open }
  message(text, error = false) {
    this.$('.asset-status').textContent = text
    this.$('.asset-status').classList.toggle('error', error)
  }
  async run(action) {
    if (this.busy) return
    this.busy = true
    this.dialog.setAttribute('aria-busy', 'true')
    try { return await action() } catch (error) { this.message(error.message || 'Could not complete this action.', true) }
    finally { this.busy = false; this.dialog.setAttribute('aria-busy', 'false') }
  }

  wire() {
    const action = (name, fn) => this.$(`[data-action="${name}"]`).addEventListener('click', () => this.run(fn))
    this.$('[data-action="close"]').addEventListener('click', () => this.close())
    this.dialog.addEventListener('cancel', (event) => { event.preventDefault(); this.close() })
    action('import', () => this.$('input[type=file]').click())
    this.$('input[type=file]').addEventListener('change', (event) => {
      const file = event.target.files[0]
      event.target.value = ''
      if (file) this.run(() => this.importFile(file))
    })
    this.dialog.addEventListener('dragover', (event) => { event.preventDefault(); this.dialog.classList.add('asset-dragover') })
    this.dialog.addEventListener('dragleave', (event) => { if (!this.dialog.contains(event.relatedTarget)) this.dialog.classList.remove('asset-dragover') })
    this.dialog.addEventListener('drop', (event) => {
      event.preventDefault()
      this.dialog.classList.remove('asset-dragover')
      if (event.dataTransfer.files.length !== 1) return this.message('Drop one GLB at a time.', true)
      this.run(() => this.importFile(event.dataTransfer.files[0]))
    })
    for (const name of ['search', 'collection', 'filter-category']) this.field(name).addEventListener('input', () => this.renderList())
    this.field('preview-animation').addEventListener('change', () => this.preview.play(this.field('preview-animation').value))
    this.$('.asset-metadata').addEventListener('submit', (event) => { event.preventDefault(); this.run(() => this.saveAsset()) })
    this.$('.asset-transform').addEventListener('submit', (event) => { event.preventDefault(); this.run(() => this.saveTransform()) })
    action('place', async () => { await this.onPlace(this.asset, this.transform(false)); await this.close(true) })
    action('move', async () => { await this.onPlace(this.asset, this.transform(true)); await this.close(true) })
    action('focus', () => this.onFocus(this.instance))
    action('remove-placement', async () => {
      await this.onRemovePlacement(this.instance.id)
      this.instance = null
      await this.refresh()
      this.renderTransform()
      this.message('Instance removed. The model is still in your library.')
    })
    action('swap', async () => {
      const asset = this.assets.find((item) => item.id === this.field('swap').value)
      const placement = { ...this.instance, assetId: asset.id, animation: '' }
      const saved = await this.onSavePlacement(placement, asset)
      await this.refresh()
      await this.selectAsset(asset, saved)
      this.message('Model swapped. Position, rotation and scale were preserved.')
    })
    action('delete-asset', () => {
      const used = this.placements.filter((item) => item.assetId === this.asset.id).length
      const confirm = this.$('.asset-confirm')
      confirm.hidden = false
      const text = document.createElement('p')
      text.textContent = used ? `This model is used by ${used} instance(s). Delete the asset and those placements?` : 'Delete this imported asset from the library?'
      confirm.replaceChildren(text, button(used ? `Delete asset and ${used} instance(s)` : 'Confirm delete', () => this.run(async () => {
        await assetRequest(`${assetPath(this.asset.id)}?cascade=1`, 'DELETE')
        await this.onRefresh()
        this.clearSelection()
        await this.refresh()
        this.message('Asset deleted.')
      })), button('Keep asset', () => { confirm.hidden = true }))
    })
  }

  async show(instanceId) {
    if (!this.dialog.open) {
      this.returnFocus = document.activeElement
      this.dialog.showModal()
      this.onOpen()
      this.preview.resize()
    }
    await this.run(async () => {
      await this.onRefresh()
      await this.refresh()
      const instance = this.placements.find((item) => item.id === instanceId)
      if (instance) await this.selectAsset(this.assets.find((item) => item.id === instance.assetId), instance)
      else if (!this.asset && this.assets.length) await this.selectAsset(this.assets[0])
      else if (this.asset && !this.preview.loaded) await this.selectAsset(this.asset, this.instance)
    })
  }

  async close(force = false) {
    if (this.busy && !force) { this.message('Please wait for the current action to finish.'); return }
    // Internal place/move calls close while run() is busy; only prevent interrupted imports.
    if (this.importing) { this.message('Please wait for the import preview to finish.'); return }
    try { await this.discardPending() } catch (error) { this.message(error.message, true); return }
    this.preview.clear()
    this.dialog.close()
    this.onClose()
    this.returnFocus?.focus()
  }

  async refresh() {
    const data = await assetRequest()
    this.assets = data.assets
    this.placements = data.placements
    const category = this.field('filter-category').value
    options(this.field('filter-category'), [['all', 'All categories'], ...[...new Set(this.assets.map((a) => a.category).filter(Boolean))].sort().map((c) => [c, c])])
    this.field('filter-category').value = [...this.field('filter-category').options].some((o) => o.value === category) ? category : 'all'
    this.renderList()
    this.renderPlacements()
    options(this.field('swap'), this.assets.map((a) => [a.id, a.name]))
    this.message(`${this.assets.length} assets available. Imports are saved on this machine.`)
    return data
  }

  renderList() {
    const query = this.field('search').value.toLowerCase().trim()
    const collection = this.field('collection').value
    const category = this.field('filter-category').value
    const filtered = this.assets.filter((asset) => (collection === 'all' || asset.origin === collection) && (category === 'all' || asset.category === category) && `${asset.name} ${asset.category} ${asset.creator}`.toLowerCase().includes(query))
    this.$('.asset-count').textContent = `${filtered.length} of ${this.assets.length} models`
    const items = filtered.map((asset) => {
      const row = button('', () => this.run(() => this.selectAsset(asset)), 'asset-row')
      row.setAttribute('aria-pressed', String(asset.id === this.asset?.id))
      const name = document.createElement('span')
      name.textContent = asset.name
      const meta = document.createElement('small')
      meta.textContent = `${asset.category || 'Uncategorized'} · ${asset.origin}`
      row.append(name, meta)
      return row
    })
    this.$('.asset-list').replaceChildren(...items)
    if (!items.length) this.$('.asset-list').textContent = 'No matching models. Try another search or import a GLB.'
  }

  renderPlacements() {
    this.$('.asset-placement-count').textContent = this.placements.length
    const items = this.placements.map((placement, index) => {
      const asset = this.assets.find((a) => a.id === placement.assetId)
      return button(`${asset?.name || 'Missing asset'} #${index + 1}`, () => this.run(() => this.selectAsset(asset, placement)), 'asset-instance')
    })
    this.$('.asset-instance-list').replaceChildren(...items)
    if (!items.length) this.$('.asset-instance-list').textContent = 'No placed assets yet.'
  }

  clearSelection() {
    this.asset = this.instance = null
    this.preview.clear()
    this.$('.asset-inspector').hidden = true
    this.$('.asset-empty').hidden = false
    this.$('.asset-confirm').hidden = true
  }

  async discardPending() {
    if (!this.pending) return
    await assetRequest(`${assetPath(this.pending.id)}?pending=1`, 'DELETE')
    this.pending = null
    this.clearSelection()
  }

  async selectAsset(asset, instance = null) {
    if (!asset) throw new Error('This instance’s model is no longer available. Refresh the library.')
    if (this.pending && this.pending.id !== asset.id) await this.discardPending()
    this.asset = asset
    this.instance = instance
    this.ready = false
    this.$('.asset-confirm').hidden = true
    this.$('.asset-inspector').hidden = false
    this.$('.asset-empty').hidden = true
    this.$('.asset-name').textContent = asset.name
    this.$('.asset-facts').textContent = 'Loading model…'
    this.$('.asset-credit').textContent = `${asset.creator || 'Creator unknown'} · ${asset.license || 'Licence unknown'}${asset.source ? ` · ${asset.source}` : ''}`
    this.renderList()
    const editable = asset.origin === 'imported'
    for (const key of ['name', 'category', 'source', 'creator', 'license']) {
      this.field(key).value = asset[key] || ''
      this.field(key).readOnly = !editable
    }
    this.$('.asset-metadata').hidden = !editable
    this.$('[data-action="delete-asset"]').hidden = asset.status === 'pending'
    this.$('[data-action="save-asset"]').textContent = asset.status === 'pending' ? 'Save import' : 'Save changes'
    this.$('[data-action="place"]').disabled = true
    this.$('[data-action="save-asset"]').disabled = true
    this.$('.asset-transform').hidden = true
    this.message(`Loading ${asset.name}…`)
    try {
      const loaded = await this.preview.show(asset)
      if (!loaded || !this.open) return
      this.ready = true
      this.measured = { bounds: loaded.bounds, stats: loaded.stats, animations: loaded.clips.map((clip) => clip.name) }
      const dimensions = loaded.bounds.max.map((value, index) => Math.abs(value - loaded.bounds.min[index]).toFixed(2)).join(' × ')
      this.$('.asset-facts').textContent = `${(asset.bytes / 1024 / 1024).toFixed(2)} MiB · ${loaded.stats.meshes} meshes · ${loaded.stats.materials} materials · ${loaded.stats.triangles.toLocaleString()} triangles · Source size ${dimensions}`
      options(this.field('preview-animation'), [['', 'Stopped'], ...loaded.clips.map((clip) => [clip.name, clip.name])])
      options(this.field('world-animation'), [['', 'None'], ...loaded.clips.map((clip) => [clip.name, clip.name])])
      this.field('preview-animation').disabled = !loaded.clips.length
      this.$('[data-action="place"]').disabled = asset.status !== 'ready'
      this.$('[data-action="save-asset"]').disabled = false
      this.renderTransform()
      this.message(asset.status === 'pending' ? 'Preview ready. Name your model, then Save import.' : 'Model ready. Inspect it here or place it in the world.')
    } catch (error) {
      this.$('.asset-facts').textContent = 'Preview unavailable'
      throw error
    }
  }

  async importFile(file) {
    if (!/\.glb$/i.test(file.name)) throw new Error('Choose a .glb file exported with embedded textures.')
    if (file.size > 50 * 1024 * 1024) throw new Error('This file exceeds 50 MiB. Reduce mesh or texture size and export again.')
    await this.discardPending()
    this.importing = true
    this.message(`Importing ${file.name}…`)
    try {
      const { asset, duplicate } = await assetRequest('/import', 'POST', file, { 'Content-Type': 'model/gltf-binary', 'X-Asset-Name': encodeURIComponent(file.name) })
      if (asset.status === 'pending') this.pending = asset
      await this.selectAsset(asset)
      if (duplicate && asset.status === 'ready') this.message('This file is already in your library. Opened the existing asset.')
    } catch (error) {
      await this.discardPending().catch(() => {})
      throw error
    } finally { this.importing = false }
  }

  async saveAsset() {
    if (!this.ready) throw new Error('Wait for a successful preview before saving.')
    const metadata = Object.fromEntries(['name', 'category', 'source', 'creator', 'license'].map((name) => [name, this.field(name).value.trim()]))
    const pending = this.asset.status === 'pending'
    const { asset } = await assetRequest(`${assetPath(this.asset.id)}${pending ? '/finalize' : ''}`, pending ? 'POST' : 'PATCH', { ...metadata, ...(pending ? this.measured : {}) })
    this.pending = null
    this.asset = asset
    await this.refresh()
    await this.selectAsset(asset, this.instance)
    this.message(pending ? 'Import saved. Ready to place in the world.' : 'Asset details saved.')
  }

  renderTransform() {
    this.$('.asset-transform').hidden = !this.ready || this.asset.status !== 'ready'
    const p = this.instance || { position: [0, 0, 0], yaw: 0, scale: this.defaultScale(), animation: '' }
    for (const [index, name] of ['x', 'y', 'z'].entries()) this.field(name).value = Number(p.position[index].toFixed(3))
    this.field('yaw').value = Number((p.yaw * 180 / Math.PI).toFixed(2))
    this.field('scale').value = p.scale
    this.field('world-animation').value = p.animation || ''
    this.$('.asset-transform-title').textContent = this.instance ? 'Edit placed instance' : 'Place using coordinates'
    this.$('[data-action="save-placement"]').textContent = this.instance ? 'Save placement' : 'Add at coordinates'
    for (const name of ['move', 'focus', 'remove-placement']) this.$(`[data-action="${name}"]`).hidden = !this.instance
    this.$('.asset-swap').hidden = !this.instance
    this.field('swap').value = this.asset.id
  }

  defaultScale() {
    if (this.asset?.origin === 'bundled') return 1
    const bounds = this.measured?.bounds
    const span = bounds ? Math.max(...bounds.max.map((v, i) => v - bounds.min[i])) : 1
    return Number(Math.min(100, Math.max(.001, 3 / Math.max(span, .001))).toPrecision(4))
  }

  transform(existing = true) {
    if (!this.$('.asset-transform').reportValidity()) throw new Error('Enter valid position, rotation and scale values.')
    return {
      id: existing && this.instance ? this.instance.id : crypto.randomUUID(),
      assetId: this.asset.id,
      position: ['x', 'y', 'z'].map((name) => Number(this.field(name).value)),
      yaw: Number(this.field('yaw').value) * Math.PI / 180,
      scale: Number(this.field('scale').value),
      animation: this.field('world-animation').value,
    }
  }

  async saveTransform() {
    const saved = await this.onSavePlacement(this.transform(), this.asset)
    this.instance = saved
    await this.refresh()
    this.renderTransform()
    this.message('Placement saved.')
  }
}
