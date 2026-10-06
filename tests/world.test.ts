import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorld,
  solutions,
  pickup,
  ending,
  validPosition,
  lineOfSight,
  publicWorld,
  type Player,
} from "../shared/world";
function player(): Player {
  return {
    id: "p",
    token: "secret",
    name: "test",
    connected: true,
    ready: true,
    x: 8,
    z: 8,
    yaw: 0,
    hp: 100,
    stamina: 100,
    down: false,
    outfit: "#ffffff",
    preset: 0,
    skin: "#b98d86",
    hair: "#232335",
    trousers: "#25283c",
    hairstyle: 0,
    accessory: 0,
    inventory: [],
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
test("seeded puzzle configurations are deterministic and all digits valid", () => {
  for (let seed = 0; seed < 1000; seed++) {
    const a = solutions(seed);
    assert.deepEqual(a, solutions(seed));
    assert.equal(a.length, 5);
    assert(a.flat().every((n) => n >= 0 && n <= 3));
    assert.equal(a[3].length, 4);
  }
});
test("simultaneous pickup has a single owner and single reward", () => {
  const w = createWorld("ABC", 1),
    a = player(),
    b = player();
  assert(pickup(w, a, "item0"));
  assert(!pickup(w, b, "item0"));
  assert.equal(w.evidence, 1);
});
test("pickup enforces range and inventory capacity", () => {
  const w = createWorld("ABC", 1),
    p = player();
  p.z = -65;
  assert(!pickup(w, p, "item0"));
  p.z = 8;
  p.inventory = Array(8).fill("medkit");
  p.x = -8;
  assert(!pickup(w, p, "item1"));
  p.x = 8;
  assert(pickup(w, p, "item0"));
  w.stage = 1;
  p.z = -19;
  assert(pickup(w, p, "item6"));
  assert(w.quest.fuse);
});
test("all four endings have distinct reachable conditions", () => {
  const w = createWorld("ABC", 1);
  assert.equal(ending(w, "contain"), "");
  w.stabilized = true;
  assert.equal(ending(w, "contain"), "Containment");
  assert.equal(ending(w, "expose"), "");
  w.stabilized = false;
  w.evidence = 3;
  assert.equal(ending(w, "expose"), "Exposure");
  assert.equal(ending(w, "sacrifice"), "Sacrifice");
  w.released = true;
  assert.equal(ending(w, "escape"), "Outbreak");
});
test("checkpoint round trip preserves progression and ownership", () => {
  const w = createWorld("ABC", 91);
  w.players = [player()];
  w.stage = 3;
  w.evidence = 2;
  w.stabilized = true;
  assert.deepEqual(JSON.parse(JSON.stringify(w)), w);
});
test("public snapshots never disclose reconnect secrets or puzzle solutions", () => {
  const w = createWorld("ABC", 1);
  w.players = [player()];
  const snapshot = JSON.stringify(publicWorld(w));
  assert(!snapshot.includes("secret"));
  assert(!snapshot.includes("solutions"));
});
test("walls and progress barriers reject clipping", () => {
  assert(!validPosition(23, 0, 5));
  assert(!validPosition(8, -2, 5));
  assert(!validPosition(0, -30, 0));
  assert(validPosition(0, 8, 0));
  assert(validPosition(0, -65, 5));
});

test("line-of-sight rejects solid walls and closed mission routes", () => {
  assert(!lineOfSight(8, 0, 8, -5, 5));
  assert(lineOfSight(0, 0, 0, -5, 5));
  assert(!lineOfSight(0, 0, 0, -8, 0));
  assert(lineOfSight(8, 0, 18, 0, 5));
});
