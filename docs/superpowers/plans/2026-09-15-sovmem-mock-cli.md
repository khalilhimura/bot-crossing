# SovMem Mock CLI Implementation Plan

**Goal:** Deliver a local OKF v0.2 mock with a stable JSON adapter boundary for the Nous MVP.
**Architecture:** Node ESM executable, passive OKF reader, immutable Markdown blobs and atomically published JSON state; isolated synthetic fixture store. A process adapter supplies the same request/response envelope to future Nous code.
**Tech stack:** Node >=20, pinned YAML parser, node:test; no model/network calls.
**Spec:** `docs/nous-mock-cli-foundation.md` and `docs/nous-mvp-sovmem-cli-readiness.md`.

## Constraints

- Branch `codex/sovmem-mock-cli`; preserve existing app and baseline.
- Explicit `demo: true`, simulated authority; no claim of production isolation or cryptographic verification.
- Namespace interface `sovmem-mock/v1`; do not claim ratified SovMem v0.4 API compatibility.
- Seed immutable synthetic OKF documents. Store mutable state only in an explicit empty initialized directory.
- Keep claimed truth, verification, acceptance, lifecycle, freshness and pending state separate.

## Tasks

- [x] Define public-boundary tests in `tests/sovmem-mock.test.mjs`: CLI JSON framing; init/status; search/get/trace/context; version/scope errors; positive and contradictory evidence; propose/review/retry/restart; topic and mission persistence; export/validation; failure scenarios. Run `node --test tests/sovmem-mock.test.mjs` and observe missing CLI failures.
- [x] Implement `mock-sovmem/okf.mjs` and synthetic `fixtures/bundle/`: bounded YAML/Markdown reading, stable sources, unknown metadata, timestamps, paths and graph projection. Test malformed/unsafe bundles and reordered source IDs.
- [x] Implement `mock-sovmem/store.mjs`: marker, lock, bounded reads, immutable Markdown blobs, atomic state, digest verification, snapshot history. No overwrite of existing directories or silent lock recovery.
- [x] Implement `mock-sovmem/service.mjs` and focused read/workflow modules: five conceptual memory operations, trace, simulated owner review, evidence-bound proposals, pending/KIV, scenarios, topic/mission state, export.
- [x] Implement `mock-sovmem/cli.mjs` and `mock-sovmem/adapter.mjs`: one JSON request per invocation; structured errors and exit codes; process timeout/cancel. No shell interpolation.
- [x] Add runbook, request examples, `mock:demo` reusable pilot, package scripts. Execute an end-to-end demo through the public adapter in a fresh temporary store.
- [x] Review requirement coverage; fix gaps with regression tests. Run mock tests, full `npm test`, `npm run build`, and `git diff --check`. Record evidence and branch state.

Implementation is authorized by the explicit build goal. Work executes in this session; no publication or deployment is requested.

## Verification — 15 September 2026

- `npm test`: 53 passed (27 existing application tests, 26 mock integration tests).
- `npm run mock:demo`: generation 2, accepted linked finding, six trace nodes and twelve edges, finding reused in a new packet; zero model calls; temporary store removed.
- `npm run build`: passed; existing bundle-size warning remains.
- `npm audit --omit=dev`: zero vulnerabilities.
- `git diff --check`: passed.
- Independent review caught and prompted regression fixes for revoked mission history/verdicts, exact historical source attribution, and complete mission evidence tracing.

The mock enables local Nous integration development. Production signing, authorization,
BLAKE3 verification, provider execution, full recovery and the 3D user interface
are outside this delivery. The role flag simulates authority; it is not authentication.
