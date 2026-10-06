import { test, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { createWorld, type Player } from "../../shared/world";
test("real firing, synchronized enemy damage and ammo, enemy-induced downing and teammate revival", async ({
  browser,
}) => {
  await mkdir("/tmp/afterlight-browser-saves", { recursive: true });
  const w = createWorld("C0BA7001", 8);
  w.phase = "playing";
  const p = {
    ready: true,
    connected: false,
    x: 0,
    z: 8,
    yaw: 0,
    hp: 16,
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
    { ...p, id: "combat-a", token: "test-combat-a", name: "Alpha" },
    {
      ...p,
      id: "combat-b",
      token: "test-combat-b",
      name: "Beta",
      x: 2,
      hp: 100,
    },
  ] as Player[];
  w.enemies[0] = {
    ...w.enemies[0],
    x: 0,
    z: 2,
    hp: 24,
    cooldown: Date.now() + 20000,
  };
  w.enemies[2] = { ...w.enemies[2], x: 0, z: 4, cooldown: Date.now() + 20000 };
  await writeFile(
    "/tmp/afterlight-browser-saves/C0BA7001.json",
    JSON.stringify({ secret: "test-combat-resume", world: w }),
    { mode: 0o600 },
  );
  const a = await browser.newContext(),
    b = await browser.newContext();
  const errors: string[] = [];
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
            if (m.type === "state") (window as any).__world = m.world;
          });
        }
      };
    });
  const pa = await a.newPage(),
    pb = await b.newPage();
  try {
    for (const page of [pa, pb]) {
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("/");
      await page.locator("#resumeCode").fill("C0BA7001");
      await page.locator("#resumeSecret").fill("test-combat-resume");
      await page.locator("#resume").click();
      await expect(page.locator("#hud")).toBeVisible({ timeout: 45000 });
    }
    await pa.locator("canvas").click({ position: { x: 300, y: 250 } });
    await expect
      .poll(() => pa.evaluate(() => !!document.pointerLockElement))
      .toBe(true);
    await pa.mouse.click(300, 250);
    await expect
      .poll(() => pb.evaluate(() => (window as any).__world.enemies[0].hp))
      .toBe(0);
    await expect
      .poll(() =>
        pb.evaluate(
          () =>
            (window as any).__world.players.find((p: any) => p.name === "Alpha")
              .ammo,
        ),
      )
      .toBe(11);
    await expect(pa.locator("#hud .bottom")).toContainText("DOWNED", {
      timeout: 35000,
    });
    await pb.keyboard.press("v");
    await expect(pa.locator("#hud .bottom")).toContainText("HEALTH 40");
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});
