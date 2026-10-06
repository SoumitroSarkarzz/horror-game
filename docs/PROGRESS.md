# Implementation checkpoint — 2026-10-06

The uploaded specification is the intended release scope. This repository is an integrated implementation in progress, not a declaration that all acceptance criteria are satisfied.

## Integrated

- TypeScript / Vite / Three.js client and 20Hz authoritative Node/ws server, dependency lockfile.
- Create/join, two-seat capacity, ready/map leader controls, synchronized presets/colors, invite link, secure reconnect and expiry, leadership transfer and abandoned room cleanup.
- Two selectable map presentations, bounded collision layouts, side exploration corridors, evidence/supplies, powered return lifts, progress barriers and five paired systems.
- Glyph decoding, circuit routing, coarse/fine frequency tuning, timestamp archive sequencing and attended-control traversal; deterministic server seed, reference roles interchangeable, visual clues and inactivity hint.
- Eight-slot supply inventory and four configurable quick slots, atomic pickup, dropping/giving/using supplies, shared quest access, pistol/shotgun/melee, ammo/reload, enemy states, damage/downing/revive and team-wipe recovery.
- Four ending conditions, procedural 3D ending compositions and coordinated extraction, including voluntary self-sacrifice.
- Text radio with speaking indicators, safe rendering and chat spacing; actual WebRTC signaling, user-requested mic access, push-to-talk/open mic, device choice, peer mute/volume, temporary authenticated server-issued TURN credentials.
- Versioned JSON checkpoints written atomically, code + separate secret resume, local cosmetic/settings persistence, journal/discovered-area map, configurable controls/render scale/text size and master/music/effects/voice levels.
- Original procedural art/textures/sound source, MIT license and local/production/persistence/TURN instructions.

## Validation status

Automated validation and its boundaries are recorded below. Shared/server tests use real WebSockets. Browser tests use two independent Chromium contexts and software rendering. Browser puzzle fixtures isolate controls; a separate socket integration test validates natural navigation, collection, combat and progression on both maps. No deployment, physical microphone, remote-network TURN test or physical-laptop performance benchmark has been performed. Low-preset SwiftShader measurements are recorded separately; they are not hardware benchmarks.

## Remaining release work (do not hide or label as complete)

1. Expand and playtest each map into the requested 20–35-minute authored adventure. Current compact routes are shorter; map topology shares a longitudinal progression structure despite different walls, side props and atmosphere. Add deeper multi-step puzzles and map-specific environmental storytelling, more elaborate survivor decisions, containment side tasks and richer ending sequences. A simple medkit rescue already recovers testimony.
2. Run uninterrupted full-route browser tests and manual playthroughs on both maps, including team wipes. Continuous authoritative socket routes now walk both maps, collect supplies and evidence, solve from clues, defeat the Pursuer and validate all four endings from earned checkpoints. Browser puzzle fixtures and the separate genuine combat test do not establish full human playthrough pacing.
3. Finish first-person/remote animation polish and richer weapon/enemy audio/telegraphs; enemy navigation and coarse reconciliation need high-latency refinement and gameplay balancing.
4. Finish normal inventory stacking, richer equipment presentation and fully authored door/lift transitions. Four configurable quick slots and written item descriptions are integrated.
5. Optionally add user-facing validated checkpoint export/import. The supported durable deployment currently uses the documented persistent SAVE_DIR volume.
6. Verify real two-way mic audio and TURN relay on two actual networks, plus reconnect recovery and expiring credential refresh. Local synthetic audio over a loopback TCP TURN relay, denied permission and track teardown were validated; auto-reacquisition and speaking flags are implemented but cross-network behavior still needs testing.
7. Expand subtitles beyond the current written clues/journal and synthesized nonverbal audio. Local license credits are integrated. Continue quality-preset refinements, accessible navigation and map-specific loading/ending presentations.
8. Extend current material batching with further prop instancing, measure bandwidth/latency and resource disposal over long sessions, test Safari/Apple Silicon and context-loss recovery. Do not claim 60 FPS on hardware from software-rendered cloud tests.
9. Harden checkpoint schema/migration; serialized atomic checkpoint writes and save throttling are integrated. Add load testing and production monitoring before public deployment.

## Continue without losing context

Use the existing checkout at `/workspace/horror-game`; do not create a worktree unless requested. `npm ci --cache /tmp/afterlight-npm`, `npm run dev`, `npm test`, `npm run test:browser`, `npm run build`. Browser test configuration uses `/usr/bin/chromium` or CHROMIUM_PATH. Keep real campaign saves out of tests. Review tests and docs before changing rules: both peers must agree to extraction; only the affected operator can confirm sacrifice; game state is server authoritative and never uses microphone audio for AI.

## Actual test results — 2026-10-06

- Production frontend build, TypeScript check and compiled Node service build: passed.
- `npm test`: 12 passed, zero failed/skipped. Continuous socket route took 248 seconds for both maps; four ending branches on each map fork the genuinely earned final checkpoint rather than replaying the whole route four times.
- Two compiled-service integration tests passed after correcting the test movement helper to follow acknowledged snapshots instead of assuming time-based arrival.
- Full Chromium suite: 4 passed, zero failed/skipped, 2.5 minutes. Covers two independent clients, appearance/movement, both map renderings, all puzzle interfaces, transfer, page refresh/reconnect without duplicate inventory, extraction, actual firing/damage/ammo, enemy-induced downing/revival, synthetic audio RTP over local TCP TURN, denied permission and microphone track disposal.
- Development startup: verified HTTP `healthy:true` service identity and the frontend document title. These checks validate the current cloud instance. Saved setup/start instructions are a configuration draft, not a published environment or proof of fresh-task restoration.
- See [measured cloud performance](PERFORMANCE.md). No physical-laptop 60 FPS claim, real microphone test, cross-network voice claim, Docker runtime validation or public deployment.

The latest small follow-up adds a persistent unsupported-WebGL message and blocks extraction while the partner is down. Final build passed, all 11 targeted compiled-service/shared/storage checks passed, and the browser puzzle/refresh/extraction scenario passed again (1.1 minutes).
