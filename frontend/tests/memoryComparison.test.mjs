import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { memoryComparison, memoryMB } from "../src/studio/memoryBenchmark.ts";
import localReport from "../../shared/current-city-memory-benchmark.json" with { type: "json" };

test("published measurement belongs to the packaged city, and another revision is clearly stale", () => {
  const seed = readFileSync(
    new URL("../../backend/data/bristol.gugis.json", import.meta.url),
  );
  const revision = createHash("sha256").update(seed).digest("hex");
  const current = memoryComparison(revision);
  assert.equal(current.matches, true);
  assert.ok(current.saving > 80 && current.saving < 85);
  assert.ok(current.shared > 0 && current.wire > current.shared);
  assert.match(memoryMB(current.shared), / MB$/);
  assert.ok(current.rows[2].saving > 80);
  const local = memoryComparison(localReport.file_sha256);
  assert.equal(local.matches, true);
  assert.equal(local.buildings, 616);
  assert.equal(memoryComparison("0".repeat(64)).matches, false);
});
