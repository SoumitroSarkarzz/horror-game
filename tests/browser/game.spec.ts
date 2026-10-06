import { mkdir, writeFile } from "node:fs/promises";
import { createWorld, type Player } from "../../shared/world";
import { test, expect } from "@playwright/test";
test("two independent browser contexts join, customize, ready and render both maps", async ({
  browser,
}) => {
  for (const map of ["Saint Vesper Institute", "Blackwater Relay"]) {
    const a = await browser.newContext(),
      b = await browser.newContext();
    for (const context of [a, b])
      await context.addInitScript(() => {
        localStorage.setItem(
          "afterlight-settings",
          JSON.stringify({ quality: "low", scale: 0.5 }),
        );
        const Native = window.WebSocket;
        window.WebSocket = class extends Native {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);

            this.addEventListener("message", (e) => {
              const m = JSON.parse(e.data);
              if (m.type === "state") (window as any).__lastWorld = m.world;
            });
          }
        };
      });
    const pa = await a.newPage(),
      pb = await b.newPage();
    const errors: string[] = [];
    pa.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("Client error", e.message);
    });
    pb.on("pageerror", (e) => {
      errors.push(e.message);
      console.log("Client error", e.message);
    });
    await pa.goto("/");
    await pb.goto("/");
    await pa.locator("#name").fill("Alpha");
    await pa.locator("#create").click();
    await expect(pa.locator(".tag")).toContainText("SECURE CHANNEL");
    const code = (await pa.locator(".tag").textContent())!.split(" ").at(-1)!;
    await pb.locator("#name").fill("Beta");
    await pb.locator("#code").fill(code.toLowerCase());
    await pb.locator("#join").click();
    await expect(pa.locator(".card").first()).toContainText("Beta");
    await pb.locator("#preset").selectOption("2");
    await expect(pa.locator(".card").first()).toContainText("Engineer");
    await pa.locator("#map").selectOption({ label: map });
    await pa.locator("#ready").click();
    await pb.locator("#ready").click();
    await pa.locator("#start").click();
    await expect(pa.locator("canvas")).toBeVisible();
    await expect(pb.locator("canvas")).toBeVisible();
    await expect(pa.locator("#hud .top")).toContainText(map);
    await pa.locator("canvas").click({ position: { x: 300, y: 250 } });
    await expect
      .poll(() => pa.evaluate(() => !!document.pointerLockElement))
      .toBe(true);
    await pa.keyboard.down("d");
    try {
      await expect
        .poll(
          () =>
            pb.evaluate(
              () =>
                (window as any).__lastWorld.players.find(
                  (p: any) => p.name === "Alpha",
                ).x,
            ),
          { timeout: 15000 },
        )
        .toBeGreaterThan(-1.5);
    } finally {
      await pa.keyboard.up("d");
    }

    await pa.mouse.move(340, 250);
    await expect
      .poll(() =>
        pb.evaluate(
          () =>
            (window as any).__lastWorld.players.find(
              (p: any) => p.name === "Alpha",
            ).yaw,
        ),
      )
      .not.toBe(0);
    await pa.waitForTimeout(500);
    const measured = await pa.evaluate(async () => {
      const intervals: number[] = [];
      let last = performance.now();
      for (let i = 0; i < 60; i++)
        await new Promise<void>((resolve) =>
          requestAnimationFrame((now) => {
            intervals.push(now - last);
            last = now;
            resolve();
          }),
        );
      return {
        viewport: [innerWidth, innerHeight],
        meanRafMs: intervals.reduce((a, b) => a + b, 0) / intervals.length,
        maxRafMs: Math.max(...intervals),
        overlay: document.getElementById("perf")?.textContent,
      };
    });
    await writeFile(
      `/tmp/afterlight-metrics-${map.startsWith("Saint") ? "vesper" : "blackwater"}.json`,
      JSON.stringify(
        {
          environment:
            "Cloud Linux Chromium, SwiftShader software rendering, two independent contexts",
          map,
          ...measured,
        },
        null,
        2,
      ),
    );
    await pa.screenshot({
      path: `/tmp/afterlight-${map.startsWith("Saint") ? "vesper" : "blackwater"}.png`,
    });
    expect(errors).toEqual([]);
    await a.close();
    await b.close();
  }
});

