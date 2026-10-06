import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import type { World } from "../shared/world.js";
export class CheckpointStore {
  private queues = new Map<string, Promise<{ code: string; secret: string }>>();
  constructor(private folder: string) {}
  async save(world: World) {
    const snapshot = structuredClone(world),
      code = world.code;
    const previous = this.queues.get(code);
    const operation = (
      previous ? previous.catch(() => undefined) : Promise.resolve()
    ).then(async () => {
      await mkdir(this.folder, { recursive: true, mode: 0o700 });
      let secret = randomBytes(32).toString("hex");
      try {
        const existing = JSON.parse(
          await readFile(`${this.folder}/${code}.json`, "utf8"),
        );
        if (typeof existing.secret === "string") secret = existing.secret;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      const temporary = `${this.folder}/${code}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(temporary, JSON.stringify({ secret, world: snapshot }), {
        mode: 0o600,
      });
      await rename(temporary, `${this.folder}/${code}.json`);
      return { code, secret };
    });
    this.queues.set(code, operation);
    try {
      return await operation;
    } finally {
      if (this.queues.get(code) === operation) this.queues.delete(code);
    }
  }
}
