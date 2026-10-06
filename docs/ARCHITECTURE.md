# Architecture

- `shared/world.ts`: serialized version-1 state, deterministic puzzle generation, maps/collision geometry, item ownership, ending predicates and secret-filtered snapshots.
- `server/index.ts`: Node HTTP/WS service, explicit Zod message envelope, 20 Hz authoritative simulation, movement/range validation, firing/ammo/damage, AI, cooperative controls, rooms/tokens and atomic JSON checkpoints. `/ice` authenticates players and generates temporary TURN credentials.
- `client/main.ts`: menus, network session, local movement prediction and coarse reconciliation, remote interpolation, renderer/HUD, inventory/journal/settings, pointer lock, radio text and WebRTC signaling/lifecycle.
- `client/art.ts`: original procedural tile surfaces, clinical furniture, trees, railway, water and transmitter; generated only for the selected map. Immutable scenery is merged by material to reduce draw calls.
- `tests`: shared-rule and real-server tests; Playwright uses two independent browser contexts.

Render frames run independently of the 20 Hz server. Clients send bounded absolute movement proposals and the server validates speed, map walls and mission gates. Predictions reconcile when disagreement exceeds two units; this coarse approach still needs refinement under high latency. Item pickup removes the world item atomically before a second request can act. No WebRTC gameplay authority exists.

Snapshots omit reconnect tokens and puzzle solutions. Resume uses a separate 256-bit credential. Origin allowlists, 16KB message bounds, per-connection message limits, creation budgets and chat spacing provide basic abuse protection. This is not a replacement for production traffic controls and load testing.

WebRTC audio tracks are muted until push-to-talk or explicit open-mic selection. Microphone permission is requested only on a user action. Audio is not persisted or fed to enemy AI. A local level meter sends only a speaking flag for the radio HUD. Listener reacts to server-known movement and weapon noise only.

Original models and graphics are generated from primitive geometry with designed silhouettes, palette, textures and props. Their source and resulting artwork use the repository MIT license. System Arial is supplied by the user's device; no font is bundled. Three.js, ws, Zod, Vite, TypeScript and test dependencies retain their upstream licenses in their packages.
