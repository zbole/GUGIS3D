import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Cartesian3, Matrix3, Matrix4, Transforms, Math as CM } from "cesium";
import { canonicalJson, chooseViewportTiles, intersectsBounds, loadRenderManifest, readBoundedBytes,
  RenderPackageUnavailable, RenderTileStream, renderTilesToCity, tileBudget, tileLoadingProfiles, normalizeTileLoadingProfile, validateManifest, validateTile } from "../src/studio/renderTileClient.ts";
const hash = value => createHash("sha256").update(value).digest("hex");
const revision = "a".repeat(64), cityId = "london";
const view = (x = 0, bounds = null) => ({ bounds, center: { longitude: x, latitude: 51 } });
function fixture(count = 4) {
  const contents = new Map(), tiles = [];
  for (let i = 0; i < count; i++) {
    const id = `x${i}_y0`, primitive = { id: "node", node_id: "node", template_id: "wall", category: "wall",
      geometry: "unitbox", color: "#abcdef", size: [5, 7, 11], position: [1, 2, 3], rotation_z: 30 };
    const tile = { format: "gugis-render-tile-v1", city_id: cityId, revision, tile_id: id,
      geometry_library: { unitbox: { kind: "box" } }, assets: { [`asset${i}`]: { quality: "full-fallback", kind: "footprint", primitives: [primitive] } },
      instances: [{ id: `building${i}`, asset: `asset${i}`, name: `Building ${i}`, longitude: i * .01, latitude: 51, altitude: 13, heading: 27 }] };
    const bytes = new TextEncoder().encode(JSON.stringify(tile)); contents.set(id, { tile, bytes });
    tiles.push({ id, grid: [i, 0], cell_bounds_enu: [i * 250, 0, (i + 1) * 250, 250], bounds_enu: [0, 0, 0, 5, 7, 11],
      bounds_wgs84: [i * .01 - .001, 50.999, i * .01 + .001, 51.001], building_count: 1, primitive_count: 1,
      byte_length: bytes.length, sha256: hash(bytes), url: `/cities/london/render/${revision}/tiles/${id}` });
  }
  const manifest = { format: "gugis-render-package-v1", city_id: cityId, name: "Test city", revision, source_sha256: revision, source_byte_length: 1000,
    grid: { coordinate_system: "ECEF_ENU", origin_wgs84: [0, 51, 0], tile_size_m: 250 }, bounds_enu: null, bounds_wgs84: null,
    counts: { buildings: count, assets: count, primitives: count, tiles: count, source_roads: 12 },
    limits: { max_buildings: 256, max_primitives: 12000, max_bytes: 2097152, max_tiles: 20000 },
    layers: { buildings: "included", roads: "not-included", terrain: "not-included", features: "not-included", semantics: "not-included" },
    quality_warnings_source_revision: revision, quality_warnings: [{ code: "source", message: "Known source issue" }],
    attribution: { source: "OSM", license: "ODbL 1.0", license_url: "https://www.openstreetmap.org/copyright", metadata: {} }, tiles };
  manifest.package_sha256 = hash(canonicalJson(manifest)); return { manifest, contents };
}
const response = (bytes, headers = {}) => new Response(bytes, { headers });
async function settle() { for (let i = 0; i < 12; i++) await new Promise(resolve => setTimeout(resolve, 0)); }
function harness(f, budget = { ...tileBudget, activeTiles: 2, cacheTiles: 3, concurrency: 2 }) {
  const requests = [], states = [];
  const fetcher = (url, { signal }) => new Promise((resolve, reject) => requests.push({ url, signal, resolve, reject, id: url.split("/").at(-1) }));
  const stream = new RenderTileStream(f.manifest, state => states.push(state), { budget, fetcher });
  const finish = request => request.resolve(response(f.contents.get(request.id).bytes));
  return { requests, states, stream, finish, current: () => states.at(-1) };
}
test("default manifest and tile fetch retain the browser global receiver", async t => {
  const f = fixture(1), calls = [], states = [];
  const manifestBytes = new TextEncoder().encode(JSON.stringify(f.manifest));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (url, options) {
    // Window.fetch rejects a RenderTileStream instance as its receiver. Node's
    // native fetch and arrow-based doubles do not catch that browser failure.
    assert.ok(this === globalThis, "native browser fetch must retain its global receiver");
    calls.push({ url, options });
    return url.endsWith("/manifest")
      ? response(manifestBytes, { ETag: `"${hash(manifestBytes)}"` })
      : response(f.contents.get(url.split("/").at(-1)).bytes);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const { manifest } = await loadRenderManifest(cityId, new AbortController().signal);
  const stream = new RenderTileStream(manifest, state => states.push(state));
  t.after(() => stream.dispose());
  stream.setView(view()); await settle();
  assert.deepEqual(calls.map(call => call.url), ["/api/cities/london/render/manifest", `/api${manifest.tiles[0].url}`]);
  assert.equal(states.at(-1).failures.length, 0);
  assert.equal(states.at(-1).tiles.length, 1);
});

test("injected tile transports are called without a stream receiver", async t => {
  const f = fixture(1), receivers = [], states = [];
  const stream = new RenderTileStream(f.manifest, state => states.push(state), {
    fetcher: async function (url) {
      receivers.push(this === undefined);
      return response(f.contents.get(url.split("/").at(-1)).bytes);
    },
  });
  t.after(() => stream.dispose());
  stream.setView(view()); await settle();
  assert.deepEqual(receivers, [true]);
  assert.equal(states.at(-1).failures.length, 0);
  assert.equal(states.at(-1).tiles.length, 1);
});

test("manifest verifies exact ETag bytes including Python numeric forms, with read-only city URLs", async () => {
  const f = fixture(1), serialized = canonicalJson(f.manifest).replace('"tile_size_m":250', '"tile_size_m":250.0').replace('"source_byte_length":1000', '"source_byte_length":1e3');
  const bytes = new TextEncoder().encode(serialized), calls = [];
  const result = await loadRenderManifest(cityId, new AbortController().signal, "/api", async (url, options) => {
    calls.push({ url, options }); return response(bytes, { ETag: `"${hash(bytes)}"`, "X-Render-Freshness": "current" });
  });
  assert.equal(result.manifest.grid.tile_size_m, 250); assert.equal(result.freshness, "current");
  assert.equal(calls[0].url, "/api/cities/london/render/manifest"); assert.equal(calls[0].options.method, undefined);
  await assert.rejects(loadRenderManifest(cityId, new AbortController().signal, "/api", async () => response(bytes, { ETag: `"${"0".repeat(64)}"` })), /SHA-256/);
  await assert.rejects(loadRenderManifest("unknown", new AbortController().signal), /未知城市/);
  await assert.rejects(loadRenderManifest(cityId, new AbortController().signal, "/api", async () => new Response("", { status: 404 })), RenderPackageUnavailable);
});
test("manifest rejects wrong identities, audit revision, URLs, bounds, duplicates and layers", async () => {
  const f = fixture(2); await validateManifest(f.manifest, cityId);
  for (const mutate of [m => m.city_id = "bristol", m => m.source_sha256 = "b".repeat(64), m => m.quality_warnings_source_revision = "b".repeat(64),
    m => m.tiles[0].url = "https://untrusted.invalid/tile", m => m.tiles[0].bounds_wgs84 = [0, 51, -1, 50], m => m.tiles[1] = m.tiles[0], m => m.layers.terrain = "included"]) {
    const copy = structuredClone(f.manifest); mutate(copy); await assert.rejects(validateManifest(copy, cityId));
  }
});
test("bounded stream cancels overflow, rejects short bytes, handles gzip and aborts a pending reader", async () => {
  let cancelled = false;
  const source = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(12)); }, cancel() { cancelled = true; } });
  await assert.rejects(readBoundedBytes(new Response(source), 10, new AbortController().signal), /字节限制/); assert.equal(cancelled, true);
  await assert.rejects(readBoundedBytes(response(new Uint8Array(4)), 10, new AbortController().signal, 6), /不匹配/);
  assert.equal((await readBoundedBytes(response(new Uint8Array(10), { "Content-Encoding": "gzip", "Content-Length": "2" }), 10, new AbortController().signal, 10)).length, 10);
  const controller = new AbortController(), pending = readBoundedBytes(new Response(new ReadableStream({ start() {} })), 10, controller.signal);
  controller.abort(); await assert.rejects(pending, { name: "AbortError" });
});
test("viewport bounds are inclusive and conservative at horizon/dateline; nearest tiles win hard caps", () => {
  assert.equal(intersectsBounds([0, 0, 1, 1], [1, 1, 2, 2]), true);
  assert.equal(intersectsBounds([175, 0, 180, 5], [170, -1, -170, 6]), true);
  assert.equal(intersectsBounds([-180, 0, -175, 5], [170, -1, -170, 6]), true);
  assert.equal(intersectsBounds([0, 0, 1, 1], [170, -1, -170, 6]), false);
  const f = fixture(6), budget = { ...tileBudget, activeTiles: 2 };
  assert.deepEqual(chooseViewportTiles(f.manifest, view(.05), budget).chosen.map(t => t.id), ["x5_y0", "x4_y0"]);
  assert.equal(chooseViewportTiles(f.manifest, view(), { ...budget, activeBytes: f.manifest.tiles[0].byte_length - 1 }).chosen.length, 0);
  assert.equal(chooseViewportTiles(f.manifest, view(0, [.009, 50.999, .011, 51.001]), budget).candidates, 1);
});
test("queue bounds concurrency, aborts obsolete views and rejects stale transport completions", async t => {
  const f = fixture(6), h = harness(f); t.after(() => h.stream.dispose());
  h.stream.setView(view()); assert.equal(h.requests.length, 2); h.stream.setView(view(.05));
  assert.equal(h.requests.length, 2); assert.ok(h.requests.every(r => r.signal.aborted));
  h.finish(h.requests[0]); h.finish(h.requests[1]); await settle();
  assert.equal(h.requests.length, 4); assert.equal(h.current().tiles.length, 0);
  assert.deepEqual(h.requests.slice(2).map(r => r.id), ["x5_y0", "x4_y0"]);
  h.finish(h.requests[2]); h.finish(h.requests[3]); await settle();
  assert.equal(h.current().loading, 0); assert.equal(h.current().tiles.length, 2); assert.equal(h.current().omitted, 4);
  assert.ok(h.current().activeBytes <= tileBudget.activeBytes); assert.ok(h.current().cacheTiles <= 3);
  assert.ok(h.requests.every(r => r.url.startsWith("/api/cities/london/render/")));
});
test("resident tile array stays identical across priority reorders, loaded selection and pause", async t => {
  const f = fixture(3), h = harness(f, { ...tileBudget, activeTiles: 3, cacheTiles: 3, concurrency: 3 });
  t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.requests.forEach(h.finish); await settle();
  const resident = h.current().tiles, states = h.states.length, bytes = h.current().activeBytes;
  assert.deepEqual(resident.map(tile => tile.tile_id), ["x0_y0", "x1_y0", "x2_y0"]);
  for (const x of [.02, 0, .01, .02]) h.stream.setView(view(x));
  h.stream.setView(view(), "building2");
  h.stream.setView(view(), null); h.stream.retry();
  h.stream.setPaused(true); h.stream.setView(view(.02), "building1"); h.stream.setPaused(false);
  assert.ok(h.states.slice(states).every(state => state.tiles === resident));
  assert.deepEqual(resident.map(tile => tile.tile_id), ["x0_y0", "x1_y0", "x2_y0"], "published order is not mutated for request priority");
  assert.equal(h.requests.length, 3); assert.equal(h.current().activeBytes, bytes);
  assert.equal(h.current().cacheTiles, 3); assert.equal(h.current().cacheBytes, bytes);
  assert.equal(h.current().wanted, 3); assert.equal(h.current().loading, 0);
});
test("same chosen membership keeps pending reads and pumps new priority without refetching", async t => {
  const f = fixture(3), h = harness(f, { ...tileBudget, activeTiles: 3, cacheTiles: 3, concurrency: 1 });
  t.after(() => h.stream.dispose());
  h.stream.setView(view()); assert.deepEqual(h.requests.map(request => request.id), ["x0_y0"]);
  h.stream.setView(view(.02));
  assert.equal(h.requests[0].signal.aborted, false); assert.equal(h.requests.length, 1);
  h.finish(h.requests[0]); await settle();
  assert.deepEqual(h.requests.map(request => request.id), ["x0_y0", "x2_y0"]);
  const firstResident = h.current().tiles;
  assert.equal(firstResident[0].tile_id, "x0_y0");
  h.stream.setView(view(.01));
  assert.equal(h.current().tiles, firstResident); assert.equal(h.requests[1].signal.aborted, false);
  h.finish(h.requests[1]); await settle();
  assert.deepEqual(h.requests.map(request => request.id), ["x0_y0", "x2_y0", "x1_y0"]);
  const partialResident = h.current().tiles;
  h.stream.setView(view(.02));
  assert.equal(h.current().tiles, partialResident, "multiple resident references stay stable while priority changes");
  assert.equal(h.requests[2].signal.aborted, false);
  h.finish(h.requests[2]); await settle();
  assert.notEqual(h.current().tiles, partialResident, "new residency still invalidates the projection");
  assert.deepEqual(h.current().tiles.map(tile => tile.tile_id).sort(), ["x0_y0", "x1_y0", "x2_y0"]);
  assert.equal(h.requests.length, 3); assert.equal(h.current().loading, 0); assert.equal(h.current().failures.length, 0);
});
test("different chosen membership still invalidates every pending read including overlapping IDs", async t => {
  const h = harness(fixture(3)); t.after(() => h.stream.dispose());
  h.stream.setView(view()); assert.deepEqual(h.requests.map(request => request.id), ["x0_y0", "x1_y0"]);
  h.stream.setView(view(.02));
  assert.ok(h.requests.every(request => request.signal.aborted)); assert.equal(h.requests.length, 2);
  h.finish(h.requests[1]); await settle();
  assert.equal(h.current().tiles.length, 0); assert.equal(h.current().cacheTiles, 0);
  assert.equal(h.requests[2].id, "x2_y0");
  h.finish(h.requests[0]); await settle();
  assert.equal(h.current().tiles.length, 0); assert.equal(h.requests[3].id, "x1_y0");
  h.finish(h.requests[2]); h.finish(h.requests[3]); await settle();
  assert.deepEqual(h.current().tiles.map(tile => tile.tile_id), ["x2_y0", "x1_y0"]);
  assert.equal(h.current().loading, 0); assert.equal(h.current().failures.length, 0);
});
test("evicted and refetched tile objects publish fresh arrays and retain no stale references", async t => {
  const h = harness(fixture(2), { ...tileBudget, activeTiles: 1, cacheTiles: 1, concurrency: 1 });
  t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.finish(h.requests[0]); await settle();
  const original = h.current().tiles;
  h.stream.setView(view(.01));
  assert.notEqual(h.current().tiles, original); assert.equal(h.current().tiles.length, 0);
  h.finish(h.requests[1]); await settle();
  assert.equal(h.current().tiles[0].tile_id, "x1_y0");
  h.stream.setView(view()); h.finish(h.requests[2]); await settle();
  const refetched = h.current().tiles;
  assert.notEqual(refetched, original); assert.notEqual(refetched[0], original[0]);
  assert.deepEqual(refetched[0], original[0]);
  h.stream.setView(view()); assert.equal(h.current().tiles, refetched);
  assert.deepEqual(h.requests.map(request => request.id), ["x0_y0", "x1_y0", "x0_y0"]);
});
test("equal-ID resident replacements publish their exact new object references", async t => {
  const h = harness(fixture(2)); t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.requests.forEach(h.finish); await settle();
  const original = h.current().tiles, replacement = structuredClone(original[0]);
  // Normal eviction emits an empty/different set first. Replace one cache entry
  // directly to guard the identity comparison against an ID-only shortcut.
  h.stream.cache.get(replacement.tile_id).tile = replacement;
  h.stream.setView(view(.01));
  const replaced = h.current().tiles;
  assert.notEqual(replaced, original); assert.deepEqual(replaced.map(tile => tile.tile_id), ["x1_y0", "x0_y0"]);
  assert.equal(replaced[0], original[1]); assert.equal(replaced[1], replacement);
  assert.equal(replaced.includes(original[0]), false);
  h.stream.setView(view()); assert.equal(h.current().tiles, replaced);
  assert.equal(h.requests.length, 2);
});
test("LRU reuses recent tiles and independently enforces cache count and encoded bytes", async t => {
  const f = fixture(4), h = harness(f, { ...tileBudget, activeTiles: 1, cacheTiles: 2, concurrency: 1 }); t.after(() => h.stream.dispose());
  for (const x of [0, .01, 0, .02, .01]) {
    const before = h.requests.length; h.stream.setView(view(x));
    if (h.requests.length > before) { h.finish(h.requests.at(-1)); await settle(); }
    assert.ok(h.current().cacheTiles <= 2); assert.equal(h.current().activeBytes, f.manifest.tiles[Math.round(x * 100)].byte_length);
  }
  assert.deepEqual(h.requests.map(r => r.id), ["x0_y0", "x1_y0", "x2_y0", "x1_y0"]);
  const one = f.manifest.tiles[0].byte_length, bytes = harness(f, { ...tileBudget, activeTiles: 1, activeBytes: one + 20, cacheTiles: 3, cacheBytes: one + 20, concurrency: 1 });
  t.after(() => bytes.stream.dispose());
  for (const x of [0, .01, .02]) { bytes.stream.setView(view(x)); bytes.finish(bytes.requests.at(-1)); await settle(); assert.equal(bytes.current().cacheTiles, 1); }
});
test("selection pins one complete tile within hard budget until deselection", async t => {
  const f = fixture(3), h = harness(f, { ...tileBudget, activeTiles: 1, cacheTiles: 2, concurrency: 1 }); t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.finish(h.requests[0]); await settle();
  h.stream.setView(view(.02, [.019, 50.999, .021, 51.001]), "building0");
  assert.equal(h.requests.length, 1); assert.equal(h.current().tiles[0].tile_id, "x0_y0"); assert.equal(h.current().omitted, 1);
  h.stream.setView(view(.02, [.019, 50.999, .021, 51.001]), null); assert.equal(h.requests[1].id, "x2_y0");
});
test("SHA failures stay out of residency until explicit retry succeeds; mismatched identity is rejected", async t => {
  const f = fixture(1), h = harness(f); t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.requests[0].resolve(response(new Uint8Array(f.manifest.tiles[0].byte_length))); await settle();
  assert.match(h.current().failures[0].message, /SHA-256/); assert.equal(h.current().tiles.length, 0);
  h.stream.setView(view()); await settle(); assert.equal(h.requests.length, 1);
  h.stream.retry(); assert.equal(h.requests.length, 2); h.finish(h.requests[1]); await settle();
  assert.equal(h.current().failures.length, 0); assert.equal(h.current().tiles.length, 1);
  const tile = structuredClone(f.contents.get("x0_y0").tile); tile.city_id = "bristol";
  assert.throws(() => validateTile(tile, f.manifest, f.manifest.tiles[0]), /身份/);
});
test("dispose aborts pending reads and suppresses all late callbacks", async () => {
  const f = fixture(4), h = harness(f); h.stream.setView(view());
  const states = h.states.length; h.stream.dispose(); assert.ok(h.requests.every(r => r.signal.aborted));
  h.requests.forEach(h.finish); await settle(); assert.equal(h.states.length, states); assert.equal(h.requests.length, 2);
});
test("pause freezes verified scene/cache and discards late responses until the latest copied view resumes", async t => {
  const f = fixture(6), h = harness(f, { ...tileBudget, activeTiles: 3, cacheTiles: 3, concurrency: 3 });
  t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.finish(h.requests[0]); await settle();
  const tiles = h.current().tiles, bytes = h.current().activeBytes;
  h.stream.setPaused(true);
  assert.equal(h.current().paused, true); assert.equal(h.current().loading, 0);
  assert.equal(h.current().tiles, tiles); assert.ok(h.requests.slice(1).every(r => r.signal.aborted));
  h.stream.setView(view(.03));
  const latest = view(.05, [.029, 50.999, .051, 51.001]);
  h.stream.setView(latest); latest.center.longitude = 0; latest.bounds[0] = -.001;
  const frozen = h.current(), stateCount = h.states.length;
  let cancelled = 0;
  h.requests[1].resolve(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  h.requests[2].reject(new Error("Obsolete network failure")); await settle();
  assert.equal(cancelled, 1); assert.equal(h.states.length, stateCount);
  assert.equal(h.current(), frozen); assert.equal(h.current().activeBytes, bytes);
  assert.equal(h.current().cacheTiles, 1); assert.equal(h.current().failures.length, 0);
  h.stream.setPaused(false);
  assert.equal(h.current().paused, false);
  assert.deepEqual(h.requests.slice(3).map(r => r.id), ["x5_y0", "x4_y0", "x3_y0"]);
  h.requests.slice(3).forEach(h.finish); await settle();
  assert.deepEqual(h.current().tiles.map(t => t.tile_id), ["x5_y0", "x4_y0", "x3_y0"]);
  assert.equal(h.current().candidates, 3); assert.equal(h.current().loading, 0);
  assert.ok(h.states.every(s => s.tiles.length <= 3 && s.cacheTiles <= 3 &&
    s.activeBytes <= tileBudget.activeBytes && s.cacheBytes <= tileBudget.cacheBytes));
});
test("pause before the first view defers all reads and resumes only the newest view", async t => {
  const h = harness(fixture(4)); t.after(() => h.stream.dispose());
  h.stream.setPaused(false); assert.equal(h.states.length, 0);
  h.stream.setPaused(true); h.stream.setPaused(true);
  h.stream.setView(view()); h.stream.setView(view(.03)); h.stream.retry();
  assert.equal(h.requests.length, 0); assert.equal(h.current().loading, 0);
  h.stream.setPaused(false); h.stream.setPaused(false);
  assert.deepEqual(h.requests.map(r => r.id), ["x3_y0", "x2_y0"]);
  h.requests.forEach(h.finish); await settle(); assert.equal(h.current().tiles.length, 2);
});
test("rapid pause/resume retains all three physical slots until each cancelled transport settles", async t => {
  const h = harness(fixture(4), { ...tileBudget, activeTiles: 3, cacheTiles: 3, concurrency: 3 });
  t.after(() => h.stream.dispose()); h.stream.setView(view());
  for (let i = 0; i < 5; i++) { h.stream.setPaused(true); h.stream.setPaused(false); }
  assert.equal(h.requests.length, 3); assert.ok(h.requests.every(r => r.signal.aborted));
  h.finish(h.requests[0]); await settle();
  assert.equal(h.requests.length, 4); assert.equal(h.requests[3].id, "x0_y0");
  assert.equal(h.current().tiles.length, 0);
  h.stream.setPaused(true); h.stream.setPaused(false);
  assert.equal(h.requests.length, 4);
  h.requests[1].reject(new DOMException("Cancelled", "AbortError")); await settle();
  assert.equal(h.requests.length, 5); assert.equal(h.requests[4].id, "x1_y0");
  h.finish(h.requests[2]); h.finish(h.requests[3]); await settle();
  assert.equal(h.requests.length, 7); assert.equal(h.current().tiles.length, 0);
  assert.equal(h.current().failures.length, 0);
  h.requests.slice(4).forEach(h.finish); await settle();
  assert.equal(h.current().tiles.length, 3); assert.equal(h.current().loading, 0);
});
test("a late response keeps its concurrency slot until body cancellation finishes", async t => {
  const h = harness(fixture(3), { ...tileBudget, activeTiles: 1, cacheTiles: 1, concurrency: 1 });
  t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.stream.setPaused(true); h.stream.setView(view(.02)); h.stream.setPaused(false);
  let finishCancel, cancelled = 0;
  h.requests[0].resolve(new Response(new ReadableStream({
    cancel() { cancelled++; return new Promise(resolve => { finishCancel = resolve; }); },
  })));
  await settle(); assert.equal(cancelled, 1); assert.equal(h.requests.length, 1);
  finishCancel(); await settle();
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].id, "x2_y0");
  h.finish(h.requests[1]); await settle();
  assert.equal(h.current().tiles[0].tile_id, "x2_y0"); assert.equal(h.current().failures.length, 0);
});
test("pause cancels a pending body read and does not manufacture a timeout failure", async t => {
  const f = fixture(1), h = harness(f); t.after(() => h.stream.dispose());
  let cancelled = 0;
  h.stream.setView(view());
  h.requests[0].resolve(new Response(new ReadableStream({
    start(controller) { controller.enqueue(f.contents.get("x0_y0").bytes.slice(0, 12)); },
    cancel() { cancelled++; },
  })));
  await settle(); h.stream.setPaused(true); const states = h.states.length; await settle();
  assert.equal(cancelled, 1); assert.equal(h.states.length, states); assert.equal(h.current().cacheTiles, 0);
  assert.equal(h.current().failures.length, 0);
  h.stream.setPaused(false); assert.equal(h.requests.length, 2);
  h.finish(h.requests[1]); await settle(); assert.equal(h.current().tiles.length, 1);
});
test("an interrupted body read keeps its physical slot until the original cancellation settles", async t => {
  const h = harness(fixture(2), { ...tileBudget, activeTiles: 1, cacheTiles: 1, concurrency: 1 });
  t.after(() => h.stream.dispose());
  let finishCancel, cancelled = 0;
  h.stream.setView(view());
  h.requests[0].resolve(new Response(new ReadableStream({
    cancel() { cancelled++; return new Promise(resolve => { finishCancel = resolve; }); },
  })));
  await settle();
  h.stream.setPaused(true); h.stream.setView(view(.01)); h.stream.setPaused(false);
  await settle();
  assert.equal(cancelled, 1); assert.equal(h.requests.length, 1);
  assert.equal(h.current().failures.length, 0); assert.equal(h.current().cacheTiles, 0);
  finishCancel(); await settle();
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].id, "x1_y0");
  h.finish(h.requests[1]); await settle(); assert.equal(h.current().tiles.length, 1);
});
test("pause during SHA verification cannot publish the stale verified tile after resume", async t => {
  const h = harness(fixture(1), { ...tileBudget, activeTiles: 1, cacheTiles: 1, concurrency: 1 });
  t.after(() => h.stream.dispose());
  const digest = crypto.subtle.digest.bind(crypto.subtle); let finishDigest;
  const mocked = t.mock.method(crypto.subtle, "digest", (...args) => new Promise(resolve => {
    finishDigest = () => resolve(digest(...args));
  }));
  h.stream.setView(view()); h.finish(h.requests[0]); await settle();
  assert.equal(typeof finishDigest, "function");
  h.stream.setPaused(true); h.stream.setPaused(false);
  assert.equal(h.requests.length, 1);
  finishDigest(); mocked.mock.restore(); await settle();
  assert.equal(h.current().cacheTiles, 0); assert.equal(h.current().failures.length, 0);
  assert.equal(h.requests.length, 2);
  h.finish(h.requests[1]); await settle(); assert.equal(h.current().tiles.length, 1);
});
test("selection changes while paused retain or clear the frozen selected tile within one-tile budget", async t => {
  const f = fixture(3), h = harness(f, { ...tileBudget, activeTiles: 1, cacheTiles: 2, concurrency: 1 });
  t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.finish(h.requests[0]); await settle();
  const frozen = h.current().tiles, remote = view(.02, [.019, 50.999, .021, 51.001]);
  h.stream.setPaused(true); h.stream.setView(remote, "building0");
  assert.equal(h.current().tiles, frozen);
  h.stream.setPaused(false);
  assert.equal(h.requests.length, 1); assert.equal(h.current().tiles, frozen);
  assert.equal(h.current().wanted, 1); assert.equal(h.current().omitted, 1);
  h.stream.setPaused(true); h.stream.setView(remote, "building0"); h.stream.setView(remote, null);
  assert.equal(h.current().tiles, frozen);
  h.stream.setPaused(false); assert.equal(h.requests[1].id, "x2_y0");
  h.finish(h.requests[1]); await settle();
  assert.equal(h.current().tiles[0].tile_id, "x2_y0");
  h.stream.setPaused(true); h.stream.setView(view()); h.stream.setPaused(false);
  assert.equal(h.requests.length, 2); assert.equal(h.current().tiles[0], frozen[0]);
});
test("pause alone retains failures; explicit retry while paused waits for resume and retries the latest plan", async t => {
  const h = harness(fixture(2), { ...tileBudget, activeTiles: 1, cacheTiles: 2, concurrency: 1 });
  t.after(() => h.stream.dispose());
  h.stream.setView(view()); h.requests[0].reject(new Error("Network unavailable")); await settle();
  h.stream.setPaused(true); h.stream.setPaused(false);
  assert.equal(h.requests.length, 1); assert.match(h.current().failures[0].message, /Network unavailable/);
  h.stream.setView(view(.01)); h.finish(h.requests[1]); await settle();
  h.stream.setPaused(true); h.stream.retry(); h.stream.retry(); h.stream.setView(view());
  assert.equal(h.requests.length, 2); assert.equal(h.current().tiles[0].tile_id, "x1_y0");
  assert.equal(h.current().loading, 0);
  h.stream.setPaused(false);
  assert.equal(h.requests.length, 3); assert.equal(h.requests[2].id, "x0_y0");
  assert.equal(h.current().failures.length, 0);
  h.finish(h.requests[2]); await settle(); assert.equal(h.current().tiles[0].tile_id, "x0_y0");
});
test("actual deadline expiry still reports a retryable timeout and respects unsettled transport slots", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness(fixture(1)); t.after(() => h.stream.dispose());
  h.stream.setView(view()); t.mock.timers.tick(20000);
  assert.equal(h.requests[0].signal.aborted, true); assert.equal(h.requests.length, 1);
  h.requests[0].reject(new DOMException("Cancelled", "AbortError"));
  await new Promise(resolve => setImmediate(resolve));
  assert.match(h.current().failures[0].message, /超时/); assert.equal(h.current().loading, 0);
  h.stream.retry(); assert.equal(h.requests.length, 2);
  h.stream.setPaused(true); t.mock.timers.tick(20000);
  h.requests[1].reject(new DOMException("Cancelled", "AbortError"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.current().failures.length, 0); assert.equal(h.current().paused, true);
});
test("repeated dispose while paused suppresses queued views, retries and every late callback", async () => {
  const h = harness(fixture(3)); h.stream.setView(view()); h.stream.setPaused(true);
  h.stream.setView(view(.02)); h.stream.retry();
  const states = h.states.length;
  h.stream.dispose(); h.stream.dispose(); h.stream.setPaused(false); h.stream.setPaused(true);
  h.stream.setView(view()); h.stream.retry();
  h.requests.forEach(h.finish); await settle();
  assert.equal(h.states.length, states); assert.equal(h.requests.length, 2);
  assert.ok(h.requests.every(r => r.signal.aborted));
});
test("cross-tile dedupe retains final references and rejects all conflicting identity kinds", () => {
  const f = fixture(2), a = f.contents.get("x0_y0").tile, duplicate = structuredClone(a); duplicate.tile_id = "x1_y0";
  const merged = renderTilesToCity(f.manifest, [a, duplicate]); assert.equal(merged.instances.length, 1);
  assert.equal(renderTilesToCity(f.manifest, [duplicate]).instances.length, 1); assert.equal(renderTilesToCity(f.manifest, []).instances.length, 0);
  for (const change of [t => t.assets.asset0.primitives[0].color = "#ffffff", t => t.geometry_library.unitbox.kind = "mesh", t => t.instances[0].heading = 12]) {
    const bad = structuredClone(duplicate); change(bad); assert.throws(() => renderTilesToCity(f.manifest, [a, bad]), /身份冲突/);
  }
  assert.throws(() => renderTilesToCity(f.manifest, [{ ...a, revision: "b".repeat(64) }]), /跨城市或修订/);
  assert.equal(merged.format, "gugis-render-scene"); assert.equal(merged.version, undefined); assert.equal(merged.source_revision, revision);
});
test("adapter retains exact box, box-set, mesh, IDs and transform order without scaling or source edits", async () => {
  const f = fixture(1), tile = structuredClone(f.contents.get("x0_y0").tile);
  tile.geometry_library = { box: { kind: "box" }, set: { kind: "box-set", bounds: [[1, 2, 3, 4, 6, 8]] }, mesh: { kind: "mesh", vertices: [[0, 0, 0], [2, 0, 0], [0, 3, 1]], triangles: [[0, 1, 2]] } };
  const p = tile.assets.asset0.primitives[0];
  tile.assets.asset0.primitives = [{ ...p, geometry: "box" }, { ...p, id: "set-node", template_id: "set-template", geometry: "set", size: undefined, rotation_z: -40 },
    { ...p, id: "mesh-node", template_id: "mesh-template", geometry: "mesh", size: undefined, position: [4, 5, 6] }];
  const before = JSON.stringify(tile), city = renderTilesToCity(f.manifest, [tile]), asset = city.assets.asset0;
  assert.deepEqual(city.instances, tile.instances); assert.deepEqual(asset.nodes.map(n => n.id), ["node", "set-node", "mesh-node"]);
  assert.deepEqual(asset.templates.wall.size, [5, 7, 11]); assert.equal(asset.parameters.scale, undefined);
  assert.deepEqual(asset.templates["mesh-template"].vertices, tile.geometry_library.mesh.vertices); assert.deepEqual(asset.templates["mesh-template"].triangles, tile.geometry_library.mesh.triangles);
  const topology = JSON.parse(await readFile(new URL("../../shared/box-topology.json", import.meta.url), "utf8"));
  assert.deepEqual(asset.templates["set-template"].vertices, topology.corners.map(c => c.map(i => tile.geometry_library.set.bounds[0][i])));
  assert.deepEqual(asset.templates["set-template"].triangles, topology.triangles);
  const placement = city.instances[0], node = asset.nodes[2];
  const frame = Matrix4.multiplyByMatrix3(Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(placement.longitude, placement.latitude, placement.altitude)), Matrix3.fromRotationZ(CM.toRadians(-placement.heading)), new Matrix4());
  const transform = Matrix4.multiplyByMatrix3(Matrix4.multiplyByTranslation(frame, new Cartesian3(...node.position), new Matrix4()), Matrix3.fromRotationZ(CM.toRadians(node.rotation_z)), new Matrix4());
  const local = new Cartesian3(...tile.geometry_library.mesh.vertices[1]), world = Matrix4.multiplyByPoint(transform, local, new Cartesian3());
  const rotated = Matrix3.multiplyByVector(Matrix3.fromRotationZ(CM.toRadians(p.rotation_z)), local, new Cartesian3());
  const expected = Matrix4.multiplyByPoint(frame, Cartesian3.add(rotated, new Cartesian3(4, 5, 6), new Cartesian3()), new Cartesian3());
  assert.ok(Cartesian3.distance(world, expected) < 1e-8); assert.equal(JSON.stringify(tile), before);
});
test("tile validation rejects broken topology, duplicate IDs, nonfinite placement and missing box dimensions", () => {
  const f = fixture(1), tile = f.contents.get("x0_y0").tile; assert.equal(validateTile(tile, f.manifest, f.manifest.tiles[0]), tile);
  for (const change of [t => t.instances.push(t.instances[0]), t => t.assets.asset0.primitives.push(t.assets.asset0.primitives[0]),
    t => t.geometry_library.unitbox = { kind: "mesh", vertices: [[0, 0, 0]], triangles: [[0, 1, 2]] },
    t => t.assets.asset0.primitives[0].position = [0, Infinity, 0], t => t.assets.asset0.primitives[0].size = undefined]) {
    const bad = structuredClone(tile); change(bad); assert.throws(() => validateTile(bad, f.manifest, f.manifest.tiles[0]));
  }
});


