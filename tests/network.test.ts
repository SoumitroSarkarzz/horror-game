import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { createWorld, type Player } from "../shared/world";
const port = 3199;
let child: ReturnType<typeof spawn>;
function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const events: any[] = [];
  let latest: any;
  let playerId = "";
  ws.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "state") latest = message.world;
    if (message.type === "joined") playerId = message.id;
    events.push(message);
  });
  return {
    ws,
    events,
    get player() {
      return latest?.players.find((p: any) => p.id === playerId);
    },
    send: (m: any) => ws.send(JSON.stringify(m)),
    async wait(type: string, predicate = (m: any) => true) {
      for (let i = 0; i < 150; i++) {
        const n = events.findIndex((m) => m.type === type && predicate(m));
        if (n >= 0) return events.splice(n, 1)[0];
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("Timeout waiting " + type);
    },
    async open() {
      if (ws.readyState !== 1)
        await new Promise<void>((r, j) => {
          ws.once("open", r);
          ws.once("error", j);
        });
    },
  };
}
test("real authoritative server: rooms, capacity, invalid messages, reconnect, checkpoint saving", async () => {
  child = spawn(
    process.execPath,
    process.env.TEST_COMPILED_SERVER
      ? ["dist-server/server/index.js"]
      : ["--import", "tsx", "server/index.ts"],
    {
      env: {
        ...process.env,
        PORT: String(port),
        SAVE_DIR: "/tmp/afterlight-test-save",
        RECONNECT_GRACE_MS: "500",
      },
      stdio: "pipe",
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.stdout!.once("data", () => resolve());
    child.once("exit", (code) => reject(new Error("Server exited " + code)));
  });
  const a = client(),
    b = client(),
    c = client();
  try {
    await Promise.all([a.open(), b.open(), c.open()]);
    a.send({ type: "create", name: "Alpha" });
    const joined = await a.wait("joined");
    b.send({ type: "join", code: joined.code.toLowerCase(), name: "Beta" });
    const bj = await b.wait("joined");
    assert.notEqual(joined.token, bj.token);
    c.send({ type: "join", code: joined.code });
    assert.match((await c.wait("error")).text, /full/);
    a.send({ type: "banana" });
    assert.match((await a.wait("error")).text, /Invalid/);
    a.send({ type: "ready", value: true });
    b.send({ type: "ready", value: true });
    await a.wait("state", (m) => m.world.players.every((p: any) => p.ready));
    a.send({ type: "start" });
    const state = await a.wait("state", (m) => m.world.phase === "playing");
    assert.equal(state.world.players.length, 2);
    assert(!JSON.stringify(state).includes(joined.token));
    async function walk(
      c: ReturnType<typeof client>,
      fromX: number,
      fromZ: number,
      toX: number,
      toZ: number,
    ) {
      for (let attempts = 0; attempts < 300; attempts++) {
        const p = c.player;
        assert(p, "authoritative player snapshot required");
        const d = Math.hypot(toX - p.x, toZ - p.z);
        if (d <= 0.04) return;
        await new Promise((r) => setTimeout(r, 60));
        const step = Math.min(0.14, d);
        c.send({
          type: "move",
          x: p.x + ((toX - p.x) / d) * step,
          z: p.z + ((toZ - p.z) / d) * step,
          yaw: 0,
          value: false,
          data: true,
        });
      }
      throw new Error("Authoritative movement did not reach pickup");
    }
    await Promise.all([walk(a, -2, 8, 8, 8), walk(b, 2, 8, 8, 8)]);
    a.send({ type: "pickup", id: "item0" });
    b.send({ type: "pickup", id: "item0" });
    await a.wait("state", (m) => m.world.evidence === 1);
    a.send({ type: "give", value: "medkit" });
    await b.wait(
      "state",
      (m) =>
        m.world.players.find((p: any) => p.id === bj.id).inventory.length === 5,
    );
    await Promise.all([walk(a, 8, 8, 8, 1), walk(b, 8, 8, 8, 1)]);
    a.send({ type: "pickup", id: "item2" });
    b.send({ type: "pickup", id: "item2" });
    const picked = await a.wait(
      "state",
      (m) => !m.world.items.some((i: any) => i.id === "item2"),
    );
    assert.equal(
      picked.world.players
        .flatMap((p: any) => p.inventory)
        .filter((k: string) => k === "ammo").length,
      3,
    );
    a.send({ type: "save" });
    const saved = await a.wait("saved");
    assert.equal(saved.secret.length, 64);
    b.ws.close();
    await new Promise((r) => setTimeout(r, 80));
    const d = client();
    await d.open();
    d.send({ type: "reconnect", code: joined.code, token: "wrong" });
    assert.match((await d.wait("error")).text, /invalid/);
    d.send({ type: "reconnect", code: joined.code, token: bj.token });
    assert.equal((await d.wait("joined")).id, bj.id);
    a.ws.close();
    await d.wait("state", (m) => m.world.leader === bj.id);
    d.ws.close();
    await new Promise((r) => setTimeout(r, 800));
    c.send({ type: "reconnect", code: joined.code, token: bj.token });
    assert.match((await c.wait("error")).text, /invalid or expired/);
    assert.equal(
      ((await (await fetch(`http://127.0.0.1:${port}`)).json()) as any).rooms,
      0,
    );
    c.send({ type: "resume", code: saved.code, token: "incorrect" });
    assert.match((await c.wait("error")).text, /Invalid resume/);
    c.send({ type: "resume", code: saved.code, token: saved.secret });
    await c.wait("joined");
    const restored = await c.wait("state", (m) => m.world.phase === "playing");
    assert.equal(restored.world.evidence, 1);
    assert.deepEqual(
      restored.world.players.map((p: any) => p.inventory),
      picked.world.players.map((p: any) => p.inventory),
    );
  } finally {
    a.ws.close();
    b.ws.close();
    c.ws.close();
    child.kill();
    await rm("/tmp/afterlight-test-save", { recursive: true, force: true });
  }
});

