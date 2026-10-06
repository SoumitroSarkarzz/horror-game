import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 180000,
  use: {
    baseURL: "http://127.0.0.1:5174",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: [
        "--no-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  webServer: {
    command:
      'npx concurrently -k "tsx server/index.ts" "vite --host 127.0.0.1 --port 5174 --strictPort"',
    env: {
      PORT: "3002",
      SAVE_DIR: "/tmp/afterlight-browser-saves",
      ALLOWED_ORIGINS: "http://127.0.0.1:5174",
      VITE_SERVER_URL: "ws://127.0.0.1:3002",
    },
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
  },
  workers: 1,
});
