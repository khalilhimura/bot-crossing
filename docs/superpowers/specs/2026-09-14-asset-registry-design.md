# Asset registry, GLB import, and Meshy workflow

Status: approved by user ("proceed"); implemented and verified on 2026-09-14.

## Outcome

Open an Assets panel, browse bundled models, import a local GLB, inspect it in
3D, and place an instance in the world. Reopen the app and retain imported assets
and placements. Change the model assigned to a placed instance while retaining
its transform. This is asset tooling for the renderer, not a context-graph data
model or an expansion of harness monitoring.

## Current evidence

The checkout is on main at e321047. Three.js loads three committed GLB bundles.
The inspected binaries contain 57 top-level space-base models, 16 forest models,
and a character rig with 15 animation clips. Existing static kit recipes depend
on node names and shared atlases; the crew uses custom bone-texture animation.
Arbitrary imported models cannot safely replace these recipes by filename alone.
Vite and the production Node server share server/api.mjs. There is no asset CRUD
API, registry UI, or configured test command today.

## Storage decision

Recommended: local disk storage using the existing Node server. Browser IndexedDB
would tie assets to one browser origin, including the dev server port. Cloud
storage adds an account and backend dependency without an established need.

Keep a generated, committed catalog for bundled assets. Store user imports,
metadata, and placements beneath a dedicated ignored data/assets/ directory,
respecting BOT_CROSSING_DATA. Never change colony.json to hold asset data. Ignore
meshy_output/ too if generated output is saved in this checkout.

## Registry contract

Each asset records a stable ID, display name, category, origin (bundled or imported),
content hash, file size, source/creator/licence fields, model selector, measured
bounds, mesh/material counts, and animation names. Imported source metadata is
optional and user-editable; unknown licences remain unknown. GLB extension alone
does not imply a licence. Bundled KayKit attribution stays visible.

Bundled entries select an individual top-level model from a shared file; crew is
a complete rig. A generated catalog prevents manual model lists drifting from
the files. Existing kit/crew loading resolves bundle URLs from the same registry
definitions while retaining its existing rendering behavior.

Store original GLB bytes unchanged. Apply centering, grounding, rotation and scale
on an instance wrapper so editing placement does not damage animation tracks or
rewrite the source asset. Keep source dimensions visible alongside the chosen
world size. Placements record instance ID, asset ID, position, yaw, scale, and
optional animation selection separately from asset metadata.

## Import and API

Accept local .glb files through file selection and drag/drop. Start with a 50 MiB
upload limit, displayed before selection. Check GLB magic, version 2, declared
length, chunk boundaries, JSON validity, a usable scene, and resource references
on the server. Reject external resource URLs and relative dependencies with an
instruction to export a self-contained GLB. Configure Draco, Meshopt and KTX2
support with locally served decoders for common compressed assets; reject other
unsupported required extensions with their names.

Render-parse the upload before completing import. A pending upload must not be
shown as ready until preview succeeds. Invalid geometry or decoder failures leave
an actionable error and clean up pending data. Server validation remains necessary
even when the browser has validated the file.

Use generated IDs and hashes for disk paths, never supplied filenames. Detect
identical bytes rather than creating duplicate entries. Serialize metadata writes
and use atomic replacement; interrupted imports must not corrupt the catalog.
Expose list, upload, finalize, metadata-edit, delete, binary retrieval and
placement operations through the shared local API. Enforce same-origin writes,
bounded request bodies and path confinement. Return explicit errors for malformed
input, missing assets, unsupported models and storage failures.

## User workflow

An Assets toolbar action opens a panel matching the existing HUD. Search/filter
the bundled and imported catalog. Selecting an entry opens an orbitable preview,
source credits, dimensions, complexity counts, and animation playback controls.
Support loading, empty, error and storage-failure states; filenames render as text.

Import -> preview -> edit name/category/source -> save -> Place in world. Placement
uses a ground-position preview, click to confirm, and Escape to cancel. Selecting
a placed instance exposes move, yaw, scale, animation, swap model, and remove.
Swap affects that instance and preserves its placement. Deleting an asset used
by placements requires an explicit choice to remove those placements too.

Imported instances retain their own materials and skeletons. Load independent scenes and skeletons for animated instances. Dispose preview and removed-instance GPU resources
without disposing resources still shared by other instances. Modal interactions
must not trigger world shortcuts or selection behind the panel. Include keyboard
access, focus return, and a usable narrow-screen layout.

## Meshy findings and proposed handoff

Inspected the upstream README, download schema and output manager at commit
56326ba165232de2ec136ab995be29e51b1ea343 on 2026-09-14:

- [README](https://github.com/meshy-dev/meshy-mcp-server/blob/56326ba165232de2ec136ab995be29e51b1ea343/README.md)
- [Download schema](https://github.com/meshy-dev/meshy-mcp-server/blob/56326ba165232de2ec136ab995be29e51b1ea343/src/schemas/tasks.ts)
- [Output manager](https://github.com/meshy-dev/meshy-mcp-server/blob/56326ba165232de2ec136ab995be29e51b1ea343/src/services/output-manager.ts)

The server exposes text/image generation, remesh, retexture, rigging, animation,
task status, balance and download operations. Download defaults to GLB and accepts
an absolute save path. Its output manager maintains project folders and task
history. No Meshy tools are callable in this session; no generation was run.

Recommended workflow: generate a low-poly prop, inspect the completed task,
optionally remesh/retexture, download GLB, then use this app's normal import path.
Record Meshy as source and optionally a task ID/source link in registry metadata.
The same workflow supports an animated GLB, but a generated rig is not assumed to
match the current astronaut skeleton. Preview and place it independently.

Exploring Meshy does not require a generation panel inside Bot Crossing. Keep API
credentials in the external MCP/server environment. The README requires a Meshy
API key and describes credit-consuming operations; installing a connection and
running a paid generation are separate from the inspected integration design.
Do not assign the MCP server's MIT licence to generated model outputs.

## Completion evidence required

1. Catalog counts/selectors agree with actual bundled GLBs; previews show models
   individually rather than overlapping the whole pack.
2. UI imports static and skinned GLBs with embedded textures, then reloads them
   after server restart. Compressed fixtures exercise each configured decoder.
3. Invalid/truncated files, external dependencies, oversized requests, unsafe
   names, duplicate files, and concurrent metadata writes have focused tests.
4. Browser checks cover preview orbit, animation, import errors, search, credits,
   placement, transform editing, swapping, removal, refresh and narrow screens.
5. Existing colony startup, kit appearance, camera controls and crew still work.
   No additional harness features or context-graph semantics are introduced.
6. npm run build and git diff --check pass. Tests use temporary data directories
   and synthetic fixtures, never real agent session data.
7. README describes actual functionality and the Meshy handoff, distinguishing
   documented capabilities from live-tested generation. Local files and secrets
   remain untracked; baseline branch remains untouched.
