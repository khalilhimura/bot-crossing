import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMockAdapter } from './adapter.mjs';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--store')) throw new Error('Usage: npm run mock:demo -- [--store NEW_DIRECTORY]');
const temporary = args.length ? null : await mkdtemp(join(tmpdir(), 'nous-mock-demo-'));
const store = args.length ? resolve(args[1]) : join(temporary, 'store');
const agent = createMockAdapter({ store }), owner = createMockAdapter({ store, role: 'owner' });
try {
  await owner.request('init');
  await agent.request('topic_save', { id: 'ai-work', title: 'AI and independent work', claims: ['claim-ai', 'claim-reasoning'] });
  const packet = await agent.request('memory_context', { id: 'claim-ai', evidence: [{ id: 'source-context', revision: 1 }], as_of: '2026-09-15T00:00:00Z', budget: 4000 });
  await agent.request('mission_save', { id: 'pilot', question: 'How well does the evidence support this claim?', packet_id: packet.id, draft: 'Synthetic assessment awaiting review.' });
  const proposal = await agent.request('memory_propose', { idempotency_key: 'demo-pilot', packet_id: packet.id, base_generation: packet.generation,
    candidate: { title: 'AI helps under conditions that preserve independent checking', body: 'Synthetic finding: AI can help with unfamiliar tasks while reducing reasoning practice when explanations are delegated.', conditions: 'Distinguish unfamiliar-task completion from unaided explanation.', conclusion: 'inconclusive', evidence: [
      { id: 'source-benefit', revision: 1, role: 'supports' }, { id: 'source-risk', revision: 1, role: 'challenges' }, { id: 'source-context', revision: 1, role: 'context' }] } });
  await owner.request('review', { proposal_id: proposal.id, revision_hash: proposal.revision_hash, action: 'kiv' });
  const accepted = await owner.request('review', { proposal_id: proposal.id, revision_hash: proposal.revision_hash, action: 'accept', reason: 'Demo owner endorses a qualified finding while retaining both positions.' });
  // Every request starts a fresh CLI process; status and retrieval prove persistence across process restarts.
  const status = await agent.request('memory_status', { proposal_id: proposal.id });
  const trace = await agent.request('memory_trace', { id: status.record_id, depth: 2 });
  const next = await agent.request('memory_context', { id: status.record_id, as_of: '2026-09-15T00:00:00Z', budget: 4000 });
  console.log(JSON.stringify({ demo: true, authority: 'simulated', model_calls: 0, generation: accepted.generation,
    proposal: proposal.id, finding: status.record_id, trace_nodes: trace.nodes.length, trace_edges: trace.edges.length,
    reused_in_packet: next.id, store: temporary ? 'temporary; removed after demo' : store }, null, 2));
} finally { if (temporary) await rm(temporary, { recursive: true, force: true }); }
