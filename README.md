# DEAD SIGNAL: AFTERLIGHT

A browser-based two-operator cooperative horror game. TypeScript, Three.js/WebGL2, Vite, Node.js and authoritative WebSockets. Original procedural models, textures and synthesized sound; no asset downloads during play.

## Run locally

Node 24 (Node 22.12+ also supported by Vite).

```sh
npm ci --cache /tmp/afterlight-npm
npm run dev
```

Vite serves the frontend on port 5173. The authoritative server listens on 3001. Open the client in two independent desktop browser windows, create a room in one, join its code in the other, customize both characters, ready both and start. No paid service, account or microphone is required. A localhost address is only accessible on the same machine; use a reachable hostname/HTTPS deployment for two remote devices.

```sh
npm run build
npm test
CHROMIUM_PATH=/usr/bin/chromium npm run test:browser
npm start
```

Browser tests use installed Chromium by default. The Python 3 test harness starts an isolated, loopback-only coturn TCP relay when a local coturn binary is available. In this cloud environment it is retained under `/workspace/.afterlight-tools/turn/root`. On Debian 13 you can prepare it without system installation with `AFTERLIGHT_TOOLS_DIR=/workspace/.afterlight-tools bash scripts/install-test-turn.sh`. Ordinary browsers can use direct host candidates; restrictive managed browsers need the relay. On another machine install Playwright Chromium and adapt `playwright.config.ts` to your executable. Browser QA runs separately on ports 5174/3002, so it does not reuse a running development room. Test checkpoints live in `/tmp/afterlight-browser-saves`, separate from actual campaigns.

## Controls

WASD movement; mouse look after clicking the canvas; Shift sprint (stamina); Ctrl crouch; Space jump; E interact; click fire; R reload; 1/2/3/4 quick slots (defaults: pistol, shotgun, melee, medkit), assignable in inventory; V revive a nearby downed partner; F flashlight; I inventory; J journal and discovered-area map; Enter text/voice radio; T push to talk; Escape settings. Movement/action keys can be remapped. Menus release pointer lock. Click the scene to regain it. The world does not pause in menus.

Each system has a cyan reference station and a crimson operator terminal. Either player can take either role. Read the reference with E, communicate its clue, and remain nearby while the partner operates the terminal. On the last system, keep the left control attended while your partner crosses to the far latch. Collect evidence in side rooms. Power routing needs the shared fuse behind the power room; archive access needs the shared keycard. Rescue the survivor in the courtyard side room with a medical kit to recover their testimony. Powered side lifts provide return shortcuts. See [solutions](docs/SOLUTIONS.md).

## Recovery

J → Save checkpoint waits for a successful atomic server write. The resume code and separate secret are retained locally and shown in Journal; share the credential privately with your partner. Both return using the same resume code and secret; the first available saved seat is assigned. Server disk contains the complete versioned mission, inventories, puzzles, evidence, conditions and choices. Set `SAVE_DIR` to a persistent volume in production. The room code alone cannot restore a saved campaign. Resave after important progress. A team wipe revives both at the arrival area with current mission progress retained; this is a recovery point, not a full rollback to the disk checkpoint.

Disconnected players have a 120-second reconnect window. The remaining operator becomes lobby leader. Reference roles require a connected operator; disconnecting releases access and cannot solve a puzzle. Essential fuse/keycard access is shared. After both reconnect windows expire the active room is cleaned up; the disk checkpoint remains resumable.

## Deployment

See [deployment](docs/DEPLOYMENT.md), [architecture](docs/ARCHITECTURE.md), [validation and remaining work](docs/PROGRESS.md), and [manual network checklist](docs/QA.md).

This repository is an integrated playable implementation, **not yet the full accepted release described in the request**. In particular the target duration, uninterrupted full-route browser coverage, cross-network voice reliability, content density, and final art/audio polish require further work. See the explicit progress checkpoint rather than assuming every requested feature is complete.
