import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { create, act } from "react-test-renderer";

const suiteBytes = await readFile(new URL("../../shared/terrain-comparison-suite.json", import.meta.url), "utf8");
const suite = JSON.parse(suiteBytes);
const cache = new URL("../node_modules/.cache/gugis-tests/", import.meta.url);
await mkdir(cache, { recursive: true });
const outfile = fileURLToPath(new URL("CompareShowcase.workflow.mjs", cache));
await build({ entryPoints: [fileURLToPath(new URL("../src/compare/CompareShowcase.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile,
  loader: { ".css": "empty" }, define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' },
  plugins: [{ name: "local-suite-asset", setup(build) {
    build.onResolve({ filter: /terrain-comparison-suite\.json\?url$/ }, () => ({ path: "suite-asset", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export default "/qa/suite.json"', loader: "js" }));
  } }],
});
const Showcase = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const group = (root, label) => root.findByProps({ role: "group", "aria-label": label });

test("overview, lazy-loaded lab, target selection and exports use the same resolution without reloading evidence", async () => {
  const keys = ["window", "document", "localStorage", "location"];
  const previous = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const fetchBefore = globalThis.fetch, urlBefore = URL.createObjectURL;
  const calls = [], blobs = [];
  let renderer;
  try {
    globalThis.window = { addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout };
    globalThis.document = { visibilityState: "visible", title: "", addEventListener() {}, removeEventListener() {},
      body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) };
    globalThis.location = { hash: "" };
    globalThis.localStorage = { getItem: () => null };
    globalThis.fetch = async url => { calls.push(url); return new Response(url === "/qa/suite.json" ? suiteBytes : JSON.stringify({ revision: suite.cityRevision })); };
    URL.createObjectURL = blob => { blobs.push(blob); return urlBefore(blob); };
    await act(async () => { renderer = create(React.createElement(Showcase)); });
    const root = renderer.root;
    const chooseOverview = n => act(() => group(root, "查看离散档位").findAllByType("button").find(b => text(b).startsWith(`${n}×${n}`)).props.onClick());
    const chooseLab = n => act(() => group(root, "三角带离散精度").findAllByType("button").find(b => text(b).startsWith(`${n} × ${n}`)).props.onClick());
    chooseOverview(4);
    assert.match(text(group(root, "三角带离散精度").findAllByType("button").find(b => b.props["aria-pressed"])), /4 × 4/);
    assert.match(text(root.findByProps({ className: "cmp-lab-score-grid" })), /3\.534/);
    assert.match(root.findByProps({ className: "cmp-profile-chart" }).props["aria-label"], /当前 4×4/);
    chooseLab(2);
    assert.match(text(group(root, "查看离散档位").findAllByType("button").find(b => b.props["aria-pressed"])), /2×2/);
    act(() => root.findByProps({ "aria-label": "高程差目标" }).props.onChange({ target: { value: "1" } }));
    assert.match(text(group(root, "查看离散档位").findAllByType("button").find(b => b.props["aria-pressed"])), /8×8/);
    chooseOverview(4);
    act(() => root.findAllByType("button").find(b => text(b) === "下载 JSON").props.onClick());
    act(() => root.findAllByType("button").find(b => text(b) === "导出当前对比结果").props.onClick());
    const overview = JSON.parse(await blobs[0].text()), selection = JSON.parse(await blobs[1].text());
    assert.equal(overview.view.resolution, 4);
    assert.equal(selection.selected.ruledSubdivisions, 4);
    assert.equal(selection.target.selectedSatisfies, false);
    assert.equal(selection.arcgisRuntime.status, "not-measured");
    act(() => root.findByProps({ "aria-label": "高程差目标" }).props.onChange({ target: { value: "5" } }));
    assert.match(text(root.findByProps({ className: "co-highlights" })), /5 cm.*2×2.*1\.258 MB.*86\.0%/);
    assert.match(text(group(root, "查看离散档位").findAllByType("button").find(b => b.props["aria-pressed"])), /2×2满足 5 cm/);
    act(() => root.findAllByType("button").find(b => text(b) === "下载 JSON").props.onClick());
    const changedTarget = JSON.parse(await blobs[2].text());
    assert.equal(changedTarget.scope.targetCentimetres, 5);
    assert.equal(changedTarget.view.resolution, 2);
    assert.equal(changedTarget.view.targetCentimetres, 5);
    act(() => root.findByProps({ "aria-label": "高程差目标" }).props.onChange({ target: { value: ".1" } }));
    assert.match(text(root.findByProps({ className: "co-highlights" })), /0\.1 cm.*未达到/);
    assert.doesNotMatch(text(root.findByProps({ className: "co-highlights" })), /98\.5%/);
    assert.match(text(root.findByProps({ className: "cmp-budget-verdict" })), /均未达到/);
    assert.deepEqual([...calls].sort(), ["/api/city/revision", "/qa/suite.json"].sort());
  } finally {
    if (renderer) act(() => renderer.unmount());
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    globalThis.fetch = fetchBefore; URL.createObjectURL = urlBefore;
  }
});
