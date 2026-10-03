import test from "node:test";
import assert from "node:assert/strict";
import { loadedBuildings, loadedBuildingPage, LOADED_BUILDINGS_PAGE_SIZE } from "../src/studio/loadedBuildings.ts";

const revision = "a".repeat(64), manifest = { city_id: "london", revision };
const placement = (id, name = id) => ({ id, name, asset: "original-asset", longitude: -.127612345678,
  latitude: 51.507212345678, altitude: -2.375, heading: 359.987654321 });
function tile(tileId, instances, overrides = {}) {
  return { city_id: "london", revision, tile_id: tileId, instances,
    assets: { "original-asset": { quality: "overview", kind: "urban", primitives: [{ id: "original-overview" }] } },
    ...overrides };
}

test("loaded-building index de-duplicates active references without changing source data or accepting another session", () => {
  const original = placement("osm_7", "Original building");
  const tiles = [tile("x0_y0", [original]), tile("x1_y0", [original, placement("osm_8")]), tile("x1_y0", [original]),
    tile("x2_y0", [placement("cross-city")], { city_id: "bristol" }),
    tile("x3_y0", [placement("old-revision")], { revision: "b".repeat(64) })];
  const before = structuredClone(tiles), buildings = loadedBuildings(manifest, tiles);
  assert.equal(buildings.length, 2);
  const entry = buildings.find(item => item.placement.id === "osm_7");
  assert.equal(entry.placement, original, "exact verified placement is retained, not rounded/reconstructed");
  assert.deepEqual(entry.tileIds, ["x0_y0", "x1_y0"]);
  assert.equal(entry.quality, "overview");
  assert.equal(entry.kind, "urban");
  assert.equal(entry.primitiveCount, 1);
  assert.deepEqual(tiles, before);
  assert.equal(loadedBuildings(manifest, tiles.slice(1, 2)).find(item => item.placement.id === "osm_7").tileIds.length, 1);
  assert.deepEqual(loadedBuildings(manifest, []), [], "evicted/cache-only entries are never retained by the index");
});

test("name/ID search is literal, trimmed, case-insensitive and distinct from asset IDs", () => {
  const buildings = loadedBuildings(manifest, [tile("x0_y0", [placement("OSM_12", "Cathedral [North]"),
    placement("OSM_13", "市政厅"), placement("OSM_14", ""), placement("__proto__", "Constructor")])]);
  for (const [query, id] of [["  CATHEDRAL ", "OSM_12"], ["[north]", "OSM_12"], ["osm_13", "OSM_13"], ["政厅", "OSM_13"], ["__proto__", "__proto__"]]) {
    const result = loadedBuildingPage(buildings, query, 0);
    assert.equal(result.matched, 1, query);
    assert.equal(result.items[0].placement.id, id);
    assert.equal(result.loaded, 4);
  }
  assert.equal(loadedBuildingPage(buildings, "original-asset", 0).matched, 0);
  assert.equal(loadedBuildingPage(buildings, ".*", 0).matched, 0, "search terms are not regular expressions");
  assert.equal(loadedBuildingPage(buildings, "  ", 0).matched, 4);
});

test("pagination always bounds rendered rows, counts all loaded matches and clamps stale/invalid page requests", () => {
  const buildings = loadedBuildings(manifest, [tile("x0_y0", Array.from({ length: 63 }, (_, i) => placement(`id-${String(i).padStart(3, "0")}`)))]);
  assert.equal(LOADED_BUILDINGS_PAGE_SIZE, 25);
  const first = loadedBuildingPage(buildings, "", 0), last = loadedBuildingPage(buildings, "", 9999);
  assert.deepEqual([first.loaded, first.matched, first.items.length, first.first, first.last, first.pages], [63, 63, 25, 1, 25, 3]);
  assert.deepEqual([last.page, last.items.length, last.first, last.last], [2, 13, 51, 63]);
  for (const page of [-1, Infinity, NaN]) assert.equal(loadedBuildingPage(buildings, "", page).page, 0);
  assert.equal(loadedBuildingPage(buildings, "id-062", 2).items[0].placement.id, "id-062", "search includes entries beyond the first page");
  const empty = loadedBuildingPage(buildings, "not-loaded", 2);
  assert.deepEqual([empty.matched, empty.first, empty.last, empty.page, empty.items.length], [0, 0, 0, 0, 0]);
  assert.equal(loadedBuildingPage(buildings.slice(0, 3), "", 2).page, 0);
});
