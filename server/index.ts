import { CheckpointStore } from "./storage.js";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { randomBytes, randomInt, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z as schema } from "zod";
import {
  createWorld,
  publicWorld,
  validPosition,
  lineOfSight,
  pickup,
  ending,
  stations,
  type World,
  type Player,
} from "../shared/world.js";
const Message = schema.object({
  type: schema.enum([
    "create",
    "join",
    "reconnect",
    "ready",
    "map",
    "start",
    "move",
    "interact",
    "pickup",
    "equip",
    "use",
    "drop",
    "give",
    "fire",
    "reload",
    "chat",
    "signal",
    "save",
    "resume",
    "leave",
    "cosmetic",
    "ping",
    "probe",
    "speaking",
  ]),
  code: schema.string().max(12).optional(),
  token: schema.string().max(128).optional(),
  name: schema.string().max(24).optional(),
  text: schema.string().max(300).optional(),
  x: schema.number().finite().optional(),
  z: schema.number().finite().optional(),
  yaw: schema.number().finite().optional(),
  value: schema
    .union([
      schema.string().max(100),
      schema.number().finite(),
      schema.boolean(),
    ])
    .optional(),
  id: schema.string().max(50).optional(),
  data: schema.unknown().optional(),
});
const creationRates = new Map<string, { count: number; at: number }>();
const rooms = new Map<string, World>(),
  sockets = new Map<
    WebSocket,
    {
      room: World;
      player: Player;
      seq: number;
      lastMove: number;
      lastChat: number;
      lastSave: number;
    }
  >(),
  expiry = new Map<string, number>(),
  rate = new Map<WebSocket, { n: number; t: number }>();
