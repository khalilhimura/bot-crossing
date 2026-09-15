import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CameraRig } from '../src/core/camera.js';

test('cancelling a captured gesture stops hover motion and allows a fresh drag', t => {
  const originalWindow = globalThis.window;
  globalThis.window = new EventTarget();
  const canvas = new EventTarget();
  canvas.style = {};
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  const rig = new CameraRig(new THREE.PerspectiveCamera(45, 800 / 600, .1, 500), canvas, { get: () => false });
  t.after(() => { rig.dispose(); globalThis.window = originalWindow; });
  const pointer = { pointerId: 1, clientX: 400, clientY: 300, button: 0, preventDefault() {} };
  rig._pointerDown(pointer);
  assert.equal(rig.interacting, true);
  const before = rig.target.clone();
  rig.cancelInteraction();
  rig.enabled = false;
  rig._pointerMove({ ...pointer, clientX: 500 });
  assert.deepEqual(rig.target.toArray(), before.toArray());
  assert.equal(rig.interacting, false);
  rig.enabled = true;
  rig._pointerDown({ ...pointer, pointerId: 2 });
  rig._pointerMove({ ...pointer, pointerId: 2, clientX: 450 });
  assert.notDeepEqual(rig.target.toArray(), before.toArray());
  rig._pointerUp({ pointerId: 2 });
  assert.equal(rig.interacting, false);
});
