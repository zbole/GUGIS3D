// Protocol/in-memory integration using real offline package bytes and a local
// fetch double. This is not a browser, network latency or GPU benchmark.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cache = resolve(process.argv[2] ?? `${root}/.local/render-cache`);
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/render-streaming-integration.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/renderTileClient.ts", import.meta.url))],
  outfile, bundle: true, format: "esm", platform: "node", packages: "external" });
const { loadRenderManifest, RenderTileStream, renderTilesToCity, tileBudget } = await import(pathToFileURL(outfile).href);
const sha = value => createHash("sha256").update(value).digest("hex");
const results = [];
for (const cityId of ["bristol", "london", "birmingham"]) {
  const pointer = JSON.parse(await readFile(`${cache}/${cityId}/active.json`, "utf8"));
  const requests = []; let concurrent = 0, peakConcurrent = 0;
  const fetcher = async (url, options = {}) => {
    assert.equal(options.method ?? "GET", "GET");
    requests.push(url); concurrent++; peakConcurrent = Math.max(peakConcurrent, concurrent);
    try {
      await new Promise(r => setTimeout(r, 1));
      if (options.signal?.aborted) throw new DOMException("aborted", "AbortError");
      let bytes;
      if (url === `/api/cities/${cityId}/render/manifest`) {
        bytes = await readFile(`${cache}/${cityId}/${pointer.revision}/manifest.json`);
        assert.equal(sha(bytes), pointer.manifest_sha256);
      } else {
        const match = String(url).match(new RegExp(`^/api/cities/${cityId}/render/([a-f0-9]{64})/tiles/(x-?\\d+_y-?\\d+)$`));
        assert.ok(match, `Unexpected request (full city loading is forbidden): ${url}`);
        assert.equal(match[1], pointer.revision);
        bytes = await readFile(`${cache}/${cityId}/${match[1]}/tiles/${match[2]}.json`);
      }
      return new Response(bytes, { status: 200, headers: { "content-type": "application/json", "content-length": String(bytes.byteLength),
        etag: `"${sha(bytes)}"`, "x-render-freshness": "current" } });
    } finally { concurrent--; }
  };
  const { manifest } = await loadRenderManifest(cityId, new AbortController().signal, "/api", fetcher);
  let settle;
  const stream = new RenderTileStream(manifest, state => {
    assert.ok(state.activeBytes <= tileBudget.activeBytes);
    assert.ok(state.cacheBytes <= tileBudget.cacheBytes);
    assert.ok(state.cacheTiles <= tileBudget.cacheTiles);
    if (state.failures.length) settle?.reject(Error(JSON.stringify(state.failures)));
    else if (!state.loading && state.wanted) settle?.resolve(state);
  }, { fetcher });
  const view = { bounds: null, center: { longitude: manifest.grid.origin_wgs84[0], latitude: manifest.grid.origin_wgs84[1] } };
  const wait = (next, selected = null) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`${cityId}: stream did not settle`)), 10000);
    settle = { resolve: state => { clearTimeout(timer); resolve(state); }, reject: error => { clearTimeout(timer); reject(error); } };
    stream.setView(next, selected);
  });
  try {
    const initial = await wait(view);
    const scene = renderTilesToCity(manifest, initial.tiles);
    assert.equal(scene.format, "gugis-render-scene");
    assert.equal(scene.roads.length, 0);
    assert.ok(scene.instances.length > 0 && scene.instances.length <= manifest.counts.buildings);
    assert.equal(new Set(scene.instances.map(i => i.id)).size, scene.instances.length);
    const selected = scene.instances[0].id;
    const far = { bounds: [view.center.longitude + .1, view.center.latitude + .1, view.center.longitude + .11, view.center.latitude + .11], center: view.center };
    const pinned = await wait(far, selected);
    assert.ok(renderTilesToCity(manifest, pinned.tiles).instances.some(i => i.id === selected), "selection is retained offscreen inside the tile budget");
    assert.ok(peakConcurrent <= tileBudget.concurrency);
    results.push({ city_id: cityId, source_revision: manifest.revision, source_buildings: manifest.counts.buildings,
      initial_loaded_buildings: scene.instances.length, initial_tiles: initial.tiles.length,
      initial_source_bytes: initial.activeBytes, source_archive_bytes: manifest.source_byte_length,
      package_quality_warnings: manifest.quality_warnings.length, peak_concurrent_requests: peakConcurrent,
      full_city_requests: 0, selected_building_retained_after_pan: true });
  } finally { stream.dispose(); }
}
console.log(JSON.stringify({ mode: "real-package bytes through a fetch double; no GPU or browser timing", results }, null, 2));
