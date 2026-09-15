import * as THREE from 'three';

const defaultLoad = async (asset, renderer) => (await import('./loader.js')).loadAsset(asset, renderer);

function makeItem(placement, loaded) {
  const wrapper = new THREE.Group();
  wrapper.name = `asset-instance:${placement.id || 'ghost'}`;
  wrapper.position.fromArray(placement.position || [0, 0, 0]);
  wrapper.rotation.y = placement.yaw || 0;
  wrapper.scale.setScalar(placement.scale ?? 1);
  wrapper.add(loaded.root);
  let mixer = null;
  const clip = loaded.clips.find(clip => clip.name === placement.animation);
  if (clip) {
    mixer = new THREE.AnimationMixer(loaded.root);
    mixer.clipAction(clip).play();
  }
  return { placement: structuredClone(placement), loaded, wrapper, mixer };
}

function disposeItem(item) {
  if (!item) return;
  item.mixer?.stopAllAction();
  item.mixer?.uncacheRoot(item.loaded.root);
  item.wrapper.removeFromParent();
  item.loaded.dispose();
}

/** Independent asset instances. Persistence and UI belong to the caller. */
export class AssetWorld {
  constructor(scene, renderer, { load = defaultLoad } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.load = load;
    this.items = new Map();
    this.pending = new Map();
    this.staged = new Map();
    this.selected = null;
    this.selectionBox = null;
    this.ghostItem = null;
    this.ghostToken = null;
    this.ghostPosition = null;
    this.disposed = false;
    this.raycaster = new THREE.Raycaster();
  }

  /** Returns the installed placement, or null if superseded or cancelled. */
  async set(placement, asset) {
    const transaction = await this.stage(placement, asset);
    return transaction?.commit() ?? null;
  }

  /** Prepare resources without changing the world; commit only after persistence succeeds. */
  async stage(placement, asset) {
    if (this.disposed) throw new Error('Asset world has been disposed.');
    const snapshot = structuredClone(placement);
    const token = Symbol();
    this.staged.get(snapshot.id)?.dispose();
    this.pending.set(snapshot.id, token);
    let loaded;
    try {
      loaded = await this.load(asset, this.renderer);
    } catch (error) {
      if (this.pending.get(snapshot.id) === token) this.pending.delete(snapshot.id);
      throw error;
    }
    if (this.disposed || this.pending.get(snapshot.id) !== token) {
      loaded.dispose();
      return null;
    }
    let item;
    try {
      item = makeItem(snapshot, loaded);
    } catch (error) {
      this.pending.delete(snapshot.id);
      loaded.dispose();
      throw error;
    }
    let finished = false;
    const release = () => {
      if (this.pending.get(snapshot.id) === token) this.pending.delete(snapshot.id);
      if (this.staged.get(snapshot.id) === transaction) this.staged.delete(snapshot.id);
    };
    const transaction = {
      commit: () => {
        if (finished) return null;
        if (this.disposed || this.pending.get(snapshot.id) !== token) {
          transaction.dispose();
          return null;
        }
        finished = true;
        release();
        disposeItem(this.items.get(snapshot.id));
        this.items.set(snapshot.id, item);
        this.scene.add(item.wrapper);
        if (this.selected === snapshot.id) this.select(snapshot.id);
        return this.get(snapshot.id);
      },
      dispose: () => {
        if (finished) return;
        finished = true;
        release();
        disposeItem(item);
      },
    };
    this.staged.set(snapshot.id, transaction);
    return transaction;
  }

  get(id) {
    const placement = this.items.get(id)?.placement;
    return placement ? structuredClone(placement) : null;
  }

  remove(id) {
    this.staged.get(id)?.dispose();
    this.pending.delete(id);
    if (this.selected === id) this.select(null);
    disposeItem(this.items.get(id));
    this.items.delete(id);
  }

  /** Restoration errors are {id, error}; successful instances remain usable. */
  async restore(placements, assets) {
    const catalog = assets instanceof Map ? assets : new Map(assets.map(asset => [asset.id, asset]));
    const errors = [];
    for (const placement of placements) {
      try {
        const asset = catalog.get(placement.assetId);
        if (!asset) throw new Error(`Asset ${placement.assetId} is missing.`);
        await this.set(placement, asset);
      } catch (error) {
        errors.push({ id: placement.id, error: error.message || String(error) });
      }
    }
    return errors;
  }

  pick(camera, ndc) {
    this.scene.updateMatrixWorld(true);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, camera);
    const roots = [...this.items.values()].map(item => item.wrapper);
    const hit = this.raycaster.intersectObjects(roots, true)[0];
    if (!hit) return null;
    let object = hit.object;
    const ids = new Map([...this.items].map(([id, item]) => [item.wrapper, id]));
    while (object) {
      if (ids.has(object)) return ids.get(object);
      object = object.parent;
    }
    return null;
  }

  select(id) {
    if (this.selectionBox) {
      this.selectionBox.removeFromParent();
      this.selectionBox.dispose();
      this.selectionBox = null;
    }
    const item = this.items.get(id);
    this.selected = item ? id : null;
    if (item) {
      item.wrapper.updateWorldMatrix(true, true);
      this.selectionBox = new THREE.BoxHelper(item.wrapper, 0x70e1ff);
      this.scene.add(this.selectionBox);
    }
  }

  update(dt) {
    for (const item of this.items.values()) item.mixer?.update(dt);
    this.ghostItem?.mixer?.update(dt);
    this.selectionBox?.update();
  }

  async ghost(asset, placement = {}) {
    if (this.disposed) throw new Error('Asset world has been disposed.');
    this.clearGhost();
    const token = Symbol();
    this.ghostToken = token;
    const snapshot = structuredClone(placement);
    this.ghostPosition = [...(snapshot.position || [0, 0, 0])];
    const loaded = await this.load(asset, this.renderer);
    if (this.disposed || this.ghostToken !== token) {
      loaded.dispose();
      return null;
    }
    snapshot.position = this.ghostPosition;
    try {
      this.ghostItem = makeItem(snapshot, loaded);
    } catch (error) {
      loaded.dispose();
      throw error;
    }
    this.ghostItem.wrapper.name = 'asset-placement-preview';
    this.ghostItem.wrapper.userData.assetGhost = true;
    this.scene.add(this.ghostItem.wrapper);
    return this.ghostItem;
  }

  moveGhost(position) {
    this.ghostPosition = [...position];
    if (this.ghostItem) {
      this.ghostItem.placement.position = [...position];
      this.ghostItem.wrapper.position.fromArray(position);
    }
  }

  clearGhost() {
    this.ghostToken = null;
    this.ghostPosition = null;
    disposeItem(this.ghostItem);
    this.ghostItem = null;
  }

  dispose() {
    this.disposed = true;
    for (const transaction of this.staged.values()) transaction.dispose();
    this.pending.clear();
    this.clearGhost();
    this.select(null);
    for (const id of this.items.keys()) this.remove(id);
  }
}
