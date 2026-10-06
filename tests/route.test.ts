import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { WebSocket } from "ws";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
const port = 3201;
function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  let state: any,
    id = "";
  const events: any[] = [];
  ws.on("message", (r) => {
    const m = JSON.parse(r.toString());
    if (m.type === "state") state = m.world;
    if (m.type === "joined") id = m.id;
    events.push(m);
    if (events.length > 300) events.splice(0, 100);
  });
  return {
    ws,
    send: (m: any) => ws.send(JSON.stringify(m)),
    get state() {
      return state;
    },
    get player() {
      return state?.players.find((p: any) => p.id === id);
    },
    async open() {
      await new Promise<void>((r, j) => {
        ws.once("open", r);
        ws.once("error", j);
      });
    },
    async wait(type: string, predicate = (m: any) => true) {
      for (let i = 0; i < 250; i++) {
        const index = events.findIndex((m) => m.type === type && predicate(m));
        if (index >= 0) return events.splice(index, 1)[0];
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("Timed out: " + type);
    },
    async move(x: number, z: number, yaw = 0) {
      let attempts = 0;
      while (
        !state ||
        Math.hypot(x - this.player.x, z - this.player.z) > 0.04
      ) {
        if (++attempts > 2000) throw new Error("Navigation failed");
        if (this.player?.down) throw new Error("Operator down during route");
        await new Promise((r) => setTimeout(r, 50));
        const p = this.player,
          d = Math.hypot(x - p.x, z - p.z),
          step = Math.min(0.14, d);
        this.send({
          type: "move",
          x: p.x + ((x - p.x) / d) * step,
          z: p.z + ((z - p.z) / d) * step,
          yaw,
          value: false,
          data: true,
        });
      }
      this.send({ type: "move", x, z, yaw, value: false, data: true });
      await new Promise((r) => setTimeout(r, 60));
    },
    async via(x: number, z: number, yaw = 0) {
      await this.move(0, this.player.z, yaw);
      await this.move(0, z, yaw);
      await this.move(x, z, yaw);
    },
  };
}
test(
  "uninterrupted authoritative routes: actual navigation, quest collection, puzzles, combat and all ending branches on both maps",
  { timeout: 360000 },
  async () => {
    const folder = await mkdtemp("/tmp/afterlight-live-route-");
    const child = spawn(
      process.execPath,
      process.env.TEST_COMPILED_SERVER
        ? ["dist-server/server/index.js"]
        : ["--import", "tsx", "server/index.ts"],
      {
        env: {
          ...process.env,
          PORT: String(port),
          SAVE_DIR: folder,
          ALLOWED_ORIGINS: "",
        },
        stdio: "pipe",
      },
    );
    await new Promise<void>((r, j) => {
      child.stdout!.once("data", () => r());
      child.once("exit", () => j(new Error("Route server failed")));
    });
    try {
      let fork = 700;
      for (const map of ["vesper", "blackwater"]) {
        const a = client(),
          b = client();
        await Promise.all([a.open(), b.open()]);
        a.send({ type: "create", name: "Alpha" });
        const joined = await a.wait("joined");
        b.send({ type: "join", code: joined.code, name: "Beta" });
        await b.wait("joined");
        a.send({ type: "map", value: map });
        a.send({ type: "ready", value: true });
        b.send({ type: "ready", value: true });
        await a.wait("state", (m) =>
          m.world.players.every((p: any) => p.ready),
        );
        a.send({ type: "start" });
        await a.wait("state", (m) => m.world.phase === "playing");
        await Promise.all([b.move(8, 8), a.via(-18, 0)]);
        b.send({ type: "pickup", id: "item0" });
        a.send({ type: "pickup", id: "item15" });
        await a.wait("state", (m) => m.world.evidence === 2);
        await Promise.all([a.via(-8, 5), b.via(8, 5)]);
        for (let stage = 0; stage < 5; stage++) {
          if (stage === 1) {
            await b.via(8, -19);
            b.send({ type: "pickup", id: "item6" });
            await b.move(-8, -19);
            b.send({ type: "pickup", id: "item7" });
            await b.wait(
              "state",
              (m) => m.world.quest.fuse && m.world.quest.keycard,
            );
            await Promise.all([a.via(-8, -8), b.via(8, -8)]);
          }
          if (stage === 2) {
            await Promise.all([a.via(-8, -22), b.via(8, -28)]);
            b.send({ type: "pickup", id: "item8" });
            await b.wait("state", (m) => m.world.evidence === 3);
            await b.move(8, -22);
          }
          if (stage === 3)
            await Promise.all([a.via(-8, -36, Math.PI), b.via(8, -36)]);
          if (stage === 4) {
            await Promise.all([a.via(-8, -50, Math.PI), b.via(8, -50)]);
            const enemy = b.state.enemies.find(
              (e: any) => e.kind === "Pursuer",
            );
            for (let shot = 0; shot < 5 && enemy.hp > 0; shot++) {
              const e = b.state.enemies.find((e: any) => e.kind === "Pursuer");
              if (e.hp <= 0) break;
              const p = b.player,
                yaw = Math.atan2(e.x - p.x, -(e.z - p.z));
              await b.move(p.x, p.z, yaw);
              b.send({ type: "fire" });
              await new Promise((r) => setTimeout(r, 400));
            }
            assert(
              b.state.enemies.find((e: any) => e.kind === "Pursuer").hp <= 0,
              "Pursuer must be defeated by validated hits",
            );
            await b.via(8, -61);
          }
          a.send({ type: "interact", id: String(stage * 2) });
          const clue = (
            await a.wait("clue", (m) =>
              m.text.startsWith(
                [
                  "Glyphs:",
                  "Circuit indicators",
                  "Carrier target",
                  "Archive timestamps",
                  "Bridge energized",
                ][stage],
              ),
            )
          ).text as string;
          if (stage === 0) {
            const glyphs = clue.match(/MOON|EYE|WAVE|THORN/g)!;
            b.send({
              type: "interact",
              id: "1",
              value: glyphs
                .map((n) => ["MOON", "EYE", "WAVE", "THORN"].indexOf(n) + 1)
                .join(""),
            });
          }
          if (stage === 1) {
            const target = clue
              .match(/NORTH|EAST|SOUTH|WEST/g)!
              .map((n) => ["NORTH", "EAST", "SOUTH", "WEST"].indexOf(n));
            const current = [...b.state.circuits];
            for (let i = 0; i < 3; i++) {
              const turns = (target[i] - current[i] + 4) % 4;
              for (let n = 0; n < turns; n++) {
                b.send({ type: "interact", id: "3", value: "rotate:" + i });
                current[i] = (current[i] + 1) % 4;
                if (i < 2) current[i + 1] = (current[i + 1] + 1) % 4;
                await new Promise((r) => setTimeout(r, 70));
              }
            }
            if (b.state.stage === 1)
              b.send({ type: "interact", id: "3", value: "check" });
          }
          if (stage === 2) {
            const target = Number(clue.match(/(\d+) MHz/)![1]),
              band = Math.floor((target - 100) / 25);
            a.send({ type: "interact", id: "4", value: "band:" + band });
            await new Promise((r) => setTimeout(r, 70));
            b.send({
              type: "interact",
              id: "5",
              value: String(target - 100 - band * 25),
            });
          }
          if (stage === 3) {
            const timestamps = [
              ...clue.matchAll(
                /(Admission|Sedation|Broadcast|Evacuation) at (\d+):15/g,
              ),
            ];
            const order = timestamps
              .sort((a, b) => Number(a[2]) - Number(b[2]))
              .map(
                (n) =>
                  ["Admission", "Sedation", "Broadcast", "Evacuation"].indexOf(
                    n[1],
                  ) + 1,
              )
              .join("");
            b.send({ type: "interact", id: "7", value: order });
          }
          if (stage === 4)
            b.send({ type: "interact", id: "9", value: "latch" });
          try {
            await a.wait("state", (m) => m.world.stage === stage + 1);
          } catch (e) {
            console.log("Route failure", {
              map,
              stage,
              positions: a.state.players.map((p: any) => ({
                x: p.x,
                z: p.z,
                hp: p.hp,
                down: p.down,
              })),
            });
            throw e;
          }
        }
        await Promise.all([a.via(0, -65), b.via(2, -65)]);
        a.send({ type: "save" });
        const saved = await a.wait("saved");
        const checkpoint = JSON.parse(
          await readFile(`${folder}/${saved.code}.json`, "utf8"),
        );
        assert.equal(checkpoint.world.stage, 5);
        assert.equal(checkpoint.world.evidence, 3);
        a.ws.close();
        b.ws.close();
        for (const choice of ["contain", "expose", "sacrifice", "escape"]) {
          const code = (++fork).toString(16).padStart(8, "0").toUpperCase();
          const copy = structuredClone(checkpoint);
          copy.world.code = code;
          copy.world.players.forEach((p: any) => (p.connected = false));
          await writeFile(`${folder}/${code}.json`, JSON.stringify(copy), {
            mode: 0o600,
          });
          const left = client(),
            right = client();
          await Promise.all([left.open(), right.open()]);
          left.send({ type: "resume", code, token: saved.secret });
          await left.wait("joined");
          right.send({ type: "resume", code, token: saved.secret });
          await right.wait("joined");
          if (choice === "contain" || choice === "escape") {
            const action = choice === "contain" ? "stabilize" : "release";
            left.send({ type: "interact", id: "10", value: action });
            right.send({ type: "interact", id: "10", value: action });
            await left.wait("state", (m) =>
              choice === "contain" ? m.world.stabilized : m.world.released,
            );
          }
          left.send({ type: "interact", id: "10", value: choice });
          right.send({
            type: "interact",
            id: "10",
            value: choice === "sacrifice" ? "escape" : choice,
          });
          const end = await left.wait(
            "state",
            (m) => m.world.phase === "ended",
          );
          const other = await right.wait(
            "state",
            (m) => m.world.phase === "ended",
          );
          assert.equal(end.world.ending, other.world.ending);
          assert.equal(
            end.world.ending,
            (
              {
                contain: "Containment",
                expose: "Exposure",
                sacrifice: "Sacrifice",
                escape: "Outbreak",
              } as Record<string, string>
            )[choice],
          );
          left.ws.close();
          right.ws.close();
        }
        console.log(
          `${map}: natural route, quest collection, combat and four endings validated`,
        );
      }
    } finally {
      child.kill();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
