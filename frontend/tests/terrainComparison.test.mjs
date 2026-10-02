import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { create, act } from "react-test-renderer";
import { comparisonSelection, parseArcGISRun, precisionChoice, profilePath } from "../src/compare/comparisonModel.ts";

const suite = JSON.parse(await readFile(new URL("../../shared/terrain-comparison-suite.json", import.meta.url), "utf8"));
// Deliberate test doubles. No ArcGIS run or fake benchmark result is published.
const runFixture = () => ({ schema: "gugis-arcgis-pro-run-v1", cityRevision: suite.cityRevision,
  bundleId: suite.bundleId, repeats: 3, measuredAtUtc: "2026-10-01T01:00:00+00:00",
  runtime: { product: "ArcGISPro", version: "test-double", python: "3.11", os: "test", processor: "" },
  cachePolicy: "one-process-repeated-no-cold-cache-guarantee",
  operations: ["SearchCursor-SHAPE@-and-PATCH_ID", "CopyFeatures-to-new-FGDB"],
  results: suite.variants.map(v => ({ subdivisions: v.ruledSubdivisions, datasetSha256: v.datasetSha256,
    shapeType: "MultiPatch", hasZ: true, horizontalWkid: 27700, featureCount: v.nativePatches,
    vertexCount: v.multipatchVertexEntries, readMs: [30, 10, 20], copyMs: [300, 100, 200],
    copyOutputBytes: [1000, 1001, 1002], medianReadMs: 999999, medianCopyMs: 999999 })) });

test("precision choices use actual bytes, respect exact thresholds and never invent an unmeasured resolution", () => {
  assert.equal(precisionChoice(suite, 1).ruledSubdivisions, 8);
  assert.equal(precisionChoice(suite, .1), null);
  assert.equal(precisionChoice(suite, NaN), null);
  const unsorted = { ...suite, variants: [...suite.variants].reverse() };
  assert.equal(precisionChoice(unsorted, 5).ruledSubdivisions, 2);
  assert.equal(precisionChoice(suite, suite.variants[2].maxRuledHeightErrorMetres * 100).ruledSubdivisions, 4);
});

test("downloaded selection keeps source identity and nullable values without claiming ArcGIS execution", () => {
  const result = comparisonSelection(suite, 2, 1, 'cell', 20, null);
  assert.equal(result.target.selectedSatisfies, false);
  assert.equal(result.target.smallestTestedResolution, 8);
  assert.equal(result.arcgisRuntime.status, 'not-measured');
  assert.equal(result.arcgisRuntime.report, null);
  assert.equal(result.bundleId, suite.bundleId);
  assert.equal(result.packageSha256, suite.packageSha256);
  result.selected.profiles[0].samples[0].height = -999;
  assert.notEqual(suite.variants[1].profiles[0].samples[0].height, -999);
  assert.throws(() => comparisonSelection(suite, 16, 1, 'cell', 0, null));
  assert.throws(() => comparisonSelection(suite, 2, 1, 'cell', -1, null));
});

test("ArcGIS import requires the same package, task and valid repeats; medians use raw values", () => {
  const run = parseArcGISRun(JSON.stringify(runFixture()), suite);
  assert.equal(run.results[0].medianReadMs, 20);
  assert.equal(run.results[0].medianCopyMs, 200);
  for (const mutate of [r => r.cityRevision = "f".repeat(64), r => r.bundleId = "changed",
    r => r.results[0].datasetSha256 = "changed", r => r.results[0].featureCount--,
    r => r.results[0].hasZ = false, r => r.results[0].readMs = [1, null, 3],
    r => r.results[0].copyMs = [-1, 2, 3], r => r.results.push(r.results[0]),
    r => r.results[1] = r.results[0], r => r.cachePolicy = "cold", r => r.runtime.product = "Other"])
  {
    const bad = runFixture(); mutate(bad);
    assert.throws(() => parseArcGISRun(JSON.stringify(bad), suite));
  }
  assert.throws(() => parseArcGISRun("x".repeat(1024 * 1024 + 1), suite), /1 MiB/);
});

