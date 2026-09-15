import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const cli = resolve('mock-sovmem/cli.mjs');
const ASOF = '2026-09-15T00:00:00Z';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nous-mock-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = join(root, 'store');
  function call(method, params = {}, role = 'agent') {
    const p = spawnSync(process.execPath, [cli, '--store', store, '--role', role], {
      input: JSON.stringify({ version: 'sovmem-mock/v1', method, params }), encoding: 'utf8', timeout: 10000,
    });
    assert.ok(p.stdout?.trim(), `CLI must emit JSON: ${p.stderr}`);
    const out = JSON.parse(p.stdout);
    assert.equal(out.demo, true);
    assert.equal(out.version, 'sovmem-mock/v1');
    assert.equal(p.status, out.ok ? 0 : 1, p.stderr);
    return out;
  }
  const ok = (m, p = {}, r = 'agent') => { const out = call(m, p, r); assert.equal(out.ok, true, JSON.stringify(out)); return out.result; };
  ok('init', {}, 'owner');
  return { root, store, call, ok };
}
function proposal(f, key = 'first') {
  const packet = f.ok('memory_context', { id: 'claim-ai', as_of: ASOF, budget: 4000 });
  return f.ok('memory_propose', {
    idempotency_key: key, packet_id: packet.id, base_generation: packet.generation,
    candidate: { title: 'AI helps with unfamiliar tasks', body: 'Synthetic finding: assistance helps in bounded unfamiliar tasks.', conclusion: 'supported', conditions: 'When outputs are checked independently', evidence: [{ id: 'source-benefit', revision: 1, role: 'supports' }] },
  });
}
function review(f, p, action = 'accept', extra = {}) { return f.call('review', { proposal_id: p.id, revision_hash: p.revision_hash, action, reason: 'Synthetic owner decision', ...extra }, 'owner'); }