test("named loading profiles are immutable allowlisted reductions of the existing hard ceilings", () => {
  assert.deepEqual(Object.keys(tileLoadingProfiles), ["balanced", "economy"]);
  assert.equal(tileLoadingProfiles.balanced, tileBudget);
  assert.deepEqual(tileLoadingProfiles.balanced, { activeTiles: 8, activeBytes: 8 * 1024 * 1024, cacheTiles: 16, cacheBytes: 16 * 1024 * 1024, concurrency: 3 });
  assert.deepEqual(tileLoadingProfiles.economy, { activeTiles: 2, activeBytes: 2 * 1024 * 1024, cacheTiles: 4, cacheBytes: 4 * 1024 * 1024, concurrency: 1 });
  assert.ok(Object.isFrozen(tileLoadingProfiles));
  for (const profile of Object.values(tileLoadingProfiles)) {
    assert.ok(Object.isFrozen(profile));
    for (const key of Object.keys(tileBudget)) assert.ok(profile[key] <= tileBudget[key]);
    assert.throws(() => { profile.activeBytes = 999999999; }, TypeError);
  }
  assert.equal(normalizeTileLoadingProfile("economy"), "economy");
  for (const value of [null, undefined, "ECONOMY", "constructor", "__proto__", 2, { activeBytes: 999999999 }, ["economy"]])
    assert.equal(normalizeTileLoadingProfile(value), "balanced");
  assert.throws(() => new RenderTileStream(fixture().manifest, () => {}, { budget: { ...tileBudget, activeBytes: tileBudget.activeBytes + 1 } }), /硬上限/);
});

