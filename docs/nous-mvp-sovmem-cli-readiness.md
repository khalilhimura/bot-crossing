# Minimum SovMem CLI contract for the Nous MVP

15 September 2026 — investigation and proposed integration contract.

## Conclusion and scope

Nous needs a verified scoped read/context/propose interface, an owner-only review
broker, and durable commitment/recovery. A version label or successful CLI command
is insufficient. Pi handles hosted model execution in Nous's adapter; SovMem
remains deterministic and offline.

The operation labels below describe required capabilities, **not commands already
implemented or new ratified MCP tool names**. Exact CLI flags, JSON encodings,
transport and capability versions belong in the implementation plan. Preserve the
spec's five conceptual agent operations: memory_search, memory_get,
memory_context, memory_propose and memory_status. Owner review and maintenance
remain a separate authority surface.

This is a proposed bounded Nous integration milestone. It neither changes frozen
SovMem contracts nor waives full v0.4 release/cutover gates. No Rust implementation,
live migration, model call, or verification suite was run for this investigation.

## Evidence examined

- SovMem root checkout HEAD: `97d212f` (docs: refresh SovMem audit for OKF v0.2
  and Nous MVP). Source inspection only; not a verification of an active phase
  worktree or release readiness.
- [v0.4 draft.1](/Users/khalilhimura/Documents/nous/docs/research/sovmem-v0.4/02-sovmem-v0.4-specification.md).
- Candidate OKF v0.2 amendment, REQ-OKF-01–16.
- MVP mapping supplement, REQ-MVP-01–06.
- Current `sovmem/src/cli.rs`, `sovmem/src/mcp/tools.rs`, `sovmem/src/mcp/mod.rs`,
  and `sovmem/src/profile/config.rs` in the SovMem checkout.
- [Approved Nous decisions](nous-mvp-design-decisions.md).

The current CLI has query, propose, proposal/review, verdict, index and recovery
surfaces. Its MCP tool definitions expose four operations. The inspected get
request accepts an ID and body flag, not an exact revision selector; status is a
store/queue status operation. The profile validator still requires OKF 0.1.
Existing names are reuse candidates, not evidence that v0.4 contracts are met.

## 1. Responsibility boundaries

| Owner | Required responsibilities |
| --- | --- |
| SovMem core and protected services | Record identity/revisions; accepted content and verdicts; scope/policy enforcement; evidence locators; typed graph; context compilation; intake; commit verification; export/recovery. |
| Nous application | Topic names/membership and scene layout; mission conversation/drafts; KIV UI; selected evidence; provider settings; Pi orchestration; dispatched-context evidence; refresh and resume UX. |
| Owner approval broker | Authenticate the owner; display the frozen review packet; bind reason and exact changes; issue effective approval through the protected contract. |
| Pi/provider adapter | Model requests, streaming, bounded mission tools, cancellation, runtime telemetry. No signing key or writable canon. |

Topics and mission UI states do not require new canonical kinds. One claim may
appear in several topics through shared record references. A durable accepted run
may use the existing `run` kind; not every chat message needs canonical acceptance.
Provider keys and conversation caches are not canonical record fields.

## 2. Minimum methods/actions, inputs and outputs

All responses need a versioned machine-readable contract, typed errors, explicit
limits and appropriate identity/generation bindings. JSON goes to the supported
machine output channel; diagnostics must not corrupt it. The authenticated caller
cannot obtain authority by supplying a different `principal` string. The service
must derive/validate identity against the effective execution boundary.

