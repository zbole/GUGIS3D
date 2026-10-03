import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalJson, loadRenderManifest, RenderTileStream, validateTile } from "../../src/studio/renderTileClient.ts";

export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const deferred = () => Promise.withResolvers();
export const descriptorCount = 2048;
const columns = 64;

/** Synthetic identities/locations, never additional London or UK coverage.
 * Only one unchanged mesh is borrowed from the committed seed. Tile bodies are
 * generated on demand, rather than retaining 2,048 copies of that mesh.
 */
export async function makeSyntheticFixture() {
  const seed = JSON.parse(await readFile(new URL("../../../backend/data/cities/london.gugis.json", import.meta.url), "utf8"));
  assert.match(seed.metadata.source_sha256, /^[a-f0-9]{64}$/, "borrowed mesh retains an explicit source fingerprint");
  const [seedMeshId, mesh] = Object.entries(seed.geometry_library).find(([, value]) => value.kind === "mesh");
  const geometry = structuredClone(mesh);
  const sourceBytes = Buffer.from(canonicalJson({
    purpose: "SYNTHETIC loader regression, not geographic coverage", version: 1,
    columns, descriptorCount, seedMeshId, geometry,
  }));
  const revision = hash(sourceBytes);
  assert.notEqual(revision, seed.metadata.source_sha256);
  const asset = { quality: "full-fallback", kind: "footprint", primitives: [{
    id: "synthetic-primitive", node_id: "synthetic-node", template_id: "synthetic-template",
    category: "wall", geometry: "synthetic-mesh", color: "#aab5be", position: [0, 0, 0], rotation_z: 0,
  }] };
  const bounds = [0, 1, 2].map(axis => Math.min(...geometry.vertices.map(v => v[axis])))
    .concat([0, 1, 2].map(axis => Math.max(...geometry.vertices.map(v => v[axis]))));
  function tileFor(id) {
    const coordinates = /^x(\d+)_y(\d+)$/.exec(id), x = Number(coordinates[1]), y = Number(coordinates[2]);
    return { format: "gugis-render-tile-v1", city_id: "london", revision, tile_id: id,
      geometry_library: { "synthetic-mesh": geometry }, assets: { "synthetic-asset": asset },
      instances: [{ id: `synthetic-${y * columns + x}`, asset: "synthetic-asset", name: `SYNTHETIC ${id}`,
        longitude: x * .01, latitude: y * .01, altitude: 0, heading: 0 }] };
  }
  const bytesFor = id => Buffer.from(JSON.stringify(tileFor(id)));
  const manifest = {
    format: "gugis-render-package-v1", city_id: "london", name: "SYNTHETIC many-tile loader regression",
    revision, source_sha256: revision, source_byte_length: sourceBytes.length,
    grid: { coordinate_system: "ECEF_ENU", origin_wgs84: [0, 0, 0], tile_size_m: 250 },
    bounds_enu: null, bounds_wgs84: null,
    counts: { buildings: descriptorCount, assets: 1, primitives: descriptorCount, tiles: descriptorCount, source_roads: 0 },
    limits: { max_buildings: 256, max_primitives: 12000, max_bytes: 2097152, max_tiles: 20000 },
    layers: { buildings: "included", roads: "not-included", terrain: "not-included", features: "not-included", semantics: "not-included" },
    quality_warnings_source_revision: revision,
    quality_warnings: [{ code: "synthetic-fixture", message: "Synthetic identities and placements; no new real coverage or performance claim" }],
    attribution: { source: "SYNTHETIC regression; unchanged London seed mesh © OpenStreetMap contributors",
      license: "ODbL 1.0", license_url: "https://www.openstreetmap.org/copyright",
      metadata: { coverage_kind: "synthetic-test-only", seed_mesh_id: seedMeshId,
        seed_source_sha256: seed.metadata.source_sha256, geometry_policy: "One unchanged mesh; synthetic identities and locations" } },
    tiles: [],
  };
  for (let i = 0; i < descriptorCount; i++) {
    const x = i % columns, y = Math.floor(i / columns), id = `x${x}_y${y}`, bytes = bytesFor(id);
    const descriptor = { id, grid: [x, y], cell_bounds_enu: [x * 250, y * 250, (x + 1) * 250, (y + 1) * 250],
      bounds_enu: bounds.map((value, axis) => value + (axis % 3 === 0 ? x * 250 : axis % 3 === 1 ? y * 250 : 0)),
      bounds_wgs84: [x * .01 - .001, y * .01 - .001, x * .01 + .001, y * .01 + .001],
      building_count: 1, primitive_count: 1, byte_length: bytes.length, sha256: hash(bytes),
      url: `/cities/london/render/${revision}/tiles/${id}` };
    validateTile(tileFor(id), manifest, descriptor);
    manifest.tiles.push(descriptor);
  }
  return { manifest: await verifyManifest(manifest), bytesFor };
}

/** Exercise the real manifest protocol, including its exact-byte ETag. */
export async function verifyManifest(manifest) {
  delete manifest.package_sha256;
  manifest.package_sha256 = hash(canonicalJson(manifest));
  const bytes = Buffer.from(JSON.stringify(manifest));
  assert.ok(bytes.length < 4 * 1024 * 1024, "fixture stays inside the existing manifest byte limit");
  const signal = new AbortController().signal;
  const loaded = await loadRenderManifest("london", signal, "/api", async (url, options) => {
    assert.equal(url, "/api/cities/london/render/manifest");
    assert.equal(options.signal, signal);
    assert.equal(options.cache, "no-store");
    return new Response(bytes, { headers: { etag: `"${hash(bytes)}"` } });
  });
  assert.equal(loaded.manifest.tiles.length, descriptorCount);
  return loaded.manifest;
}

