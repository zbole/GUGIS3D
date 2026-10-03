import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detailBudget } from "../src/studio/detailBudget.ts";
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/renderBudget.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/renderBudget.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile });
const { chooseRenderBuildings, chooseRenderDetails, renderBudget } = await import(pathToFileURL(outfile).href);
const population = (count, components = 2) => Array.from({ length: count }, (_, i) => ({
  id: `building-${i}`, distance: i + 100, visible: true, components,
}));

test("synthetic 3/615/5000 populations retain small views and bound coarse residency", () => {
  for (const count of [3, 615, 5000]) {
    const candidates = population(count), source = JSON.stringify(candidates), selected = `building-${count - 1}`;
    const chosen = chooseRenderBuildings(candidates, new Set(), selected);
    assert.equal(chosen.size, Math.min(count, renderBudget.buildings));
    assert.ok(chosen.has(selected));
    assert.ok(chosen.size * 2 <= renderBudget.components);
    assert.equal(JSON.stringify(candidates), source);
  }
});
test("frustum culling and invalid distances never remove the selected building", () => {
  const candidates = population(5000).map((item, i) => ({ ...item, visible: i < 10 }));
  candidates.at(-1).distance = Infinity;
  const chosen = chooseRenderBuildings(candidates, new Set(candidates.map(c => c.id)), "building-4999");
  assert.equal(chosen.size, 11);
  assert.ok(chosen.has("building-4999"));
  assert.ok(!chosen.has("building-11"));
  assert.equal(chooseRenderBuildings(candidates.map(c => ({ ...c, visible: false })), chosen, null).size, 0);
});
test("nearest ranking is deterministic, with residency hysteresis around budget boundaries", () => {
  const budget = { buildings: 1, components: 100, batchBuildings: 128 };
  const candidates = [
    { id: "new", components: 1, distance: 95, visible: true },
    { id: "resident", components: 1, distance: 100, visible: true },
  ];
  assert.deepEqual([...chooseRenderBuildings(candidates, new Set(["resident"]), null, budget)], ["resident"]);
  assert.deepEqual([...chooseRenderBuildings(candidates, new Set(), null, budget)], ["new"]);
  const tied = population(5000).map(c => ({ ...c, distance: 100 }));
  assert.deepEqual([...chooseRenderBuildings(tied, new Set(), null)],
    [...chooseRenderBuildings(tied.toReversed(), new Set(), null)]);
});
test("coarse component limits include fallback buildings; only an oversized selection is exceptional", () => {
  const candidates = population(5000, 400);
  assert.equal(chooseRenderBuildings(candidates, new Set(), null).size, renderBudget.components / 400);
  const oversized = { id: "large-selected", components: renderBudget.components + 1, distance: 0, visible: false };
  assert.deepEqual([...chooseRenderBuildings([...candidates, oversized], new Set(), oversized.id)], [oversized.id]);
});
test("selected detail gets priority without exceeding either hard fine-detail limit", () => {
  const candidates = population(5000, 400).map((c, i) => ({ ...c, pixels: 100, visible: i < 100 }));
  candidates.at(-1).pixels = 0;
  const chosen = chooseRenderDetails(candidates, new Set(), "building-4999");
  assert.ok(chosen.has("building-4999"));
  assert.equal(chosen.size, detailBudget.components / 400);
  assert.ok(chosen.size <= detailBudget.buildings);
  candidates.at(-1).components = detailBudget.components + 1;
  const oversized = chooseRenderDetails(candidates, new Set(), "building-4999");
  assert.ok(!oversized.has("building-4999"), "its coarse fallback remains available instead");
  assert.ok(oversized.size * 400 <= detailBudget.components);
});
