import { exportBundle } from './export.mjs';
import { check, fail, owner, VERSION } from './common.mjs';
import { openStore, save, documents } from './store.mjs';
import { readBundle, conformance, PIN } from './okf.mjs';
import { search, get, trace, context, visible, view } from './reads.mjs';
import { propose, proposalFor, revise, review, scenario, missionSave, missionGet, missionDispatch, topicSave } from './workflow.mjs';
export const METHODS = ['init','memory_status','memory_search','memory_get','memory_trace','memory_context','memory_propose','proposal_get','proposal_list','proposal_revise','review','scenario','mission_save','mission_get','mission_list','mission_dispatch','topic_save','topic_list','export','validate'];
const MUTATING = new Set(['memory_context','memory_propose','proposal_revise','review','scenario','mission_save','mission_dispatch','topic_save']);
export function dispatch(storePath, request, role = 'agent') {
  check(request && typeof request === 'object' && !Array.isArray(request));
  if (request.version !== VERSION) fail('version.unsupported', `Expected ${VERSION}`);
  check(['agent','owner'].includes(role));
  const { method } = request, p = request.params ?? {};
  check(p && typeof p === 'object' && !Array.isArray(p));
  if (!METHODS.includes(method)) fail('method.unsupported', 'Unknown mock method');
  if (method === 'init') owner(role);
  if (p.archival === true) owner(role);
  const store = openStore(storePath, method === 'init');
  try {
    let result;
    switch (method) {
      case 'init': result = { generation: 1, label: 'Demo memory', authority: 'simulated' }; break;
      case 'memory_status':
        if (p.proposal_id) result = proposalFor(store, p.proposal_id);
        else result = { methods: METHODS, generation: store.state.generation, policy: store.state.policy, integrity: 'verified_mock_sha256', authority: 'simulated', verdict_count: store.state.verdicts.length, okf_version: '0.2', spec_commit: PIN, limits: { document_bytes: 262144, request_bytes: 262144, trace_depth: 3, page_size: 100 }, pending: Object.values(store.state.proposals).filter(x => x.state === 'awaiting_review' && store.state.packets[x.packet_id]?.selected.every(n => !store.state.denied.includes(n.id))).length };
        break;
      case 'memory_search': result = search(store, p); break;
      case 'memory_get': result = get(store, p); break;
      case 'memory_trace': result = trace(store, p); break;
      case 'memory_context': result = context(store, p); break;
      case 'memory_propose':
        if (store.state.scenario === 'pause_intake') fail('intake.paused', 'Intake is paused by the simulated owner');
        result = propose(store, p); break;
      case 'proposal_list': result = { items: Object.values(store.state.proposals).filter(x => store.state.packets[x.packet_id]?.selected.every(n => !store.state.denied.includes(n.id))).filter(x => !p.state || x.state === p.state).map(x => ({ id: x.id, state: x.state, revision_hash: x.revision_hash, title: x.candidate.title, deferred: x.deferred })) }; break;
      case 'proposal_get': result = proposalFor(store, p.proposal_id); break;
      case 'proposal_revise': result = revise(store, p); break;
      case 'review': result = review(store, p, role); break;
      case 'scenario': result = scenario(store, p, role); break;
      case 'mission_save': result = missionSave(store, p); break;
      case 'mission_get': result = missionGet(store, p); break;
      case 'mission_dispatch': result = missionDispatch(store, p); break;
      case 'mission_list': result = { items: Object.values(store.state.missions).filter(m => store.state.packets[m.packet_id]?.selected.every(n => !store.state.denied.includes(n.id))).map(m => ({ id: m.id, question: m.question, state: m.state })) }; break;
      case 'topic_save': result = topicSave(store, p); break;
      case 'topic_list': {
        const ids = new Set(visible(store).map(d => d.native.id));
        result = { items: Object.values(store.state.topics).map(t => ({ ...t, claims: t.claims.filter(x => ids.has(x)) })) }; break;
      }
      case 'validate': owner(role); check(typeof p.bundle === 'string'); result = conformance(readBundle(p.bundle)); break;
      case 'export': owner(role); result = exportBundle(store, p); break;
    }
    if (MUTATING.has(method)) save(store);
    if (result?.response_lost) fail('transport.response_lost', 'Simulated response loss after commitment; reconcile with memory_status');
    return result;
  } finally { store.release(); }
}