test('initializes real OKF fixtures and exposes bounded capabilities', t => {
  const f = fixture(t);
  const status = f.ok('memory_status');
  assert.equal(status.generation, 1); assert.equal(status.integrity, 'verified_mock_sha256');
  assert.ok(status.methods.includes('memory_context'));
  const claims = f.ok('memory_search', { kind: 'claim', limit: 1 });
  assert.equal(claims.items.length, 1); assert.ok(claims.cursor);
  const second = f.ok('memory_search', { kind: 'claim', limit: 1, cursor: claims.cursor });
  assert.notEqual(second.items[0].id, claims.items[0].id);
  const doc = f.ok('memory_get', { id: 'claim-ai', revision: 1, as_of: ASOF });
  assert.match(doc.body, /independently/); assert.equal(doc.acceptance, 'simulated_accepted');
  assert.equal(doc.trust, 'unverified'); assert.equal(doc.revision, 1);
  assert.equal(f.call('init', {}, 'owner').error.code, 'store.exists');
});
test('trace keeps categories, exact revisions and conflicting positions', t => {
  const f = fixture(t);
  const trace = f.ok('memory_trace', { id: 'claim-ai', revision: 1, depth: 1 });
  assert.ok(trace.nodes.some(n => n.id === 'claim-reasoning'));
  assert.ok(trace.edges.some(e => e.relation === 'contradicts' && e.target_revision === 1));
  assert.ok(trace.edges.some(e => e.category === 'source'));
  assert.ok(trace.edges.some(e => e.category === 'markdown'));
  const context = f.ok('memory_context', { id: 'claim-ai', as_of: ASOF, budget: 4000 });
  assert.ok(context.contradictions.length); assert.ok(context.markdown.includes('Synthetic'));
  assert.equal(context.consumed, 'unknown'); assert.ok(context.digest);
  assert.equal(f.call('memory_context', { id: 'claim-ai', as_of: ASOF, budget: 1 }).error.code, 'context.incomplete');
});
test('proposals persist, are idempotent and preserve branching provenance after acceptance', t => {
  const f = fixture(t); const p = proposal(f);
  const same = proposal(f); assert.equal(same.id, p.id);
  assert.equal(f.call('review', { proposal_id: p.id, action: 'accept' }).error.code, 'authority.owner_required');
  const accepted = review(f, p); assert.equal(accepted.ok, true);
  assert.equal(accepted.result.state, 'accepted'); assert.equal(accepted.result.generation, 2);
  const status = f.ok('memory_status', { proposal_id: p.id }); assert.equal(status.state, 'accepted');
  const found = f.ok('memory_get', { id: status.record_id, revision: 1 });
  assert.equal(found.trust, 'unverified'); assert.match(found.body, /bounded unfamiliar/);
  assert.ok(found.edges.some(e => e.target_id === 'claim-ai' && e.target_revision === 1));
  assert.equal(f.ok('memory_get', { id: 'claim-ai', revision: 1 }).revision, 1);
  assert.equal(review(f, p).error.code, 'review.already_decided');
  assert.equal(f.ok('memory_status').generation, 2);
});
test('KIV is pending, rejection is recorded, edits require new review', t => {
  const f = fixture(t); const p = proposal(f);
  assert.equal(review(f, p, 'kiv').result.state, 'awaiting_review');
  assert.equal(f.ok('memory_status').generation, 1);
  const edited = f.ok('proposal_revise', { proposal_id: p.id, revision_hash: p.revision_hash, body: 'Edited synthetic finding.' });
  assert.notEqual(edited.revision_hash, p.revision_hash);
  assert.equal(review(f, p).error.code, 'review.revision_mismatch');
  assert.equal(review(f, edited, 'reject').result.state, 'rejected');
  assert.equal(f.ok('memory_status').generation, 1);
});
test('lost response reconciles once and old snapshots remain accessible', t => {
  const f = fixture(t); const p = proposal(f);
  f.ok('scenario', { name: 'lost_response' }, 'owner');
  assert.equal(review(f, p).error.code, 'transport.response_lost');
  const s = f.ok('memory_status', { proposal_id: p.id }); assert.equal(s.state, 'accepted');
  assert.equal(s.generation, 2); assert.equal(f.ok('memory_status').verdict_count, 1);
  assert.equal(f.call('memory_get', { id: s.record_id, revision: 1, generation: 1 }).error.code, 'record.unavailable');
});
test('scope revocation invalidates paging and does not reveal denied documents', t => {
  const f = fixture(t); const first = f.ok('memory_search', { limit: 1 });
  f.ok('scenario', { name: 'deny_source' }, 'owner');
  assert.equal(f.call('memory_get', { id: 'source-benefit' }).error.code, 'record.unavailable');
  assert.equal(f.call('memory_search', { limit: 1, cursor: first.cursor }).error.code, 'cursor.stale');
  const trace = f.ok('memory_trace', { id: 'claim-ai' });
  assert.ok(!JSON.stringify(trace).includes('source-benefit'));
  assert.equal(f.call('scenario', { name: 'clear' }).error.code, 'authority.owner_required');
});
test('changed sources flag mission resume and stale bases block review', t => {
  const f = fixture(t); const p = proposal(f);
  f.ok('mission_save', { id: 'mission-1', question: 'Examine this claim', packet_id: p.packet_id, conversation: [{ role: 'user', content: 'Why?' }], draft: 'Pending' });
  f.ok('scenario', { name: 'changed_source' }, 'owner');
  const resumed = f.ok('mission_get', { id: 'mission-1' }); assert.equal(resumed.refresh_required, true);
  assert.equal(review(f, p).error.code, 'review.stale_base');
  assert.equal(f.ok('memory_get', { id: 'source-benefit', revision: 1 }).revision, 1);
});
test('topics share identity and persistent membership without deleting claims', t => {
  const f = fixture(t);
  f.ok('topic_save', { id: 'topic-ai', title: 'AI and independent work', claims: ['claim-ai', 'claim-reasoning'] });
  f.ok('topic_save', { id: 'topic-learning', title: 'Learning habits', claims: ['claim-ai'] });
  assert.equal(f.ok('topic_list').items.length, 2);
  f.ok('topic_save', { id: 'topic-ai', title: 'AI and independent work', claims: [] });
  assert.equal(f.ok('memory_get', { id: 'claim-ai' }).id, 'claim-ai');
});
test('export emits independently readable OKF and validate distinguishes malformed input', t => {
  const f = fixture(t); const output = join(f.root, 'export');
  f.ok('export', { output }, 'owner');
  assert.match(readFileSync(join(output, 'index.md'), 'utf8'), /okf_version: "0.2"/);
  const report = f.ok('validate', { bundle: output }, 'owner'); assert.equal(report.conformant, true);
  const bad = join(f.root, 'bad'); mkdirSync(bad); writeFileSync(join(bad, 'invalid.md'), '---\ntitle: Missing type\n---\nHi');
  assert.equal(f.ok('validate', { bundle: bad }, 'owner').conformant, false);
  symlinkSync('/etc/passwd', join(bad, 'escape.md'));
  assert.equal(f.call('validate', { bundle: bad }, 'owner').error.code, 'path.unsafe');
});
test('faults and invalid parameters produce typed JSON without partial mutation', t => {
  const f = fixture(t);
  assert.equal(f.call('unknown').error.code, 'method.unsupported');
  assert.equal(f.call('memory_get', { id: '../secret' }).error.code, 'request.invalid');
  assert.equal(f.call('memory_search', { limit: -1 }).error.code, 'request.invalid');
  f.ok('scenario', { name: 'authority_conflict' }, 'owner');
  assert.equal(f.call('memory_context', { id: 'claim-ai', as_of: ASOF, budget: 4000 }).error.code, 'context.authority_conflict');
  f.ok('scenario', { name: 'investigation_failure' }, 'owner');
  assert.equal(f.call('memory_context', { id: 'claim-ai', as_of: ASOF, budget: 4000 }).error.code, 'investigation.failed');
  assert.equal(f.ok('memory_status').generation, 1);
});