| Capability | Minimum request | Minimum response/effect | Specification basis |
| --- | --- | --- | --- |
| Inspect supported capabilities and health | Authorized store/profile; requested interface version | Supported schema/profile/capabilities, committed generation, policy version, verification/index freshness, intake state, typed unsupported/degraded status. A health claim must have verification evidence. | API-01/02, TXN-03/04; proposed handshake detail |
| Search/list eligible claims and sources | Query/filter, scope, purpose, explicit as_of, current/historical mode, bounded result count/cursor | Stable ordered record/revision references, safe summaries, lifecycle and acceptance information; generation-bound continuation. | SEC-05, CTX-03/04, MVP-04 |
| Get exact record/evidence | Store-bound ID and revision (or explicit governed current selector), scope, bounded body range | Verified record fields, body/excerpt, source locators, digest, verdict reference, freshness and scope. Explicit truncation/range metadata; no silent complete-document claim for a snippet. | DATA-01/03, GRAPH-02, CTX-02, OKF-04/06 |
| Get focused trace/history | Root claim/run ID and revision, direction/edge filters, historical/archive scope, page/depth limits | Nodes and edges with exact endpoints, evidence locators and owning verdict references; consistent snapshot/cursor. Implement as versioned read options or an authorized projection, not an unrestricted new model tool. | GRAPH-01–03, MVP-03/04 |
| Compile mission context | Authenticated principal, task/goal and purpose, selected claim/evidence revisions, scope, as_of, token/candidate/expansion budgets | One packet in JSON and Markdown: packet ID/digest, generation/policy, governing route, excerpts/citations, decision reasons, uncertainty/contradictions and permitted omissions. Fail when required governing context is unavailable. | CTX-01–04, API-01, MVP-05 |
| Submit/revise a proposal | Candidate bytes/schema, intended effect, target/base generation, mission/run and packet references, source revisions, scoped idempotency key | Proposal ID and revision hash, admission state/diagnostics, scoped status handle; no canon mutation. Same key+payload returns the same proposal; changed payload fails or uses an explicit new revision. | TXN-01, SEC-07, MVP-01/05 |
| Read pending proposal/review packet | Authorized proposal ID+revision/status handle | Exact candidate/diff, intended effect, both supporting and conflicting evidence, uncertainty, policy checks and base generation; pending/rejected/rewrite/accepted state. | REV-01, MVP-06 |
| Review through owner broker | Frozen proposal revision, target/scope/base/policy, artifact digest, human decision and non-empty reason | Protected approval bound to exact reviewed bytes; edited bytes need fresh review. Agents cannot obtain effective authority through a CLI flag or TTY. | SEC-01–04, REV-01, MVP-06 |
| Apply/reconcile reviewed outcome | Valid owner receipt through protected boundary; reconciliation uses a scoped read-only handle | Verified verdict event and committed generation, exact accepted record revisions; reject/expiry/stale-base errors leave canon unchanged. Reconciliation never replays a signing/apply operation. | TXN-02–05, SEC-04, MVP-06 |
| Pause/revoke/resume intake scope | Authenticated owner, source/scope and reason under policy | Enforced pause/revocation on subsequent requests and explicit state; preserve pending work. No silent resumption by the model. | AGENCY-01, REV-03, MVP-04 |
| Read/map legacy or OKF source material | Authorized read-only source, pinned profile and parsing limits | Bounded inert source view and mapping report: preserved/converted/excluded/blocked; provenance and unknown fields retained. No implicit fetch, execution or acceptance. | OKF-01–11/15, MVP-01/02 |
| Verify/rebuild/export/restore | Authorized store, explicit scope/mode and protected output destination | Verified generation and deterministic projection; filtered OKF working set or separately authorized complete native archive; restore/recovery evidence and typed failures. | TXN-03/04, RET-01, MIG, OKF-09/11/15/16 |

The read/propose endpoint can wrap the compiled CLI with structured arguments or
use a versioned local service. Pi does not itself require MCP. If MCP is used or
v0.4 MCP compatibility is claimed, API-02's pinned lifecycle/conformance suite is
still required. CLI transport does not waive the spec's two-independent-adapter
proof for a full v0.4 claim. Five model providers behind one Pi adapter are not
five independent SovMem adapters.

## 3. Minimum data contracts

### Canonical records