test("profile plots break at NoData instead of connecting fabricated elevations", () => {
  const samples = [0, null, 2].map((height, i) => ({ distance: i, height,
    multipatchHeight: height, errorMetres: height === null ? null : 0, patch: null, kind: null }));
  assert.equal(profilePath(samples, "height", 100, 100, 0, 2), "M0.00,100.00 M100.00,0.00");
  assert.equal(profilePath(samples, "errorMetres", 100, 100, -1, 1), "M0.00,50.00 M100.00,50.00");
});

const cache = new URL("../node_modules/.cache/gugis-tests/", import.meta.url);
await mkdir(cache, { recursive: true });
const outfile = fileURLToPath(new URL("TerrainComparisonLab.mjs", cache));
await build({ entryPoints: [fileURLToPath(new URL("../src/compare/TerrainComparisonLab.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile,
  define: { "import.meta.env.VITE_API_BASE_URL": JSON.stringify("/api") } });
const Lab = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const button = (root, name) => root.findAllByType("button").find(n => text(n) === name);
function fixture() {
  const saved = new Map();
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) };
  let renderer;
  act(() => { renderer = create(React.createElement(Lab, { suite })); });
  return { get root() { return renderer.root; }, saved, close: () => act(() => renderer.unmount()) };
}

test("precision target selects a sufficient export and profile stations follow the chosen route", () => {
  const f = fixture();
  const target = f.root.findByProps({ "aria-label": "高程差目标" });
  assert.equal(target.props.value, 1, "the lab starts with the overview's centimetre target");
  assert.match(text(f.root.findByProps({ className: "cmp-lab-score-grid" })), /11.921/);
  act(() => target.props.onChange({ target: { value: "5" } }));
  assert.match(text(f.root.findAllByType("button").find(n => n.props["aria-pressed"] === true && text(n).includes("每个直纹区段"))), /2 × 2/);
  act(() => target.props.onChange({ target: { value: "1" } }));
  const selected = f.root.findAllByType("button").find(n => n.props["aria-pressed"] === true && text(n).includes("每个直纹区段"));
  assert.match(text(selected), /8 × 8/);
  assert.match(text(f.root.findByProps({ className: "cmp-lab-score-grid" })), /11.921/);
  act(() => button(f.root, "街区路线").props.onClick());
  const stations = f.root.findByProps({ "aria-label": "剖面对比站点" });
  const count = suite.variants[3].profiles.find(p => p.id === "city").samples.length;
  assert.equal(stations.props.max, count - 1);
  act(() => stations.props.onChange({ target: { value: String(count - 1) } }));
  assert.match(stations.props["aria-valuetext"], new RegExp(`第 ${count} 站`));
  act(() => button(f.root, "坡度").props.onClick());
  assert.match(f.root.findAllByType("svg").find(n => n.props.role === 'img').props['aria-label'], /坡度.*单位度/);
  assert.match(text(f.root.findByProps({ className: "cmp-derivative-stats" })), /0.014°/);
  act(() => target.props.onChange({ target: { value: ".1" } }));
  assert.match(text(f.root.findByProps({ className: "cmp-budget-verdict" })), /均未达到/);
  f.close();
});

test("report import is browser-only, cancellation is harmless and invalid files preserve prior evidence", async () => {
  const f = fixture();
  const file = f.root.findByProps({ "aria-label": "ArcGIS Pro 实测报告文件" });
  await act(async () => file.props.onChange({ currentTarget: { files: [] } }));
  assert.equal(f.saved.size, 0);
  const input = { files: [{ size: 100, text: async () => JSON.stringify(runFixture()) }], value: "chosen" };
  await act(async () => file.props.onChange({ currentTarget: input }));
  assert.equal(f.saved.size, 1);
  assert.equal(input.value, "");
  assert.match(text(f.root), /用户导入 · 本机未独立复核/);
  const bad = runFixture(); bad.cityRevision = "f".repeat(64);
  await act(async () => file.props.onChange({ currentTarget: { files: [{ size: 100, text: async () => JSON.stringify(bad) }], value: "bad" } }));
  assert.match(text(f.root.findByProps({ role: "alert" })), /另一份城市/);
  assert.equal(f.saved.size, 1);
  assert.match(text(f.root), /test-double/);
  act(() => button(f.root, "清除本浏览器展示").props.onClick());
  assert.equal(f.saved.size, 0);
  assert.match(text(f.root), /运行值待导入/);
  f.close();
});
