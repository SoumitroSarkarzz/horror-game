import * as THREE from "three";
import {
  maps,
  stations,
  walls,
  mapWalls,
  validPosition,
  itemDescriptions,
  type World,
  type Player,
} from "../shared/world";
import "./style.css";
import notices from "../docs/THIRD_PARTY_LICENSES.md?raw";
import { surface, decorate, batchScenery } from "./art";
const app = document.querySelector<HTMLDivElement>("#app")!;
const notice = document.createElement("div");
notice.id = "notice";
notice.hidden = true;
document.body.append(notice);
let noticeTimer: ReturnType<typeof setTimeout>;
function say(text: string) {
  notice.textContent = text;
  notice.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (notice.hidden = true), 8000);
}
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
let ws: WebSocket | null = null,
  world: World | null = null,
  myId = "",
  myToken = "",
  lastUI = "",
  bytes = 0,
  latency = 0,
  bandwidth = 0,
  lastBytes = 0,
  lastMeasure = performance.now();
let renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  clock = new THREE.Clock(),
  running = false,
  yaw = 0,
  pitch = 0,
  pos = new THREE.Vector3(-2, 1.65, 8),
  velocityY = 0;
const gates: THREE.Mesh[] = [];
const entities = new Map<string, THREE.Group>(),
  keys = new Set<string>();
let recoil = 0;
let overlay = false,
  weapon = "pistol",
  nearest = "",
  frame = 0,
  frameMs = 0,
  sendTime = 0;