Use the draft's top-level OKF `type` and `schema_version: sovmem-record-v4`, with
native fields in `sovmem`: store/profile/record identity, kind, title/body,
epistemic_status, lifecycle, scope, provenance, recorded/applicability times,
revision/predecessor, owning decision_ref, sensitivity and retention_class.
Digests live in the verified manifest, not inside their own hashed document.
Missing actor, time, usage/cost or observation facts remain unknown with reasons.

The pilot directly exercises `claim`, `source`, `run`, and potentially `artifact`,
`goal` and `decision`; governing `constraint`/`procedure` records remain readable.
Preserve the complete nine-kind vocabulary. Do not mislabel a finding as a factual
observation merely because the user accepted it.

### Edges and attachments

Each native edge needs owning record revision/ordinal, relation, exact target ID
and revision, scope and evidence locator. Support relevant `supports`,
`contradicts`, `used_version`, `produced`, `supersedes` and governing relations.
The candidate mapping adds `cites`, `derived_from`, `references`; ratify that
vocabulary before freezing it. Keep ordinary Markdown links, source attribution
and reviewed typed edges distinguishable. Context-only attachments must not be
silently converted into support. Retain source ID, exact locator/revision, excerpt
anchor and optional relevance note. No unattested historical target guessing.

### Mission/run envelope

Nous owns the transient mission ID and draft. Bind its returned proposal to task,
selected revisions, packet ID/digest, base generation, authorized scope and budget,
Pi/adapter version, provider/model ID/settings, output and evidence locators.
Distinguish selected, dispatched and observably consumed context; model receipt
of a request cannot prove its internal use. Record unavailable telemetry explicitly.
Preserve assessment conclusion and scope/conditions in the candidate content or a
reviewed extension; exact encoding remains a schema-design decision.

### Proposal and acceptance result

Proposal identity, immutable revision digest, base generation, intended effect,
candidate records/edges, review packet and policy version are required. The
approval contract binds store/proposal/revision/base/policy/verdict/reason,
single-use nonce, expiry and key ID. Result data binds the verified ledger event,
sequence, committed generation and accepted revisions. Support a single reviewed
change set for mutually dependent new records/edges, or use already committed
exact references; never leave dangling provenance after a partial write. The
change-set encoding is a proposed MVP contract detail, not a current CLI feature.

## 4. Product semantics that must survive the CLI boundary

1. **Endorsed is not objectively true.** Keep epistemic status, OKF asserted
   verification, native acceptance, lifecycle and freshness as separate dimensions.
2. **Contradictions can coexist.** Return applicable endorsed claims and their
   qualifications together. Ordinary evidence disagreement does not automatically
   produce an authority error or select one winner. Ambiguous current selectors
   or incompatible governing constraints do produce `context.authority_conflict`
   and stop dispatch until the owner resolves the route. Freeze fixtures for both.
3. **A topic is not a single current-version selector.** Different claims can be
   current in the same topic. Historical trace always uses exact revisions.
4. **Accept assesses a finding.** A finding challenging the original may be
   accepted. Acceptance appends it with lineage; replacement needs an explicit
   reviewed supersession effect. Existing endorsed claims do not disappear.
5. **KIV is pending.** Preserve the local deferred draft and, if submitted, its
   pending proposal reference. No KIV verdict, new canon lifecycle or fake reject.
6. **Reject and validation failure differ.** A human rejection has its recorded
   reviewed object and reason. Machine admission failure is a diagnostic.
7. **Retry cannot mean approve again.** Uncertain response -> status reconciliation
   -> refresh verified generation. Changed input/base -> new review.
8. **Refresh is explicit.** Resume checks source/claim changes and authorization.
   New evidence produces a new draft; old evidence/decision provenance stays fixed.

## 5. Readiness milestones

