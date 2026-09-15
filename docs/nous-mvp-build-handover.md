# Nous MVP build handover

Prepared 15 September 2026. Start here in a new session. This handover describes
implemented prerequisites, approved product decisions and the work still to build.

## 1. Starting state

- Repository: `/Users/khalilhimura/Projects/bot-crossing`.
- Base: `main`; mock delivery commit `c2b8aa96a352617fb9ab535b4579e5f44ef56620`.
- Verified remote: `https://github.com/khalilhimura/bot-crossing.git`. Both `origin`
  and `upstream` pointed there at handover; verify before any fetch/push.
- Preserved session-monitor branch: `codex/agent-monitor-baseline` at `1a35b84`.
  Do not modify that historical snapshot.
- Implemented: standalone OKF v0.2 mock, CLI, Node process adapter, synthetic
  pilot, persistence, failure scenarios, tests and runbook.
- Not implemented: Nous context-graph interface, browser bridge, model execution,
  BYOK settings, Pi integration and production SovMem adapter.
- Prior checks: 53 tests passed; build passed with an existing chunk-size warning.
  The mock demo reached generation 2, six trace nodes, twelve edges and reuse of
  the accepted finding, with zero model calls. Repeat checks on your starting tree.

## 2. Read in this order

1. Repository [AGENTS.md](../AGENTS.md): attribution, baseline and product direction.
2. [Approved design decisions](nous-mvp-design-decisions.md): product scope.
3. [Mock runbook](../mock-sovmem/README.md) and [method inventory](../mock-sovmem/contract.json).
4. [First implementation plan](superpowers/plans/2026-09-15-nous-mvp-mock-bridge.md).
5. [Production CLI readiness](nous-mvp-sovmem-cli-readiness.md) when evaluating
   the future real adapter; do not turn its production gates into mock UI blockers.
6. [OKF foundation](nous-mock-cli-foundation.md): pinned format and native extension boundary.

The native SovMem research lives in `/Users/khalilhimura/Documents/nous/docs/research/sovmem-v0.4/`.
Treat it as read-only reference for this build. No private vault or user evidence
is needed. The existing mock fixtures are sufficient to start.

## 3. Start commands

```sh
cd /Users/khalilhimura/Projects/bot-crossing
git status --short
git branch --show-current
git remote -v
git log -1 --oneline
npm ci
npm test
npm run mock:demo
npm run build
```

If clean, branch from current `main` using `codex/nous-mvp-build`. If the handover
files are still uncommitted, preserve them on the new branch; do not reset or
clean the checkout. Follow repository instructions for isolation if needed.

Use a new disposable store outside the repo:

```sh
NOUS_DEMO_PARENT=$(mktemp -d /tmp/nous-mvp.XXXXXX)
node mock-sovmem/cli.mjs --store "$NOUS_DEMO_PARENT/store" --role owner <<'JSON'
{"version":"sovmem-mock/v1","method":"init","params":{}}
JSON
```

The `init` target must not exist. Record the path for restarts. Do not use
`mock:demo -- --store` as the fresh UI acceptance fixture: that demo already
accepts a finding. `npm run dev` currently starts the legacy application; the
new bridge configuration in the implementation plan does not exist yet.

## 4. Runtime shape to build

```text
Nous browser: topic → claim → Explore the tension → assessment → review
       │ local JSON requests (untrusted input)
       ▼
Nous Node bridge ── agent adapter ── SovMem mock CLI ── demo store
       │
       └── separate demo review route ── owner adapter

Later: Nous investigation runner ── Pi candidate runtime ── selected BYOK provider
       The runner receives evidence and proposes; it never receives owner review.
```

The process adapter is Node-only. Do not import it into a Vite browser bundle.
Do not expose raw CLI arguments, store paths or a caller-selected owner role over
HTTP. The mock role switch remains simulated even behind separate routes.
Keep the local bridge loopback-only and validate browser origin/JSON requests.

### Existing implementation entry points

| File | Current responsibility / intended use |
| --- | --- |
| `vite.config.js` | Registers existing Node middleware for development; register the new bridge before the legacy API. |
| `server/serve.mjs` | Built-app HTTP server; wire the same bridge before legacy `/api/` dispatch. |
| `server/api.mjs` | Legacy session and asset operations; keep separate from Nous memory operations. |
| `src/main.js` | Legacy boot, polling and UI orchestration; introduce explicit Nous entry routing before starting session polling. |
| `src/core/engine.js`, `src/core/camera.js` | Reusable renderer and camera. |
| `src/game/colony.js`, `src/world/plots.js`, `src/world/ship.js` | Inspect spatial layout and ship interaction; map topics deliberately instead of fabricating agent sessions. |
| `src/ui/hud.js`, `src/ui/styles.css` | Existing interaction/style reference; new mission panels should be isolated. |
| `mock-sovmem/adapter.mjs` | `createMockAdapter({store, role, timeoutMs}).request(method, params, {signal})`; returns result or throws `.code`. |
| `tests/sovmem-mock.test.mjs` | Public CLI examples and regression expectations. |

Suggested new modules for later UI slices: `src/nous/main.js`, `world.js`,
`mission.js`, `assessment.js`, `trace.js`, `styles.css`; keep state transitions
independent of DOM/Three.js so persistence and retry tests do not require WebGL.
These names are proposed implementation locations, not existing files.

## 5. Product rules to preserve

- One topic per 3D object; several claims can share it, and a claim can belong to
  several topics through the same ID. Show current endorsed understanding and
  contradictory positions together. Newest timestamp is not the truth selector.
- Pilot: **AI and independent work**; selected claim `claim-ai`. Sources:
  `source-benefit`, `source-risk`, `source-context`; opposing claim `claim-reasoning`.
  All are synthetic fixtures. Show **Demo memory · Simulated approval** persistently.
