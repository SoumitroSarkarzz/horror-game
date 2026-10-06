# Manual acceptance checklist

## Two actual networks

- Deploy HTTPS frontend and WSS server; open two desktop devices on different internet connections.
- Create/join with mixed-case room code; verify capacity and ready gating.
- Customize colors/presets and verify remote appearance; walk, crouch, fire and revive while watching both clients.
- Complete every system on each map with roles swapped. Walk all side paths and lifts; try locked routes and boundary clipping.
- Race an item pickup, transfer supplies with full/empty inventories, disconnect while holding a control and carrying supplies, reconnect without duplication.
- Recover from a team wipe. Save, stop the server, restart with the persistent volume, and resume both seats with the secret. Reject room-code-only resume.
- Reach each documented ending and verify identical summaries. Confirm nobody can sacrifice the other operator.
- Allow microphones and verify two-way push-to-talk and open-mic audio; test self/peer mute, device choice, volume and leave/reconnect cleanup.
- Force relay-only ICE in a test deployment and verify TURN UDP and TCP/TLS relay between the two networks. Inspect connection stats for relay candidates; do not treat two local tabs as cross-network proof.
- Deny microphone permission; finish via text and written clues. Test XSS-like chat text, chat limits, focus and control remapping.
- Test tab suspension, network loss, resize and WebGL context loss. Test unsupported WebGL2 messaging.
- Measure 1080p medium and low settings on a named physical laptop, including Apple Silicon Safari/Chrome. Record frame-time percentiles, memory, draw calls and bandwidth over a complete route.

## Automated coverage limits

Playwright uses Chromium with software rendering in this cloud machine. State fixtures intentionally place players near puzzle controls to isolate UI behavior. This verifies puzzle/transfer/revive/extraction interfaces. A separate real-server socket route traverses both maps without stage or position fixtures, collects quest items/evidence, solves from delivered clues and fights the Pursuer; every ending is then validated from its earned checkpoint. Browser combat independently validates actual weapon damage and enemy-induced downing. These tests still do not establish human exploration balance or playthrough duration. Real microphone hardware, two-network TURN performance, MacBook frame rate and production hosting are not validated by these tests.
