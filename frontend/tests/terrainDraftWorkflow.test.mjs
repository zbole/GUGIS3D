import test from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";
import { emptyEnvironment, featurePresets } from "../src/studio/environment.ts";

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