test("both maps: restore checkpoints, solve each paired system and confirm every ending", async () => {
  const dir = "/tmp/afterlight-route-test";
  await mkdir(dir, { recursive: true });
  child = spawn(
    process.execPath,
    process.env.TEST_COMPILED_SERVER
      ? ["dist-server/server/index.js"]
      : ["--import", "tsx", "server/index.ts"],
    {
      env: { ...process.env, PORT: String(port), SAVE_DIR: dir },
      stdio: "pipe",
    },
  );
  await new Promise<void>((r, j) => {
    child.stdout!.once("data", () => r());
    child.once("exit", () => j(new Error("Server failed")));
  });
  try {
    let index = 0;
    for (const map of ["vesper", "blackwater"] as const) {
      for (let stage = 0; stage < 5; stage++) {
        const code = (++index).toString(16).padStart(8, "0").toUpperCase(),
          w = createWorld(code, index * 77);
        w.phase = "playing";
        w.quest = { fuse: true, keycard: true };
        w.stage = stage;
        w.map = map;
        const z = [5, -8, -22, -36, -50][stage];
        const base = {
          name: "Tester",
          ready: true,
          connected: false,
          x: -8,
          z,
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
          inventory: ["medkit"],
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
        w.players = [
          { ...base, id: "a", token: "token-a" },
          {
            ...base,
            id: "b",
            token: "token-b",
            x: 8,
            z: stage === 4 ? -61 : z,
          },
        ] as Player[];
        w.leader = "a";
        await writeFile(
          `${dir}/${code}.json`,
          JSON.stringify({ secret: "resume-secret", world: w }),
        );
        const a = client(),
          b = client();
        await Promise.all([a.open(), b.open()]);
        a.send({ type: "resume", code, token: "resume-secret" });
        await a.wait("joined");
        b.send({ type: "resume", code, token: "resume-secret" });
        await b.wait("joined");
        a.send({ type: "interact", id: String(stage * 2) });
        await a.wait("clue");
        const solution = w.solutions[stage];
        if (stage === 1) {
          const current = [0, 0, 0];
          for (let i = 0; i < 3; i++) {
            const turns = (solution[i] - current[i] + 4) % 4;
            for (let n = 0; n < turns; n++) {
              b.send({ type: "interact", id: "3", value: "rotate:" + i });
              current[i] = (current[i] + 1) % 4;
              if (i < 2) current[i + 1] = (current[i + 1] + 1) % 4;
            }
          }
          if (solution.every((n) => n === 0))
            b.send({ type: "interact", id: "3", value: "check" });
        } else {
          if (stage === 2)
            a.send({ type: "interact", id: "4", value: "band:" + solution[0] });
          b.send({
            type: "interact",
            id: String(stage * 2 + 1),
            value:
              stage === 4
                ? "latch"
                : stage === 2
                  ? String(solution[1] * 5 + solution[2])
                  : solution.map((n) => n + 1).join(""),
          });
        }
        await a.wait("state", (m) => m.world.stage === stage + 1);
        a.ws.close();
        b.ws.close();
      }
      for (const choice of ["contain", "expose", "sacrifice", "escape"]) {
        const code = (++index).toString(16).padStart(8, "0").toUpperCase(),
          w = createWorld(code, 1);
        w.phase = "playing";
        w.stage = 5;
        w.map = map;
        const old = JSON.parse(
          await readFile(
            `${dir}/${(index - 1).toString(16).padStart(8, "0").toUpperCase()}.json`,
            "utf8",
          ),
        ).world;
        w.players = old.players;
        w.players.forEach((p) => {
          p.x = 0;
          p.z = -65;
          p.connected = false;
        });
        w.stabilized = choice === "contain";
        w.evidence = choice === "expose" ? 3 : 0;
        w.released = choice === "escape";
        await writeFile(
          `${dir}/${code}.json`,
          JSON.stringify({ secret: "resume-secret", world: w }),
        );
        const a = client(),
          b = client();
        await Promise.all([a.open(), b.open()]);
        a.send({ type: "resume", code, token: "resume-secret" });
        await a.wait("joined");
        b.send({ type: "resume", code, token: "resume-secret" });
        await b.wait("joined");
        a.send({ type: "interact", id: "10", value: choice });
        await new Promise((r) => setTimeout(r, 80));
        assert(
          !a.events.some(
            (m) => m.type === "state" && m.world.phase === "ended",
          ),
        );
        b.send({
          type: "interact",
          id: "10",
          value: choice === "sacrifice" ? "escape" : choice,
        });
        const result = await a.wait("state", (m) => m.world.phase === "ended");
        const second = await b.wait("state", (m) => m.world.phase === "ended");
        assert.equal(result.world.ending, second.world.ending);
        assert.equal(
          result.world.ending,
          (
            {
              contain: "Containment",
              expose: "Exposure",
              sacrifice: "Sacrifice",
              escape: "Outbreak",
            } as any
          )[choice],
        );
        a.ws.close();
        b.ws.close();
      }
    }
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
