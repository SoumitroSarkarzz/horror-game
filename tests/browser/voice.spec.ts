import { test, expect } from "@playwright/test";
test("synthetic local WebRTC audio connects, denied permission falls back, and leave disposes tracks", async ({
  browser,
}) => {
  const a = await browser.newContext({ permissions: ["microphone"] }),
    b = await browser.newContext({ permissions: ["microphone"] });
  for (const context of [a, b])
    await context.addInitScript(() => {
      localStorage.setItem(
        "afterlight-settings",
        JSON.stringify({ quality: "low", scale: 0.5 }),
      );
      const state = {
        tracks: [] as MediaStreamTrack[],
        peers: [] as RTCPeerConnection[],
        events: [] as any[],
      };
      (window as any).__mediaTest = state;
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          this.addEventListener("message", (e) => {
            const m = JSON.parse(e.data);
            if (["signal", "error"].includes(m.type))
              state.events.push({
                type: m.type,
                text: m.text,
                description: m.data?.description?.type,
                candidate: !!m.data?.candidate,
              });
          });
        }
      };
      const get = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        const stream = await get(constraints);
        state.tracks.push(...stream.getTracks());
        return stream;
      };
      const original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends original {
        constructor(config?: RTCConfiguration) {
          super(config);
          state.peers.push(this);
        }
      };
    });
  const pa = await a.newPage(),
    pb = await b.newPage();
  await pa.goto("/");
  await pb.goto("/");
  await pa.locator("#create").click();
  await expect(pa.locator(".tag")).toContainText("SECURE CHANNEL");
  const code = (await pa.locator(".tag").textContent())!.split(" ").at(-1)!;
  await pb.locator("#code").fill(code);
  await pb.locator("#join").click();
  await pa.locator("#ready").click();
  await pb.locator("#ready").click();
  await pa.locator("#start").click();
  for (const p of [pa, pb]) {
    await expect(p.locator("#hud")).toBeVisible();
    await p.keyboard.press("Enter");
    await p.locator("#voice").click();
    await expect
      .poll(() => p.evaluate(() => (window as any).__mediaTest.tracks.length), {
        timeout: 15000,
      })
      .toBeGreaterThan(0);
  }
  await expect
    .poll(
      () =>
        pa.evaluate(
          () => (window as any).__mediaTest.peers.at(-1)?.connectionState,
        ),
      { timeout: 15000 },
    )
    .toBe("connected");
  await expect
    .poll(
      () =>
        pb.evaluate(
          () => (window as any).__mediaTest.peers.at(-1)?.connectionState,
        ),
      { timeout: 15000 },
    )
    .toBe("connected");
  await pa.locator("#closeOverlay").click();
  await pa.keyboard.down("t");
  await pa.waitForTimeout(1200);
  await pa.keyboard.up("t");
  const bytes = await pb.evaluate(async () => {
    const stats = await (window as any).__mediaTest.peers.at(-1).getStats();
    let received = 0;
    stats.forEach((s: any) => {
      if (s.type === "inbound-rtp" && s.kind === "audio")
        received += s.bytesReceived || 0;
    });
    return received;
  });
  expect(bytes).toBeGreaterThan(0);
  await pa.keyboard.press("Escape");
  await pa.locator("#leave").click();
  expect(
    await pa.evaluate(() =>
      (window as any).__mediaTest.tracks.every(
        (t: MediaStreamTrack) => t.readyState === "ended",
      ),
    ),
  ).toBe(true);
  await a.close();
  await b.close();
  const denied = await browser.newContext();
  await denied.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  const pc = await denied.newPage();
  await pc.goto("/");
  await pc.locator("#create").click();
  await expect(pc.locator(".tag")).toContainText("SECURE CHANNEL");
  const dc = (await pc.locator(".tag").textContent())!.split(" ").at(-1)!;
  const d = await browser.newContext(),
    pd = await d.newPage();
  await pd.goto("/");
  await pd.locator("#code").fill(dc);
  await pd.locator("#join").click();
  await pc.locator("#ready").click();
  await pd.locator("#ready").click();
  await pc.locator("#start").click();
  await expect(pc.locator("#hud")).toBeVisible();
  await pc.keyboard.press("Enter");
  await pc.locator("#voice").click();
  await expect(pc.locator("#notice")).toContainText("unavailable or denied");
  await pc.locator("#chatText").fill("<script>not html</script>");
  await pc.locator("#chatForm button").click();
  await expect(pc.locator("#chatlog")).toContainText(
    "<script>not html</script>",
  );
  expect(await pc.locator("#chatlog script").count()).toBe(0);
  await denied.close();
  await d.close();
});
