import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { CheckpointStore } from "../server/storage";
import { createWorld } from "../shared/world";
test("concurrent checkpoints serialize, preserve credentials and commit the last snapshot privately", async () => {
  const folder = await mkdtemp("/tmp/afterlight-store-");
  try {
    const store = new CheckpointStore(folder),
      w = createWorld("ABCDEF12", 4);
    w.evidence = 1;
    const first = store.save(w);
    w.evidence = 2;
    const second = store.save(w);
    w.evidence = 3;
    const third = store.save(w);
    const results = await Promise.all([first, second, third]);
    assert(results.every((r) => r.secret === results[0].secret));
    assert.equal(results[0].secret.length, 64);
    const saved = JSON.parse(await readFile(`${folder}/ABCDEF12.json`, "utf8"));
    assert.equal(saved.world.evidence, 3);
    assert.equal(saved.secret, results[0].secret);
    assert.equal((await stat(`${folder}/ABCDEF12.json`)).mode & 0o777, 0o600);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
