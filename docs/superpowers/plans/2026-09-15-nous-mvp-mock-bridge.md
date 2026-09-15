# Nous MVP local mock bridge implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. This is the first build slice; subsequent slices are scoped in the handover.

**Goal:** Let the Nous browser call the delivered mock through a bounded local Node API with a separate simulated review route.

**Architecture:** Inject two Node process adapters into a small HTTP middleware.
Agent operations and explicit demo review use distinct allowlists. Register the
same middleware in Vite and built serving; the browser receives JSON only.

**Tech Stack:** Existing Node >=20, Vite, ESM, node:test and fetch; no new framework or model dependency.

**Spec:** [Build handover](../../nous-mvp-build-handover.md),
[approved decisions](../../nous-mvp-design-decisions.md),
[mock runbook](../../../mock-sovmem/README.md).

## Global constraints

- Synthetic demo store only, configured on the server; no real SovMem access.
- Interface version `sovmem-mock/v1`; explicit `demo:true` in HTTP results.
- Owner is a simulation flag, never production authentication.
- No model calls, provider keys, new harness integrations or existing-state deletion.
- Preserve MIT licence, original attribution and third-party asset credits.
- Keep unknown/malformed input out of CLI dispatch. Never accept store, role,
  executable, command-line or filesystem arguments from a browser request.
- No public hosting; bind this demo service to loopback.

## Interface and file map

Create `server/nous/api.mjs`:

```js
export function createNousMiddleware({ memory, reviewer, allowedOrigin }) {
  // Returns async (req, res, next); adapters implement request(method, params).
}
```

Routes (all JSON POST):

- `/api/nous/request`: `{method,params}` with allowlist `memory_status`,
  `memory_search`, `memory_get`, `memory_trace`, `memory_context`, `memory_propose`,
  `proposal_get`, `proposal_list`, `proposal_revise`, `topic_save`, `topic_list`,
  `mission_save`, `mission_get`, `mission_list`.
- `/api/nous/review`: `{proposal_id,revision_hash,action,reason}`; invoke only
  `reviewer.request('review', body)`. KIV may omit reason as the CLI permits.
- Exclude `init`, `scenario`, `validate`, `export`, `mission_dispatch` from browser
  routing in this slice. Run fixture administration via CLI.

Success: `{version:'sovmem-mock/v1',demo:true,ok:true,result}`. Failure:
`{version:'sovmem-mock/v1',demo:true,ok:false,error:{code,message}}`.
Use HTTP 400 for invalid input/unsupported methods, 403 for origin/role violations,
413 for >256 KiB bodies, 409 for stale/busy/conflict outcomes and 503 for adapter
process/unavailability errors. Other CLI domain failures use 422. Preserve `.code`;
use a safe generic message for unexpected exceptions. Do not leak server paths.

Create `server/nous/runtime.mjs`: `createNousRuntime({store,allowedOrigin})`
constructs adapters once and returns middleware. Missing store returns a typed
`demo.unconfigured` on Nous routes; it does not auto-initialize a directory.
Queue adapter requests across both roles so autosave and review do not collide;
never automatically replay a mutation after timeout. Reconciliation is a caller action.

Create `src/nous/api.js`: `createNousClient({fetchImpl=fetch}={})` returning
`request(method,params)` and `review(params)`. Preserve typed errors and reject
responses with an incompatible version or missing demo marker. Browser code must
not import `mock-sovmem/adapter.mjs`.

Modify `vite.config.js` and `server/serve.mjs` to register the runtime before the
legacy API. Proposed server configuration: `NOUS_MOCK_STORE` (absolute initialized
store path), `NOUS_ORIGIN` (exact local browser origin). These variables do not
exist until this slice implements them. Require an explicit origin when the
store is configured; validate that it is loopback HTTP. Keep legacy mode available
when no demo store is configured. Test dynamic dev port handling: use the printed
port to set the explicit origin if 5274 is occupied.

## Task 1: HTTP contract and authority routing

**Files:** create `server/nous/api.mjs`, `tests/nous-api.test.mjs`.

**Consumes:** adapter `request(method,params)` from the delivered mock.
**Produces:** middleware with the routes/envelopes above.

- [ ] Add a local HTTP test harness using `node:http`, listening on `127.0.0.1`
  at port 0 with cleanup via `t.after`. Inject spies for both adapters.
- [ ] Write these assertions before implementation (the helper below is the test
  harness API to implement; `post` sends JSON with the configured Origin):

```js
const h = await harness(t);
const response = await h.post('/api/nous/request', {
  method: 'memory_search', params: {kind:'claim'}
});
assert.equal(response.body.demo, true);
assert.deepEqual(h.agentCalls, [['memory_search', {kind:'claim'}]]);
assert.equal(h.ownerCalls.length, 0);
await h.post('/api/nous/review', {
  proposal_id:'proposal-demo', revision_hash:'abc', action:'kiv'
});
assert.equal(h.ownerCalls[0][0], 'review');
```