test("economy bounds live requests at one, active tiles at two and cache count at four", async t => {
  const f = fixture(8), budget = tileLoadingProfiles.economy, h = harness(f, budget); t.after(() => h.stream.dispose());
  let completed = 0;
  async function drain() {
    while (completed < h.requests.length) {
      assert.equal(h.requests.length - completed, 1, "one physical request at a time");
      h.finish(h.requests[completed++]); await settle();
    }
  }
  for (const x of [0, .02, .04, .06, 0]) {
    h.stream.setView(view(x)); await drain();
    assert.equal(h.current().tiles.length, 2);
  }
  assert.equal(Math.max(...h.states.map(s => s.cacheTiles)), 4);
  assert.ok(h.states.every(s => s.tiles.length <= budget.activeTiles && s.activeBytes <= budget.activeBytes &&
    s.cacheTiles <= budget.cacheTiles && s.cacheBytes <= budget.cacheBytes));
  assert.ok(h.requests.filter(r => r.id === "x0_y0").length > 1, "evicted oldest tile is fetched again");
});

function resizeTile(f, index, length) {
  const id = `x${index}_y0`, entry = f.contents.get(id);
  entry.tile.instances[0].name += ".".repeat(length - entry.bytes.length);
  entry.bytes = new TextEncoder().encode(JSON.stringify(entry.tile));
  assert.equal(entry.bytes.length, length);
  f.manifest.tiles[index].byte_length = length; f.manifest.tiles[index].sha256 = hash(entry.bytes);
}

