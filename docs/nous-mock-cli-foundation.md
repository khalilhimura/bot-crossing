# Mock SovMem CLI — OKF v0.2 foundation

15 September 2026. Approved document-format direction, now implemented by the
[standalone mock CLI](../mock-sovmem/README.md). This document does not claim a
working production SovMem v0.4 implementation.

## Pinned foundation

Use [OKF v0.2 SPEC.md](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/ad30107c31c06aec8a7d5636e0d1058118604e6f/SPEC.md)
at commit `ad30107c31c06aec8a7d5636e0d1058118604e6f` as the normative
document-format baseline. Use the candidate SovMem v0.4 specification and OKF
amendment for the proposed native semantics and CLI behaviour described in the
[readiness checklist](nous-mvp-sovmem-cli-readiness.md).

OKF defines documents; it does not define the mock's CLI methods, native authority,
transaction protocol, topic layout or mission workflow. Version the mock interface
separately and label it experimental until the real SovMem contract is frozen.

## Three layers

1. **OKF documents:** actual UTF-8 Markdown files with YAML frontmatter, not only
   hard-coded JSON responses. Derive the mock's read/search/trace responses from
   these files so they exercise the future document boundary.
2. **SovMem profile:** explicit native identity, revision, lifecycle, scope,
   decision references and typed relationships under the proposed namespace.
   Preserve the distinction between generic readable OKF and native eligibility.
3. **Mock runtime state:** synthetic proposals, review results, generation/status
   simulation and failure scenarios outside the exchange bundle. Simulated
   acceptance is never represented as a real protected approval.

## Document rules

- Give every non-reserved Markdown document a non-empty top-level `type`.
- Declare `okf_version: "0.2"` in the bundle-root `index.md`; keep non-root indexes
  free of frontmatter. Reserve `index.md` and `log.md` for their defined purposes.
- Use `sources` with stable source IDs for attribution, and matching Markdown
  footnotes for individual claims. Include synthetic supporting, challenging and
  contextual material for the **AI and independent work** pilot; label it as
  synthetic evidence, not real research or the user's actual endorsed beliefs.
- Keep `generated` and `verified` distinct. A native acceptance does not
  automatically generate an OKF verification event.
- Keep OKF `status` separate from native lifecycle and transient proposal status.
  A missing OKF status does not mean the owner accepted the document.
- Preserve `stale_after` independently of applicability and supersession. Use
  explicit timezone offsets for timestamp-valued fields and fixed `as_of` values
  for deterministic scenarios.
- Resolve concept paths under the bundle root. Map native record/revision identity
  explicitly; never replace a historical target with a current revision silently.
- Preserve unknown keys/types, tolerate missing optional families/indexes and
  broken links, and accept both mapping and list forms of `verified`. Report
  unsupported or ineligible native content separately from malformed OKF.
- Distinguish ordinary Markdown links, source attribution and reviewed typed
  edges. Additional grouping into Nous topics remains presentation state.
- Read source text and computation descriptors passively. Importing or displaying
  a document must not execute code or fetch a URL.

## Fixture and readiness requirements

The implemented mock covers the approved search/get/trace/context/propose/
review/status loop and restart persistence with synthetic data. Add cases for
source reordering, broken links, conflicting positions, stale evidence, changed
proposal bytes, KIV, rejection, denied scope, repeated submission and a lost
response after simulated commitment.

Keep the seed fixtures immutable and runtime changes in a separate disposable
directory. Never point the mock at the private SovMem store or real approval keys.
Responses and UI must clearly identify demo memory and simulated authority.

Validate the fixture bundle against OKF rules and test the machine-readable
contract independently of the UI. A shared contract suite should later be run
against the real adapter; matching mock behaviour does not establish real
cryptographic, isolation, crash-durability or recovery guarantees.

Pi remains outside this CLI. A later explicitly authorized BYOK test can send
selected synthetic context to a provider. API keys, chat caches and per-run
receipts are not part of the OKF exchange bundle.

## Delivered mock contract

The [runbook](../mock-sovmem/README.md) and [method inventory](../mock-sovmem/contract.json)
describe operation names, JSON request/response examples, error/state transitions,
fixture layout, persistence format and conformance cases.
Keep it aligned with the [approved Nous flow](nous-mvp-design-decisions.md) and
the proposed real SovMem methods, so replacement requires an adapter change
rather than a redesign of the interface.

Next build: [Nous MVP handover](nous-mvp-build-handover.md) and its linked local bridge plan.