test("two browsers operate all five cooperative systems and restore, transfer, revive and extract", async ({
  browser,
}) => {
  await mkdir("/tmp/afterlight-browser-saves", { recursive: true });
  let n = 100;
  const base = {
    name: "Operator",
    ready: true,
    connected: false,
    x: -8,
    z: 5,
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
  async function open(w: ReturnType<typeof createWorld>) {
    await writeFile(
      `/tmp/afterlight-browser-saves/${w.code}.json`,
      JSON.stringify({ secret: "browser-secret", world: w }),
    );
    const a = await browser.newContext(),
      b = await browser.newContext();
    for (const context of [a, b])
      await context.addInitScript(() =>
        localStorage.setItem(
          "afterlight-settings",
          JSON.stringify({ quality: "low", scale: 0.5 }),
        ),
      );
    const pa = await a.newPage(),
      pb = await b.newPage();
    for (const page of [pa, pb])
      page.on("pageerror", (e) => console.log("Early client error", e.message));
    for (const p of [pa, pb]) {
      await p.goto("/");
      await p.locator("#resumeCode").fill(w.code);
      await p.locator("#resumeSecret").fill("browser-secret");
      await p.locator("#resume").click();
      p.on("pageerror", (e) => console.log("Resume client error", e.message));
      try {
        await expect(p.locator("#hud")).toBeVisible({ timeout: 45000 });
      } catch (e) {
        console.log(
          "Resume screen",
          await p.evaluate(() => ({
            body: document.body.innerText,
            visible: document.visibilityState,
            hud: document
              .getElementById("hud")
              ?.getBoundingClientRect()
              .toJSON(),
            frame: document.getElementById("perf")?.textContent,
          })),
        );
        throw e;
      }
    }
    return { a, b, pa, pb };
  }
  for (let stage = 0; stage < 5; stage++) {
    const w = createWorld(
      (++n).toString(16).padStart(8, "0").toUpperCase(),
      n * 71,
    );
    w.phase = "playing";
    w.quest = { fuse: true, keycard: true };
    w.stage = stage;
    const z = [5, -8, -22, -36, -50][stage];
    w.players = [
      { ...base, id: w.code + "a", token: w.code + "a-secret", z },
      {
        ...base,
        id: w.code + "b",
        token: w.code + "b-secret",
        x: 8,
        z: stage === 4 ? -61 : z,
      },
    ] as Player[];
    const { a, b, pa, pb } = await open(w);
    await pa.keyboard.press("e");
    await expect(pa.locator("#notice")).toContainText(
      stage === 4
        ? "Bridge energized"
        : stage === 3
          ? "Archive timestamps"
          : stage === 2
            ? "Carrier target"
            : stage === 1
              ? "Circuit indicators"
              : "Glyphs",
    );
    await pb.keyboard.press("e");
    const sol = w.solutions[stage];
    if (stage === 0 || stage === 3) {
      await pb.locator("#sequence").fill(sol.map((x) => x + 1).join(""));
      await pb.locator("#submit").click();
    }
    if (stage === 1) {
      const current = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        const turns = (sol[i] - current[i] + 4) % 4;
        for (let j = 0; j < turns; j++) {
          await pb.locator(`[data-circuit="${i}"]`).click();
          current[i] = (current[i] + 1) % 4;
          if (i < 2) current[i + 1] = (current[i + 1] + 1) % 4;
          await pb.waitForTimeout(150);
        }
      }
      if (sol.every((n) => n === 0)) await pb.locator("#checkRouting").click();
    }
    if (stage === 2) {
      await pa.locator("#band").selectOption(String(sol[0]));
      await pa.locator("#setBand").click();
      await pb.locator("#frequency").fill(String(sol[1] * 5 + sol[2]));
      await pb.locator("#tune").click();
    }
    await expect(pa.locator("#hud .top")).toContainText(
      stage === 4 ? "Choose the final intervention" : `SYSTEM ${stage + 2}`,
    );
    await a.close();
    await b.close();
  }
  const w = createWorld((++n).toString(16).padStart(8, "0").toUpperCase(), 7);
  w.phase = "playing";
  w.stage = 5;
  w.stabilized = true;
  w.players = [
    { ...base, id: w.code + "a", token: w.code + "a-secret", x: 0, z: -65 },
    {
      ...base,
      id: w.code + "b",
      token: w.code + "b-secret",
      x: 1,
      z: -65,
      hp: 0,
      down: true,
    },
  ] as Player[];
  const { a, b, pa, pb } = await open(w);
  await expect(pb.locator("#hud .bottom")).toContainText("DOWNED");
  await pa.keyboard.press("v");
  await expect(pb.locator("#hud .bottom")).toContainText("HEALTH 40");
  await pa.keyboard.press("i");
  await pa.locator('[data-action="give"]').click();
  await pb.keyboard.press("i");
  await expect(pb.locator("#overlay")).toContainText("2/8 slots");
  await pa.locator("#closeOverlay").click();
  await pb.locator("#closeOverlay").click();
  await pa.keyboard.press("j");
  await pa.locator("#save").click();
  await expect(pa.locator("#notice")).toContainText("Checkpoint saved");
  await pa.locator("#closeOverlay").click();
  await pa.reload();
  await expect(pa.locator("#hud")).toBeVisible({ timeout: 45000 });
  await pa.keyboard.press("i");
  await expect(pa.locator("#overlay")).toContainText("0/8 slots");
  await pa.locator("#closeOverlay").click();
  for (const p of [pa, pb]) {
    await p.keyboard.press("e");
    await p.locator('[data-choice="contain"]').click();
  }
  await expect(pa.locator("h1")).toHaveText("Containment");
  await expect(pb.locator("h1")).toHaveText("Containment");
  await a.close();
  await b.close();
});