const prefs = JSON.parse(localStorage.getItem("afterlight-settings") || "{}");
prefs.sensitivity ??= 0.002;
prefs.scale ??= 0.75;
prefs.quality ??= "medium";
prefs.volume ??= 0.5;
prefs.music ??= 0.2;
prefs.effects ??= 0.5;
prefs.color ??= "#a54968";
prefs.preset ??= 0;
prefs.skin ??= "#b98d86";
prefs.hair ??= "#232335";
prefs.trousers ??= "#25283c";
prefs.hairstyle ??= 0;
prefs.accessory ??= 0;
prefs.textSize ??= 16;
prefs.voiceVolume ??= 1;
prefs.openMic ??= false;
prefs.quick ??= ["pistol", "shotgun", "melee", "medkit"];
prefs.bindings ??= {
  moveForward: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  sprint: "ShiftLeft",
  crouch: "ControlLeft",
  jump: "Space",
  interact: "KeyE",
  inventory: "KeyI",
  journal: "KeyJ",
  reload: "KeyR",
  revive: "KeyV",
  flashlight: "KeyF",
  talk: "KeyT",
};
document.documentElement.style.fontSize = prefs.textSize + "px";
function cosmeticData() {
  return {
    preset: prefs.preset,
    skin: prefs.skin,
    hair: prefs.hair,
    trousers: prefs.trousers,
    hairstyle: prefs.hairstyle,
    accessory: prefs.accessory,
  };
}
let ambienceGain: GainNode | undefined;
let ambienceNodes: OscillatorNode[] = [];
let audio: AudioContext | undefined;
function ambience() {
  audio ??= new AudioContext();
  if (ambienceNodes.length) return;
  ambienceGain = audio.createGain();
  ambienceGain.gain.value = prefs.volume * prefs.music * 0.035;
  ambienceGain.connect(audio.destination);
  for (const f of [55, 82.7, 110.3]) {
    const o = audio.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    o.connect(ambienceGain);
    o.start();
    ambienceNodes.push(o);
  }
}
function stopAmbience() {
  ambienceNodes.forEach((o) => o.stop());
  ambienceNodes = [];
  ambienceGain?.disconnect();
}
function tone(freq: number, duration = 0.15) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.type = "triangle";
    o.frequency.value = freq;
    g.gain.value = prefs.volume * prefs.effects * 0.15;
    o.connect(g);
    g.connect(audio.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);
    o.stop(audio.currentTime + duration);
  } catch {}
}
const send = (v: unknown) => {
  if (ws?.readyState === 1) ws.send(JSON.stringify(v));
};
function connect(action: unknown) {
  if (ws && ws.readyState < 2) {
    ws.onclose = null;
    ws.close();
  }
  ws = new WebSocket(
    import.meta.env.VITE_SERVER_URL ||
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:3001`,
  );
  ws.onopen = () => send(action);
  ws.onmessage = (e) => {
    bytes += e.data.length;
    const m = JSON.parse(e.data);
    if (m.type === "joined") {
      if (document.querySelector("#overlay[data-reconnect]")) {
        document.getElementById("overlay")?.remove();
        overlay = false;
      }
      myId = m.id;
      myToken = m.token;
      sessionStorage.setItem("afterlight-session", JSON.stringify(m));
      send({ type: "cosmetic", value: prefs.color, data: cosmeticData() });
      if (voiceWanted) void enableVoice();
    }
    if (m.type === "state") {
      world = m.world;
      const freq = document.getElementById("frequencyOutput");
      if (freq)
        freq.textContent = `Output ${world!.frequency} MHz / coarse band ${100 + world!.band * 25} MHz`;
      const inv = document.querySelector<HTMLElement>(
        "#overlay[data-inventory]",
      );
      if (
        inv &&
        inv.dataset.inventory !==
          JSON.stringify(world!.players.find((p) => p.id === myId)?.inventory)
      )
        inventory();
      if (world!.phase === "playing" && !running) startGame();
      if (world!.phase === "lobby") lobby();
      if (world!.phase === "ended") endingScreen();
    }
    if (m.type === "latency") latency = performance.now() - Number(m.value);
    if (m.type === "error" || m.type === "notice" || m.type === "clue") {
      say(m.text);
      if (
        m.type === "error" &&
        /Reconnect credential invalid or expired/i.test(m.text)
      ) {
        leaveRoom();
        say(
          "Reconnect window expired. Resume your saved checkpoint with its private credential.",
        );
      }
      if (m.type === "notice" && m.text.startsWith("System restored")) {
        document.getElementById("overlay")?.remove();
        overlay = false;
        keys.clear();
      }
    }
    if (m.type === "chat") {
      chatHistory.push(
        `${new Date(m.time).toLocaleTimeString()} ${m.name}: ${m.text}`,
      );
      if (chatHistory.length > 60) chatHistory.shift();
      say(`${m.name}: ${m.text}`);
      updateChat();
    }
    if (m.type === "effect") {
      if (m.id === myId) recoil = 0.08;
      tone(m.weapon === "shotgun" ? 55 : m.weapon === "melee" ? 180 : 90, 0.08);
    }
    if (m.type === "signal") void signal(m.data);
    if (m.type === "saved") {
      localStorage.setItem("afterlight-resume", JSON.stringify(m));
      say(
        `Checkpoint saved. Resume code ${m.code}. Secret stored locally; copy it from Journal for your teammate.`,
      );
    }
  };
  ws.onclose = () => {
    teardownVoice();
    if (world && myToken) {
      showOverlay(
        "<h2>Signal lost</h2><p>Reconnecting automatically. Your seat is reserved for 120 seconds. If the window expires, resume a saved checkpoint from the menu.</p>",
      );
      document.getElementById("overlay")!.dataset.reconnect = "true";
    }
    if (myToken)
      setTimeout(() => {
        if (myToken)
          connect({ type: "reconnect", code: world?.code, token: myToken });
      }, 1500);
  };
  ws.onerror = () =>
    say("Cannot reach game server. Check server URL and network.");
}
function title() {
  app.innerHTML = `<main class="screen"><section class="panel"><div class="tag">COOPERATIVE HORROR / TWO OPERATORS</div><h1>DEAD SIGNAL<br><span class="accent">AFTERLIGHT</span></h1><p>The dead learned to broadcast.<br>Bring someone who will answer.</p><div class="grid"><div class="card"><h2>Establish a connection</h2><input id="name" maxlength="24" placeholder="Operator nickname" value="Operator"><div class="row"><button id="create">Create room</button></div><div class="row"><input id="code" maxlength="8" placeholder="Room code" value="${esc(new URLSearchParams(location.search).get("room") || "")}"><button id="join">Join</button></div><p class="small">Desktop · keyboard + mouse · headphones recommended<br>Voice is optional. All puzzles have written clues.</p></div><div class="card"><h2>Return to a checkpoint</h2><input id="resumeCode" placeholder="Resume code"><input id="resumeSecret" placeholder="Secret credential" type="password"><div class="row"><button id="resume">Resume mission</button><button id="settings">Settings</button><button id="credits">Credits &amp; licenses</button></div><p class="small">Original procedural art and sound. No external art or audio downloads.<br>© DEAD SIGNAL contributors · MIT source license</p></div></div></section></main>`;
  const val = (id: string) =>
    (document.getElementById(id) as HTMLInputElement).value;
  document.getElementById("create")!.onclick = () =>
    connect({ type: "create", name: val("name") });
  document.getElementById("join")!.onclick = () =>
    connect({ type: "join", name: val("name"), code: val("code") });
  document.getElementById("resume")!.onclick = () =>
    connect({
      type: "resume",
      code: val("resumeCode"),
      token: val("resumeSecret"),
    });
  document.getElementById("settings")!.onclick = settings;
  document.getElementById("credits")!.onclick = () =>
    showOverlay(
      `<h2>Credits</h2><p>Original procedural art, models and synthesized sound: DEAD SIGNAL contributors. Source and original artwork: MIT license.</p><details><summary>Third-party legal notices</summary><pre style="white-space:pre-wrap">${esc(notices)}</pre></details>`,
    );
  const saved = JSON.parse(localStorage.getItem("afterlight-resume") || "null");
  if (saved) {
    (document.getElementById("resumeCode") as HTMLInputElement).value =
      saved.code;
    (document.getElementById("resumeSecret") as HTMLInputElement).value =
      saved.secret;
  }
}
function lobby() {
  if (!world) return;
  const signature =
    JSON.stringify(
      world.players.map((p) => [
        p.id,
        p.ready,
        p.connected,
        p.outfit,
        p.preset,
        p.skin,
        p.hair,
        p.trousers,
        p.hairstyle,
        p.accessory,
      ]),
    ) +
    world.map +
    world.leader;
  if (lastUI === signature) return;
  lastUI = signature;
  app.innerHTML = `<main class="screen"><div class="panel"><div class="tag">SECURE CHANNEL ${esc(world.code)}</div><h1 style="font-size:64px">Two voices.<br>One way out.</h1><div class="grid"><div class="card"><h2>Operators</h2>${world.players.map((p) => `<p style="border-left:8px solid ${esc(p.outfit)};padding-left:12px">${esc(p.name)} · ${["Archivist", "Medic", "Engineer", "Scout"][p.preset]}<br><small>${p.connected ? "Connected" : "Reconnecting"} / ${p.ready ? "Ready" : "Preparing"} ${p.id === world!.leader ? "· Leader" : ""}</small></p>`).join("")}<div class="row"><button id="ready">Toggle ready</button><button id="copyCode">Copy code</button><button id="copy">Copy invite</button></div><label>Preset <select id="preset">${["Archivist", "Medic", "Engineer", "Scout"].map((n, i) => `<option value="${i}" ${i === prefs.preset ? "selected" : ""}>${n}</option>`).join("")}</select></label><label> Jacket <input id="color" type="color" value="${prefs.color}"></label><div class="row">${["skin", "hair", "trousers"].map((k) => `<label>${k} <input id="${k}" type="color" value="${prefs[k]}"></label>`).join("")}<label>Hair <select id="hairstyle"><option value="0">Cropped</option><option value="1">Swept</option><option value="2">Long</option></select></label><label>Accessory <select id="accessory"><option value="0">Radio pack</option><option value="1">Headset</option><option value="2">Scarf</option></select></label></div><canvas id="preview" style="width:240px;height:240px"></canvas></div><div class="card"><h2>Choose the signal</h2><select id="map" ${world.leader !== myId ? "disabled" : ""}>${Object.entries(
    maps,
  )
    .map(
      ([id, m]) =>
        `<option value="${id}" ${world!.map === id ? "selected" : ""}>${m.name}</option>`,
    )
    .join(
      "",
    )}</select><p>${maps[world.map].story}</p><p class="small">Five paired systems. Communicate the reference sequence to the operator across the room. Collect evidence and choose your final intervention together.</p><button id="start" ${world.leader !== myId ? "disabled" : ""}>Enter the facility</button></div></div></div></main>`;
  document.getElementById("ready")!.onclick = () =>
    send({
      type: "ready",
      value: !world!.players.find((p) => p.id === myId)?.ready,
    });
  document.getElementById("copyCode")!.onclick = () =>
    void navigator.clipboard
      .writeText(world!.code)
      .then(() => say("Room code copied"))
      .catch(() => say(world!.code));
  document.getElementById("copy")!.onclick = () =>
    void navigator.clipboard
      .writeText(`${location.origin}/?room=${world!.code}`)
      .then(() => say("Invitation copied"))
      .catch(() => say(world!.code));
  document.getElementById("map")!.onchange = (e) =>
    send({ type: "map", value: (e.target as HTMLSelectElement).value });
  document.getElementById("start")!.onclick = () => send({ type: "start" });
  for (const key of ["hairstyle", "accessory"])
    (document.getElementById(key) as HTMLSelectElement).value = String(
      prefs[key],
    );
  preview();
  for (const id of [
    "color",
    "preset",
    "skin",
    "hair",
    "trousers",
    "hairstyle",
    "accessory",
  ])
    document.getElementById(id)!.onchange = () => {
      prefs.color = (
        document.getElementById("color") as HTMLInputElement
      ).value;
      prefs.preset = Number(
        (document.getElementById("preset") as HTMLSelectElement).value,
      );
      for (const k of ["skin", "hair", "trousers"])
        prefs[k] = (document.getElementById(k) as HTMLInputElement).value;
      for (const k of ["hairstyle", "accessory"])
        prefs[k] = Number(
          (document.getElementById(k) as HTMLSelectElement).value,
        );
      persist();
      send({ type: "cosmetic", value: prefs.color, data: cosmeticData() });
    };
}
function mesh(
  w: number,
  h: number,
  d: number,
  color: number | string,
  x: number,
  y: number,
  z: number,
) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshToonMaterial({ color }),
  );
  m.position.set(x, y, z);
  scene.add(m);
  return m;
}
function label(
  text: string,
  x: number,
  y: number,
  z: number,
  color = "#b7ef56",
) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#111524";
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = color;
  ctx.font = "bold 28px monospace";
  ctx.textAlign = "center";
  ctx.fillText(text, 256, 75);
  const texture = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 1),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
  );
  m.position.set(x, y, z);
  scene.add(m);
}
function character(color: string, preset = 0, appearance?: Partial<Player>) {
  const g = new THREE.Group();
  const material = new THREE.MeshToonMaterial({ color });
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.65, 4, 8),
    material,
  );
  body.position.y = 1;
  body.scale.x = [0.85, 1, 1.15, 0.9][preset];
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.25, 1),
    new THREE.MeshToonMaterial({ color: appearance?.skin || "#b98d86" }),
  );
  head.position.y = 1.65;
  g.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6),
    new THREE.MeshToonMaterial({ color: appearance?.hair || "#232335" }),
  );
  hair.position.y = 1.68;
  hair.scale.z = appearance?.hairstyle === 2 ? 1.3 : 1;
  if (appearance?.hairstyle === 1) {
    hair.rotation.z = -0.3;
    hair.position.x = 0.08;
  }
  g.add(hair);
  for (const x of [-0.4, 0.4]) {
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.65, 0.2),
      material,
    );
    arm.position.set(x, 0.98, 0);
    arm.name = "arm";
    g.add(arm);
  }
  if (appearance?.accessory === 1) {
    const headset = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.04, 4, 12),
      new THREE.MeshToonMaterial({ color: 0xb7ef56 }),
    );
    headset.position.y = 1.67;
    g.add(headset);
  }
  if (appearance?.accessory === 2) {
    const scarf = new THREE.Mesh(
      new THREE.TorusGeometry(0.24, 0.1, 4, 8),
      new THREE.MeshToonMaterial({ color: 0xcc405d }),
    );
    scarf.rotation.x = Math.PI / 2;
    scarf.position.y = 1.4;
    g.add(scarf);
  }
  for (const x of [-0.17, 0.17]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.65, 0.23),
      new THREE.MeshToonMaterial({ color: appearance?.trousers || "#25283c" }),
    );
    leg.name = x < 0 ? "legLeft" : "legRight";
    leg.position.set(x, 0.35, 0);
    g.add(leg);
  }
  const pack = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.6, 0.25),
    new THREE.MeshToonMaterial({ color: preset % 2 ? 0xe5d8aa : 0x505268 }),
  );
  pack.position.set(0, 1, 0.3);
  g.add(pack);
  if (preset === 1) {
    const pouch = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.2, 0.15),
      new THREE.MeshToonMaterial({ color: 0xe4dbcb }),
    );
    pouch.position.set(-0.32, 0.7, -0.1);
    g.add(pouch);
  }
  if (preset === 2) {
    const hat = new THREE.Mesh(
      new THREE.SphereGeometry(0.29, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshToonMaterial({ color: 0xc1b254 }),
    );
    hat.position.y = 1.85;
    g.add(hat);
  }
  if (preset === 3) {
    const hood = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.35, 8),
      new THREE.MeshToonMaterial({ color }),
    );
    hood.position.set(0, 1.8, 0.1);
    g.add(hood);
  }
  return g;
}
let previewRenderer: THREE.WebGLRenderer | undefined;
function preview() {
  previewRenderer?.dispose();
  const canvas = document.getElementById("preview") as HTMLCanvasElement;
  if (!canvas) return;
  try {
    previewRenderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    previewRenderer.setSize(240, 240, false);
    const s = new THREE.Scene();
    s.add(new THREE.HemisphereLight(0xddd9ff, 0x30354b, 3));
    const g = character(prefs.color, prefs.preset, cosmeticData());
    g.rotation.y = -0.5;
    s.add(g);
    const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    c.position.set(0, 1.2, 3.4);
    c.lookAt(0, 1, 0);
    previewRenderer.render(s, c);
    s.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  } catch {}
}
function startGame() {
  entities.clear();
  gates.length = 0;
  previewRenderer?.dispose();
  running = true;
  lastUI = "";
  app.innerHTML =
    '<div id="hud"><div class="top"></div><div id="cross">+</div><div id="prompt"></div><div class="bottom"></div><div id="perf"></div></div>';
  try {
    renderer = new THREE.WebGLRenderer({ antialias: prefs.quality !== "low" });
  } catch {
    app.innerHTML =
      '<section class="panel"><h1>Graphics unavailable</h1><p>WebGL2 could not start. Use an up-to-date desktop browser with graphics acceleration enabled, then reload.</p></section>';
    running = false;
    return;
  }
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * prefs.scale);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.prepend(renderer.domElement);
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080b18);
  scene.fog = new THREE.FogExp2(0x111325, 0.035);
  camera = new THREE.PerspectiveCamera(
    75,
    innerWidth / innerHeight,
    0.1,
    prefs.quality === "low" ? 45 : 70,
  );
  scene.add(new THREE.HemisphereLight(0x9b8bd0, 0x151228, 2.3));
  const light = new THREE.DirectionalLight(0x7ddde4, 2);
  light.position.set(3, 9, 4);
  scene.add(light);
  const floor = mesh(47, 0.25, 84, 0xffffff, 0, -0.2, -30);
  (floor.material as THREE.MeshToonMaterial).map = surface(
    world!.map === "vesper" ? "#33304a" : "#2c4148",
    "floor",
  );
  const wallTexture = surface(
    world!.map === "vesper" ? "#625571" : "#49616c",
    "wall",
  );
  mapWalls(world!.map).forEach((w) => {
    const wall = mesh(w.w, 3.6, w.d, 0xffffff, w.x, 1.8, w.z);
    (wall.material as THREE.MeshToonMaterial).map = wallTexture;
  });
  decorate(scene, world!.map);
  batchScenery(scene);
  for (let i = 0; i < 5; i++) {
    const gate = mesh(7, 3.5, 0.2, 0x6b2948, 0, 1.7, -6 - i * 14);
    gates.push(gate);
    label("LOCK " + (i + 1), 0, 2, -5.8 - i * 14);
  }
  for (const z of [0, -28, -56])
    for (const x of [-18, 18])
      label(
        world!.map === "vesper"
          ? z === 0
            ? "RECORDS / SAFE"
            : z === -28
              ? "COURTYARD"
              : "SERVICE ROUTE"
          : z === 0
            ? "VILLAGE / SAFE"
            : z === -28
              ? "FOREST PATH"
              : "CABLE TUNNELS",
        x,
        2.7,
        z - 5,
      );
  for (let i = 0; i < 6; i++) {
    label(maps[world!.map].zones[i], 0, 2.8, 10 - i * 14);
    for (const x of [-10, 10]) {
      mesh(0.15, 2, 0.15, 0x58dbcf, x, 1.8, 5 - i * 14);
      for (let j = 0; j < 3; j++) {
        mesh(
          0.8,
          0.7,
          0.7,
          world!.map === "vesper" ? 0x716075 : 0x4c655f,
          x,
          0.35,
          2 - i * 14 - j * 2,
        );
      }
    }
  }
  stations.forEach((st, i) => {
    mesh(1.5, 1.1, 0.8, i % 2 ? 0x893a5e : 0x387681, st.x, 0.55, st.z);
    mesh(1.1, 0.5, 0.1, 0xb7ef56, st.x, 1.25, st.z + 0.45);
    label(st.name, st.x, 2.3, st.z - 0.5);
  });
  const survivor = character("#c1bda7", 1);
  survivor.name = "survivor";
  survivor.position.set(18, 0, -26);
  survivor.scale.y = 0.6;
  scene.add(survivor);
  label("THE SOURCE IS LISTENING", 0, 3, -69, "#ff5075");
  const hand = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.2, 0.55),
    new THREE.MeshToonMaterial({ color: 0x44475e }),
  );
  hand.name = "weapon";
  hand.position.set(0.28, -0.2, -0.65);
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.22, 0.12),
    new THREE.MeshToonMaterial({ color: 0x23273a }),
  );
  grip.position.set(0, -0.13, 0.13);
  hand.add(grip);
  const fingers = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.13, 0.15),
    new THREE.MeshToonMaterial({ color: prefs.skin }),
  );
  fingers.position.set(0.02, -0.12, 0.1);
  hand.add(fingers);
  camera.add(hand);
  const flashlight = new THREE.SpotLight(0xc9e4ff, 14, 24, 0.55, 0.6, 1);
  flashlight.name = "flashlight";
  flashlight.position.set(0.2, -0.1, 0);
  const target = new THREE.Object3D();
  target.position.set(0, 0, -10);
  camera.add(target);
  flashlight.target = target;
  camera.add(flashlight);
  scene.add(camera);
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    running = false;
    say("Graphics context lost. Reload and reconnect to recover.");
  });
  renderer.domElement.onclick = () => {
    ambience();
    void audio?.resume();
    if (!overlay) void renderer.domElement.requestPointerLock();
  };
  const operator = world!.players.find((p) => p.id === myId);
  pos.set(operator?.x ?? -2, 1.65, operator?.z ?? 8);
  yaw = operator?.yaw ?? 0;
  pitch = 0;
  applyQuality();
  clock.start();
  animate();
}
function updateEntity(
  id: string,
  x: number,
  z: number,
  color: string,
  kind = 0,
  down = false,
  appearance?: Player,
) {
  let g = entities.get(id);
  if (!g) {
    g = character(color, kind, appearance);
    entities.set(id, g);
    scene.add(g);
  }
  const movement = Math.hypot(x - g.position.x, z - g.position.z);
  g.children
    .filter((c) => c.name.startsWith("leg"))
    .forEach(
      (leg, i) =>
        (leg.rotation.x =
          movement > 0.05
            ? Math.sin(performance.now() / 120 + i * Math.PI) * 0.4
            : 0),
    );
  if (appearance) {
    g.rotation.y +=
      Math.atan2(
        Math.sin(appearance.yaw - g.rotation.y),
        Math.cos(appearance.yaw - g.rotation.y),
      ) * 0.25;
    g.children
      .filter((c) => c.name === "arm")
      .forEach(
        (arm) => (arm.rotation.x = world?.held[appearance.id] ? -0.6 : 0),
      );
  }
  g.position.x += (x - g.position.x) * 0.25;
  g.position.z += (z - g.position.z) * 0.25;
  g.rotation.z = down ? Math.PI / 2 : 0;
  g.scale.y = down ? 0.35 : appearance?.crouch ? 0.65 : 1;
}
function animate() {
  if (!running) return;
  requestAnimationFrame(animate);
  const rawDelta = clock.getDelta();
  const dt = Math.min(rawDelta, 0.05);
  if (performance.now() - lastMeasure > 2000) {
    const now = performance.now();
    bandwidth = (bytes - lastBytes) / (now - lastMeasure);
    lastBytes = bytes;
    lastMeasure = now;
    send({ type: "probe", value: now });
  }
  frameMs = frameMs * 0.95 + rawDelta * 1000 * 0.05;
  const p = world?.players.find((p) => p.id === myId);
  if (!world || !p) return;
  gates.forEach((g, i) => (g.visible = world!.stage <= i));
  const survivor = scene.getObjectByName("survivor");
  if (survivor) survivor.visible = !world.survivor;
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked && !overlay && !p.down) {
    let dx = Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
      dz = Number(keys.has("KeyS")) - Number(keys.has("KeyW"));
    const len = Math.hypot(dx, dz) || 1;
    const speed =
      keys.has("ShiftLeft") && p.stamina > 0
        ? 5
        : keys.has("ControlLeft")
          ? 1.8
          : 3;
    dx = (dx / len) * speed * dt;
    dz = (dz / len) * speed * dt;
    const nx = pos.x + dx * Math.cos(yaw) + dz * Math.sin(yaw),
      nz = pos.z - dx * Math.sin(yaw) + dz * Math.cos(yaw);
    if (validPosition(nx, pos.z, world.stage, world.map)) pos.x = nx;
    if (validPosition(pos.x, nz, world.stage, world.map)) pos.z = nz;
    if (keys.has("Space") && pos.y <= 1.65) velocityY = 4;
    velocityY -= 12 * dt;
    pos.y = Math.max(1.65, pos.y + velocityY * dt);
    if (performance.now() - sendTime > 50) {
      sendTime = performance.now();
      send({
        type: "move",
        x: pos.x,
        z: pos.z,
        yaw,
        value: keys.has("ShiftLeft") ? "sprint" : keys.has("ControlLeft"),
        data: p.flash,
      });
    }
  }
  if (Math.hypot(pos.x - p.x, pos.z - p.z) > 2) {
    pos.x = p.x;
    pos.z = p.z;
  }
  (camera.getObjectByName("flashlight") as THREE.SpotLight).visible = p.flash;
  camera.position.copy(pos);
  camera.position.y = keys.has("ControlLeft") ? pos.y - 0.5 : pos.y;
  camera.rotation.order = "YXZ";
  camera.rotation.set(pitch, yaw, 0);
  const gun = camera.getObjectByName("weapon")!;
  recoil = Math.max(0, recoil - dt * 0.45);
  gun.position.z = -0.65 + recoil;
  gun.scale.z = p.weapon === "shotgun" ? 1.7 : p.weapon === "melee" ? 0.5 : 1;
  gun.rotation.x = p.weapon === "melee" ? -recoil * 8 : 0;
  world.players
    .filter((q) => q.id !== myId)
    .forEach((q) =>
      updateEntity(q.id, q.x, q.z, q.outfit, q.preset, q.down, q),
    );
  world.enemies.forEach((e) => {
    updateEntity(
      e.id,
      e.x,
      e.z,
      e.kind === "Watcher"
        ? "#b7ef56"
        : e.kind === "Listener"
          ? "#7d89b5"
          : "#9a315b",
    );
    entities.get(e.id)!.visible = e.hp > 0;
    entities.get(e.id)!.scale.set(1, 1.25, 1);
  });
  world.items.forEach((item) => {
    let g = entities.get(item.id);
    if (!g) {
      g = new THREE.Group();
      g.add(
        new THREE.Mesh(
          new THREE.OctahedronGeometry(0.23),
          new THREE.MeshToonMaterial({
            color: item.kind === "evidence" ? 0x55e4df : 0xe5d29a,
          }),
        ),
      );
      scene.add(g);
      entities.set(item.id, g);
    }
    g.position.set(
      item.x,
      0.55 + Math.sin(performance.now() / 500) * 0.05,
      item.z,
    );
    g.rotation.y += dt;
  });
  for (const [id, g] of entities)
    if (
      !world.items.some((i) => i.id === id) &&
      !world.players.some((p) => p.id === id) &&
      !world.enemies.some((e) => e.id === id)
    ) {
      scene.remove(g);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      entities.delete(id);
    }
  nearest = "";
  let distance = 2.6;
  for (const [i, st] of stations.entries()) {
    const d = Math.hypot(pos.x - st.x, pos.z - st.z);
    if (d < distance) {
      distance = d;
      nearest = String(i);
    }
  }
  for (const item of world.items) {
    const d = Math.hypot(pos.x - item.x, pos.z - item.z);
    if (d <= distance) {
      distance = d;
      nearest = item.id;
    }
  }
  document.querySelector("#prompt")!.textContent = nearest
    ? `E · ${stations[Number(nearest)]?.name || world.items.find((i) => i.id === nearest)?.kind}`
    : "Click to focus · ESC opens the field menu";
  document.querySelector("#hud .top")!.textContent =
    `${maps[world.map].name} / SYSTEM ${Math.min(world.stage + 1, 5)} OF 5 · ${["Decode the patient signal", "Route generator power", "Align the carrier", "Sequence the archive", "Bridge the isolation lock", "Choose the final intervention"][world.stage]}`;
  document.querySelector("#hud .bottom")!.textContent =
    `${p.down ? "DOWNED — teammate: approach and press V" : `HEALTH ${p.hp} · ${p.weapon.toUpperCase()} ${Date.now() < p.reloadUntil ? "RELOADING" : p.ammo}`} | STAMINA ${Math.round(p.stamina)} · LIGHT ${Math.round(p.battery)}% | EVIDENCE ${world.evidence}/3 | ${world.players.find((q) => q.id !== myId)?.name}: ${world.players.find((q) => q.id !== myId)?.hp} HP ${world.players.find((q) => q.id !== myId)?.speaking ? " / RADIO TRANSMITTING" : ""}`;
  if (++frame % 20 === 0)
    document.querySelector("#perf")!.textContent =
      `${frameMs.toFixed(1)} ms · ${renderer.info.render.calls} calls · ${renderer.info.render.triangles} triangles · ${latency.toFixed(0)} ms RTT · ${bandwidth.toFixed(1)} KB/s`;
  renderer.render(scene, camera);
}
function showOverlay(html: string) {
  overlay = true;
  document.exitPointerLock();
  document.getElementById("overlay")?.remove();
  const d = document.createElement("div");
  d.id = "overlay";
  d.innerHTML = `${html}<div class="row"><button id="closeOverlay">Return</button></div>`;
  document.body.append(d);
  document.getElementById("closeOverlay")!.onclick = () => {
    d.remove();
    overlay = false;
    keys.clear();
  };
}
function interact() {
  if (!nearest) return;
  if (world!.items.some((i) => i.id === nearest)) {
    send({ type: "pickup", id: nearest });
    tone(620);
    return;
  }
  const n = Number(nearest);
  if (n === 11 || n === 12 || n === 13) {
    send({ type: "interact", id: nearest });
    return;
  }
  if (n === 10) {
    showOverlay(
      `<h2>Final intervention</h2><p>Both operators must explicitly agree. Sacrifice confirms that you voluntarily remain behind.</p>${["stabilize", "release", "contain", "expose", "sacrifice", "escape"].map((v) => `<button data-choice="${v}">${v}</button>`).join(" ")}`,
    );
    document.querySelectorAll<HTMLButtonElement>("[data-choice]").forEach(
      (b) =>
        (b.onclick = () => {
          send({ type: "interact", id: "10", value: b.dataset.choice });
          say("Choice transmitted. Your partner must confirm.");
        }),
    );
    return;
  }
  if (n % 2 === 0) {
    send({ type: "interact", id: nearest });
    if (n === 4) {
      showOverlay(
        '<h2>Carrier transmitter</h2><p>Read the target frequency in your reference message. Set a coarse carrier band; your partner tunes the fine offset (0–24 MHz) at the receiver. Band + fine must equal the target.</p><select id="band"><option value="0">100 MHz</option><option value="1">125 MHz</option><option value="2">150 MHz</option><option value="3">175 MHz</option></select><button id="setBand">Set band</button>',
      );
      document.getElementById("setBand")!.onclick = () =>
        send({
          type: "interact",
          id: "4",
          value:
            "band:" +
            (document.getElementById("band") as HTMLSelectElement).value,
        });
    }
    return;
  }
  const stage = Math.floor(n / 2);
  if (stage === 1) {
    showOverlay(
      `<h2>Power routing</h2><p>Your partner sees the circuit indicators. Rotate A, B and C to the matching cardinal directions. Each rotation also rotates the next circuit: A changes B; B changes C. Communicate the indicators and work in order.</p>${["A", "B", "C"].map((name, i) => `<button data-circuit="${i}">${name}: ${["NORTH", "EAST", "SOUTH", "WEST"][world!.circuits[i]]}</button>`).join(" ")}<button id="checkRouting">Check routing</button>`,
    );
    document.getElementById("checkRouting")!.onclick = () =>
      send({ type: "interact", id: "3", value: "check" });
    document.querySelectorAll<HTMLButtonElement>("[data-circuit]").forEach(
      (b) =>
        (b.onclick = () => {
          send({
            type: "interact",
            id: nearest,
            value: "rotate:" + b.dataset.circuit,
          });
          setTimeout(interact, 100);
        }),
    );
    return;
  }
  if (stage === 2) {
    showOverlay(
      '<h2>Frequency alignment</h2><p>Ask your partner to set the coarse carrier band. Your fine offset (0–24 MHz) adds to their band. Coordinate until the output matches the reference target. Visual readout substitutes for audio cues.</p><input id="frequency" type="number" min="0" max="24" value="0"><button id="tune">Tune</button><p id="frequencyOutput">Output 100 MHz</p>',
    );
    document.getElementById("tune")!.onclick = () => {
      const value = (document.getElementById("frequency") as HTMLInputElement)
        .value;
      tone(100 + Number(value) * 5);
      send({ type: "interact", id: nearest, value });
    };
    return;
  }
  if (stage === 4) {
    send({ type: "interact", id: nearest, value: "latch" });
    say("Bridge latch engaged. Return route is open.");
    return;
  }
  showOverlay(
    `<h2>${stations[n].name}</h2><p>${stage === 0 ? "Legend: MOON = 1 · EYE = 2 · WAVE = 3 · THORN = 4" : "Records: Admission = 1 · Sedation = 2 · Broadcast = 3 · Evacuation = 4"}</p><p>Your partner reads the reference across this room. Enter the corresponding digits in order.</p><input id="sequence" maxlength="4" placeholder="Sequence"><button id="submit">Transmit</button>`,
  );
  document.getElementById("submit")!.onclick = () =>
    send({
      type: "interact",
      id: nearest,
      value: (document.getElementById("sequence") as HTMLInputElement).value,
    });
}
function inventory() {
  const p = world!.players.find((p) => p.id === myId)!;
  showOverlay(
    `<h2>Field kit · ${p.inventory.length}/8 slots</h2><div class="row">${["pistol", "shotgun", "melee"].map((w) => `<button data-weapon="${w}">${w}</button>`).join("")}</div><div class="row">${prefs.quick.map((value: string, i: number) => `<label>Slot ${i + 1} <select data-quick="${i}">${["pistol", "shotgun", "melee", "medkit", "battery", "flare"].map((k) => `<option ${k === value ? "selected" : ""}>${k}</option>`).join("")}</select></label>`).join("")}</div>${p.inventory.map((kind, i) => `<div class="row"><strong>${esc(kind)}</strong><span class="small">${itemDescriptions[kind] || "Field equipment"}</span>${(kind === "medkit" || kind === "battery" || kind === "flare" ? ["use", "give", "drop"] : ["give", "drop"]).map((a) => `<button data-action="${a}" data-item="${kind}">${a}</button>`).join("")}</div>`).join("")}<p>Quest section: fuse ${world!.quest.fuse ? "recovered" : "missing"} · keycard ${world!.quest.keycard ? "recovered" : "missing"}</p><p>Quest access is shared. Fuse and keycard pickups cannot be permanently discarded.</p>`,
  );
  document.querySelectorAll<HTMLSelectElement>("[data-quick]").forEach(
    (select) =>
      (select.onchange = () => {
        prefs.quick[Number(select.dataset.quick)] = select.value;
        persist();
      }),
  );
  document.getElementById("overlay")!.dataset.inventory = JSON.stringify(
    p.inventory,
  );
  document.querySelectorAll<HTMLButtonElement>("[data-weapon]").forEach(
    (b) =>
      (b.onclick = () => {
        weapon = b.dataset.weapon!;
        send({ type: "equip", value: weapon });
      }),
  );
  document
    .querySelectorAll<HTMLButtonElement>("[data-action]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          send({ type: b.dataset.action, value: b.dataset.item })),
    );
}
const chatHistory: string[] = [];
function updateChat() {
  const d = document.getElementById("chatlog");
  if (d) {
    d.textContent = chatHistory.join("\n");
    d.style.whiteSpace = "pre-wrap";
    d.scrollTop = d.scrollHeight;
  }
}
function chat() {
  showOverlay(
    '<h2>Radio text</h2><p id="voiceStatus">Voice status · microphone permission is optional</p><div id="chatlog"></div><div class="row"><button data-ping="Come here">Come here</button><button data-ping="Danger">Danger</button><button data-ping="Need help">Need help</button><button data-ping="Found item">Found item</button></div><form id="chatForm"><input id="chatText" maxlength="300" placeholder="Message your partner"><button>Send</button></form><div class="row"><button id="voice">Enable microphone</button><button id="mutePeer">Mute teammate</button><button id="muteSelf">Mute self</button><button id="openMic">Toggle open microphone</button><select id="micDevice" aria-label="Microphone device"><option value="">System default</option></select></div><p>Push-to-talk: hold T. Microphone permission is optional; text and written clues remain available.</p>',
  );
  updateChat();
  document.getElementById("voiceStatus")!.textContent =
    "Voice: " + (peer?.connectionState || "disabled");
  document
    .querySelectorAll<HTMLButtonElement>("[data-ping]")
    .forEach(
      (b) => (b.onclick = () => send({ type: "ping", value: b.dataset.ping })),
    );
  document.getElementById("muteSelf")!.textContent = prefs.selfMute
    ? "Unmute self"
    : "Mute self";
  document.getElementById("muteSelf")!.onclick = () => {
    prefs.selfMute = !prefs.selfMute;
    persist();
    stream
      ?.getAudioTracks()
      .forEach(
        (t) =>
          (t.enabled = !prefs.selfMute && (prefs.openMic || keys.has("KeyT"))),
      );
    document.getElementById("muteSelf")!.textContent = prefs.selfMute
      ? "Unmute self"
      : "Mute self";
    say(prefs.selfMute ? "Microphone muted" : "Microphone unmuted");
  };
  document.getElementById("chatForm")!.onsubmit = (e) => {
    e.preventDefault();
    const input = document.getElementById("chatText") as HTMLInputElement;
    send({ type: "chat", text: input.value });
    input.value = "";
  };
  document.getElementById("voice")!.onclick = () => void enableVoice();
  document.getElementById("openMic")!.onclick = () => {
    prefs.openMic = !prefs.openMic;
    persist();
    stream
      ?.getAudioTracks()
      .forEach((t) => (t.enabled = prefs.openMic && !prefs.selfMute));
    say(prefs.openMic ? "Open microphone enabled" : "Push-to-talk enabled");
  };
  void navigator.mediaDevices
    ?.enumerateDevices()
    .then((devices) => {
      const select = document.getElementById(
        "micDevice",
      ) as HTMLSelectElement | null;
      if (select)
        for (const d of devices.filter((d) => d.kind === "audioinput")) {
          const option = new Option(d.label || "Microphone", d.deviceId);
          select.add(option);
        }
      if (select)
        select.onchange = () => {
          prefs.device = select.value;
          persist();
        };
    })
    .catch(() => {});
  document.getElementById("mutePeer")!.onclick = () => {
    peerAudio.muted = !peerAudio.muted;
    say(peerAudio.muted ? "Teammate muted" : "Teammate audible");
  };
}
function journal() {
  const save = JSON.parse(localStorage.getItem("afterlight-resume") || "null");
  showOverlay(
    `<h2>Field journal</h2><p>${maps[world!.map].story}</p><p>Restored systems: ${world!.stage}/5 · Evidence recovered: ${world!.evidence} · Rescues: ${world!.rescues}</p><p>Discovered areas: ${world!.discovered.map((i) => maps[world!.map].zones[i]).join(" → ")}</p><svg viewBox="0 0 200 330" width="200" height="330" aria-label="Discovered facility map"><rect x="20" y="5" width="160" height="310" fill="#20243a"/>${world!.discovered.map((i) => `<rect x="65" y="${10 + i * 38}" width="70" height="34" fill="#3b6269"/><text x="70" y="${32 + i * 38}" fill="white" font-size="9">${maps[world!.map].zones[i]}</text>`).join("")}<circle cx="${100 + (world!.players.find((p) => p.id === myId)!.x / 23) * 75}" cy="${10 + (10 - world!.players.find((p) => p.id === myId)!.z) * 3.7}" r="4" fill="#b7ef56"/></svg><p>Containment: stabilize the source, then both choose contain.<br>Exposure: recover three evidence records, both choose expose.<br>Sacrifice: one voluntarily confirms sacrifice, the other confirms extraction.<br>Outbreak: release the source, then both escape.</p><button id="save">Save checkpoint</button>${save ? `<p>Resume code: ${esc(save.code)}<br>Secret credential: <code>${esc(save.secret)}</code><br>Share privately with your partner.</p>` : ""}`,
  );
  document.getElementById("save")!.onclick = () => send({ type: "save" });
}
function applyQuality() {
  if (!renderer || !scene) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * prefs.scale);
  camera.far =
    prefs.quality === "low" ? 45 : prefs.quality === "medium" ? 70 : 100;
  camera.updateProjectionMatrix();
  scene.traverse((o) => {
    if (o instanceof THREE.LineSegments || o instanceof THREE.PointLight)
      o.visible = prefs.quality !== "low";
  });
}
function persist() {
  localStorage.setItem("afterlight-settings", JSON.stringify(prefs));
}
function leaveRoom() {
  voiceWanted = false;
  teardownVoice();
  stopAmbience();
  myToken = "";
  sessionStorage.removeItem("afterlight-session");
  world = null;
  running = false;
  if (ws) {
    ws.onclose = null;
    ws.close();
  }
  renderer?.dispose();
  renderer?.domElement.remove();
  document.getElementById("overlay")?.remove();
  overlay = false;
  lastUI = "";
  title();
}
function settings() {
  showOverlay(
    `<h2>Field settings</h2>${world ? '<button id="leave">Leave room</button>' : ""}<p>The shared world continues while this menu is open.</p><p>Quality <select id="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></p><p>Mouse sensitivity <input id="sensitivity" type="range" min="0.0005" max="0.006" step="0.0001" value="${prefs.sensitivity}"></p><p>Render scale <input id="scale" type="range" min="0.5" max="1" step="0.1" value="${prefs.scale}"></p><p>Master volume <input id="volume" type="range" min="0" max="1" step="0.05" value="${prefs.volume}"></p><p>Music volume <input id="music" type="range" min="0" max="1" step="0.05" value="${prefs.music}"></p><p>Effects volume <input id="effects" type="range" min="0" max="1" step="0.05" value="${prefs.effects}"></p><p>Text size <input id="textSize" type="range" min="14" max="24" value="${prefs.textSize}"></p><p>Teammate volume <input id="voiceVolume" type="range" min="0" max="1" step="0.05" value="${prefs.voiceVolume}"></p><details><summary>Remap controls</summary>${Object.keys(
      prefs.bindings,
    )
      .map(
        (k) =>
          `<label style="display:block;margin:8px">${k} <input data-bind="${k}" value="${prefs.bindings[k]}" readonly aria-label="Remap ${k}"></label>`,
      )
      .join(
        "",
      )}</details><p>WASD move · Mouse look · Shift sprint · Ctrl crouch · Space jump<br>E interact · Click fire · R reload · 1/2/3 weapons · V revive<br>I inventory · J journal · Enter chat/voice · T push-to-talk · F flashlight<br>Reduced motion: no head bob, camera shake, blur or flashing effects.</p>`,
  );
  const quality = document.getElementById("quality") as HTMLSelectElement;
  quality.value = prefs.quality;
  quality.onchange = () => {
    prefs.quality = quality.value;
    prefs.scale =
      quality.value === "low" ? 0.5 : quality.value === "medium" ? 0.75 : 1;
    persist();
    applyQuality();
  };
  const leave = document.getElementById("leave");
  if (leave) leave.onclick = leaveRoom;
  document.querySelectorAll<HTMLInputElement>("[data-bind]").forEach(
    (input) =>
      (input.onkeydown = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") return;
        prefs.bindings[input.dataset.bind!] = e.code;
        input.value = e.code;
        persist();
      }),
  );
  for (const id of [
    "sensitivity",
    "scale",
    "volume",
    "music",
    "effects",
    "textSize",
    "voiceVolume",
  ])
    document.getElementById(id)!.oninput = (e) => {
      prefs[id] = Number((e.target as HTMLInputElement).value);
      persist();
      document.documentElement.style.fontSize = prefs.textSize + "px";
      peerAudio.volume = prefs.voiceVolume * prefs.volume;
      if (ambienceGain)
        ambienceGain.gain.value = prefs.volume * prefs.music * 0.035;
      if (renderer)
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * prefs.scale);
    };
}
function endingScreen() {
  if (lastUI === "ended") return;
  lastUI = "ended";
  running = false;
  document.exitPointerLock();
  scene?.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      materials.forEach((m) => m.dispose());
    }
  });
  renderer?.dispose();
  renderer?.domElement.remove();
  document.getElementById("overlay")?.remove();
  overlay = false;
  app.innerHTML = `<main class="screen"><div class="panel"><div class="tag">TRANSMISSION COMPLETE / ${maps[world!.map].name}</div><h1>${esc(world!.ending)}</h1><canvas id="endingArt" style="width:100%;height:280px" aria-label="Map-specific ending scene"></canvas><div class="card"><p>${({ Containment: "For the first time in years, the carrier falls silent. Two silhouettes emerge into morning.", Exposure: "You carry the proof into the daylight. Behind you, the broadcast continues.", Sacrifice: "One voice remains on the frequency. The other carries their name into the light.", Outbreak: "You escape. Across the horizon, every radio begins to answer." } as Record<string, string>)[world!.ending]}</p><p>Evidence ${world!.evidence} · Systems ${world!.stage}/5 · Rescues ${world!.rescues} · Survivor ${world!.survivor ? "rescued" : "left behind"}<br>Source ${world!.released ? "released" : world!.stabilized ? "stabilized" : "active"}</p><button id="returnTitle">Return to title</button></div></div></main>`;
  endingArt();
  document.getElementById("returnTitle")!.onclick = () => {
    sessionStorage.removeItem("afterlight-session");
    location.reload();
  };
  tone(110, 3);
}
function endingArt() {
  const canvas = document.getElementById("endingArt") as HTMLCanvasElement;
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setSize(canvas.clientWidth || 700, 280, false);
  const s = new THREE.Scene();
  const released = world!.ending === "Outbreak",
    sacrificed = world!.ending === "Sacrifice";
  s.background = new THREE.Color(released ? 0x361a32 : 0x121c30);
  s.add(new THREE.HemisphereLight(0xb7d9f0, 0x15111f, 3));
  const light = new THREE.PointLight(
    world!.ending === "Containment" ? 0x71eee0 : 0xf44470,
    8,
    12,
  );
  light.position.set(0, 3, 0);
  s.add(light);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshToonMaterial({
      color: world!.map === "vesper" ? 0x302b48 : 0x213e46,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  s.add(ground);
  world!.players.forEach((p, i) => {
    const g = character(p.outfit, p.preset, p);
    g.position.set(
      (i ? 1 : -1) * 2,
      0,
      sacrificed && world!.votes[p.id] === "sacrifice" ? -3 : 2,
    );
    g.rotation.y = Math.PI;
    s.add(g);
  });
  const source = new THREE.Mesh(
    world!.map === "vesper"
      ? new THREE.TorusKnotGeometry(1, 0.09, 50, 6)
      : new THREE.ConeGeometry(1, 6, 4, 1, true),
    new THREE.MeshToonMaterial({
      color: world!.ending === "Containment" ? 0x5aa49f : 0xbd3562,
    }),
  );
  source.position.set(0, world!.map === "vesper" ? 2 : 3, -3);
  s.add(source);
  const c = new THREE.PerspectiveCamera(
    45,
    (canvas.clientWidth || 700) / 280,
    0.1,
    60,
  );
  c.position.set(6, 3, 9);
  c.lookAt(0, 1.4, 0);
  let finished = false;
  const start = performance.now();
  function render() {
    if (!canvas.isConnected) {
      if (!finished) {
        finished = true;
        s.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.geometry.dispose();
            (o.material as THREE.Material).dispose();
          }
        });
        r.dispose();
      }
      return;
    }
    const time = Math.min(1, (performance.now() - start) / 6000);
    if (world!.ending === "Containment") light.intensity = 8 * (1 - time) + 1;
    source.rotation.y = 0.2 * time;
    r.render(s, c);
    requestAnimationFrame(render);
  }
  render();
}
let voiceWanted = false,
  voiceStarting = false;
let meter: ReturnType<typeof setInterval> | undefined;
let micSource: MediaStreamAudioSourceNode | undefined;
let pendingDescription: RTCSessionDescriptionInit | undefined;
const pendingCandidates: RTCIceCandidateInit[] = [];
let peer: RTCPeerConnection | undefined, stream: MediaStream | undefined;
const peerAudio = new Audio();
peerAudio.autoplay = true;
peerAudio.volume = prefs.voiceVolume * prefs.volume;
async function enableVoice() {
  if (voiceStarting) return;
  voiceStarting = true;
  voiceWanted = true;
  try {
    stream?.getTracks().forEach((t) => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({
      audio: prefs.device ? { deviceId: { exact: prefs.device } } : true,
    });
    stream
      .getAudioTracks()
      .forEach((t) => (t.enabled = !!prefs.openMic && !prefs.selfMute));
    clearInterval(meter);
    micSource?.disconnect();
    audio ??= new AudioContext();
    await audio.resume();
    micSource = audio.createMediaStreamSource(stream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 256;
    micSource.connect(analyser);
    const samples = new Uint8Array(256);
    let speaking = false;
    meter = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      const active =
        !!stream?.getAudioTracks().some((t) => t.enabled) &&
        samples.some((v) => Math.abs(v - 128) > 5);
      if (active !== speaking) {
        speaking = active;
        send({ type: "speaking", value: active });
      }
    }, 150);
    teardownPeer();
    const endpoint = (
      import.meta.env.VITE_SERVER_URL ||
      `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:3001`
    ).replace(/^ws/, "http");
    const response = await fetch(
      `${endpoint}/ice?token=${encodeURIComponent(myToken)}`,
    );
    if (!response.ok) throw new Error("ICE unavailable");
    const config = await response.json();
    peer = new RTCPeerConnection({ iceServers: config.iceServers });
    stream.getTracks().forEach((t) => peer!.addTrack(t, stream!));
    peer.onicecandidate = (e) => {
      if (e.candidate)
        send({ type: "signal", data: { candidate: e.candidate.toJSON() } });
    };
    peer.ontrack = (e) => {
      peerAudio.srcObject = e.streams[0];
      void peerAudio
        .play()
        .catch(() => say("Click the page to enable teammate audio"));
    };
    peer.onconnectionstatechange = () => {
      if (!peer) return;
      const status = document.getElementById("voiceStatus");
      if (status) status.textContent = "Voice: " + peer!.connectionState;
      say("Voice: " + peer!.connectionState);
    };
    if (pendingDescription) {
      await signal({ description: pendingDescription });
      pendingDescription = undefined;
    } else {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      send({ type: "signal", data: { description: offer } });
    }
    say("Microphone enabled. Hold T to transmit.");
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop());
    voiceWanted = false;
    clearInterval(meter);
    micSource?.disconnect();
    say("Microphone unavailable or denied. Use text chat.");
  } finally {
    voiceStarting = false;
  }
}
async function signal(data: any) {
  try {
    if (!peer) {
      if (data.description) pendingDescription = data.description;
      if (data.candidate) pendingCandidates.push(data.candidate);
      if (voiceWanted && !voiceStarting) void enableVoice();
      else if (data.description)
        say("Partner requested voice. Open chat and enable your microphone.");
      return;
    }
    if (data.description) {
      if (
        data.description.type === "offer" &&
        peer.signalingState !== "stable"
      ) {
        if (myId > world!.players.find((p) => p.id !== myId)!.id) return;
        await peer.setLocalDescription({ type: "rollback" });
      }
      await peer.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        send({ type: "signal", data: { description: answer } });
      }
    }
    if (data.candidate) {
      if (peer.remoteDescription) await peer.addIceCandidate(data.candidate);
      else pendingCandidates.push(data.candidate);
    }
    if (peer.remoteDescription)
      while (pendingCandidates.length)
        await peer.addIceCandidate(pendingCandidates.shift()!);
  } catch {
    say("Voice negotiation failed. Disable and re-enable microphone.");
  }
}
function teardownPeer() {
  peer?.close();
  peer = undefined;
}
function teardownVoice() {
  clearInterval(meter);
  micSource?.disconnect();
  pendingCandidates.length = 0;
  pendingDescription = undefined;
  stream?.getTracks().forEach((t) => t.stop());
  peer?.close();
  peer = undefined;
  stream = undefined;
  peerAudio.srcObject = null;
}
const defaults: Record<string, string> = {
  moveForward: "KeyW",
  moveBack: "KeyS",
  moveLeft: "KeyA",
  moveRight: "KeyD",
  sprint: "ShiftLeft",
  crouch: "ControlLeft",
  jump: "Space",
  interact: "KeyE",
  inventory: "KeyI",
  journal: "KeyJ",
  reload: "KeyR",
  revive: "KeyV",
  flashlight: "KeyF",
  talk: "KeyT",
};
function mapped(code: string) {
  return (
    defaults[
      Object.keys(prefs.bindings).find((k) => prefs.bindings[k] === code) || ""
    ] || code
  );
}
window.addEventListener("keydown", (e) => {
  const code = mapped(e.code);
  if (e.target instanceof HTMLInputElement) return;
  if (code === "KeyT")
    stream?.getAudioTracks().forEach((t) => (t.enabled = !prefs.selfMute));
  if (!running) return;
  if (["Space", "Tab"].includes(e.code)) e.preventDefault();
  keys.add(code);
  if (e.repeat) return;
  if (code === "Escape") settings();
  if (overlay) return;
  if (code === "KeyE") interact();
  if (code === "KeyI") inventory();
  if (code === "KeyJ") journal();
  if (code === "Enter") chat();
  if (code === "KeyR") send({ type: "reload" });
  if (code === "KeyV") send({ type: "interact", id: "revive" });
  if (code === "KeyF") {
    const p = world!.players.find((p) => p.id === myId)!;
    p.flash = !p.flash;
    say(p.flash ? "Light enabled — Watchers hesitate" : "Light disabled");
  }
  if (["Digit1", "Digit2", "Digit3", "Digit4"].includes(e.code)) {
    const item = prefs.quick[Number(e.code.slice(-1)) - 1];
    send({
      type: ["pistol", "shotgun", "melee"].includes(item) ? "equip" : "use",
      value: item,
    });
  }
});
window.addEventListener("keyup", (e) => {
  const code = mapped(e.code);
  keys.delete(mapped(e.code));
  if (code === "KeyT")
    stream
      ?.getAudioTracks()
      .forEach((t) => (t.enabled = !!prefs.openMic && !prefs.selfMute));
});
window.addEventListener("blur", () => {
  keys.clear();
  stream?.getAudioTracks().forEach((t) => (t.enabled = false));
});
window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement && !overlay) {
    yaw -= e.movementX * prefs.sensitivity;
    pitch = THREE.MathUtils.clamp(
      pitch - e.movementY * prefs.sensitivity,
      -1.4,
      1.4,
    );
  }
});
window.addEventListener("mousedown", (e) => {
  if (e.button === 0 && document.pointerLockElement && !overlay) {
    send({ type: "fire" });
    tone(80, 0.08);
  }
});
window.addEventListener("resize", () => {
  if (renderer) {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
});
window.addEventListener("beforeunload", teardownVoice);
title();

try {
  const previous = JSON.parse(
    sessionStorage.getItem("afterlight-session") || "null",
  );
  if (previous?.code && previous?.token)
    setTimeout(
      () =>
        connect({
          type: "reconnect",
          code: previous.code,
          token: previous.token,
        }),
      500,
    );
} catch {
  sessionStorage.removeItem("afterlight-session");
}