- Inquiry prompt: **Explore the tension**. Conclusions: Supported / Challenged /
  Inconclusive. Actions: Accept / Reject / KIV (Keep in View).
- Accept appends an inferred finding with exact provenance. It does not overwrite
  the original, settle every contradiction or establish objective truth.
- Reject records the reviewed finding and human reason. KIV leaves pending work
  without a verdict or canonical generation change.
- Save and resume a mission; one quiet Continue mission action on the ship.
  Trace provenance opens a separate focused graph and restores the prior scene.
- Existing evidence only. Web capture, uploads, automatic supersession, autonomous
  approval, new harness integrations and future thinking frameworks are outside MVP.

## 6. Mock integration details that matter

1. `memory_context` persists an immutable packet. Pass a current `as_of` from Nous;
   the CLI's default date is fixed for reproducible fixtures. Keep ID/revision/digest,
   generation and policy. Its byte-based estimate is not a provider tokenizer.
2. `mission_save` replaces supplied UI fields; omitted conversation/draft reset to
   empty. Save complete mission snapshots. Changing the packet preserves prior
   history. Save before navigating away; report save failures visibly.
3. Mock proposals reference a packet, not an independently enforced mission ID.
   Compile a fresh packet per mission (capture a distinct `as_of`) and retain the
   returned proposal ID in Nous state. If concurrent missions share a packet,
   add an explicit mission binding with regression tests before relying on mission
   trace to distinguish them. Do not claim the current contract already does this.
4. Only body edits use `proposal_revise`. Changing title, conclusion, conditions or
   evidence requires a new candidate/submission key. Preserve pending old proposals.
5. Serialize autosaves with review/proposal requests to avoid `store.busy`; reads
   may retry with a bound. A timed-out mutation may have committed: reconcile a
   known proposal with `memory_status({proposal_id})`, never blindly repeat review.
6. Resume checks `refresh_required`; source changes require an explicit refresh and
   fresh assessment. Scope revocation can make a saved packet unavailable. Clear
   stale client caches and hide denied drafts, evidence and verdicts.
7. Accepted findings are not automatically inserted into topic membership. After
   confirmed acceptance, persist the new ID in the originating topic while retaining
   existing IDs. If grouping save fails, retry grouping only; acceptance has already
   happened. A future real backend must re-evaluate the same application boundary.
8. Trace identities are `id@revision`; paginate all needed nodes and do not invent
   endpoints when edges reference another page. Preserve native/source/Markdown
   edge categories. Show current positions first and expand history on demand.
9. `mission_dispatch` reports an external dispatch; it does not call a model or
   prove consumption. Never use it to disguise a scripted fixture as a live run.
10. Render evidence as text initially or use a reviewed sanitizer. Markdown, metadata
    and attached documents are data, never executable instructions or raw HTML.

## 7. Build milestones and exit evidence

| Slice | Deliverable | Exit evidence |
| --- | --- | --- |
| 1: local bridge | Same mock HTTP boundary in Vite and built serving, browser client, isolated review route | Public HTTP tests for read, pending proposal, review, invalid methods/origins/roles and typed errors; existing suite and build pass. |
| 2: topic world | Named topic, shared claim references, evidence selection and quiet ship entry | Browser QA: one topic object, opposing positions visible, no history clutter, no session polling in Nous mode. |
| 3: demo mission | Scripted and labelled assessment, editable card, Accept/Reject/KIV, saved mission | Browser pilot succeeds; rejection/KIV do not accept; restart recovers exact draft; lost response yields one verdict. |
| 4: provenance and resilience | Separate progressive graph; source refresh/revocation and retry UX | Exact revisions and evidence roles visible; back restores camera/selection; denied content disappears; source change does not silently rewrite assessment. |
| 5: real investigation | Isolated Pi feasibility followed by provider adapters/settings | Verify current official docs and pin dependency versions. Choose credential storage, endpoint rules, disclosure and cancellation behavior. Verify each approved provider separately; no unsupported compatibility claims. |
| 6: acceptance | User completes the full mock-backed BYOK pilot | User can explain endorsed positions, conditions and evidence, restart and reuse a finding. Mark production SovMem readiness separately. |

Provider options remain OpenAI, Anthropic, Gemini, OpenRouter and OpenAI-compatible
APIs. The scripted slices unblock UI work; they do not reduce that approved target.
Keep provider credentials out of browser bundles, OKF files, exports, logs and Git.
Use synthetic evidence for initial calls. Do not send private context by assumption.

Returning to the ship saves work; it is not permission for background model runs.
Before slice 5, define cancel-vs-pause behavior and late-result handling. In slices
1–4 there is no live background investigation to cancel.

## 8. New-session prompt

Copy this into a new session rooted at the repository:

> Build the Nous MVP in `/Users/khalilhimura/Projects/bot-crossing`, starting from
> `docs/nous-mvp-build-handover.md` and its linked plans. Preserve any uncommitted
> handover documentation. Create `codex/nous-mvp-build` from current main after
> checking local state. Start with the local mock bridge plan, then work through
> the synthetic topic/mission/provenance milestones with tests and browser QA.
> Use the delivered SovMem mock CLI (`sovmem-mock/v1`, OKF v0.2), not the private
> SovMem store. Preserve the approved one-topic-per-object design, contradictory
> endorsed claims, Accept/Reject/KIV and exact provenance. Keep demo authority
> explicit. Do not expand session-monitor features. Read the contract before
> implementing callers; resolve ordinary implementation choices autonomously.
> Report each milestone's evidence and remaining gaps. BYOK/Pi remains the later
> investigation milestone and requires current provider verification. No deployment
> or private-data migration is requested.

No new session was created by preparing this document. This is a portable handover.