| Milestone | Required proof | Nous work enabled |
| --- | --- | --- |
| A: frozen contract and synthetic fixtures | Ratified scoped schema/operation contracts, sample JSON/Markdown, typed errors, explicit versions and test vectors | Build interface against a fake adapter; no live capability claim. |
| B: real read/context integration | Passive OKF reading/mapping; verified scoped search/get/trace/context; stable paging; contradiction/authority distinction; source/permission change cases | Private read-only exploration and bounded model investigations, with model dispatch separately authorized. |
| C: full mission loop on an isolated store | Protected broker/principal; proposal idempotency and edited drafts; accepted/rejected/pending cases; exact provenance; crash recovery and commitment reconciliation | End-to-end Nous pilot on an authorized safe clone. |
| D: user-data readiness | Affected G0/G1/G2/G3/G4/G4-OKF/G5 cases, owner checkpoint and archive restore, operational readiness evidence and acceptance exercise; reviewed scope of remaining gates | Consider a separately authorized live pilot. No automatic cutover or full v0.4 release declaration. |

Before claiming a successful integrated MVP, run the approved pilot: examine the
AI/independent-work claim, review, accept an evidence-bound finding, retain relevant
opposing positions, trace its verdict, restart and reuse it without the old chat.
Measure the owner's ability to explain what they endorse, under which conditions,
and why. This is an acceptance observation, not a cognitive-outcome claim.

Mandatory negative fixtures for the relevant milestone:

- Denied record via search, direct get, edges, history, counts and stale cursors.
- Missing governing context under budget; contradictory evidence preserved;
  conflicting governing instructions blocked; no future evidence in past views.
- Forged `human:` review label, direct CLI/file write, replayed/expired/revoked
  receipt, stale base, changed candidate after review.
- Identical submission retry, key reused for different content, lost response
  after commit, and refresh from an old graph cache.
- Crash before/after each publication boundary; wrong store/index ownership;
  rollback against an independent checkpoint; restore without the prior index.
- Reordered source IDs, unknown fields, stripped native namespace, invalid dates,
  broken/historical links, path escapes, private metadata and retired reimport.

The full v0.4 spec retains G0–G8, two adapters, comparative review/retrieval/value
studies and operational proofs. A bounded integration milestone cannot be called
their completion. A narrowed milestone must be explicitly scoped in the SovMem
plan; unresolved baseline integrity/authority defects remain blockers.

## 6. Work not needed inside the SovMem CLI

- Pi, model SDKs, provider networking, BYOK credentials, model switching.
- 3D rendering, topic layout/membership, animations, chat persistence or KIV UI.
- New canonical topic/mission/paradox kinds solely for the interface.
- Web capture/uploads for this existing-source MVP; automatic source execution.
- Embeddings/vector database, full-store graph loading or automatic contradiction
  resolution; the lexical and bounded trace paths are sufficient starting points.
- Attested Computation execution, generalized schedulers, autonomous approval,
  Janusian and Polarity Management missions, hosted multi-user operation.

Preserve optional computation descriptions as passive content. Deferring execution
does not mean G-ATTEST passed. Broad feature deferral does not remove the security,
recovery or portability obligations for features actually used.

## 7. Remaining decisions before a SovMem implementation plan

Freeze exact schema and digest/receipt vectors; effective owner/agent isolation;
transport/capability envelope; bounded evidence-body paging; review/change-set and
commit-reconciliation handles; current selector versus topic semantics; source
revocation and mission-resume behaviour; accepted fixture corpus and total test
budgets. Confirm the active SovMem worktree and fresh baseline evidence first.

### Local source paths

- `/Users/khalilhimura/Documents/nous/docs/research/sovmem-v0.4/02-sovmem-v0.4-specification.md`
- `/Users/khalilhimura/Documents/nous/docs/research/sovmem-v0.4/04-okf-v0.2-spec-amendment.md`
- `/Users/khalilhimura/Documents/nous/docs/research/sovmem-v0.4/05-sovmem-on-okf-v0.2-mvp-mapping.md`
- `/Users/khalilhimura/Documents/nous/sovmem/src/cli.rs`
- `/Users/khalilhimura/Documents/nous/sovmem/src/mcp/tools.rs`
- `/Users/khalilhimura/Documents/nous/sovmem/src/profile/config.rs`
