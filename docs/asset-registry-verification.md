# Asset registry verification

Date: 2026-09-14. Feature branch: `codex/asset-registry`.

The checks below use synthetic sessions and disposable storage through
`tests/serve-browser-fixtures.mjs`. No real agent session records are test fixtures.

## Browser checks observed

- Catalog: 74 entries; a single base module appears in the preview rather than
  all models from its shared GLB. Creator, CC0 licence, size and mesh counts shown.
- Imported a synthetic textured cube through the actual file chooser, inspected
  its embedded texture, edited its name/creator/licence and saved it. API and disk
  both contained the ready asset with measured bounds and statistics.
- Added cube at [8, 0, 5], yaw 45 degrees, scale 2; swapped it for a bundled tree.
  API confirmed the same instance ID, position, yaw and scale after the swap.
- Imported Meshopt, KTX2/Basis and Draco fixtures through the file chooser. All
  produced successful previews and saved ready assets. The Draco fixture retained
  71 meshes, 15 materials and an animation clip with visible textured geometry.
- Imported a copy of the bundled skinned crew; all 15 clips appeared. Selected
  Walking_A and placed the character by pointing/clicking on the ground. Its
  skeleton rendered in the world, and its AnimationMixer time advanced.
- Picked the placed character directly in the world; the asset editor opened with
  the existing placement. Changed rotation and saved with fractional X/Y/Z.
- Preview ArrowRight changed the preview camera position, while the world camera
  stayed disabled and its dragging flag was false during the modal.
- Search "tree" returned six bundled trees; selecting Imported with that search
  produced the explicit empty-state message.
- A malformed GLB produced "Invalid or truncated GLB header"; no asset was added.
- Closing a successfully previewed but unsaved import removed its pending record
  from the disposable registry, closed the dialog and restored camera input.
- Delete for the placed character offered explicit asset-plus-instance deletion
  and Keep asset choices. Keep asset retained both records.
- At 390 CSS pixels wide, the dialog measured 378 pixels and document scrollWidth
  stayed 390. The layout stacked library, preview and inspector, with scrollable
  content. Browser emulation was cleared after inspection.

## Fixture provenance

Temporary files were created under `/tmp/bot-crossing-asset-fixtures/`; they are
not bundled product assets or committed test data.

- Static PNG cube: synthetic geometry and a generated 2x2 texture.
- Meshopt cube: synthetic geometry compressed with MeshoptEncoder; decoding was
  also compared with the original bytes before browser import.
- KTX2 cube: synthetic geometry with an embedded
  [Three.js ETC1S fixture](https://github.com/mrdoob/three.js/blob/dev/examples/textures/ktx2/2d_etc1s.ktx2).
- Draco: [Three.js LittlestTokyo example](https://github.com/mrdoob/three.js/blob/dev/examples/models/gltf/LittlestTokyo.glb).
- Skinned model: unchanged local copy of `public/assets/crew.glb`, Kay Lousberg,
  CC0 1.0.

## Review regressions

All 27 tests pass, including camera cancellation, independent pending uploads,
atomic ready-asset deduplication, interleaved storage operations, three concurrent
server processes, crashed lock-owner recovery, staged replacement rollback and
resource disposal. Focused final review found no blocking issues.

Further browser verification:

- Restarted the actual QA server and reloaded the page: five saved imports and
  both placements restored with the saved transforms and character animation.
- Corrupt embedded PNG and KTX2 files were rejected with actionable errors;
  neither showed Save import or left pending records.
- Intercepted a placement PUT and failed its network request: the UI reported
  the error, while the exact same prior scene object UUID and [8, 0, 5] position
  remained. Persistence also retained the old transform.
- Move in world followed by Escape cleared the ghost and preserved the instance.
- Remove instance removed the tree. Confirmed asset-plus-instance deletion removed
  the imported character and its world object. API and renderer both had zero
  placements afterwards, with the other four imports retained.
- A synthetic browser drop of an already saved GLB opened the existing asset and
  reported the duplicate explicitly, without adding a new record.

`npm run build` passes. Vite reports the large core bundle and mixed static/dynamic
loader import warnings; neither prevents the build. Production server HTTP checks
returned 74 catalog entries, GLB bytes with model/gltf-binary, and the local Basis
WASM decoder with application/wasm. `git diff --check` passes. No temporary model
fixtures, local asset data, or agent session data are included in the changes.

Meshy capabilities were inspected in upstream sources. No Meshy authentication,
paid generation, or live generation-to-import round trip is claimed.