test("economy independently enforces encoded byte caps and preserves a selected complete tile across pause", async t => {
  const f = fixture(6), budget = tileLoadingProfiles.economy;
  for (let i = 0; i < 6; i++) resizeTile(f, i, 1024 * 1024 + 64);
  const h = harness(f, budget); t.after(() => h.stream.dispose());
  for (const x of [0, .01, .02, .03, .04, .05]) {
    h.stream.setView(view(x)); h.finish(h.requests.at(-1)); await settle();
    assert.equal(h.current().tiles.length, 1, "two source tiles would exceed 2 MiB");
  }
  assert.equal(h.current().cacheTiles, 3, "four source tiles would exceed 4 MiB");
  const requests = h.requests.length, retained = h.current().tiles;
  h.stream.setView(view(0, [-.001, 50.999, .001, 51.001]), "building5");
  assert.equal(h.requests.length, requests);
  assert.equal(h.current().tiles[0].tile_id, "x5_y0", "the entire selected building remains pinned inside the same hard budget");
  h.stream.setPaused(true); h.stream.setView(view(.01), "building5");
  assert.equal(h.current().tiles, retained); assert.equal(h.requests.length, requests);
  h.stream.setPaused(false);
  assert.equal(h.current().tiles[0].tile_id, "x5_y0"); assert.equal(h.requests.length, requests);
  h.stream.setView(view(0), null); assert.equal(h.requests.length, requests + 1);
  h.finish(h.requests.at(-1)); await settle();
  assert.ok(h.states.every(s => s.activeBytes <= budget.activeBytes && s.cacheBytes <= budget.cacheBytes && s.cacheTiles <= 4 && s.tiles.length <= 2));
});

test("economy never requests a non-fitting source tile or raises its budget on retry, pin or resume", async t => {
  const f = fixture(2), budget = tileLoadingProfiles.economy;
  f.manifest.tiles[0].byte_length = budget.activeBytes + 1;
  const h = harness(f, budget); t.after(() => h.stream.dispose());
  const nearLargeTile = view(0, [-.001, 50.999, .001, 51.001]);
  h.stream.setView(nearLargeTile, "building0"); h.stream.retry();
  h.stream.setPaused(true); h.stream.setPaused(false);
  assert.equal(h.requests.length, 0); assert.equal(h.current().wanted, 0); assert.equal(h.current().omitted, 1);
  assert.equal(h.current().activeBytes, 0); assert.equal(h.current().failures.length, 0);
  h.stream.setView(view());
  assert.deepEqual(h.requests.map(r => r.id), ["x1_y0"]);
  h.finish(h.requests[0]); await settle();
  assert.equal(h.current().tiles[0].tile_id, "x1_y0");
  assert.deepEqual(chooseViewportTiles(f.manifest, nearLargeTile, tileLoadingProfiles.balanced).chosen.map(tile => tile.id), ["x0_y0"], "larger tiles only fit an explicitly selected larger profile");
});
