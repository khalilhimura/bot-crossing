import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AssetWorld } from '../src/assets/world.js';

const placement = (extra = {}) => ({ id: 'one', assetId: 'box', position: [2, 0, 3], yaw: 0.5, scale: 2, ...extra });
function model(animated = false) {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mesh.name = 'shape';
  mesh.position.y = 0.5;
  root.add(mesh);
  const value = { root, clips: animated ? [new THREE.AnimationClip('walk', 1, [new THREE.NumberKeyframeTrack('shape.position[x]', [0, 1], [0, 1])])] : [], disposed: 0 };
  value.dispose = () => { value.disposed++; mesh.geometry.dispose(); mesh.material.dispose(); };
  return value;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('replacement retains transform and only disposes the old instance after success', async () => {
  const scene = new THREE.Scene();
  const first = model();
  const second = model();
  let next = first;
  const world = new AssetWorld(scene, null, { load: async () => { if (next instanceof Error) throw next; return next; } });
  await world.set(placement(), {});
  next = new Error('bad model');
  await assert.rejects(world.set(placement({ assetId: 'bad' }), {}), /bad model/);
  assert.equal(world.items.get('one').loaded, first);
  assert.equal(first.disposed, 0);
  next = second;
  await world.set(placement({ assetId: 'new' }), {});
  assert.equal(first.disposed, 1);
  const wrapper = second.root.parent;
  assert.deepEqual(wrapper.position.toArray(), [2, 0, 3]);
  assert.equal(wrapper.rotation.y, 0.5);
  assert.deepEqual(wrapper.scale.toArray(), [2, 2, 2]);
  assert.equal(world.get('one').assetId, 'new');
  world.dispose();
  assert.equal(second.disposed, 1);
});

test('removal and a later replacement invalidate outstanding loads', async () => {
  const jobs = [];
  const world = new AssetWorld(new THREE.Scene(), null, { load: () => { const job = deferred(); jobs.push(job); return job.promise; } });
  const old = model();
  const pending = world.set(placement(), {});
  world.remove('one');
  jobs[0].resolve(old);
  await pending;
  assert.equal(world.items.size, 0);
  assert.equal(old.disposed, 1);
  const a = model(), b = model();
  const p1 = world.set(placement(), {});
  const p2 = world.set(placement({ assetId: 'new' }), {});
  jobs[2].resolve(b);
  await p2;
  jobs[1].resolve(a);
  await p1;
  assert.equal(world.items.get('one').loaded, b);
  assert.equal(a.disposed, 1);
  world.dispose();
});

test('pick and selection identify only placed models; animations advance within wrapper', async () => {
  const scene = new THREE.Scene();
  const loaded = model(true);
  const world = new AssetWorld(scene, null, { load: async () => loaded });
  await world.set(placement({ position: [0, 0, 0], yaw: 0, scale: 1, animation: 'walk' }), {});
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0.5, 5);
  camera.lookAt(0, 0.5, 0);
  camera.updateMatrixWorld();
  assert.equal(world.pick(camera, new THREE.Vector2(0, 0)), 'one');
  assert.equal(world.pick(camera, new THREE.Vector2(1, 1)), null);
  world.select('one');
  assert.ok(scene.children.some(child => child instanceof THREE.BoxHelper));
  world.update(0.25);
  assert.equal(loaded.root.getObjectByName('shape').position.x, 0.25);
  assert.deepEqual(loaded.root.parent.position.toArray(), [0, 0, 0]);
  world.remove('one');
  assert.equal(scene.children.length, 0);
});