test('historical evidence endpoints remain traceable after source revision changes', t => {
  const f = fixture(t); const p = proposal(f); const accepted = review(f, p).result;
  f.ok('scenario', { name: 'changed_source' }, 'owner');
  const graph = f.ok('memory_trace', { id: accepted.record_id, depth: 1 });
  assert.ok(graph.nodes.some(n => n.id === 'source-benefit' && n.revision === 1));
  assert.ok(graph.edges.some(e => e.target_id === 'source-benefit' && e.target_revision === 1));
  const output = join(f.root, 'history-export'); f.ok('export', { output }, 'owner');
  const report = f.ok('validate', { bundle: output }, 'owner');
  assert.equal(report.conformant, true);
  assert.ok(!report.diagnostics.some(d => d.code === 'native.edge_unresolved'));
});
test('generic OKF supports unknown metadata and reports attribution and freshness diagnostics', t => {
  const f = fixture(t); const bundle = join(f.root, 'custom'); mkdirSync(bundle);
  writeFileSync(join(bundle, 'custom.md'), '---\ntype: Alien\nx-extra: {color: blue}\nverified: {by: "human:demo", at: "2026-09-15T00:00:00Z"}\nstale_after: 2026-02-31T00:00:00Z\nsources:\n - {id: b, resource: https://example.invalid/b}\n - {id: a, resource: https://example.invalid/a}\n---\nFact[^a].\n\n[^a]: Source A\n\n[Unknown](missing.md)\n');
  const report = f.ok('validate', { bundle }, 'owner');
  assert.equal(report.conformant, true);
  assert.ok(report.diagnostics.some(d => d.code === 'timestamp.invalid'));
  assert.ok(report.diagnostics.some(d => d.code === 'link.unresolved'));
  assert.ok(!report.diagnostics.some(d => d.code === 'source.footnote_unresolved'));
  writeFileSync(join(bundle, 'duplicate.md'), '---\ntype: Claim\nsources: [{id: a, resource: a}, {id: a, resource: b}]\n---\nClaim[^a].');
  assert.ok(f.ok('validate', { bundle }, 'owner').diagnostics.some(d => d.code === 'source.id_duplicate'));
});
test('mission trace exposes its saved context and linked accepted finding', t => {
  const f = fixture(t); const p = proposal(f);
  f.ok('mission_save', { id: 'm-trace', question: 'Examine', packet_id: p.packet_id });
  const accepted = review(f, p).result;
  const graph = f.ok('memory_trace', { mission_id: 'm-trace', depth: 1 });
  assert.equal(graph.mission.id, 'm-trace');
  assert.ok(graph.nodes.some(n => n.id === accepted.record_id));
  assert.ok(graph.verdicts.some(v => v.proposal_id === p.id));
});
test('rejects incompatible versions, invalid dates, missing evidence revisions and changed idempotency payloads', t => {
  const f = fixture(t);
  assert.equal(f.call('memory_context', { id: 'claim-ai', as_of: '2026-02-31T00:00:00Z' }).error.code, 'request.invalid');
  const p = proposal(f); const packet = f.ok('memory_context', { id: 'claim-ai', as_of: ASOF, budget: 4000 });
  const candidate = { title: 'Changed', body: 'Changed', conditions: 'Demo', conclusion: 'supported', evidence: [{ id: 'source-benefit', revision: 1, role: 'supports' }] };
  assert.equal(f.call('memory_propose', { idempotency_key: 'first', packet_id: packet.id, base_generation: 1, candidate }).error.code, 'proposal.idempotency_conflict');
  delete candidate.evidence[0].revision;
  assert.equal(f.call('memory_propose', { idempotency_key: 'no-revision', packet_id: packet.id, base_generation: 1, candidate }).error.code, 'request.invalid');
});
test('locks and document corruption fail explicitly without resetting store', t => {
  const f = fixture(t); mkdirSync(join(f.store, '.lock'));
  assert.equal(f.call('memory_status').error.code, 'store.busy');
  rmSync(join(f.store, '.lock'), { recursive: true });
  const state = JSON.parse(readFileSync(join(f.store, 'state.json')));
  const ref = state.snapshots[1].find(r => r.path === 'claims/ai.md');
  writeFileSync(join(f.store, 'documents', ref.hash + '.md'), 'corrupt');
  assert.equal(f.call('memory_status').error.code, 'store.integrity');
  assert.equal(JSON.parse(readFileSync(join(f.store, 'state.json'))).generation, 1);
});
test('adapter and demo run the public contract without shell interpolation', async t => {
  const f = fixture(t);
  let module; try { module = await import('../mock-sovmem/adapter.mjs'); } catch {}
  assert.ok(module?.createMockAdapter, 'Process adapter is required');
  const adapter = module.createMockAdapter({ store: f.store });
  const status = await adapter.request('memory_status'); assert.equal(status.generation, 1);
  await assert.rejects(adapter.request('review', {}), e => e.code === 'authority.owner_required');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(adapter.request('memory_status', {}, { signal: cancelled.signal }), e => e.code === 'adapter.aborted');
});

