export type MapId = "vesper" | "blackwater";
export const maps = {
  vesper: {
    name: "Saint Vesper Institute",
    story:
      "The institute stored its patients in a signal. Something is still answering.",
    zones: [
      "Reception",
      "Records",
      "Patient wing",
      "Laboratory",
      "Courtyard",
      "Maintenance",
      "Generator basement",
      "Containment",
    ],
    color: 0x423466,
  },
  blackwater: {
    name: "Blackwater Relay",
    story:
      "The evacuation broadcast never stopped. Nobody who heard it remained themselves.",
    zones: [
      "Arrival platform",
      "Village archive",
      "Chapel",
      "Pump station",
      "Forest path",
      "Relay control",
      "Cable tunnels",
      "Transmission tower",
    ],
    color: 0x183f49,
  },
};
export const stations = [
  { x: -8, z: 5, name: "Cipher reader" },
  { x: 8, z: 5, name: "Decoder" },
  { x: -8, z: -8, name: "Circuit monitor" },
  { x: 8, z: -8, name: "Power router" },
  { x: -8, z: -22, name: "Frequency reference" },
  { x: 8, z: -22, name: "Frequency dial" },
  { x: -8, z: -36, name: "Archive sequence" },
  { x: 8, z: -36, name: "Sequence terminal" },
  { x: -8, z: -50, name: "Bridge control" },
  { x: 8, z: -61, name: "Bridge latch" },
  { x: 0, z: -65, name: "Source / extraction" },
  { x: -18, z: -28, name: "Service lift → records" },
  { x: 18, z: -56, name: "Cable lift → courtyard" },
  { x: 18, z: -28, name: "Trapped survivor" },
];
export const walls = [
  { x: -23, z: -30, w: 1, d: 84 },
  { x: 23, z: -30, w: 1, d: 84 },
  { x: 0, z: 12, w: 47, d: 1 },
  { x: 0, z: -72, w: 47, d: 1 },
  ...[-2, -16, -30, -44, -58].flatMap((z) => [
    { x: -8, z, w: 8, d: 1 },
    { x: 8, z, w: 8, d: 1 },
  ]),
  ...[-12, 12].flatMap((x) => [
    { x, z: 8, w: 0.5, d: 7 },
    { x, z: -14, w: 0.5, d: 19 },
    { x, z: -42, w: 0.5, d: 19 },
    { x, z: -66, w: 0.5, d: 11 },
  ]),
  ...[-14, -42].flatMap((z) => [
    { x: -19, z, w: 7, d: 0.5 },
    { x: 19, z, w: 7, d: 0.5 },
  ]),
];
export function mapWalls(map: MapId) {
  return map === "vesper"
    ? walls
    : walls.map((w) =>
        w.w === 8 ? { ...w, w: 5, x: w.x < 0 ? -9.5 : 9.5, z: w.z - 2 } : w,
      );
}
export function validPosition(
  x: number,
  z: number,
  stage: number,
  map: MapId = "vesper",
) {
  return (
    x > -22 &&
    x < 22 &&
    z < 11 &&
    z > -71 &&
    z > 6 - stage * 14 - 12 &&
    !mapWalls(map).some(
      (w) =>
        Math.abs(x - w.x) < w.w / 2 + 0.32 &&
        Math.abs(z - w.z) < w.d / 2 + 0.32,
    )
  );
}
export function lineOfSight(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  stage: number,
  map: MapId = "vesper",
  padding = 0,
) {
  if (!validPosition(ax, az, stage, map) || !validPosition(bx, bz, stage, map))
    return false;
  const dx = bx - ax,
    dz = bz - az;
  return !mapWalls(map).some((w) => {
    let lo = 0,
      hi = 1;
    for (const [start, delta, min, max] of [
      [ax, dx, w.x - w.w / 2 - padding, w.x + w.w / 2 + padding],
      [az, dz, w.z - w.d / 2 - padding, w.z + w.d / 2 + padding],
    ]) {
      if (Math.abs(delta) < 1e-8) {
        if (start < min || start > max) return false;
      } else {
        const a = (min - start) / delta,
          b = (max - start) / delta;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
        if (lo > hi) return false;
      }
    }
    return true;
  });
}
export type Item = {
  id: string;
  kind: string;
  x: number;
  z: number;
  count: number;
};
export type Player = {
  id: string;
  name: string;
  token: string;
  connected: boolean;
  ready: boolean;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  stamina: number;
  down: boolean;
  outfit: string;
  preset: number;
  skin: string;
  hair: string;
  trousers: string;
  hairstyle: number;
  accessory: number;
  inventory: string[];
  ammo: number;
  weapon: string;
  lastShot: number;
  flash: boolean;
  crouch: boolean;
  battery: number;
  noiseUntil: number;
  clips: Record<string, number>;
  reloadUntil: number;
  speaking: boolean;
};
export type Enemy = {
  id: string;
  kind: string;
  x: number;
  z: number;
  hp: number;
  state: string;
  cooldown: number;
};
export type World = {
  version: 1;
  code: string;
  leader: string;
  map: MapId;
  phase: "lobby" | "playing" | "ended";
  stage: number;
  seed: number;
  solutions: number[][];
  progress: number[];
  evidence: number;
  stabilized: boolean;
  released: boolean;
  survivor: boolean;
  rescues: number;
  players: Player[];
  items: Item[];
  enemies: Enemy[];
  ending: string;
  votes: Record<string, string>;
  held: Record<string, number>;
  time: number;
  circuits: number[];
  frequency: number;
  band: number;
  bandSet: boolean;
  hintAt: number;
  discovered: number[];
  quest: { fuse: boolean; keycard: boolean };
};
export function solutions(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return Math.floor((s / 4294967296) * 4);
  };
  return Array.from({ length: 5 }, (_, i) => {
    if (i === 3) {
      const order = [0, 1, 2, 3];
      for (let n = 3; n > 0; n--) {
        const j = next() % (n + 1);
        [order[j], order[n]] = [order[n], order[j]];
      }
      return order;
    }
    return Array.from({ length: 3 }, next);
  });
}
export function createWorld(code: string, seed: number): World {
  return {
    version: 1,
    code,
    leader: "",
    map: "vesper",
    phase: "lobby",
    stage: 0,
    seed,
    solutions: solutions(seed),
    progress: [0, 0, 0, 0, 0],
    evidence: 0,
    stabilized: false,
    released: false,
    survivor: false,
    rescues: 0,
    players: [],
    items: Array.from({ length: 18 }, (_, i) => ({
      id: "item" + i,
      kind:
        i >= 15
          ? "evidence"
          : [
              "evidence",
              "medkit",
              "ammo",
              "shells",
              "battery",
              "flare",
              "fuse",
              "keycard",
            ][i % 8],
      x: i >= 15 ? (i % 2 ? -18 : 18) : i % 2 ? -8 : 8,
      z: i >= 15 ? (15 - i) * 28 || 0 : 8 - Math.floor(i / 2) * 9,
      count: 1,
    })),
    enemies: ["Listener", "Watcher", "Pursuer"].map((kind, i) => ({
      id: "enemy" + i,
      kind,
      x: i % 2 ? -6 : 6,
      z: -18 - i * 14,
      hp: 70,
      state: "patrol",
      cooldown: 0,
    })),
    ending: "",
    votes: {},
    held: {},
    time: 0,
    circuits: [0, 0, 0],
    frequency: 100,
    band: 0,
    bandSet: false,
    hintAt: 0,
    discovered: [0],
    quest: { fuse: false, keycard: false },
  };
}
export function ending(w: World, choice: string) {
  if (choice === "sacrifice") return "Sacrifice";
  if (w.released || choice === "release") return "Outbreak";
  if (w.stabilized && choice === "contain") return "Containment";
  if (w.evidence >= 3 && !w.stabilized && choice === "expose")
    return "Exposure";
  return "";
}
export function pickup(w: World, p: Player, id: string) {
  const i = w.items.findIndex((v) => v.id === id);
  if (i < 0) return false;
  const item = w.items[i];
  if (
    !["evidence", "fuse", "keycard"].includes(item.kind) &&
    p.inventory.length >= 8
  )
    return false;
  if (
    Math.hypot(p.x - item.x, p.z - item.z) > 2.6 ||
    !lineOfSight(p.x, p.z, item.x, item.z, w.stage, w.map)
  )
    return false;
  if (item.kind === "evidence") w.evidence++;
  else if (item.kind === "fuse" || item.kind === "keycard")
    w.quest[item.kind] = true;
  else p.inventory.push(item.kind);
  w.items.splice(i, 1);
  return true;
}
export const itemDescriptions: Record<string, string> = {
  medkit:
    "Restores 45 health. Approach a downed partner and press V to revive without consuming a kit.",
  ammo: "One 12-round pistol magazine. Equip pistol and press R to reload.",
  shells: "Five shotgun shells. Equip shotgun and press R to reload.",
  battery: "Restores flashlight battery to full.",
  flare: "Creates a seven-second distraction, buying time to escape or revive.",
  fuse: "Shared generator component. Quest access remains recoverable.",
  keycard: "Shared access credential. Quest access remains recoverable.",
  evidence: "A recording of the signal. Three records unlock Exposure.",
};
export function publicWorld(w: World) {
  return {
    ...w,
    solutions: undefined,
    seed: undefined,
    players: w.players.map(({ token, lastShot, ...p }) => p),
  };
}
