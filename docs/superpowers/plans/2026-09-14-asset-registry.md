# Asset Registry Implementation Plan

> Execute tasks in this session, using focused implementation and review agents where independent work permits.

**Goal:** Import, inspect, persist, place and swap GLBs through a local asset registry.
**Architecture:** A shared Node API owns import bytes and registry metadata. Three.js loads each asset with its original materials, normalizes placement through wrappers, and renders an independent preview. Bundled model catalog entries share bundle definitions with legacy loaders.
**Tech Stack:** Node.js, Three.js, Vite, node:test, local JSON and GLB files.
**Spec:** ../specs/2026-09-14-asset-registry-design.md (approved by user: proceed).

## Global constraints

- Keep the historical baseline branch untouched and preserve attribution.
- Limit GLB uploads to 50 MiB and accept self-contained glTF 2 only.
- Store local asset state under BOT_CROSSING_DATA/assets, separately from colony.json.
- Preserve original model bytes and apply placement transforms through wrappers.
- No new graph semantics, harness features, Meshy credentials or paid generation.

## Task 1: Import validation and durable API

Files: server/assets/{glb,store,api}.mjs, tests/assets.test.mjs, server/api.mjs.

- [x] Test invalid headers, chunk lengths, external dependencies, required extensions, duplicate bytes, pending/finalized imports, persistence, metadata writes, placements, delete-in-use and traversal.
- [x] Run node --test tests/assets.test.mjs before implementation, then after.
- [x] Implement createAssetStore({directory, catalog}) with list(), upload(bytes,name), finalize(id,metadata), update(id,metadata), remove(id,cascade), binary(id), putPlacement(data), removePlacement(id).
- [x] Add createAssetMiddleware(store): GET /api/assets returns {assets,placements}; POST /api/assets/import accepts raw GLB + X-Asset-Name, returns {asset,duplicate}; POST /api/assets/:id/finalize accepts metadata; PATCH /api/assets/:id edits metadata; DELETE /api/assets/:id?cascade=1 removes; GET /api/assets/:id/file serves bytes; PUT /api/assets/placements/:id and DELETE same path save/remove placement. Enforce same-origin requests and bounded bodies.
- [x] Ready asset fields: id,name,category,origin,url,selector,hash,bytes,source,creator,license,animations,stats,bounds,status. Placement: id,assetId,position:[x,y,z],yaw (radians),scale (>0),animation (clip name or empty).

## Task 2: Catalog and loaders

Files: src/assets/{bundles,loader,world}.js, tools/build-catalog.mjs, public/assets/catalog.json, tools/copy-decoders.mjs.

- [x] Generate entries by top-level scene nodes; crew is one complete rig. Use IDs bundled:base:<node>, bundled:forest:<node>, bundled:crew.
- [x] Share bundle URLs with kit.js and crew.js. Copy Draco/Basis decoder files locally; import Meshopt decoder from Three.js addons.
- [x] Load a single model selector or whole scene, retain materials/skeletons, measure bounds/mesh/material/triangle counts, provide animation clips and a wrapper grounded and centered at origin.
- [x] Add reusable disposal and load an independent scene per instance, preserving skeletons and disposing resources without damaging other instances.
- [x] Maintain world placements and mixers, ghost placement, picking and selected bounds. Persist through API before reporting success, restore prior state on failed save.

## Task 3: Asset panel and integration

Files: src/assets/{panel,preview}.js, src/assets/assets.css, src/main.js.

- [x] Add Assets action within existing toolbar; use native dialog for focus containment and keyboard isolation.
- [x] Search/filter registry, select one model, orbit preview, display credits/source dimensions/counts and animation control.
- [x] Import via file picker/drop, show loading and actionable errors, preview pending file before Save import, clean pending upload on cancel/failure.
- [x] Edit name/category/source/creator/license and retain unknown source fields as unknown.
- [x] List placements for keyboard selection. Place/move using ground ghost plus click/Escape, numeric transform fields as keyboard alternative, swap selected instance while preserving transform, remove and explicit cascade confirmation.
- [x] Keep camera/world shortcuts inert while dialog is open and avoid pointer selection through dialog. Provide narrow-screen layout.

## Task 4: Verification and documentation

Files: tests fixtures and browser checks, README.md, docs/meshy-workflow.md, AGENTS.md (test command only).

- [x] Test static, textured and skinned GLB import/reload, malformed file feedback, dedup, metadata edits, filtering, animation, placement/swap/removal and restart.
- [x] Exercise Draco, Meshopt and KTX2 fixtures against actual browser loaders.
- [x] Inspect desktop/mobile panel screenshots and verify existing world/camera/crew startup.
- [x] Document UI usage, storage, import limits and Meshy generate/remesh/retexture/download/import handoff; distinguish inspected support from live-tested generation.
- [x] Run npm test, npm run build, git diff --check and review complete diff for correctness and data leakage.

## Decisions

- Work on codex/asset-registry in the current checkout so the user can immediately review the running app; preserve main and the historical baseline.
- Generation stays external to the app; the approved Meshy exploration deliverable is source-verified workflow documentation.

## Completion evidence

Implemented and verified on 2026-09-14. All 27 tests pass; production build and
`git diff --check` pass. Browser checks include compressed textures/geometry,
animation, restart persistence, removal, duplicate drop import, and failed-save
rollback retaining the exact prior object. See `docs/asset-registry-verification.md`.

Implementation refinement: each instance gets a fresh GLTF parse instead of shared
source cloning. This gives independent skeletons and straightforward resource
ownership. Staged replacements keep the original scene alive until persistence
succeeds. Pending imports have distinct IDs and finalization performs atomic
deduplication; cross-process storage writes use a recoverable lock.
