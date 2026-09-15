# SovMem Mock CLI for Nous

A working local mock of the memory boundary needed by the Nous MVP. **Demo memory,
synthetic evidence, simulated authority.** It does not open your real SovMem store,
call a model, execute source content, or hold approval/API keys.

## Run

From the repository root, install dependencies with `npm ci` (Node >=20), then:

```sh
npm run mock:demo
npm run test:mock
```

The demo creates a temporary store, groups the pilot claims, compiles evidence,
submits an assessment, exercises KIV and simulated acceptance, traces provenance,
and reuses the finding in a new inquiry. It removes its temporary store afterward.
To retain an inspectable demo store:

```sh
npm run mock:demo -- --store /tmp/my-nous-demo
```

The path must not already exist. Each request is a separate process, so the demo
also exercises restart persistence. No model response is fabricated as a real call:
the assessment is explicitly synthetic and the demo reports `model_calls: 0`.

## Protocol

Use `node mock-sovmem/cli.mjs --store DIRECTORY [--role agent|owner]` and send one
JSON object on stdin. The executable emits exactly one JSON envelope on stdout:

```json
{"version":"sovmem-mock/v1","method":"memory_get","params":{"id":"claim-ai","revision":1,"as_of":"2026-09-15T00:00:00Z"}}
```

```json
{"version":"sovmem-mock/v1","demo":true,"ok":true,"result":{}}
```

Failure uses `ok:false,error:{code,message}` and exit code 1. Success uses exit
code 0. `--help` is human-readable. Use the direct `node` executable when a consumer
requires clean stdout; npm may add script banners.

First initialize a **new** directory using method `init` and `--role owner`.
It seeds only the bundled synthetic OKF files. A non-mock directory is never adopted.
There is no implicit reset, delete, real-vault import or real signing operation.

`--role owner` is a **test switch**, not authentication. Both roles are simulated.
Keep this mock behind a demo-only adapter; never expose it as a protected broker.

## Embedding in the future Nous backend

```js
import { createMockAdapter } from './mock-sovmem/adapter.mjs';
const memory = createMockAdapter({ store: '/tmp/my-nous-demo' });
const result = await memory.request('memory_search', { kind: 'claim' });
// AbortSignal and timeout are supported; no shell interpolation is used.
```

Create a separate owner adapter only for demo review controls. Never expose that
adapter to Pi tools. In a real integration it is replaced by the protected broker,
not by changing a Boolean. UI must retain the demo/simulated label. Adapter errors
have a `.code`; cancellation/timeout around a mutation requires status reconciliation.

## Methods and data

| Method | Parameters | Result |
| --- | --- | --- |
| `init` (owner) | none; store directory must be new | Demo marker and generation 1. |
| `memory_status` | optional `proposal_id` | Store capabilities and verified mock document hashes, or full scoped proposal/result for reconciliation. |
| `memory_search` | optional `query`, `kind`, `limit`, `cursor`, `scope:"pilot"`, `generation`, `as_of` | Ordered `items`, bound `cursor`, generation. Simple deterministic lexical scoring; **not production BM25**. |
| `memory_get` | `id`; optional exact `revision`, `generation`, `as_of` | Body, identity/revision, SHA-256 digest, sources, edges, lifecycle, acceptance, asserted trust and freshness. Exact old revisions remain readable. |
| `memory_trace` | `id` or `mission_id`; optional `revision`, `generation`, `depth:0..3`, `limit`, `cursor`, `as_of` | Versioned nodes, categorized directed edges, verdicts, optional saved mission; progressive expansion/paging. Edges can reference an authorized node on another page. |
| `memory_context` | `id`; optional `revision`, `generation`, `evidence:[{id,revision}]`, `budget:1..16000`, `as_of` | Immutable persisted packet: ID/digest, snapshot/policy, selected exact revisions, evidence Markdown, contradictions, freshness and approximate size estimate. |
| `memory_propose` | `idempotency_key`, `packet_id`, `base_generation`, `candidate` | Immutable review hash and proposal ID, `awaiting_review`, intended effect. Rejects missing/unselected/duplicate evidence and stale packets. |
| `proposal_get` | `proposal_id` | Candidate, previous edited candidates, exact review hash, intended effect, verdict/result. |
| `proposal_list` | optional `state` | Recoverable scoped review queue across restarts. |
| `proposal_revise` | `proposal_id`, current `revision_hash`, new `body` | New hash; preserves the prior candidate. Other candidate changes use a new submission/key. |
| `review` (owner) | `proposal_id`, exact `revision_hash`, `action:accept/reject/kiv`; non-empty `reason` for accept/reject | Simulated verdict and committed generation for accept; recorded rejection; or pending+deferred for KIV. |
| `topic_save` | `id`, `title`, `claims:[id]` | Persistent topic membership; shared references, never copies/deletions. |
| `topic_list` | none | Topics with currently visible members. |
| `mission_save` | `id`, `question`, `packet_id`; optional `conversation:[{role:user/assistant,content}]`, `draft`, `state:paused/kiv/failed/completed` | Persistent UI state. Changing packet preserves prior mission draft/conversation in history. |
| `mission_get` | `id` | Saved work, dispatch report, history and `refresh_required`. Revoked packet returns unavailable. |
| `mission_list` | none | Visible saved missions for Continue mission. |
| `mission_dispatch` | saved mission `id`, matching `packet_id`, `provider`, `model`, `adapter_version`; optional `at` | Adapter-reported dispatch metadata and packet digest; consumption remains unknown. Does not call a model. |
| `scenario` (owner) | `name` from table below | Deterministic failure/edge-case setup. |
| `validate` (owner) | read-only `bundle` directory | OKF conformance and separate attribution/freshness/link/native-edge diagnostics. |
| `export` (owner) | new external `output` directory | OKF bundle with explicit revision paths and source rewrites. Not a full native recovery archive. |