- [ ] Add HTTP cases for `request` attempting `review` or `init`, extra top-level
  `role`/`store`, null/array bodies, >256 KiB input, wrong content type, wrong or
  missing Origin, wrong Host, and a thrown `review.stale_base`. Assert denied
  requests call neither adapter. Require matching Host plus exact configured
  Origin; do not enable wildcard CORS. Non-Nous paths call `next`.
- [ ] Run `node --test tests/nous-api.test.mjs`; confirm the missing middleware
  fails the contract cases.
- [ ] Implement request parsing, allowlists, origin/host checks, envelopes and
  error mapping. Limit bytes while reading, not after retaining an unlimited body.
  Allow only `{method,params}` on request and the documented review keys; params
  must be a non-null object. Return once after errors and end each response.
- [ ] Run the same test command to green, then `git diff --check`. Commit this
  bounded slice with `git add server/nous/api.mjs tests/nous-api.test.mjs` and
  `git commit -m "Add bounded Nous demo HTTP contract"`.

## Task 2: Real CLI wiring in both server modes

**Files:** create `server/nous/runtime.mjs`, `tests/nous-runtime.test.mjs`;
modify `vite.config.js`, `server/serve.mjs`.

**Consumes:** task 1 middleware and `createMockAdapter({store,role})`.
**Produces:** same HTTP contract backed by a persistent synthetic store.

- [ ] Initialize a fresh temp store through the public CLI in the integration
  test; do not mutate `state.json` directly. Start middleware with real adapters.
- [ ] Write a public HTTP flow: compile context for `claim-ai`, submit candidate
  evidence `source-benefit@1`, then KIV and Accept using the returned proposal hash.
  Assert pending after KIV and generation 2 after acceptance. Recreate the runtime
  using the same store and assert `memory_status({proposal_id})` stays accepted.
  Assert two simultaneous saves serialize and both finish, while a rejected
  queued request does not poison subsequent work.
- [ ] Run `node --test tests/nous-runtime.test.mjs` and observe failure before wiring.
- [ ] Implement a shared queue that recovers its tail after rejection:

```js
let tail = Promise.resolve();
function enqueue(adapter, method, params) {
  const pending = tail.then(() => adapter.request(method, params));
  tail = pending.catch(() => {});
  return pending;
}
```

- [ ] Instantiate agent and owner adapters only in Node and wrap both in that queue.
  Validate environment configuration and register middleware in both hosts before
  the existing API dispatch. Bind configured demo serving to loopback. Keep
  `server/api.mjs`'s legacy methods outside the new allowlist.
- [ ] Run runtime and HTTP tests, then `npm test` and `npm run build`. Start each
  server mode and issue a same-origin memory status request to verify wiring.
  Stop only servers started for this check. Commit the runtime and host changes.

## Task 3: Browser client and handoff to topic UI

**Files:** create `src/nous/api.js`, `tests/nous-client.test.mjs`;
update `docs/nous-mvp-build-handover.md` with measured results and startup commands.

**Consumes:** task 1 HTTP contract.
**Produces:** browser-safe `createNousClient` for topic/mission panels.

- [ ] Test using injected fetch: assert correct URL and JSON request, returned
  result, preserved error `.code`, and protocol failure for missing demo/version.

```js
const calls = [];
const client = createNousClient({fetchImpl: async (url, options) => {
  calls.push([url, JSON.parse(options.body)]);
  return {ok:true, json:async () => ({
    version:'sovmem-mock/v1', demo:true, ok:true, result:{generation:1}
  })};
}});
assert.equal((await client.request('memory_status', {})).generation, 1);
assert.equal(calls[0][0], '/api/nous/request');
```

- [ ] Run `node --test tests/nous-client.test.mjs` to see missing-client failure.
- [ ] Implement fetch POST with `Content-Type: application/json`, strict response
  envelope parsing and typed errors. Do not put credentials, store paths or roles
  into browser state. Preserve uncertain mutation outcomes for UI reconciliation.
- [ ] Run client tests, full `npm test`, `npm run build` and `git diff --check`.
  Confirm the browser dependency graph contains no `node:child_process` import.
- [ ] Document exact startup environment, tested request example, pass counts and
  remaining UI work. Commit the client and evidence updates.

## Completion and next slice

This slice is complete when real CLI-backed requests work through both local
server modes, review is isolated from ordinary operations, and all checks pass.
It does not yet deliver the 3D topic or mission interface. Continue with handover
milestones 2–4: write their concrete UI plan against the now-tested client, then
implement and visually verify the approved pilot. Do not claim the whole MVP is
complete from bridge tests alone. Commit only intended files; push/merge/deployment
remain governed by the user's active instructions.
