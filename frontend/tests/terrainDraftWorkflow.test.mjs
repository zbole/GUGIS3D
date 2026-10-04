import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";
import { emptyEnvironment, featurePresets } from "../src/studio/environment.ts";
import { decodeCity } from "../src/studio/cityArchive.ts";

const cache = new URL("../node_modules/.cache/gugis-tests/", import.meta.url);
await mkdir(cache, { recursive: true });
const outfile = fileURLToPath(new URL("CityStudio.terrain-draft.mjs", cache));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/CityStudio.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile,
  loader: { ".css": "empty" }, define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' },
  plugins: [{ name: "non-browser-scene", setup(build) {
    build.onResolve({ filter: /^react$/, namespace: "fixture" }, () => ({ path: "react", external: true }));
    build.onResolve({ filter: /^\.\/(CityScene|DetailPanel|MemoryComparison)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "./CityScene"
      ? 'import React from "react"; export default React.forwardRef((props, ref) => { globalThis.terrainDraftScene = props; return React.createElement("div", {className:"test-scene"}); });'
      : "export default () => null", loader: "js" }));
  } }],
});

test("single-building export receipts retain the exported identity and never overwrite the formal-city path", async () => {
  const windowBefore = globalThis.window, fetchBefore = globalThis.fetch;
  globalThis.window = { location: new URL("http://localhost/?city=london"), addEventListener() {}, removeEventListener() {} };
  const seed = decodeCity(JSON.parse(await readFile(new URL("../../backend/data/cities/london.gugis.json", import.meta.url), "utf8")));
  const first = seed.instances[0], asset = seed.assets[first.asset];
  const city = { ...seed, assets: { asset }, instances: [
    { ...first, id: "one", asset: "asset", name: "QA exported one" },
    { ...first, id: "two", asset: "asset", name: "QA selected two" },
  ], roads: [] };
  let resolve, exports = 0, cityWrites = 0, renderer;
  const pending = new Promise(yes => { resolve = yes; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/studio/save"); assert.equal(JSON.parse(options.body).parameters.name, "QA exported one");
    exports++; return pending;
  };
  const api = { cityExportUrl: "/qa/city-export", loadCity: async () => ({ document: city, revision: "a".repeat(64), storage: null }),
    loadDraft: async () => null, persistCity: async () => { cityWrites++; return { revision: "b".repeat(64), storage: null, directory: "C:/qa/city", filename: "current.gugis.json" }; } };
  const workspace = { id: "london", name: "伦敦", status: "ready", coverage_kind: "sample", coverage_label: "QA sample" };
  try {
    await act(async () => { renderer = create(React.createElement(Studio, { api, workspace })); });
    const exportClick = button(renderer.root, "单栋导出").props.onClick;
    act(() => { exportClick(); exportClick(); });
    assert.equal(exports, 1, "double clicks cannot create duplicate export writes");
    act(() => globalThis.terrainDraftScene.onSelect("two"));
    await act(async () => resolve(new Response(JSON.stringify({ directory: "C:/qa/objects", filename: "one.json", download_path: "/studio/download/one.json" }))));
    const receipt = renderer.root.findByProps({ className: "save-receipt" });
    assert.match(text(receipt), /QA exported one.*one.*C:\/qa\/objects\/one.json/);
    assert.doesNotMatch(text(receipt), /QA selected two/);
    assert.equal(receipt.findByType("a").props.href, "/api/studio/download/one.json");
    const pathText = () => renderer.root.findByProps({ className: "studio-status" }).findAllByType("span").find(n => n.props.title);
    assert.match(pathText().props.title, /伦敦独立城市工作区/);
    assert.doesNotMatch(pathText().props.title, /objects|\.local\/city/);
    await act(async () => button(renderer.root, "删除").props.onClick());
    assert.equal(cityWrites, 1);
    assert.equal(pathText().props.title, "C:/qa/city/current.gugis.json");
    assert.match(text(renderer.root.findByProps({ className: "save-receipt" })), /C:\/qa\/objects\/one.json/);
    act(() => renderer.root.findByProps({ "aria-label": "关闭保存位置" }).props.onClick());
    assert.equal(renderer.root.findAllByProps({ className: "save-receipt" }).length, 0);
    assert.equal(pathText().props.title, "C:/qa/city/current.gugis.json");
  } finally {
    if (renderer) act(() => renderer.unmount());
    if (windowBefore === undefined) delete globalThis.window; else globalThis.window = windowBefore;
    globalThis.fetch = fetchBefore; delete globalThis.terrainDraftScene;
  }
});
const Studio = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const button = (root, label) => root.findAllByType("button").find(b => text(b) === label);
const terrain = name => ({ id: name, name, longitude: -2.603, latitude: 51.454, reference_height: 0,
  vertical_datum: "local", demonstration: true, source: { 来源: "test-only" },
  points: [[0,0,0], [10,0,1], [0,10,2], [10,10,3]],
  patches: [{ id: "strip", kind: "ruled-strip", left: [0,1], right: [2,3] }] });

test("terrain preview preserves the rest of the city, survives reload, discards safely and commits only on confirmation", async () => {
  const windowBefore = globalThis.window;
  globalThis.window = { location: new URL("http://localhost/?workspace=environment&view=terrain"),
    addEventListener() {}, removeEventListener() {} };
  const formal = { format: "gugis-city", version: "1.0", coordinate_system: "ENU_METERS_WGS84", name: "QA city", assets: {}, instances: [],
    roads: [{ id: "road", name: "retained", width: 5, coordinates: [[-2.603,51.454], [-2.602,51.454]] }], metadata: { keep: "value" },
    environment: { ...emptyEnvironment(), terrain: terrain("original"), feature_assets: { lamp: featurePresets.lamp },
      features: [{ id: "lamp", asset: "lamp", name: "retained", longitude: -2.603, latitude: 51.454, altitude: 0, heading: 0, scale: 1, layer: "surface" }] } };
  const before = JSON.stringify(formal), revision = "a".repeat(64), draftRevision = "b".repeat(64);
  let pending = null, writes = 0, stageCalls = 0, renderer;
  const api = { cityExportUrl: "/qa/export", terrainMultipatchUrl: "/qa/terrain.zip",
    loadCity: async () => ({ document: formal, revision, storage: null }), loadDraft: async () => ({ draft: null }),
    demoTerrain: async () => ({ terrain: terrain("replacement") }),
    persistCity: async () => { writes++; throw new Error("formal save must not be used for terrain preview"); },
    persistDraft: async (document, base_revision, old, label) => { stageCalls++; assert.equal(base_revision, revision); assert.equal(old, null);
      pending = { document, base_revision, label, revision: draftRevision }; return { revision: draftRevision }; },
    discardDraft: async id => { assert.equal(id, draftRevision); pending = null; },
    commitDraft: async id => { assert.equal(id, draftRevision); writes++; return { revision: "c".repeat(64), storage: null, directory: "qa", filename: "qa.json" }; } };
  // CityApi.loadDraft returns the decoded draft itself, rather than an HTTP envelope.
  api.loadDraft = async () => pending;
  try {
    await act(async () => { renderer = create(React.createElement(Studio, { api })); });
    await act(async () => button(renderer.root, "创建演示地形（非实测）").props.onClick());
    assert.equal(writes, 0); assert.equal(stageCalls, 1);
    assert.equal(globalThis.terrainDraftScene.city.environment.terrain.name, "replacement");
    assert.deepEqual(pending.document.roads, formal.roads);
    assert.deepEqual(pending.document.environment.features, formal.environment.features);
    assert.deepEqual(pending.document.environment.feature_assets, formal.environment.feature_assets);
    assert.deepEqual(pending.document.metadata, formal.metadata);
    assert.equal(JSON.stringify(formal), before);
    act(() => renderer.unmount());
    await act(async () => { renderer = create(React.createElement(Studio, { api })); });
    assert.equal(globalThis.terrainDraftScene.city.environment.terrain.name, "replacement");
    assert.ok(button(renderer.root, "确认写入正式城市"));
    await act(async () => button(renderer.root, "丢弃草稿").props.onClick());
    assert.equal(pending, null); assert.equal(writes, 0);
    assert.equal(globalThis.terrainDraftScene.city.environment.terrain.name, "original");
    await act(async () => button(renderer.root, "创建演示地形（非实测）").props.onClick());
    await act(async () => button(renderer.root, "确认写入正式城市").props.onClick());
    assert.equal(writes, 1);
    assert.equal(globalThis.terrainDraftScene.city.environment.terrain.name, "replacement");
    assert.equal(JSON.stringify(formal), before);
  } finally {
    if (renderer) act(() => renderer.unmount());
    if (windowBefore === undefined) delete globalThis.window; else globalThis.window = windowBefore;
    delete globalThis.terrainDraftScene;
  }
});
