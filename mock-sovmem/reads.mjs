import { documents } from './store.mjs';
import { id, integer, instant, check, fail, digest, stable } from './common.mjs';
import { linkPath } from './okf.mjs';
export function visible(store, p = {}) {
  const generation = integer(p.generation, store.state.generation, 1, store.state.generation);
  if (p.scope !== undefined && p.scope !== 'pilot') fail('scope.denied', 'Scope unavailable');
  const docs = documents(store, generation).filter(d => d.native && !store.state.denied.includes(d.native.id));
  return docs.filter(d => d.native.scope === 'pilot' && (p.archival === true || d.native.lifecycle !== 'retired'));
}
function safeBody(store, d, docs) {
  // Suppress content carrying denied locators, rather than leaking via embedded Markdown/frontmatter.
  const deniedDocs = documents(store).filter(x => x.native && store.state.denied.includes(x.native.id));
  const blocked = deniedDocs.some(x => d.raw.includes(x.native.id) || d.raw.includes(x.path));
  return blocked ? '[Content withheld because it references material outside the current scope.]' : d.body;
}
export function view(store, d, docs, p = {}) {
  const asOf = instant(p.as_of);
  const allowed = new Set(docs.map(x => x.native.id));
  const sourceAllowed = source => { if (source.sovmem_ref) return !store.state.denied.includes(source.sovmem_ref.id); const path = linkPath(d.path, source.resource); return !path || docs.some(x => x.path === path); };
  const stale = d.meta.stale_after;
  let freshness = 'unknown';
  if (stale) { try { instant(stale); freshness = Date.parse(asOf) >= Date.parse(stale) ? 'stale' : 'fresh'; } catch { freshness = 'invalid'; } }
  return { id: d.native.id, revision: d.native.revision, kind: d.native.kind, title: d.meta.title, body: safeBody(store, d, docs),
    path: d.path, digest: d.digest, scope: d.native.scope, lifecycle: d.native.lifecycle, epistemic_status: d.native.epistemic_status,
    acceptance: d.native.decision_ref ? 'simulated_accepted' : 'unaccepted', decision_ref: d.native.decision_ref ?? null,
    trust: d.trust, freshness, as_of: asOf, sources: d.sources.filter(sourceAllowed),
    edges: (d.native.edges ?? []).filter(e => allowed.has(e.target_id)), synthetic: true };
}
export function getDoc(store, p) {
  id(p.id); if (p.revision !== undefined) integer(p.revision, 1, 1, 10000);
  let docs = visible(store, p);
  let found = docs.find(d => d.native.id === p.id && (p.revision === undefined || d.native.revision === p.revision));
  if (!found && p.revision !== undefined && p.generation === undefined && !store.state.denied.includes(p.id)) {
    for (let g = store.state.generation - 1; g >= 1 && !found; g--) {
      const history = visible(store, { ...p, generation: g });
      found = history.find(d => d.native.id === p.id && d.native.revision === p.revision);
      if (found) docs = history;
    }
  }
  if (!found) fail('record.unavailable', 'Record or revision unavailable');
  return { doc: found, docs };
}
export function get(store, p) { const { doc, docs } = getDoc(store, p); return view(store, doc, docs, p); }
export function page(store, p, all) {
  const limit = integer(p.limit, 20, 1, 100), generation = p.generation ?? store.state.generation;
  const query = { ...p }; delete query.cursor;
  const fingerprint = digest(query);
  let offset = 0;
  if (p.cursor) {
    let c; try { c = JSON.parse(Buffer.from(p.cursor, 'base64url').toString()); } catch { fail('cursor.invalid', 'Invalid cursor'); }
    if (!c || typeof c !== 'object') fail('cursor.invalid', 'Invalid cursor');
    if (c.generation !== generation || c.policy !== store.state.policy || c.query !== fingerprint) fail('cursor.stale', 'Refresh query after generation, policy or query change');
    offset = integer(c.offset, 0, 0, 100000);
  }
  const next = offset + limit;
  return { items: all.slice(offset, next), generation, cursor: next < all.length ? Buffer.from(JSON.stringify({ generation, policy: store.state.policy, query: fingerprint, offset: next })).toString('base64url') : null };
}
export function search(store, p) {
  check(p.query === undefined || typeof p.query === 'string' && p.query.length <= 1000);
  const docs = visible(store, p); const words = (p.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const items = docs.map(d => view(store, d, docs, p)).filter(d => !p.kind || d.kind === p.kind)
    .map(d => ({ ...d, score: words.reduce((n, w) => n + `${d.title} ${d.body}`.toLowerCase().split(w).length - 1, 0) }))
    .filter(d => !words.length || d.score > 0).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
  return page(store, p, items);
}
export function history(store, p = {}) {
  const docs = new Map();
  const last = p.generation ?? store.state.generation;
  for (let generation = 1; generation <= last; generation++) {
    for (const d of visible(store, { ...p, generation })) {
      const key = `${d.native.id}@${d.native.revision}`;
      if (!docs.has(key)) docs.set(key, { ...d, origin_generation: generation });
    }
  }
  const retired = new Set(documents(store).filter(d => d.native?.lifecycle === 'retired').map(d => d.native.id));
  return [...docs.values()].filter(d => p.archival === true || !retired.has(d.native.id));
}
export function trace(store, p) {
  check(Boolean(p.id) !== Boolean(p.mission_id), 'Provide exactly one claim ID or mission ID');
  let mission;
  if (p.mission_id) {
    id(p.mission_id); mission = store.state.missions[p.mission_id];
    const packet = mission && store.state.packets[mission.packet_id];
    if (!packet || packet.selected.some(n => store.state.denied.includes(n.id))) fail('mission.unavailable', 'Mission unavailable');
    p = { ...p, id: packet.claim_id };
  }
  const { doc: root } = getDoc(store, p), depth = integer(p.depth, 1, 0, 3);
  const docs = history(store, p), key = d => `${d.native.id}@${d.native.revision}`, allEdges = [];
  for (const d of docs) {
    const origin = documents(store, d.origin_generation);
    const resolveLink = target => {
      const old = origin.find(x => x.path === linkPath(d.path, target) && x.native);
      return old && docs.find(x => key(x) === key(old));
    };
    for (const e of d.native.edges ?? []) if (docs.some(x => x.native.id === e.target_id && x.native.revision === e.target_revision)) allEdges.push({ category: 'native', source_id: d.native.id, source_revision: d.native.revision, ...e });
    for (const source of d.sources) { const target = source.sovmem_ref ? docs.find(x => x.native.id === source.sovmem_ref.id && x.native.revision === source.sovmem_ref.revision) : resolveLink(source.resource); if (target) allEdges.push({ category: 'source', relation: 'attributed_to', source_id: d.native.id, source_revision: d.native.revision, target_id: target.native.id, target_revision: target.native.revision, source_key: source.id ?? null }); }
    for (const match of d.body.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) { const target = resolveLink(match[1]); if (target) allEdges.push({ category: 'markdown', relation: 'link', source_id: d.native.id, source_revision: d.native.revision, target_id: target.native.id, target_revision: target.native.revision }); }
  }
  const selected = new Set(mission ? store.state.packets[mission.packet_id].selected.map(n => `${n.id}@${n.revision}`) : [key(root)]);
  const proposals = mission ? Object.values(store.state.proposals).filter(x => x.packet_id === mission.packet_id) : [];
  for (const proposal of proposals) if (proposal.record_id) selected.add(`${proposal.record_id}@${proposal.record_revision}`);
  for (let n = 0; n < depth; n++) {
    const before = new Set(selected);
    for (const e of allEdges) if (before.has(`${e.source_id}@${e.source_revision}`) || before.has(`${e.target_id}@${e.target_revision}`)) {
      selected.add(`${e.source_id}@${e.source_revision}`); selected.add(`${e.target_id}@${e.target_revision}`);
    }
  }
  const nodes = docs.filter(d => selected.has(key(d))).map(d => view(store, d, docs, p)).sort((a,b) => a.id.localeCompare(b.id) || a.revision - b.revision);
  const paged = page(store, p, nodes), keys = new Set(paged.items.map(x => `${x.id}@${x.revision}`));
  return { nodes: paged.items, edges: allEdges.filter(e => selected.has(`${e.source_id}@${e.source_revision}`) && selected.has(`${e.target_id}@${e.target_revision}`) && (keys.has(`${e.source_id}@${e.source_revision}`) || keys.has(`${e.target_id}@${e.target_revision}`))),
    generation: paged.generation, cursor: paged.cursor,
    verdicts: store.state.verdicts.filter(v => { const proposal = store.state.proposals[v.proposal_id], packet = proposal && store.state.packets[proposal.packet_id]; return packet && packet.selected.every(n => !store.state.denied.includes(n.id)) && (proposals.some(x => x.id === v.proposal_id) || nodes.some(x => x.decision_ref === v.id)); }),
    ...(mission ? { mission: { id: mission.id, packet_id: mission.packet_id, state: mission.state } } : {}) };
}
export function context(store, p) {
  instant(p.as_of); const budget = integer(p.budget, 4000, 1, 16000);
  if (store.state.scenario === 'authority_conflict') fail('context.authority_conflict', 'Synthetic governing instructions conflict');
  if (store.state.scenario === 'investigation_failure') fail('investigation.failed', 'Synthetic investigation failed; saved drafts are unchanged');
  const graph = trace(store, { ...p, limit: 100, depth: 2 });
  if (p.evidence !== undefined) {
    check(Array.isArray(p.evidence) && p.evidence.length <= 30, 'At most 30 evidence selections');
    for (const e of p.evidence) {
      check(e && typeof e === 'object');
      integer(e.revision, undefined, 1, 10000);
      const node = get(store, { id: e.id, revision: e.revision, generation: p.generation, as_of: p.as_of });
      if (!graph.nodes.some(n => n.id === node.id && n.revision === node.revision)) graph.nodes.push(node);
    }
  }
  if (graph.cursor) fail('context.incomplete', 'Evidence exceeds the packet node limit');
  const governing = 'Synthetic demo: examine evidence; do not claim factual truth from acceptance. Preserve opposing positions. No canonical write authority.';
  const markdown = `# Mission evidence (synthetic)\n\n${governing}\n\n` + graph.nodes.map(n => `## ${n.title}\n[${n.id}@${n.revision}] Freshness: ${n.freshness}; epistemic status: ${n.epistemic_status}\n${n.body}`).join('\n\n');
  const tokens = Math.ceil(Buffer.byteLength(markdown) / 3);
  if (tokens > budget) fail('context.incomplete', 'Required pilot context does not fit the approximate byte-based budget; increase budget');
  const packet = { generation: p.generation ?? store.state.generation, policy: store.state.policy, scope: 'pilot', as_of: p.as_of ?? '2026-09-15T00:00:00Z', claim_id: p.id,
    selected: graph.nodes.map(n => ({ id: n.id, revision: n.revision, digest: n.digest, freshness: n.freshness })), markdown, governing,
    contradictions: graph.edges.filter(e => e.relation === 'contradicts'), budget, estimated_tokens: tokens, budget_estimator: 'utf8-bytes-divided-by-3', consumed: 'unknown', dispatched: false };
  packet.digest = digest(packet); packet.id = `packet-${packet.digest.slice(0,20)}`;
  store.state.packets[packet.id] = packet; return packet;
}
