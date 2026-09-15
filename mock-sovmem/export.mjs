import { existsSync, mkdirSync, writeFileSync, realpathSync, renameSync, rmSync, mkdtempSync } from 'node:fs';
import { join, resolve, dirname, relative, basename } from 'node:path';
import { history, view } from './reads.mjs';
import { documents } from './store.mjs';
import { serialize, linkPath, readBundle, conformance } from './okf.mjs';
import { check, fail } from './common.mjs';
export function exportBundle(store, p) {
  check(typeof p.output === 'string'); const output = resolve(p.output);
  if (existsSync(output)) fail('export.exists', 'Export requires a new directory');
  const parent = realpathSync(dirname(output)), actual = join(parent, basename(output));
  const rel = relative(store.root, actual);
  if (rel === '' || (!rel.startsWith('..') && !resolve(rel).startsWith('/../'))) fail('path.unsafe', 'Export must be outside the store');
  const docs = history(store, p), allowed = docs.filter(d => view(store, d, docs).body === d.body);
  const key = d => `${d.native.id}@${d.native.revision}`;
  const paths = new Map(allowed.map(d => [key(d), `records/${d.native.id}/r${d.native.revision}.md`]));
  const stage = mkdtempSync(join(parent, '.nous-mock-export-'));
  try {
    for (const d of allowed) {
      const origin = documents(store, d.origin_generation);
      const mapLink = value => {
        const target = origin.find(x => x.path === linkPath(d.path, value) && x.native);
        return target && paths.has(key(target)) ? `/${paths.get(key(target))}` : value;
      };
      const meta = structuredClone(d.meta);
      meta.sources = (meta.sources ?? []).map(s => ({ ...s, resource: s.sovmem_ref && paths.has(`${s.sovmem_ref.id}@${s.sovmem_ref.revision}`) ? `/${paths.get(`${s.sovmem_ref.id}@${s.sovmem_ref.revision}`)}` : mapLink(s.resource) }));
      const body = d.body.replace(/(\[[^\]]+\]\()([^)]+)(\))/g, (_, a, url, b) => `${a}${mapLink(url)}${b}`);
      const dest = join(stage, paths.get(key(d))); mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, serialize(meta, body), { mode: 0o600 });
    }
    writeFileSync(join(stage, 'index.md'), `---\nokf_version: "0.2"\n---\n# Demo memory export\n\n${allowed.map(d => `- [${key(d)}](${paths.get(key(d))})`).join('\n')}\n`, { mode: 0o600 });
    const report = conformance(readBundle(stage));
    if (!report.conformant) fail('export.invalid', 'Generated bundle failed conformance');
    renameSync(stage, actual);
    return { output: actual, generation: store.state.generation, documents: allowed.length, recovery_archive: false, conformance: report };
  } catch (e) { rmSync(stage, { recursive: true, force: true }); throw e; }
}