export const centerView = descriptor => ({ bounds: null, center: {
  longitude: (descriptor.bounds_wgs84[0] + descriptor.bounds_wgs84[2]) / 2,
  latitude: (descriptor.bounds_wgs84[1] + descriptor.bounds_wgs84[3]) / 2,
} });
export function rectangleView(manifest, start, count) {
  const first = manifest.tiles[start], last = manifest.tiles[start + count - 1];
  assert.equal(first.grid[1], last.grid[1], "a fixture rectangle stays in one row");
  return { ...centerView(first), bounds: [first.bounds_wgs84[0], first.bounds_wgs84[1], last.bounds_wgs84[2], last.bounds_wgs84[3]] };
}

/** Deferred transport and event-driven completion, without timers/polling.
 * The test-only load observer does not alter queue behavior: it only exposes the
 * existing async method's completion, needed when disposal suppresses notify().
 */
export function makeHarness(manifest, budget) {
  const descriptors = new Map(manifest.tiles.map(d => [d.id, d]));
  const requests = [], loads = new Set();
  let change = deferred(), state, failure, live = 0, peak = 0, emissions = 0, peakCache = 0;
  const wake = () => { change.resolve(); change = deferred(); };
  const check = () => { if (failure) throw failure; };
  const stream = new RenderTileStream(manifest, value => {
    try {
      assert.ok(value.tiles.length <= budget.activeTiles);
      assert.ok(value.activeBytes <= budget.activeBytes);
      assert.ok(value.cacheTiles <= budget.cacheTiles);
      assert.ok(value.cacheBytes <= budget.cacheBytes);
      assert.ok(value.cacheTiles >= value.tiles.length);
      assert.ok(value.cacheBytes >= value.activeBytes);
      assert.equal(new Set(value.tiles.map(tile => tile.tile_id)).size, value.tiles.length);
      assert.equal(new Set(value.tiles.flatMap(tile => tile.instances.map(instance => instance.id))).size,
        value.tiles.reduce((sum, tile) => sum + tile.instances.length, 0));
      assert.equal(value.activeBytes, value.tiles.reduce((sum, tile) => sum + descriptors.get(tile.tile_id).byte_length, 0));
      assert.equal(new Set(value.failures.map(item => item.id)).size, value.failures.length);
      assert.ok(value.failures.every(item => !value.tiles.some(tile => tile.tile_id === item.id)));
      if (!value.paused) assert.equal(value.tiles.length + value.loading + value.failures.length, value.wanted);
    } catch (error) { failure ??= error; }
    state = value; emissions++; peakCache = Math.max(peakCache, value.cacheTiles); wake();
  }, { budget, fetcher: (url, options) => {
    const id = url.split("/").at(-1), transport = deferred();
    assert.equal(url, `/api${descriptors.get(id).url}`);
    assert.equal(options.cache, "force-cache");
    live++; peak = Math.max(peak, live);
    if (live > budget.concurrency) failure ??= new Error(`Physical reads ${live} exceed concurrency ${budget.concurrency}`);
    const request = { id, signal: options.signal, answered: false, readStarted: deferred(), finish(response) {
      assert.equal(request.answered, false, "each deferred request is answered once");
      request.answered = true;
      const reader = response.body.getReader();
      let ended = false, cancelling = false;
      const end = () => { if (!ended) { ended = true; live--; wake(); } };
      // Count physical work until EOF or cancellation actually settles, not
      // merely until fetch returns headers or its AbortSignal fires.
      const body = new ReadableStream({
        async pull(controller) {
          request.readStarted.resolve();
          const chunk = await reader.read();
          if (cancelling) return;
          if (chunk.done) { controller.close(); end(); } else controller.enqueue(chunk.value);
        },
        async cancel(reason) { cancelling = true; try { await reader.cancel(reason); } finally { end(); } },
      }, { highWaterMark: 0 });
      transport.resolve(new Response(body, { status: response.status, headers: response.headers }));
      wake();
    } };
    requests.push(request); wake(); return transport.promise;
  } });
  const load = stream.load.bind(stream);
  stream.load = (...args) => {
    const pending = load(...args); loads.add(pending);
    void pending.then(() => { loads.delete(pending); wake(); }, error => { failure ??= error; loads.delete(pending); wake(); });
    return pending;
  };
  async function waitFor(predicate) {
    while (true) { check(); if (predicate()) return; await change.promise; }
  }
  async function drain(respond) {
    while (true) {
      check();
      if (state?.loading === 0 && loads.size === 0) return;
      const next = change.promise;
      for (const request of requests.filter(r => !r.answered)) request.finish(respond(request));
      await next;
    }
  }
  return { stream, requests, check, waitFor, drain,
    idle: () => waitFor(() => loads.size === 0),
    get current() { check(); return state; }, get emissions() { return emissions; },
    get peak() { return peak; }, get live() { return live; }, get peakCache() { return peakCache; },
  };
}
