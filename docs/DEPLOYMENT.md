# Production deployment

## Static frontend

Set `VITE_SERVER_URL=wss://game.example.com` during `npm run build`. Publish `dist/` to a static HTTPS host, serving `index.html` as the root document. Assets are local; no external fonts or art CDNs are used. Do not put private credentials in Vite variables. Frontend and server are independent deployments.

## Game service

Build with `npm ci && npm run build`, then run `npm start` with Node 24. For a minimal runtime copy `dist-server/`, `package.json` and `package-lock.json`, install with `npm ci --omit=dev`, and start the compiled Node server. A multi-stage Dockerfile performs this split; container deployment itself is unverified in this workspace. Set `PORT`, `ALLOWED_ORIGINS=https://play.example.com` and `SAVE_DIR=/var/lib/afterlight` (writable persistent volume). Terminate HTTPS at your reverse proxy and forward HTTP plus WebSocket upgrade requests to the Node service. `/` returns service health. `/ice?token=<authenticated reconnect credential>` supplies short-lived ICE credentials to connected players. Avoid logging query strings on this endpoint.

Single process/replica owns active rooms in memory. Do not run multiple independent replicas behind round-robin load balancing. Restart loses uncheckpointed rooms; disk saves survive. Mount persistent disk, back it up securely, and keep it private because checkpoints include session credentials. Without persistent disk, current deployment cannot guarantee saves after restarts; use a persistent volume rather than claiming durability. Validated user-facing checkpoint export/import is unfinished.

Example reverse proxy (replace domains and certificates):

```nginx
location / {
  proxy_pass http://127.0.0.1:3001;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_read_timeout 120s;
}
```

## TURN and voice

For cross-network voice deploy a standards-compliant TURN server such as coturn with TLS and its REST shared-secret credential mechanism. Set only server environment variables:

```
STUN_URL=stun:turn.example.com:3478
TURN_URL=turn:turn.example.com:3478,turns:turn.example.com:5349
TURN_SECRET=<secure value from deployment secrets>
```

Never commit TURN_SECRET or bake long-lived TURN credentials into the browser bundle. The game issues one-hour HMAC-SHA1 TURN credentials after authenticating a connected player. Match the coturn shared secret and REST configuration. Open TURN's UDP/TCP relay ports, configure its public IP and restrict abuse. Microphone APIs require HTTPS outside localhost. TURN UDP/TCP connectivity must be tested from two actual networks; WebSocket gameplay alone does not prove voice works.

No hosting access was supplied, so there is no verified live deployment URL. Review `docs/QA.md` before public exposure; this implementation has no production-scale load or penetration testing.
