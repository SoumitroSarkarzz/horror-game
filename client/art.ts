import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { MapId } from "../shared/world";
export function surface(base: string, kind: "floor" | "wall") {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "#090d1e";
  g.lineWidth = 4;
  if (kind === "floor") {
    for (let i = 0; i < 256; i += 64) {
      g.strokeRect(i, 0, 64, 256);
      g.strokeRect(0, i, 256, 64);
    }
  } else {
    g.fillStyle = "#ffffff0a";
    g.fillRect(0, 20, 256, 25);
    g.fillStyle = "#111626";
    g.fillRect(0, 200, 256, 56);
    g.fillStyle = "#82d9cb";
    g.fillRect(0, 190, 256, 4);
  }
  for (let i = 0; i < 80; i++) {
    const x = (i * 73) % 256,
      y = (i * 109) % 256;
    g.fillStyle = i % 3 ? "#00000010" : "#ffffff08";
    g.fillRect(x, y, 4, 2);
  }
  const texture = new T.CanvasTexture(c);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(kind === "floor" ? 12 : 2, kind === "floor" ? 40 : 1);
  return texture;
}
function part(
  g: T.Group,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: number,
) {
  const m = new T.Mesh(
    new T.BoxGeometry(w, h, d),
    new T.MeshToonMaterial({ color }),
  );
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
function tree() {
  const g = new T.Group();
  part(g, 0, 1.4, 0, 0.3, 2.8, 0.3, 0x2e2b33);
  for (let i = 0; i < 3; i++) {
    const m = new T.Mesh(
      new T.ConeGeometry(1.8 - i * 0.4, 2.8, 6),
      new T.MeshToonMaterial({ color: 0x1d343b }),
    );
    m.position.y = 2.5 + i * 1.1;
    g.add(m);
  }
  return g;
}
function bed() {
  const g = new T.Group();
  part(g, 0, 0.6, 0, 1.1, 0.25, 2.1, 0x667780);
  part(g, 0, 0.82, 0, 1, 0.2, 1.9, 0xafa4b9);
  part(g, 0, 0.98, -0.65, 0.85, 0.16, 0.4, 0xd4c8d1);
  for (const x of [-0.5, 0.5])
    for (const z of [-0.9, 0.9]) part(g, x, 0.3, z, 0.08, 0.6, 0.08, 0x353a4a);
  part(g, 0, 1.1, -1, 1.2, 0.7, 0.1, 0x444b61);
  return g;
}
function cabinet() {
  const g = new T.Group();
  part(g, 0, 1, 0, 1, 2, 0.5, 0x455665);
  for (let i = 0; i < 4; i++) {
    part(g, 0, 0.3 + i * 0.45, 0.27, 0.9, 0.03, 0.02, 0x191d33);
    part(g, 0, 0.5 + i * 0.45, 0.28, 0.18, 0.05, 0.03, 0xc0c1b9);
  }
  return g;
}
function desk() {
  const g = new T.Group();
  part(g, 0, 0.9, 0, 1.8, 0.15, 0.85, 0x574854);
  part(g, -0.65, 0.4, 0, 0.4, 0.8, 0.7, 0x353949);
  part(g, 0.65, 0.4, 0, 0.1, 0.8, 0.7, 0x353949);
  part(g, 0.35, 1.25, -0.2, 0.6, 0.5, 0.1, 0x161c28);
  part(g, 0.35, 1.25, -0.13, 0.5, 0.35, 0.03, 0x55beb0);
  return g;
}
function chair() {
  const g = new T.Group();
  part(g, 0, 0.55, 0, 0.65, 0.12, 0.65, 0x62404f);
  part(g, 0, 0.95, 0.3, 0.65, 0.85, 0.12, 0x62404f);
  for (const x of [-0.25, 0.25])
    for (const z of [-0.25, 0.25])
      part(g, x, 0.27, z, 0.07, 0.54, 0.07, 0x323849);
  return g;
}
export function decorate(scene: T.Scene, map: MapId) {
  const add = (g: T.Group, x: number, z: number, rotation = 0) => {
    g.position.set(x, 0, z);
    g.rotation.y = rotation;
    scene.add(g);
  };
  for (const z of [0, -28, -56])
    for (const x of [-18, 18]) {
      add(cabinet(), x + 2, z - 3);
      add(desk(), x, z - 3);
      add(chair(), x, z - 1.8, Math.PI);
      if (map === "vesper") add(bed(), x - 2, z + 1);
      else add(tree(), x - 2, z + 1);
    }
  if (map === "vesper") {
    for (let i = 0; i < 5; i++) {
      add(bed(), -9, 1 - i * 14);
      add(cabinet(), 10, 0 - i * 14);
      add(desk(), -9, -5 - i * 14);
      add(chair(), -9, -3.8 - i * 14, Math.PI);
    }
    for (let i = 0; i < 7; i++) {
      const lamp = new T.Mesh(
        new T.BoxGeometry(3, 0.08, 0.5),
        new T.MeshBasicMaterial({ color: i === 4 ? 0xe54a75 : 0x72bcbd }),
      );
      lamp.position.set(0, 3.5, 5 - i * 11);
      scene.add(lamp);
      const l = new T.PointLight(i === 4 ? 0xc23165 : 0x44c5c8, 5, 9, 2);
      l.position.copy(lamp.position);
      if (i % 3 === 0) scene.add(l);
    }
    const coil = new T.Mesh(
      new T.TorusKnotGeometry(1.5, 0.12, 80, 6),
      new T.MeshToonMaterial({ color: 0xad3762, emissive: 0x420f24 }),
    );
    coil.position.set(0, 3, -68);
    scene.add(coil);
  } else {
    for (let i = 0; i < 12; i++) {
      add(tree(), i % 2 ? -10.5 : 10.5, 8 - i * 6);
      if (i % 3 === 0) add(desk(), i % 2 ? -8 : 8, 2 - i * 6);
    }
    for (const x of [-3, 3]) {
      const rail = new T.Mesh(
        new T.BoxGeometry(0.12, 0.12, 12),
        new T.MeshToonMaterial({ color: 0x7d8190 }),
      );
      rail.position.set(x, 0.02, 5);
      scene.add(rail);
    }
    for (let z = 0; z < 11; z += 1) {
      const sleeper = new T.Mesh(
        new T.BoxGeometry(7, 0.1, 0.22),
        new T.MeshToonMaterial({ color: 0x544e49 }),
      );
      sleeper.position.set(0, -0.01, z);
      scene.add(sleeper);
    }
    const water = new T.Mesh(
      new T.PlaneGeometry(20, 9),
      new T.MeshToonMaterial({
        color: 0x184f63,
        transparent: true,
        opacity: 0.65,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.02, -29);
    scene.add(water);
    for (const x of [-2, 2]) {
      const leg = new T.Mesh(
        new T.CylinderGeometry(0.18, 0.4, 22, 6),
        new T.MeshToonMaterial({ color: 0x6e5865 }),
      );
      leg.position.set(x, 11, -69);
      leg.rotation.z = x > 0 ? 0.12 : -0.12;
      scene.add(leg);
    }
    const beacon = new T.Mesh(
      new T.SphereGeometry(0.35, 8, 6),
      new T.MeshBasicMaterial({ color: 0xff3659 }),
    );
    beacon.position.set(0, 22, -69);
    scene.add(beacon);
    scene.fog = new T.FogExp2(0x101e2c, 0.04);
  }
}

// Batch immutable scenery by material, retaining transparent water as a separate draw.
export function batchScenery(scene: T.Scene) {
  scene.updateMatrixWorld(true);
  const batches = new Map<string, T.Mesh[]>();
  scene.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      Array.isArray(o.material) ||
      o.material.transparent
    )
      return;
    const m = o.material as T.MeshToonMaterial;
    const key = [
      m.type,
      m.color?.getHex(),
      m.map?.uuid,
      m.emissive?.getHex(),
      m.side,
    ].join(":");
    const group = batches.get(key) || [];
    group.push(o);
    batches.set(key, group);
  });
  for (const group of batches.values()) {
    if (group.length < 2) continue;
    const geometries = group.map((m) =>
      m.geometry.clone().applyMatrix4(m.matrixWorld),
    );
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!merged) continue;
    const material = (group[0].material as T.Material).clone();
    const mesh = new T.Mesh(merged, material);
    scene.add(mesh);
    for (const original of group) {
      original.removeFromParent();
      original.geometry.dispose();
      (original.material as T.Material).dispose();
    }
    const edge = new T.LineSegments(
      new T.EdgesGeometry(merged, 40),
      new T.LineBasicMaterial({
        color: 0x111222,
        transparent: true,
        opacity: 0.65,
      }),
    );
    scene.add(edge);
  }
}
