import test from "node:test";
import assert from "node:assert/strict";
import { chooseDetails, detailBudget } from "../src/studio/detailBudget.ts";

test("a tour of all 616 buildings never exceeds the building or component budget", () => {
  const candidates = Array.from({ length: 616 }, (_, i) => ({ id: String(i), pixels: 80, components: 400, visible: true }));
  const resident = new Set(candidates.map(c => c.id));
  const chosen = chooseDetails(candidates, resident);
  assert.ok(chosen.size <= detailBudget.buildings);
  assert.ok(chosen.size * 400 <= detailBudget.components);
  assert.equal(chosen.size, 40);
  assert.equal(chooseDetails(candidates.map(c => ({ ...c, components: 10 })), resident).size, detailBudget.buildings);
});
test("off-screen and distant details are evicted; hysteresis avoids reloading at a threshold", () => {
  const c = (id, pixels, visible = true) => ({ id, pixels, visible, components: 10 });
  assert.deepEqual([...chooseDetails([c("near", 100), c("hidden", 200, false), c("far", 5), c("resident", 35), c("new", 35)], new Set(["resident", "far", "hidden"]))], ["near", "resident"]);
});
