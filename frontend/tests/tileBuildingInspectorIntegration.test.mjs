import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";
import { inspectorScene } from "./helpers/tileInspectorScene.mjs";

// A separate bundle filename prevents racing the real-Cesium preview test bundle.
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/TileBuildingInspectorIntegration.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/CityTilePreview.tsx", import.meta.url))],
  outfile, bundle: true, platform: "node", format: "esm", packages: "external", plugins: [{ name: "inspector-scene-contract", setup(build) {
    build.onResolve({ filter: /^\.\/CityScene$/ }, () => ({ path: new URL("./helpers/tileInspectorScene.mjs", import.meta.url).href, external: true }));
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  } }] });
const Preview = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value));
const workspace = id => ({ id, name: id, status: "ready", coverage_kind: "sample-area", coverage_label: "sample", center_wgs84: [-.12, 51.5] });
function renderPackage(city = "london", revision = "a".repeat(64)) {
  const bodies = new Map();
  const tiles = [0, 1].map(index => {
    const id = `x${index}_y0`, longitude = -.12 + index * .01;
    const instances = Array.from({ length: 30 }, (_, row) => ({ id: `building-${String(index * 30 + row).padStart(3, "0")}`,
      name: `${city} source ${index * 30 + row}`, asset: "brick", longitude, latitude: 51.5, altitude: 1.25, heading: 17.125 }));
    const body = encode({ format: "gugis-render-tile-v1", city_id: city, revision, tile_id: id,
      geometry_library: { cube: { kind: "box" } }, assets: { brick: { quality: "full-fallback", kind: "urban", primitives: [{
        id: "wall", node_id: "wall", template_id: "wall", category: "wall", geometry: "cube", color: "#aabbcc", size: [10, 10, 10], position: [0, 0, 5], rotation_z: 0 }] } }, instances });
    bodies.set(id, body);
    return { id, grid: [index, 0], cell_bounds_enu: [index * 250, 0, (index + 1) * 250, 250], bounds_enu: [0, 0, 0, 20, 20, 20],
      bounds_wgs84: [longitude - .001, 51.499, longitude + .001, 51.501], building_count: 30, primitive_count: 30,
      byte_length: body.length, sha256: hash(body), url: `/cities/${city}/render/${revision}/tiles/${id}` };
  });
  const manifest = { format: "gugis-render-package-v1", city_id: city, name: `${city} source`, revision, source_sha256: revision,
    source_byte_length: 10000, package_sha256: "b".repeat(64), bounds_enu: null, bounds_wgs84: null,
    grid: { coordinate_system: "ECEF_ENU", origin_wgs84: [-.12, 51.5, 0], tile_size_m: 250 },
    counts: { buildings: 60, assets: 1, primitives: 60, tiles: 2, source_roads: 0 },
    limits: { max_buildings: 100, max_primitives: 1000, max_bytes: 1024 * 1024, max_tiles: 100 },
    layers: { buildings: "included", roads: "not-included", terrain: "not-included", features: "not-included", semantics: "not-included" },
    quality_warnings_source_revision: revision, quality_warnings: [], attribution: { source: "OSM", license: "ODbL", license_url: "", metadata: {} }, tiles };
  return { manifest, respond(url) {
    const bytes = url.endsWith("/manifest") ? encode(manifest) : bodies.get(url.split("/").at(-1));
    assert.ok(bytes, `Unexpected route: ${url}`);
    return new Response(bytes, { headers: { "content-length": String(bytes.length), ...(url.endsWith("/manifest") ? { etag: `"${hash(bytes)}"` } : {}) } });
  } };
}
async function until(predicate, message) {
  for (let i = 0; i < 100 && !predicate(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.ok(predicate(), message);
}
function fixture(t) {
  let renderer, city = "london";
  const previousFetch = globalThis.fetch, calls = [], states = [], packages = { london: renderPackage(), bristol: renderPackage("bristol") };
  inspectorScene.focuses = []; inspectorScene.resets = 0;
  globalThis.fetch = async (url, options = {}) => { calls.push({ url, options }); return packages[url.split("/")[3]].respond(url); };
  const element = () => React.createElement(Preview, { workspace: workspace(city), onWorkspaceState: (...state) => states.push(state) });
  act(() => { renderer = create(element()); });
  t.after(() => { act(() => renderer.unmount()); globalThis.fetch = previousFetch; });
  return { calls, states, packages,
    get root() { return renderer.root; },
    get content() { return text(renderer.toJSON()); },
    get input() { return renderer.root.findByType("input"); },
    get rows() { return renderer.root.findByProps({ className: "tile-building-list" }).findAllByType("li"); },
    search(query) { act(() => renderer.root.findByType("input").props.onChange({ target: { value: query } })); },
    click(label) { const button = renderer.root.findAllByType("button").find(node => text(node) === label); assert.ok(button, label); act(() => button.props.onClick()); },
    selectRow() { act(() => renderer.root.findByProps({ className: "tile-building-list" }).findAllByType("li")[0].findByType("button").props.onClick()); },
    switchCity(next) { city = next; act(() => renderer.update(element())); },
    assertReadOnly() {
      assert.ok(calls.every(({ url, options }) => /^\/api\/cities\/(london|bristol)\/render\/(manifest|[a-f0-9]{64}\/tiles\/x[01]_y0)$/.test(url) && (options.method ?? "GET") === "GET" && !options.body));
      assert.ok(states.every(([, busy, draft]) => !busy && !draft));
    },
  };
}

test("search and pagination make no requests; list/canvas selection share exact details and only explicit focus moves the camera", async t => {
  const f = fixture(t);
  await until(() => f.content.includes("匹配 60 / 60"), "all fixture tiles loaded");
  assert.equal(f.calls.length, 3);
  assert.equal(f.rows.length, 25);
  f.click("下一页"); f.click("下一页");
  assert.equal(f.rows.length, 10);
  f.search("BUILDING-059"); f.selectRow();
  assert.equal(inspectorScene.props.selected, "building-059");
  assert.match(f.content, /london source 59/);
  assert.deepEqual(inspectorScene.focuses, []);
  f.click("定位所选建筑");
  assert.deepEqual(inspectorScene.focuses, ["building-059"]);
  f.search("not loaded");
  assert.equal(f.rows.length, 0);
  assert.ok(f.content.includes("london source 59"));
  act(() => inspectorScene.props.onSelect("building-001"));
  assert.match(text(f.root.findByProps({ className: "tile-building-details" })), /london source 1/);
  f.click("清除选择");
  assert.equal(inspectorScene.props.selected, null);
  assert.equal(f.calls.length, 3, "all search/select/focus actions reuse loaded tiles");
  assert.equal(inspectorScene.resets, 0);
  f.assertReadOnly();
});

test("selected buildings stay pinned offscreen, then clearing releases them; stale callbacks cannot select evicted rows", async t => {
  const f = fixture(t);
  await until(() => f.content.includes("匹配 60 / 60"), "tiles loaded");
  f.search("building-001");
  const staleClick = f.rows[0].findByType("button").props.onClick;
  f.selectRow();
  act(() => inspectorScene.props.onViewBounds({ bounds: [-.111, 51.499, -.109, 51.501], center: { longitude: -.11, latitude: 51.5 } }));
  assert.equal(inspectorScene.props.selected, "building-001");
  assert.equal(inspectorScene.props.city.instances.length, 60, "one source tile stays pinned within existing budgets");
  f.click("清除选择");
  assert.equal(inspectorScene.props.city.instances.length, 30);
  assert.equal(f.rows.length, 0, "cached but evicted buildings are not searchable");
  assert.doesNotMatch(text(f.root.findByProps({ className: "tile-building-details" })), /london source 1/);
  act(() => staleClick());
  assert.equal(inspectorScene.props.selected, null);
  f.search("");
  assert.match(f.content, /匹配 30 \/ 30/);
  assert.equal(f.calls.length, 3);
  f.assertReadOnly();
});

test("same-revision reload and city/revision switches clear search, page and selection despite reused IDs", async t => {
  const f = fixture(t);
  await until(() => f.content.includes("匹配 60 / 60"), "initial tiles loaded");
  f.search("building-001"); f.selectRow();
  f.click("重新检查渲染包");
  assert.equal(f.root.findAllByType("aside").length, 0, "old inspector is removed while checking manifest");
  await until(() => f.content.includes("匹配 60 / 60"), "same revision reloaded");
  assert.equal(f.input.props.value, "");
  assert.equal(inspectorScene.props.selected, null);
  assert.match(f.content, /第 1 \/ 3 页/);
  f.search("building-001"); f.selectRow();
  f.packages.london = renderPackage("london", "c".repeat(64));
  f.click("重新检查渲染包");
  await until(() => f.content.includes("匹配 60 / 60"), "changed revision reloaded");
  assert.equal(inspectorScene.props.selected, null);
  assert.equal(f.input.props.value, "");
  f.search("building-001"); f.selectRow();
  const oldSelect = inspectorScene.props.onSelect;
  f.switchCity("bristol");
  await until(() => f.content.includes("匹配 60 / 60"), "new city loaded");
  assert.equal(inspectorScene.props.selected, null);
  assert.equal(f.input.props.value, "");
  act(() => oldSelect("building-001"));
  assert.equal(inspectorScene.props.selected, null, "disposed city cannot affect the new city's reused ID");
  f.search("building-001"); f.selectRow();
  assert.match(text(f.root.findByProps({ className: "tile-building-details" })), /bristol source 1/);
  assert.doesNotMatch(f.content, /london source/);
  assert.deepEqual(inspectorScene.focuses, []);
  f.assertReadOnly();
});