test('ghost stays independent, moves, and disposes after cancellation including pending load', async () => {
  const scene = new THREE.Scene();
  const jobs = [];
  const world = new AssetWorld(scene, null, { load: () => { const job = deferred(); jobs.push(job); return job.promise; } });
  const first = model();
  const pending = world.ghost({}, placement());
  jobs[0].resolve(first);
  await pending;
  assert.equal(world.items.size, 0);
  world.moveGhost([9, 0, 8]);
  assert.deepEqual(first.root.parent.position.toArray(), [9, 0, 8]);
  world.clearGhost();
  assert.equal(first.disposed, 1);
  assert.equal(scene.children.length, 0);
  const second = model();
  const cancelled = world.ghost({}, placement());
  world.clearGhost();
  jobs[1].resolve(second);
  await cancelled;
  assert.equal(second.disposed, 1);
  assert.equal(scene.children.length, 0);
});

test('restore keeps successful placements and reports individual missing or failed assets', async () => {
  const world = new AssetWorld(new THREE.Scene(), null, { load: async asset => { if (asset.id === 'bad') throw new Error('broken'); return model(); } });
  const errors = await world.restore([placement(), placement({ id: 'two', assetId: 'bad' }), placement({ id: 'three', assetId: 'missing' })], [{ id: 'box' }, { id: 'bad' }]);
  assert.equal(world.items.size, 1);
  assert.equal(errors.length, 2);
  assert.deepEqual(errors.map(e => e.id), ['two', 'three']);
  world.dispose();
});

test('disposing a staged replacement retains the same original object without reloading', async () => {
  const first = model(), second = model();
  let calls = 0;
  const world = new AssetWorld(new THREE.Scene(), null, { load: async () => ++calls === 1 ? first : second });
  await world.set(placement(), {});
  const transaction = await world.stage(placement({ assetId: 'replacement' }), {});
  assert.equal(world.items.get('one').loaded, first);
  assert.equal(first.disposed, 0);
  transaction.dispose();
  transaction.dispose();
  assert.equal(transaction.commit(), null);
  assert.equal(world.items.get('one').loaded, first);
  assert.equal(first.disposed, 0);
  assert.equal(second.disposed, 1);
  assert.equal(calls, 2);
  world.dispose();
});

test('committing a staged replacement disposes the original and applies the saved transform', async () => {
  const first = model(), second = model();
  let next = first;
  const world = new AssetWorld(new THREE.Scene(), null, { load: async () => next });
  await world.set(placement(), {});
  next = second;
  const saved = placement({ assetId: 'replacement', position: [8, 2, 9], yaw: 1.5, scale: 4 });
  const transaction = await world.stage(saved, {});
  assert.equal(first.disposed, 0);
  assert.deepEqual(transaction.commit(), saved);
  transaction.dispose();
  assert.equal(first.disposed, 1);
  assert.equal(second.disposed, 0);
  assert.deepEqual(second.root.parent.position.toArray(), [8, 2, 9]);
  assert.equal(second.root.parent.rotation.y, 1.5);
  assert.deepEqual(second.root.parent.scale.toArray(), [4, 4, 4]);
  world.dispose();
});

test('removal cancels both loading and prepared transactions without resurrecting assets', async () => {
  const job = deferred();
  const first = model(), second = model();
  const world = new AssetWorld(new THREE.Scene(), null, { load: () => job.promise });
  const pending = world.stage(placement(), {});
  world.remove('one');
  job.resolve(first);
  assert.equal(await pending, null);
  assert.equal(first.disposed, 1);
  world.load = async () => second;
  const transaction = await world.stage(placement(), {});
  world.remove('one');
  assert.equal(second.disposed, 1);
  assert.equal(transaction.commit(), null);
  assert.equal(world.items.size, 0);
  world.dispose();
});

test('superseding and disposing the world release prepared transactions', async () => {
  const a = model(), b = model();
  let next = a;
  const world = new AssetWorld(new THREE.Scene(), null, { load: async () => next });
  const first = await world.stage(placement(), {});
  next = b;
  const second = await world.stage(placement(), {});
  assert.equal(a.disposed, 1);
  assert.equal(first.commit(), null);
  world.dispose();
  assert.equal(b.disposed, 1);
  assert.equal(second.commit(), null);
});