test('historical context cannot masquerade as current and stale evidence reaches the model packet', t => {
  const f = fixture(t); f.ok('scenario', { name: 'changed_source' }, 'owner');
  const old = f.ok('memory_context', { id: 'claim-ai', generation: 1, as_of: ASOF, budget: 4000 });
  assert.equal(old.generation, 1);
  f.ok('scenario', { name: 'stale_evidence' }, 'owner');
  const fresh = f.ok('memory_context', { id: 'source-benefit', as_of: ASOF, budget: 4000 });
  assert.match(fresh.markdown, /stale/);
});
test('pending queue survives restart and stale proposals can be rejected without a canon write', t => {
  const f = fixture(t); const p = proposal(f);
  f.ok('scenario', { name: 'changed_source' }, 'owner');
  const queue = f.ok('proposal_list'); assert.ok(queue.items.some(x => x.id === p.id));
  assert.equal(review(f, p, 'reject').result.state, 'rejected');
  assert.equal(f.ok('memory_status').generation, 2);
});

test('explicit selected evidence enters bounded context and mission dispatch remains separate from consumption', t => {
  const f = fixture(t);
  const packet = f.ok('memory_context', { id: 'claim-ai', as_of: ASOF, evidence: [{ id: 'source-context', revision: 1 }], budget: 4000 });
  assert.ok(packet.selected.some(n => n.id === 'source-context'));
  f.ok('mission_save', { id: 'dispatch-1', question: 'Examine with conditions', packet_id: packet.id });
  const dispatched = f.ok('mission_dispatch', { id: 'dispatch-1', packet_id: packet.id, provider: 'test-provider', model: 'test-model', adapter_version: 'test/v1', at: ASOF });
  assert.equal(dispatched.consumed, 'unknown'); assert.equal(dispatched.packet_digest, packet.digest);
  assert.equal(f.ok('mission_get', { id: 'dispatch-1' }).dispatch.provider, 'test-provider');
});
test('duplicate evidence is rejected and paused intake does not destroy the pending queue', t => {
  const f = fixture(t); const packet = f.ok('memory_context', { id: 'claim-ai', budget: 4000 });
  const e = { id: 'source-benefit', revision: 1, role: 'supports' };
  assert.equal(f.call('memory_propose', { idempotency_key: 'duplicate', packet_id: packet.id, base_generation: 1, candidate: { title: 'Demo', body: 'Demo', conditions: 'Demo', conclusion: 'supported', evidence: [e,e] } }).error.code, 'request.invalid');
  const p = proposal(f); f.ok('scenario', { name: 'pause_intake' }, 'owner');
  assert.equal(f.call('memory_propose', {}).error.code, 'intake.paused');
  assert.equal(f.ok('proposal_get', { proposal_id: p.id }).state, 'awaiting_review');
});

