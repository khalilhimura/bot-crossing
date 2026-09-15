# Project direction

This repository is Khalil's fork of Bot Crossing by Jarren Rocks. GitHub's parent
repository is `Station-Sciences/bot-crossing` (historically
`jarrenrocks/bot-crossing`). Preserve the MIT licence, original author attribution,
and third-party asset credits.

## Current implementation and intended product

- The current application is a Three.js/Vite/Node.js colony visualization of agent
  sessions, with Claude Code, DeepSeek Harness, and Codex adapters.
- Future development should repurpose the 3D visualization for a context graph.
  Multi-harness session monitoring is legacy behavior, not the product roadmap.
- The context graph is planned, not implemented. Its entity and relationship model,
  data sources, storage, and visual mapping remain undecided. Do not describe them
  as existing capabilities or assume a backend has been chosen.
- Reuse the renderer, camera, spatial layout, and interaction code where useful.
  Decide which colony metaphors fit the graph before extending them.
- Do not add harness integrations or expand session-monitor features unless the
  user explicitly requests that work. Do not remove existing behavior as a side
  effect of a documentation-only task.

## Preserved baseline

`codex/agent-monitor-baseline` at `1a35b84` preserves this fork's session-monitor
build, including its existing Codex adapter, before the documentation pivot.
Keep that branch as the historical snapshot; do context-graph work on `main` or
feature branches based on it. The README records how to run the baseline.

The baseline is not pristine upstream and does not include ignored local state or
agent session data. Its build passed on 2026-09-14, but live harness behavior was
not retested. Codex activity is inferred; opening launches the app, and new-session
creation and archiving are unsupported.

Both `origin` and `upstream` currently point to `khalilhimura/bot-crossing`.
Verify remote URLs before any fetch/push assumptions; the remote name `upstream`
does not identify the original author's repository in this checkout.

## Working practices

- Keep implemented, verified, and planned behavior distinct in documentation.
- Treat the inherited README sections and `.claude/skills/agent-session-world/`
  material as historical implementation references. This file records the fork's
  current direction; old multi-harness expansion suggestions are not new requirements.
- Start graph implementation by defining the minimum graph model and a concrete
  exploration workflow with the user; do not invent a full product specification.
- Use `npm run dev` for local development and `npm run build` for build validation.
  Run `npm test` for the asset registry, catalog, placement, and camera tests.
- Never commit local agent session data or ignored `data/colony.json` state.