Read requests default to scope `pilot`, the current generation, and fixed
`as_of=2026-09-15T00:00:00Z`; real-time clients should pass a current timestamp.
Requests default to page size 20, maximum 100. A cursor binds query parameters,
generation and policy; repeat the same parameters plus cursor. Refresh after a
`cursor.stale` response. A trace node is identified by **ID and revision**, not ID
alone. Historical trace may show more than one revision of the same source.

Context includes a synthetic governing rule plus a two-hop evidence neighbourhood
and explicitly selected evidence. It fails if the complete bounded selection does
not fit. The size estimate is UTF-8 bytes / 3, **not a provider tokenizer**. A packet
records selection; `mission_dispatch` separately records reported dispatch. Neither
claims that a model actually consumed every source. Context does not elevate
source prose into owner instructions.

### Candidate shape

```json
{
  "title": "AI helps under bounded conditions",
  "body": "Synthetic finding with supporting and conflicting evidence.",
  "conclusion": "inconclusive",
  "conditions": "Distinguish task completion from independent explanation.",
  "evidence": [
    {"id":"source-benefit","revision":1,"role":"supports"},
    {"id":"source-risk","revision":1,"role":"challenges"},
    {"id":"source-context","revision":1,"role":"context"}
  ]
}
```

Conclusions: supported/challenged/inconclusive. Each evidence ID appears once.
Evidence must be in the packet. The candidate becomes a **new inferred finding**,
with derived-from and assessment relation to the examined claim, plus citations
carrying evidence roles. The original claim remains unchanged. Acceptance does not
create an OKF `verified` event. A contradictory finding can be accepted without
retiring the original; KIV makes no verdict or canonical generation.

### Retry and review state

```text
submit → awaiting_review → accepted | rejected
                  ↕
              KIV (deferred)
```

An edit keeps the prior candidate and invalidates its review hash. Same submission
key + exact request returns the same proposal; a different request with that key
fails. After a source/generation change, acceptance requires a refreshed packet and
new proposal/key; the old item can still be rejected or left pending. On lost
response, query `memory_status` with the known proposal ID. Never repeat review to
infer success; it returns `review.already_decided` after a recorded outcome.

## Synthetic scenarios

| Name | Behaviour |
| --- | --- |
| `changed_source` | New revision of the benefit source and new generation; old revision remains available. |
| `stale_evidence` | New source revision with expired `stale_after`. |
| `deny_source` | Revoke benefit-source visibility and bump policy; reject stale cursors and hide referencing content. |
| `authority_conflict` | Context fails; distinct from ordinary contradictory evidence. |
| `investigation_failure` | Context fails with a recoverable investigation error; drafts remain. |
| `pause_intake` | Reject new proposals while preserving review queue. |
| `lost_response` | Next accept/reject commits its result, then returns a simulated transport error. |
| `clear` | Clear active fault and revocation; bump policy. Does not erase source revisions, proposals or verdicts. |

## OKF foundation and persistence

Normative document baseline: [OKF v0.2 at ad30107](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md).
Seed Markdown/YAML files live in `fixtures/bundle/`. No real user artifacts are used.
Generic validation accepts unknown types/fields, missing optional families/indexes,
broken links and singleton/list verification. Unsafe paths, excessive input and
malformed YAML fail explicitly. Datetime warnings do not masquerade as freshness.
Markdown remains untrusted text; the future Nous renderer must sanitize it.

```text
STORE/
  state.json                 # Demo marker, committed snapshot refs, proposals, UI state
  documents/<sha256>.md       # Immutable actual Markdown document bytes
  .lock/                     # Exclusive request lock while CLI is active
```

Accepted documents and scenario revisions are written first; the atomic state-file
rename selects the new generation. Old document bytes/snapshots remain. All requests
verify active blob digests. Locks serialize requests; `store.busy` never silently
steals a possibly live lock. After a confirmed interrupted process, inspect the
store before manually removing `.lock`. Orphan immutable blobs are inert.

This is process-level mock persistence: no fsync/power-loss guarantee, independent
checkpoint, cryptographic owner authentication, signed receipts, full native
archive/restore or production policy engine. SHA-256 is explicitly a **mock digest**,
not SovMem's BLAKE3. `verified_mock_sha256` means active document integrity only,
not verified human authority or rollback resistance. Export preserves revision-bound
Markdown and unknown metadata; it does not export mission caches or approval keys.

## Limits and integration boundary

Requests/documents: 256 KiB each; bundles: 4 MiB, 256 Markdown files, depth 12;
metadata depth 24 and YAML alias limits; state 16 MiB and active snapshot 512 docs.
No network or code execution during validation/import/export. There is no private
store import. Keep disposable stores outside this repo and the real SovMem vault.

`adapter.mjs` is Node-only and intended for Nous's local backend. Pi and BYOK stay
outside this executable. The five conceptual read/propose methods are a proposed
compatibility boundary; **`sovmem-mock/v1` is not the ratified SovMem v0.4 protocol**.
Use contract tests when implementing the real adapter, retaining its separate
protected review path and stronger semantics.

The machine-readable method inventory is in [contract.json](contract.json). Sources that pin historical evidence carry a SovMem `sovmem_ref` extension; generic OKF readers can follow their exported resource paths.
