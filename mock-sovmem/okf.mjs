import { parseDocument, stringify } from 'yaml';
import { readdirSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, relative, sep, posix } from 'node:path';
import { digest, fail, instant } from './common.mjs';
export const PIN = 'ad30107c31c06aec8a7d5636e0d1058118604e6f';
export function parse(raw, path) {
  if (Buffer.byteLength(raw) > 262144) fail('limit.document', 'Document exceeds 256 KiB');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  const reserved = ['index.md', 'log.md'].includes(posix.basename(path));
  const diagnostics = [];
  let meta = {}, body = raw;
  if (match) {
    try {
      const doc = parseDocument(match[1], { uniqueKeys: true, customTags: [], maxAliasCount: 20 });
      if (doc.errors.length) throw new Error('Invalid YAML');
      meta = doc.toJS({ maxAliasCount: 20 }); body = match[2];
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('Mapping required');
    } catch { fail('okf.malformed', `Invalid YAML in ${path}`); }
  } else if (!reserved) diagnostics.push('frontmatter.missing');
  if (!reserved && (typeof meta.type !== 'string' || !meta.type.trim())) diagnostics.push('type.missing');
  if (reserved && match && (path !== 'index.md' || Object.keys(meta).some(k => k !== 'okf_version'))) diagnostics.push('reserved.frontmatter');
  if (path === 'index.md' && meta.okf_version && meta.okf_version !== '0.2') diagnostics.push('version.unsupported');
  const sources = Array.isArray(meta.sources) ? meta.sources : [];
  if (meta.sources !== undefined && !Array.isArray(meta.sources)) diagnostics.push('sources.invalid');
  const ids = new Set();
  for (const source of sources) {
    if (!source || typeof source.resource !== 'string') diagnostics.push('source.resource_missing');
    if (source?.id) { if (ids.has(source.id)) diagnostics.push('source.id_duplicate'); ids.add(source.id); }
  }
  for (const m of body.matchAll(/\[\^([^\]]+)\]/g)) if (!ids.has(m[1])) diagnostics.push('source.footnote_unresolved');
  let verified = meta.verified === undefined ? [] : (Array.isArray(meta.verified) ? meta.verified : [meta.verified]);
  const trust = verified.length ? (verified.some(v => typeof v?.by === 'string' && v.by.startsWith('human:')) ? 'asserted_human_reviewed' : 'asserted_machine_confirmed') : 'unverified';
  const native = meta.sovmem && typeof meta.sovmem === 'object' ? meta.sovmem : null;
  function timestamps(value, depth = 0) {
    if (depth > 24) fail('limit.depth', 'Metadata nesting exceeds 24');
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['at','stale_after','last_modified','from','to'].includes(key) && item != null) {
        try { instant(item); } catch { diagnostics.push('timestamp.invalid'); }
      }
      if (typeof item === 'object') timestamps(item, depth + 1);
    }
  }
  timestamps(meta);
  return { path, raw, body, meta, native, reserved, sources, verified, trust, diagnostics: [...new Set(diagnostics)], digest: digest(raw) };
}
export function serialize(meta, body) { return `---\n${stringify(meta, { lineWidth: 0 })}---\n\n${body.trim()}\n`; }
export function readBundle(root) {
  const base = realpathSync(root); const records = []; let bytes = 0;
  function walk(dir, depth) {
    if (depth > 12) fail('limit.depth', 'Bundle depth exceeds 12');
    for (const entry of readdirSync(dir).sort()) {
      const file = resolve(dir, entry), st = lstatSync(file);
      if (st.isSymbolicLink()) fail('path.unsafe', 'Symlinks are not allowed in mock bundles');
      if (st.isDirectory()) walk(file, depth + 1);
      else if (entry.endsWith('.md')) {
        if (++bytes > 4194304 || records.length >= 256 || st.size > 262144) fail('limit.bundle', 'Bundle exceeds limits');
        bytes += st.size;
        const raw = readFileSync(file, 'utf8');
        records.push(parse(raw, relative(base, file).split(sep).join('/')));
      }
    }
  }
  walk(base, 0); return records;
}
export function linkPath(from, target) {
  if (typeof target !== 'string' || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return null;
  const clean = target.split('#')[0]; if (!clean) return from;
  let decoded; try { decoded = decodeURIComponent(clean); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0')) return null;
  const normalized = posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : posix.join(posix.dirname(from), decoded));
  return normalized.startsWith('../') || normalized === '..' ? null : normalized;
}
export function conformance(docs) {
  const paths = new Set(docs.map(d => d.path));
  const extra = [];
  for (const d of docs) {
    for (const m of d.body.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = linkPath(d.path, m[1]);
      if (target && !paths.has(target)) extra.push({ path: d.path, code: 'link.unresolved' });
    }
    for (const e of d.native?.edges ?? []) if (!docs.some(x => x.native?.id === e.target_id && x.native?.revision === e.target_revision)) extra.push({ path: d.path, code: 'native.edge_unresolved' });
  }
  return { conformant: !docs.some(d => d.diagnostics.some(x => ['type.missing', 'frontmatter.missing', 'reserved.frontmatter'].includes(x))), documents: docs.length,
    diagnostics: [...docs.flatMap(d => d.diagnostics.map(code => ({ path: d.path, code }))), ...extra], okf_version: '0.2', spec_commit: PIN, profile: 'experimental-mock' };
}
