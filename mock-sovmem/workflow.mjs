import { check, text, id, digest, owner, fail, ASOF, integer, instant } from './common.mjs';
import { get, getDoc, visible, context } from './reads.mjs';
import { publish, documents } from './store.mjs';
import { serialize } from './okf.mjs';
function packetFor(store, packetId) {
  id(packetId); const packet = store.state.packets[packetId];
  if (!packet || packet.selected.some(n => store.state.denied.includes(n.id))) fail('packet.unavailable', 'Packet unavailable under current scope');
  return packet;
}
export function proposalFor(store, proposalId) {
  id(proposalId); const p = store.state.proposals[proposalId];
  if (!p) fail('proposal.unavailable', 'Proposal unavailable');
  packetFor(store, p.packet_id); return p;
}
export function propose(store, p) {
  text(p.idempotency_key, 'idempotency key', 100); const packet = packetFor(store, p.packet_id);
  const c = p.candidate; check(c && typeof c === 'object');
  text(c.title, 'title', 200); text(c.body, 'body'); text(c.conditions, 'conditions', 4000);
  check(['supported','challenged','inconclusive'].includes(c.conclusion), 'Invalid assessment conclusion');
  check(Array.isArray(c.evidence) && c.evidence.length > 0 && c.evidence.length <= 30, 'Evidence is required');
  const evidenceIds = new Set();
  for (const e of c.evidence) {
    check(e && typeof e === 'object');
    integer(e.revision, undefined, 1, 10000);
    check(!evidenceIds.has(e.id), 'Each evidence source must appear once'); evidenceIds.add(e.id);
    check(['supports','challenges','context'].includes(e.role), 'Invalid evidence role');
    get(store, { id: e.id, revision: e.revision });
    check(packet.selected.some(n => n.id === e.id && n.revision === e.revision), 'Evidence must belong to dispatched packet');
  }
  const requestHash = digest(p), keyHash = digest(p.idempotency_key);
  const existing = Object.values(store.state.proposals).find(x => x.key_hash === keyHash);
  if (existing) { if (existing.request_hash !== requestHash) fail('proposal.idempotency_conflict', 'Key was used for different bytes'); return existing; }
  if (p.base_generation !== store.state.generation || packet.generation !== store.state.generation || packet.policy !== store.state.policy) fail('proposal.stale_base', 'Refresh context before submitting');
  const proposal = { id: `proposal-${requestHash.slice(0,20)}`, key_hash: keyHash, request_hash: requestHash, packet_id: packet.id,
    base_generation: p.base_generation, policy: store.state.policy, claim_id: packet.claim_id, candidate: structuredClone(c), revision_hash: digest(c),
    state: 'awaiting_review', deferred: false, history: [], intended_effect: 'Append a linked finding; do not replace or retire the examined claim', simulated: true };
  store.state.proposals[proposal.id] = proposal; return proposal;
}
export function revise(store, p) {
  const proposal = proposalFor(store, p.proposal_id);
  check(proposal.state === 'awaiting_review', 'Only pending proposals can be edited');
  if (p.revision_hash !== proposal.revision_hash) fail('review.revision_mismatch', 'Review the current candidate');
  text(p.body, 'body'); proposal.history.push({ candidate: proposal.candidate, revision_hash: proposal.revision_hash });
  proposal.candidate = { ...proposal.candidate, body: p.body }; proposal.revision_hash = digest(proposal.candidate); proposal.deferred = false;
  return proposal;
}
export function review(store, p, role) {
  owner(role); const proposal = proposalFor(store, p.proposal_id);
  if (p.revision_hash !== proposal.revision_hash) fail('review.revision_mismatch', 'Candidate changed; fresh review required');
  if (proposal.state !== 'awaiting_review') fail('review.already_decided', 'Read status to reconcile the existing outcome');
  check(['accept','reject','kiv'].includes(p.action));
  if (p.action === 'kiv') { proposal.deferred = true; return proposal; }
  text(p.reason, 'human reason', 4000);
  if (p.action === 'accept' && (proposal.base_generation !== store.state.generation || proposal.policy !== store.state.policy)) fail('review.stale_base', 'Refresh context and submit a new proposal for review');
  const event = { id: `verdict-${store.state.verdicts.length + 1}`, proposal_id: proposal.id, revision_hash: proposal.revision_hash,
    action: p.action, reason: p.reason, simulated: true, sequence: store.state.verdicts.length + 1 };
  if (p.action === 'accept') {
    const c = proposal.candidate, recordId = `finding-${proposal.id.slice(9)}`, claim = get(store, { id: proposal.claim_id });
    const refs = c.evidence.map(e => { const d = get(store, { id: e.id, revision: e.revision }); return { id: e.id, resource: `/records/${e.id}/r${e.revision}.md`, title: d.title, sovmem_ref: { id: e.id, revision: e.revision } }; });
    const native = { ...getDoc(store, { id: proposal.claim_id }).doc.native, id: recordId, revision: 1, previous_revision: null, kind: 'claim',
      epistemic_status: 'inferred', lifecycle: 'active', decision_ref: event.id, recorded_at: ASOF,
      mission: { packet_id: proposal.packet_id, assessment: c.conclusion, conditions: c.conditions, consumed: 'unknown' },
      edges: [{ relation: c.conclusion === 'challenged' ? 'contradicts' : c.conclusion === 'supported' ? 'supports' : 'references', target_id: claim.id, target_revision: claim.revision, scope: 'pilot' }, { relation: 'derived_from', target_id: claim.id, target_revision: claim.revision, scope: 'pilot' },
        ...c.evidence.map(e => ({ relation: 'cites', evidence_role: e.role, target_id: e.id, target_revision: e.revision, scope: 'pilot' }))] };
    const raw = serialize({ type: 'Claim', title: c.title, status: 'stable', schema_version: 'sovmem-record-v4', synthetic: true, sources: refs, sovmem: native },
      `${c.body}\n\n## Conditions\n${c.conditions}\n\n## Assessment\n${c.conclusion}\n\n${refs.map(r => `Evidence [^${r.id}].\n\n[^${r.id}]: ${r.title}`).join('\n\n')}`);
    publish(store, [{ path: `claims/${recordId}.md`, raw }]);
    proposal.record_id = recordId; proposal.record_revision = 1; proposal.state = 'accepted';
  } else proposal.state = 'rejected';
  event.generation = store.state.generation; store.state.verdicts.push(event);
  proposal.verdict = event; proposal.generation = event.generation;
  if (store.state.scenario === 'lost_response') { store.state.scenario = null; return { ...proposal, response_lost: true }; }
  return proposal;
}
export function scenario(store, p, role) {
  owner(role); const name = p.name;
  check(['clear','lost_response','changed_source','stale_evidence','deny_source','authority_conflict','investigation_failure','pause_intake'].includes(name), 'Unknown scenario');
  if (name === 'clear') { store.state.scenario = null; store.state.denied = []; store.state.policy++; }
  else if (name === 'deny_source') { store.state.denied = ['source-benefit']; store.state.policy++; }
  else if (name === 'changed_source' || name === 'stale_evidence') {
    const d = documents(store).find(x => x.native?.id === 'source-benefit');
    const meta = structuredClone(d.meta); meta.sovmem.previous_revision = meta.sovmem.revision; meta.sovmem.revision++;
    if (name === 'stale_evidence') meta.stale_after = '2026-09-01T00:00:00Z';
    publish(store, [{ path: d.path, raw: serialize(meta, d.body + '\nSynthetic scenario: new source revision.') }]);
  } else store.state.scenario = name;
  return { name, generation: store.state.generation, policy: store.state.policy };
}
export function missionSave(store, p) {
  id(p.id); text(p.question, 'question', 4000); const packet = packetFor(store, p.packet_id);
  check(p.conversation === undefined || Array.isArray(p.conversation) && p.conversation.length <= 200);
  for (const m of p.conversation ?? []) { check(m && ['user','assistant'].includes(m.role)); text(m.content, 'message', 32000); }
  check(p.draft === undefined || typeof p.draft === 'string' && p.draft.length <= 32000);
  const previous = store.state.missions[p.id];
  const value = { id: p.id, question: p.question, packet_id: packet.id, conversation: p.conversation ?? [], draft: p.draft ?? '', state: p.state ?? 'paused',
    history: previous?.history ?? [], ...(previous?.packet_id === packet.id && previous.dispatch ? { dispatch: previous.dispatch } : {}) };
  if (previous && previous.packet_id !== packet.id) value.history = [...value.history, { packet_id: previous.packet_id, question: previous.question, draft: previous.draft, conversation: previous.conversation, dispatch: previous.dispatch ?? null }];
  check(['paused','kiv','failed','completed'].includes(value.state));
  store.state.missions[p.id] = value; return missionGet(store, p);
}
export function missionGet(store, p) {
  id(p.id); const mission = store.state.missions[p.id]; if (!mission) fail('mission.unavailable', 'Mission unavailable');
  const packet = packetFor(store, mission.packet_id);
  return { ...mission, history: mission.history.filter(h => { const old = store.state.packets[h.packet_id]; return old && old.selected.every(n => !store.state.denied.includes(n.id)); }), refresh_required: packet.generation !== store.state.generation || packet.policy !== store.state.policy };
}
export function topicSave(store, p) {
  id(p.id); text(p.title, 'topic title', 200); check(Array.isArray(p.claims) && p.claims.length <= 100);
  for (const claim of p.claims) check(get(store, { id: claim }).kind === 'claim', 'Topic members must be claims');
  return store.state.topics[p.id] = { id: p.id, title: p.title, claims: [...new Set(p.claims)] };
}
export function missionDispatch(store, p) {
  const mission = missionGet(store, p), packet = packetFor(store, p.packet_id);
  check(mission.packet_id === packet.id, 'Dispatch must match the saved mission packet');
  if (mission.refresh_required) fail('mission.stale_context', 'Refresh and review context before dispatch');
  text(p.provider, 'provider', 100); text(p.model, 'model', 200); text(p.adapter_version, 'adapter version', 100);
  const dispatch = { provider: p.provider, model: p.model, adapter_version: p.adapter_version,
    packet_id: packet.id, packet_digest: packet.digest, at: instant(p.at), consumed: 'unknown', provenance: 'adapter_reported', simulated: true };
  store.state.missions[p.id].dispatch = dispatch;
  return dispatch;
}
