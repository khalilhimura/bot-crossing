import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, fail, FORMAT } from './common.mjs';
import { readBundle, parse } from './okf.mjs';
export const SEED = fileURLToPath(new URL('./fixtures/bundle/', import.meta.url));
function safeFile(file, max) {
  const st = lstatSync(file); if (!st.isFile() || st.isSymbolicLink() || st.size > max) fail('store.invalid', 'Unsafe or oversized mock state');
  return readFileSync(file, 'utf8');
}
export function openStore(path, init = false) {
  const root = resolve(path);
  if (init) {
    if (existsSync(root)) fail('store.exists', 'Initialization requires a new directory');
    if (!existsSync(dirname(root))) fail('store.parent_missing', 'Create the parent directory first');
    mkdirSync(root, { mode: 0o700 }); mkdirSync(join(root, 'documents'), { mode: 0o700 });
    const state = { format: FORMAT, demo: true, generation: 1, policy: 1, snapshots: {}, proposals: {}, packets: {}, topics: {}, missions: {}, verdicts: [], denied: [], scenario: null };
    const store = { root, state };
    state.snapshots[1] = readBundle(SEED).map(d => writeDocument(store, d.path, d.raw));
    save(store);
  }
  if (!existsSync(root) || lstatSync(root).isSymbolicLink()) fail('store.uninitialized', 'An explicitly initialized mock store is required');
  const actual = realpathSync(root);
  const stateFile = join(actual, 'state.json');
  if (!existsSync(stateFile)) fail('store.uninitialized', 'Not a mock store');
  const lock = join(actual, '.lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch (e) { if (e.code === 'EEXIST') fail('store.busy', 'Store is locked; inspect any interrupted process before removing its lock'); throw e; }
  try {
    const state = JSON.parse(safeFile(stateFile, 16 * 1024 * 1024));
    if (state.format !== FORMAT || state.demo !== true || !Number.isInteger(state.generation) || !state.snapshots?.[state.generation]) fail('store.invalid', 'Not a valid mock state');
    const store = { root: actual, state, release: () => rmSync(lock, { recursive: true }) };
    documents(store); return store;
  } catch (e) { rmSync(lock, { recursive: true }); if (!e.code) fail('store.invalid', 'Unreadable mock state'); throw e; }
}
export function save(store) {
  const out = JSON.stringify(store.state, null, 2) + '\n';
  if (Buffer.byteLength(out) > 16 * 1024 * 1024) fail('limit.store', 'Mock state exceeds 16 MiB');
  const tmp = join(store.root, `state-${process.pid}.tmp`);
  writeFileSync(tmp, out, { mode: 0o600, flag: 'wx' }); renameSync(tmp, join(store.root, 'state.json'));
}
export function writeDocument(store, path, raw) {
  const hash = digest(raw), directory = join(store.root, 'documents');
  if (lstatSync(directory).isSymbolicLink()) fail('store.invalid', 'Unsafe document directory');
  const file = join(directory, `${hash}.md`);
  if (!existsSync(file)) writeFileSync(file, raw, { mode: 0o600, flag: 'wx' });
  return { path, hash };
}
export function documents(store, generation = store.state.generation) {
  const refs = store.state.snapshots[generation];
  if (!Array.isArray(refs)) fail('generation.unavailable', 'Snapshot unavailable');
  if (refs.length > 512) fail('limit.store', 'Too many documents');
  const directory = join(store.root, 'documents');
  if (lstatSync(directory).isSymbolicLink()) fail('store.invalid', 'Unsafe document directory');
  return refs.map(ref => {
    if (!/^[a-f0-9]{64}$/.test(ref.hash) || typeof ref.path !== 'string' || ref.path.includes('..') || ref.path.startsWith('/')) fail('store.invalid', 'Invalid document reference');
    const raw = safeFile(join(directory, `${ref.hash}.md`), 262144);
    if (digest(raw) !== ref.hash) fail('store.integrity', 'Mock document digest mismatch');
    return parse(raw, ref.path);
  });
}
export function publish(store, additions) {
  const old = store.state.snapshots[store.state.generation];
  const added = additions.map(d => writeDocument(store, d.path, d.raw));
  store.state.generation += 1;
  store.state.snapshots[store.state.generation] = [...old.filter(r => !added.some(a => a.path === r.path)), ...added];
}