const grace = Math.max(50, Number(process.env.RECONNECT_GRACE_MS || 120000));
const dir = process.env.SAVE_DIR || "data";
const checkpoints = new CheckpointStore(dir);
const server = createServer((req, res) => {
  const origin = req.headers.origin || "";
  const origins = process.env.ALLOWED_ORIGINS?.split(",");
  if (!origins || origins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url?.startsWith("/ice")) {
    const u = new URL(req.url, "http://localhost");
    const credential = u.searchParams.get("token");
    const authorized = [...rooms.values()].some((w) =>
      w.players.some((p) => p.connected && p.token === credential),
    );
    if (!authorized) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: "Authentication required" }));
      return;
    }
    const iceServers: any[] = process.env.STUN_URL
      ? [{ urls: process.env.STUN_URL }]
      : [];
    if (process.env.TURN_URL && process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}:operator`;
      iceServers.push({
        urls: process.env.TURN_URL.split(","),
        username,
        credential: createHmac("sha1", process.env.TURN_SECRET)
          .update(username)
          .digest("base64"),
      });
    }
    res.end(JSON.stringify({ iceServers }));
    return;
  }
  res.end(
    JSON.stringify({
      service: "DEAD SIGNAL",
      rooms: rooms.size,
      healthy: true,
    }),
  );
});
const wss = new WebSocketServer({ server, maxPayload: 16384 });
const send = (s: WebSocket, v: unknown) => {
  if (s.bufferedAmount > 1048576) {
    s.close(1008, "Client too slow");
    return;
  }
  if (s.readyState === 1) s.send(JSON.stringify(v));
};
const broadcast = (w: World, v: unknown) => {
  for (const [s, c] of sockets) if (c.room === w) send(s, v);
};
const token = () => randomBytes(32).toString("hex");
function attach(s: WebSocket, w: World, p: Player) {
  sockets.set(s, {
    room: w,
    player: p,
    seq: 0,
    lastMove: Date.now(),
    lastChat: 0,
    lastSave: 0,
  });
  for (const [old, c] of sockets)
    if (old !== s && c.room === w && c.player.id === p.id) {
      sockets.delete(old);
      old.close(1000, "Session replaced");
    }
  p.connected = true;
  expiry.delete(p.id);
  send(s, { type: "joined", id: p.id, token: p.token, code: w.code });
  broadcast(w, { type: "state", world: publicWorld(w) });
}
function error(s: WebSocket, text: string) {
  send(s, { type: "error", text });
}
wss.on("connection", (s, req) => {
  const allowed = process.env.ALLOWED_ORIGINS?.split(",");
  if (allowed && !allowed.includes(req.headers.origin || "")) {
    s.close(1008, "Origin denied");
    return;
  }
  s.on("message", async (raw) => {
    try {
      let r = rate.get(s);
      if (!r || Date.now() - r.t > 1000) {
        r = { n: 0, t: Date.now() };
        rate.set(s, r);
      }
      if (++r.n > 80) {
        s.close(1008, "Rate limit");
        return;
      }
      const parsed = Message.safeParse(JSON.parse(raw.toString()));
      if (!parsed.success) return error(s, "Invalid message");
      const m = parsed.data;
      let c = sockets.get(s);
      if (m.type === "create") {
        if (c) return;
        const ip = req.socket.remoteAddress || "unknown";
        let budget = creationRates.get(ip);
        if (!budget || Date.now() - budget.at > 3600000) {
          budget = { count: 0, at: Date.now() };
          creationRates.set(ip, budget);
        }
        if (++budget.count > 20)
          return error(s, "Room creation limit reached; try later");
        const code = randomBytes(4).toString("hex").toUpperCase();
        const w = createWorld(code, randomInt(1, 2147483647));
        rooms.set(code, w);
        const p = makePlayer(m.name);
        w.players.push(p);
        w.leader = p.id;
        attach(s, w, p);
        return;
      }
      if (m.type === "join") {
        if (c) return;
        const w = rooms.get((m.code || "").toUpperCase());
        if (!w) return error(s, "Room is invalid or expired");
        if (w.players.length >= 2) return error(s, "Room is full");
        if (w.phase !== "lobby") return error(s, "Mission already started");
        const p = makePlayer(m.name);
        p.x = 2;
        w.players.push(p);
        attach(s, w, p);
        return;
      }
      if (m.type === "reconnect") {
        const w = rooms.get((m.code || "").toUpperCase());
        const p = w?.players.find((p) => p.token === m.token);
        if (!w || !p || !expiry.has(p.id) || expiry.get(p.id)! < Date.now())
          return error(s, "Reconnect credential invalid or expired");
        attach(s, w, p);
        return;
      }
      if (m.type === "resume") {
        if (!/^[A-F0-9]{8}$/i.test(m.code || ""))
          return error(s, "Invalid resume code");
        const saved = JSON.parse(
          await readFile(`${dir}/${m.code?.toUpperCase()}.json`, "utf8"),
        );
        if (saved.secret !== m.token)
          return error(s, "Invalid resume credential");
        const w = saved.world as World;
        if (w.version !== 1) return error(s, "Unsupported checkpoint");
        if (!rooms.has(w.code)) {
          w.players.forEach((p) => {
            p.connected = false;
            expiry.set(p.id, Date.now() + grace);
          });
          rooms.set(w.code, w);
        }
        const active = rooms.get(w.code)!;
        const p = active.players.find((p) => !p.connected);
        if (!p) return error(s, "Both seats are occupied");
        attach(s, active, p);
        return;
      }
      if (!c) return error(s, "Join a room first");
      const { room: w, player: p } = c;
      if (
        [
          "move",
          "pickup",
          "use",
          "give",
          "drop",
          "fire",
          "reload",
          "interact",
        ].includes(m.type) &&
        w.phase !== "playing"
      )
        return error(s, "Mission is not active");
      switch (m.type) {
        case "probe":
          send(s, { type: "latency", value: m.value });
          break;
        case "speaking":
          p.speaking = m.value === true;
          break;
        case "leave":
          s.close();
          break;
        case "ready":
          p.ready = !!m.value;
          break;
        case "cosmetic":
          if (typeof m.value === "string" && /^#[0-9a-f]{6}$/i.test(m.value))
            p.outfit = m.value;
          const cosmetics = schema
            .object({
              preset: schema.number().int().min(0).max(3),
              skin: schema.string().regex(/^#[0-9a-f]{6}$/i),
              hair: schema.string().regex(/^#[0-9a-f]{6}$/i),
              trousers: schema.string().regex(/^#[0-9a-f]{6}$/i),
              hairstyle: schema.number().int().min(0).max(2),
              accessory: schema.number().int().min(0).max(2),
            })
            .safeParse(m.data);
          if (cosmetics.success) Object.assign(p, cosmetics.data);
          break;
        case "map":
          if (
            w.phase === "lobby" &&
            w.leader === p.id &&
            (m.value === "vesper" || m.value === "blackwater")
          )
            w.map = m.value;
          break;
        case "start":
          if (
            w.leader === p.id &&
            w.players.length === 2 &&
            w.players.every((p) => p.ready && p.connected)
          ) {
            w.phase = "playing";
            w.time = Date.now();
            w.hintAt = Date.now();
          } else error(s, "Two connected, ready players are required");
          break;
        case "move":
          if (w.phase !== "playing" || p.down) break;
          const x = m.x ?? p.x,
            z = m.z ?? p.z;
          const d = Math.hypot(x - p.x, z - p.z);
          const now = Date.now(),
            elapsed = Math.min(0.2, (now - c.lastMove) / 1000);
          c.lastMove = now;
          const sprint = m.value === "sprint" && p.stamina > 0;
          const maxSpeed = sprint ? 5.3 : m.value === true ? 1.9 : 3.3;
          if (
            w.stage === 4 &&
            z < -54 &&
            !w.players.some(
              (q) =>
                q.id !== p.id &&
                q.connected &&
                Math.hypot(q.x + 8, q.z + 50) < 3,
            )
          )
            return;
          if (
            d <= maxSpeed * elapsed + 0.04 &&
            validPosition(x, z, w.stage, w.map) &&
            lineOfSight(p.x, p.z, x, z, w.stage, w.map, 0.32)
          ) {
            p.stamina = Math.max(
              0,
              Math.min(100, p.stamina + (sprint ? -15 : 10) * elapsed),
            );
            if (sprint && d > 0.01) p.noiseUntil = now + 1500;
            p.x = x;
            p.z = z;
            const area = Math.min(7, Math.max(0, Math.floor((10 - z) / 11)));
            if (!w.discovered.includes(area)) w.discovered.push(area);
            p.yaw = m.yaw ?? p.yaw;
            p.crouch = m.value === true;
            p.flash = m.data === true && p.battery > 0;
          }
          break;
        case "pickup": {
          const kind = w.items.find((i) => i.id === m.id)?.kind;
          if (!pickup(w, p, m.id || ""))
            error(s, "Pickup unavailable, too far away, or inventory full");
          else if (kind === "evidence") {
            const text =
              w.map === "vesper"
                ? [
                    "Patient 14: I can hear myself on the ward radio, but the voice is older.",
                    "Protocol memo: consciousness persists only while the carrier remains energized.",
                    "Evacuation order: disconnect the containment coil before opening the service exit.",
                  ]
                : [
                    "Dispatch log: do not repeat the emergency broadcast. It recognizes a second voice.",
                    "Village journal: the pump keeper shut the tunnel gate to keep the listeners outside.",
                    "Technician note: the tower can be grounded. Proof alone will not stop it.",
                  ];
            send(s, { type: "notice", text: text[(w.evidence - 1) % 3] });
          }
          break;
        }
        case "equip":
          if (["pistol", "shotgun", "melee"].includes(String(m.value))) {
            p.clips[p.weapon] = p.ammo;
            p.weapon = String(m.value);
            p.ammo = p.clips[p.weapon] ?? 0;
          }
          break;
        case "reload":
          {
            const a = p.inventory.indexOf(
              p.weapon === "shotgun" ? "shells" : "ammo",
            );
            if (a >= 0) {
              if (Date.now() < p.reloadUntil) break;
              p.inventory.splice(a, 1);
              p.reloadUntil = Date.now() + 1500;
              p.ammo = p.weapon === "shotgun" ? 5 : 12;
              p.clips[p.weapon] = p.ammo;
            } else error(s, "No ammunition supply");
          }
          break;
        case "drop":
          {
            const i = p.inventory.indexOf(String(m.value));
            if (i >= 0) {
              p.inventory.splice(i, 1);
              w.items.push({
                id: token().slice(0, 12),
                kind: String(m.value),
                x: p.x,
                z: p.z,
                count: 1,
              });
            }
          }
          break;
        case "give":
          {
            const other = w.players.find((q) => q.id !== p.id);
            const i = p.inventory.indexOf(String(m.value));
            if (
              other &&
              Math.hypot(p.x - other.x, p.z - other.z) < 3 &&
              i >= 0 &&
              other.inventory.length < 8
            ) {
              p.inventory.splice(i, 1);
              other.inventory.push(String(m.value));
            } else error(s, "Teammate must be nearby with space");
          }
          break;
        case "use":
          {
            const i = p.inventory.indexOf(String(m.value));
            if (i < 0) break;
            if (m.value === "medkit") {
              p.hp = Math.min(100, p.hp + 45);
              p.inventory.splice(i, 1);
            }
            if (m.value === "battery") {
              p.battery = 100;
              p.inventory.splice(i, 1);
            }
            if (m.value === "flare") {
              p.inventory.splice(i, 1);
              w.enemies.forEach((e) => (e.cooldown = Date.now() + 7000));
            }
          }
          break;
        case "fire":
          if (
            p.down ||
            Date.now() < p.reloadUntil ||
            Date.now() - p.lastShot < (p.weapon === "pistol" ? 350 : 850) ||
            (p.weapon !== "melee" && p.ammo <= 0)
          )
            break;
          p.lastShot = Date.now();
          p.noiseUntil = Date.now() + 4000;
          if (p.weapon !== "melee") {
            p.ammo--;
            p.clips[p.weapon] = p.ammo;
          }
          broadcast(w, { type: "effect", id: p.id, weapon: p.weapon });
          for (const e of w.enemies) {
            const dx = e.x - p.x,
              dz = e.z - p.z;
            const a = Math.atan2(dx, -dz);
            const delta = Math.atan2(Math.sin(a - p.yaw), Math.cos(a - p.yaw));
            if (
              e.hp > 0 &&
              Math.abs(delta) < 0.22 &&
              Math.hypot(dx, dz) < (p.weapon === "melee" ? 2.5 : 18) &&
              lineClear(p.x, p.z, e.x, e.z, w.stage, w.map)
            ) {
              e.hp -= p.weapon === "shotgun" ? 48 : 24;
              break;
            }
          }
          break;
        case "interact":
          interact(s, w, p, m.id || "", String(m.value ?? ""));
          break;
        case "chat":
        case "ping":
          if (Date.now() - c.lastChat < 700) break;
          c.lastChat = Date.now();
          if (++c.seq % 1 === 0)
            broadcast(w, {
              type: "chat",
              name: p.name,
              text: m.type === "ping" ? String(m.value) : m.text,
              time: Date.now(),
            });
          break;
        case "signal": {
          const signalData = schema
            .object({
              description: schema
                .object({
                  type: schema.enum(["offer", "answer"]),
                  sdp: schema.string().max(12000),
                })
                .optional(),
              candidate: schema
                .object({
                  candidate: schema.string().max(4096),
                  sdpMid: schema.string().nullable().optional(),
                  sdpMLineIndex: schema
                    .number()
                    .int()
                    .min(0)
                    .nullable()
                    .optional(),
                  usernameFragment: schema.string().nullable().optional(),
                })
                .optional(),
            })
            .strict()
            .safeParse(m.data);
          if (!signalData.success) return error(s, "Invalid voice signaling");
          for (const [peer, other] of sockets)
            if (other.room === w && other.player.id !== p.id)
              send(peer, { type: "signal", data: signalData.data });
          break;
        }
        case "save": {
          if (Date.now() - c.lastSave < 3000)
            return error(s, "Checkpoint rate limit: wait three seconds");
          c.lastSave = Date.now();
          const saved = await checkpoints.save(w);
          send(s, { type: "saved", ...saved });
          break;
        }
      }
    } catch (e) {
      error(s, e instanceof Error ? e.message : "Request failed");
    }
  });
  s.on("close", () => {
    const c = sockets.get(s);
    if (c) {
      c.player.connected = false;
      c.player.speaking = false;
      expiry.set(c.player.id, Date.now() + grace);
      delete c.room.held[c.player.id];
      const other = c.room.players.find((p) => p.connected);
      if (other) c.room.leader = other.id;
      sockets.delete(s);
    }
    rate.delete(s);
  });
});
function makePlayer(name?: string): Player {
  return {
    id: token().slice(0, 12),
    token: token(),
    name: name?.trim() || "Operator",
    connected: true,
    ready: false,
    x: -2,
    z: 8,
    yaw: 0,
    hp: 100,
    stamina: 100,
    down: false,
    outfit: "#a54968",
    preset: 0,
    skin: "#b98d86",
    hair: "#232335",
    trousers: "#25283c",
    hairstyle: 0,
    accessory: 0,
    inventory: ["medkit", "ammo", "shells", "flare"],
    ammo: 12,
    weapon: "pistol",
    lastShot: 0,
    flash: true,
    crouch: false,
    battery: 100,
    noiseUntil: 0,
    clips: { pistol: 12, shotgun: 5 },
    reloadUntil: 0,
    speaking: false,
  };
}
function lineClear(
  x: number,
  z: number,
  tx: number,
  tz: number,
  stage: number,
  map: "vesper" | "blackwater" = "vesper",
) {
  return lineOfSight(x, z, tx, tz, stage, map);
}
function interact(
  s: WebSocket,
  w: World,
  p: Player,
  id: string,
  value: string,
) {
  if (w.phase !== "playing" || p.down) return;
  const other = w.players.find((q) => q.id !== p.id);
  if (id === "revive") {
    if (other?.down && Math.hypot(p.x - other.x, p.z - other.z) < 3) {
      other.down = false;
      other.hp = 40;
      w.rescues++;
    }
    return;
  }
  const n = Number(id);
  const st = stations[n];
  if (!st || Math.hypot(p.x - st.x, p.z - st.z) > 3)
    return error(s, "Move closer to the station");
  if (n === 13) {
    if (w.survivor) return error(s, "The survivor is already safe");
    const medkit = p.inventory.indexOf("medkit");
    if (medkit < 0)
      return error(s, "Bring a medical kit to rescue this survivor");
    p.inventory.splice(medkit, 1);
    w.survivor = true;
    w.evidence++;
    broadcast(w, {
      type: "notice",
      text: "Survivor rescued. Their recorded testimony joins your evidence.",
    });
    return;
  }
  if (n === 11 || n === 12) {
    const required = n === 11 ? 2 : 4;
    if (w.stage < required) return error(s, "Lift power is still locked");
    p.z = n === 11 ? 0 : -28;
    return;
  }
  if (n === 10) {
    if (w.stage < 5) return error(s, "Complete all five systems");
    if (value === "stabilize" || value === "release") {
      w.votes[p.id] = value;
      if (other?.connected && w.votes[other.id] === value) {
        if (value === "stabilize") w.stabilized = true;
        else w.released = true;
        w.votes = {};
        broadcast(w, {
          type: "notice",
          text:
            value === "release"
              ? "Both operators confirmed: source released."
              : "Both operators confirmed: source stabilized.",
        });
      } else
        broadcast(w, {
          type: "notice",
          text: `${p.name} requests ${value}. Partner must explicitly confirm at the source.`,
        });
      return;
    }
    if (!["contain", "expose", "sacrifice", "escape"].includes(value)) return;
    w.votes[p.id] = value;
    if (other && (!other.connected || other.down))
      return error(
        s,
        "Both operators must be connected and conscious for extraction",
      );
    const candidate =
      other && w.votes[other.id] === "sacrifice" && value === "escape"
        ? "Sacrifice"
        : ending(w, value);
    if (!candidate)
      return error(
        s,
        "Containment needs stabilization; Exposure needs three evidence records and an active, unreleased source",
      );
    if (
      other?.connected &&
      w.votes[other.id] &&
      (value === "sacrifice" ||
        w.votes[other.id] === "sacrifice" ||
        w.votes[other.id] === value)
    ) {
      w.ending =
        value === "sacrifice" || w.votes[other.id] === "sacrifice"
          ? "Sacrifice"
          : candidate;
      w.phase = "ended";
    }
    return;
  }
  const stage = Math.floor(n / 2);
  if (stage !== w.stage)
    return error(s, "This system is not the current objective");
  if (n % 2 === 0) {
    if (stage === 2 && /^band:[0-3]$/.test(value)) {
      w.band = Number(value.slice(-1));
      w.bandSet = true;
    }
    w.held[p.id] = Date.now();
    const sol = w.solutions[stage];
    const clues = [
      `Glyphs: ${sol.map((x) => ["MOON", "EYE", "WAVE", "THORN"][x]).join(" → ")}. Partner's panel has the cipher legend.`,
      `Circuit indicators (A / B / C): ${sol.map((x) => ["NORTH", "EAST", "SOUTH", "WEST"][x]).join(" / ")}. Rotate each route to match.`,
      `Carrier target: ${100 + sol[0] * 25 + sol[1] * 5 + sol[2]} MHz. Tell your partner to tune the receiver.`,
      `Archive timestamps (sort oldest to newest): ${["Admission", "Sedation", "Broadcast", "Evacuation"].map((name, i) => `${name} at 0${sol.indexOf(i) + 1}:15`).join("; ")}. Tell your partner the chronological order.`,
      `Bridge energized while you stand at this control. Your partner must cross to the far latch; then both routes stay open.`,
    ];
    send(s, { type: "clue", text: clues[stage] });
    return;
  }
  if (
    !other?.connected ||
    Math.hypot(other.x - stations[n - 1].x, other.z - stations[n - 1].z) > 3
  )
    return error(s, "Your partner must attend the reference station");
  if (stage === 1 && !w.quest.fuse)
    return error(
      s,
      "Generator needs a fuse. Find the glowing component behind the power room.",
    );
  if (stage === 3 && !w.quest.keycard)
    return error(
      s,
      "Archive requires the shared keycard from the maintenance area.",
    );
  let solved = false;
  if (stage === 0 || stage === 3) {
    const digits = value.split("").map(Number);
    solved =
      digits.length === w.solutions[stage].length &&
      digits.every((d, i) => d === w.solutions[stage][i] + 1);
  }
  if (stage === 1) {
    const match = /^rotate:([012])$/.exec(value);
    if (match) {
      const i = Number(match[1]);
      w.circuits[i] = (w.circuits[i] + 1) % 4;
      if (i < 2) w.circuits[i + 1] = (w.circuits[i + 1] + 1) % 4;
    }
    solved = w.circuits.every((v, i) => v === w.solutions[stage][i]);
  }
  if (stage === 2) {
    const dial = Number(value);
    if (Number.isInteger(dial) && dial >= 0 && dial <= 24)
      w.frequency = 100 + w.band * 25 + dial;
    solved =
      w.bandSet &&
      w.frequency ===
        100 +
          w.solutions[stage][0] * 25 +
          w.solutions[stage][1] * 5 +
          w.solutions[stage][2];
  }
  if (stage === 4) solved = value === "latch";
  if (!solved) {
    if (stage !== 1)
      error(s, "Incorrect setting. Communicate the reference again.");
    return;
  }
  w.progress[stage] = 1;
  w.stage++;
  w.hintAt = Date.now();
  w.held = {};
  broadcast(w, {
    type: "notice",
    text: "System restored. The next route is open.",
  });
}
setInterval(() => {
  for (const [ip, b] of creationRates)
    if (Date.now() - b.at > 3600000) creationRates.delete(ip);
  for (const w of rooms.values()) {
    for (const p of w.players) {
      if (!p.connected && expiry.get(p.id)! < Date.now()) {
        if (w.phase === "lobby") w.players = w.players.filter((q) => q !== p);
        expiry.delete(p.id);
      }
    }
    if (
      !w.players.some((p) => p.connected) &&
      !w.players.some((p) => expiry.has(p.id))
    ) {
      rooms.delete(w.code);
      continue;
    }
    if (w.phase === "playing") {
      if (w.stage < 5 && Date.now() - w.hintAt > 120000) {
        w.hintAt = Date.now();
        broadcast(w, {
          type: "notice",
          text: "Hint: one operator must stay at the cyan reference. The other uses the crimson terminal. Roles are interchangeable; text chat works without a microphone.",
        });
      }
      for (const p of w.players) {
        if (p.flash) p.battery = Math.max(0, p.battery - 0.003);
        if (p.battery === 0) p.flash = false;
      }
      for (const e of w.enemies) {
        if (e.hp <= 0 || e.cooldown > Date.now()) continue;
        const candidates = w.players.filter(
          (p) =>
            p.connected &&
            !p.down &&
            (e.kind !== "Listener" || p.noiseUntil > Date.now()) &&
            lineClear(e.x, e.z, p.x, p.z, w.stage, w.map),
        );
        const p = candidates.sort(
          (a, b) =>
            Math.hypot(a.x - e.x, a.z - e.z) - Math.hypot(b.x - e.x, b.z - e.z),
        )[0];
        if (!p) {
          e.state = "patrol";
          const direction =
            Math.sin(Date.now() / 5000 + Number(e.id.slice(-1))) > 0 ? 1 : -1;
          const z = e.z + direction * 0.025;
          if (validPosition(e.x, z, w.stage, w.map)) e.z = z;
          continue;
        }
        const dist = Math.hypot(p.x - e.x, p.z - e.z);
        const bearing = Math.atan2(e.x - p.x, -(e.z - p.z));
        const observed =
          Math.abs(
            Math.atan2(Math.sin(bearing - p.yaw), Math.cos(bearing - p.yaw)),
          ) < 0.65;
        if (dist > 12 || (e.kind === "Watcher" && p.flash && observed)) {
          e.state = e.kind === "Watcher" && observed ? "frozen" : "patrol";
          continue;
        }
        e.state = "chase";
        if (dist < 1.4) {
          p.hp = Math.max(0, p.hp - 8);
          e.cooldown = Date.now() + 1400;
          if (p.hp <= 0) p.down = true;
        } else {
          const speed = e.kind === "Pursuer" ? 0.12 : 0.07;
          const x = e.x + ((p.x - e.x) / dist) * speed,
            z = e.z + ((p.z - e.z) / dist) * speed;
          if (validPosition(x, z, w.stage, w.map)) {
            e.x = x;
            e.z = z;
          }
        }
      }
      if (w.players.length === 2 && w.players.every((p) => p.down)) {
        w.players.forEach((p) => {
          p.down = false;
          p.hp = 100;
          p.x = -2;
          p.z = 8;
        });
        w.enemies.forEach((e, i) => {
          e.hp = 70;
          e.x = i % 2 ? -6 : 6;
          e.z = -18 - i * 14;
          e.state = "patrol";
          e.cooldown = Date.now() + 5000;
        });
        broadcast(w, {
          type: "notice",
          text: "Team wipe. Progress retained; recovered at reception.",
        });
      }
    }
    broadcast(w, { type: "state", world: publicWorld(w) });
  }
}, 50);
server.listen(Number(process.env.PORT || 3001), "0.0.0.0", () =>
  console.log("Authoritative server on port " + (process.env.PORT || 3001)),
);