test('contract inventory matches executable capabilities and evidence export is independently readable', async t => {
  const f = fixture(t);
  const contract = JSON.parse(readFileSync(resolve('mock-sovmem/contract.json')));
  assert.deepEqual(Object.keys(contract.methods).sort(), f.ok('memory_status').methods.sort());
  const p = proposal(f); review(f, p); f.ok('scenario', { name: 'changed_source' }, 'owner');
  const output = join(f.root, 'independent-export'); f.ok('export', { output }, 'owner');
  const { readdirSync } = await import('node:fs'); const { parse: parseYaml } = await import('yaml');
  const docs = [];
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name); if (entry.isDirectory()) walk(path);
      else if (entry.name !== 'index.md' && path.endsWith('.md')) {
        const raw = readFileSync(path, 'utf8'); const meta = parseYaml(raw.match(/^---\n([\s\S]*?)\n---/)[1]);
        assert.ok(meta.type); assert.equal(meta.synthetic, true); docs.push({ path, meta });
      }
    }
  }
  walk(output);
  for (const { meta } of docs) {
    for (const edge of meta.sovmem.edges) assert.ok(docs.some(d => d.meta.sovmem.id === edge.target_id && d.meta.sovmem.revision === edge.target_revision));
    for (const source of meta.sources) if (source.resource.startsWith('/')) assert.ok(docs.some(d => d.path === join(output, source.resource.slice(1))));
  }
  assert.ok(docs.some(d => d.meta.sovmem.id === 'source-benefit' && d.meta.sovmem.revision === 1));
  assert.ok(docs.some(d => d.meta.sovmem.id === 'source-benefit' && d.meta.sovmem.revision === 2));
});

test('refreshed mission never discloses revoked historical drafts', t => {
  const f = fixture(t); const packet = f.ok('memory_context', { id: 'claim-ai' });
  f.ok('mission_save', { id: 'private-history', question: 'Old', packet_id: packet.id, draft: 'DO-NOT-DISCLOSE-HISTORY', conversation: [{ role: 'user', content: 'DO-NOT-DISCLOSE-HISTORY' }] });
  f.ok('scenario', { name: 'deny_source' }, 'owner');
  const safe = f.ok('memory_context', { id: 'source-context' });
  const saved = f.ok('mission_save', { id: 'private-history', question: 'New', packet_id: safe.id });
  assert.ok(!JSON.stringify(saved).includes('DO-NOT-DISCLOSE-HISTORY'));
  assert.ok(!JSON.stringify(f.ok('mission_get', { id: 'private-history' })).includes('DO-NOT-DISCLOSE-HISTORY'));
});
test('acceptance of historical evidence keeps source attribution and typed citation on the same revision', t => {
  const f = fixture(t); f.ok('scenario', { name: 'changed_source' }, 'owner');
  const p = proposal(f); const accepted = review(f, p).result;
  const graph = f.ok('memory_trace', { id: accepted.record_id });
  const edges = graph.edges.filter(e => e.source_id === accepted.record_id && e.target_id === 'source-benefit');
  assert.ok(edges.some(e => e.category === 'source'));
  assert.ok(edges.every(e => e.target_revision === 1));
  const output = join(f.root, 'old-evidence-export'); f.ok('export', { output }, 'owner');
});

test('trace withholds verdict reasons when their evidence packet loses scope', t => {
  const f = fixture(t), p = proposal(f);
  assert.equal(review(f, p, 'accept', { reason: 'REVOKED-REASON-SENTINEL' }).ok, true);
  f.ok('scenario', { name: 'deny_source' }, 'owner');
  assert.ok(!JSON.stringify(f.ok('memory_trace', { id: 'claim-ai' })).includes('REVOKED-REASON-SENTINEL'));
});
test('mission trace includes every exact selected evidence revision', t => {
  const f = fixture(t);
  const packet = f.ok('memory_context', { id: 'claim-ai', evidence: [{ id: 'source-context', revision: 1 }, { id: 'source-risk', revision: 1 }] });
  f.ok('mission_save', { id: 'all-evidence', question: 'Compare', packet_id: packet.id });
  const graph = f.ok('memory_trace', { mission_id: 'all-evidence', depth: 0 });
  for (const n of packet.selected) assert.ok(graph.nodes.some(d => d.id === n.id && d.revision === n.revision));
});
test('malformed nested inputs produce typed request errors', t => {
  const f = fixture(t), packet = f.ok('memory_context', { id: 'claim-ai' });
  assert.equal(f.call('memory_context', { id: 'claim-ai', evidence: [null] }).error.code, 'request.invalid');
  assert.equal(f.call('mission_save', { id: 'invalid', question: 'Question', packet_id: packet.id, conversation: [null] }).error.code, 'request.invalid');
  assert.equal(f.call('memory_search', { cursor: Buffer.from('null').toString('base64url') }).error.code, 'cursor.invalid');
  f.ok('mission_save', { id: 'invalid', question: 'Question', packet_id: packet.id });
  assert.equal(f.call('mission_dispatch', { id: 'invalid', packet_id: packet.id, provider: 'demo', model: 'demo', adapter_version: 'demo', at: 'yesterday' }).error.code, 'request.invalid');
});
