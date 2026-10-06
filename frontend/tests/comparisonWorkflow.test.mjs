import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {bundleWorkspaceModule} from './bundleWorkspaceModule.mjs';
import React from "react";
import { create, act } from "react-test-renderer";

const suiteBytes = await readFile(new URL("../../shared/terrain-comparison-suite.json", import.meta.url), "utf8");
const suite = JSON.parse(suiteBytes);
const cache = new URL("../node_modules/.cache/gugis-tests/", import.meta.url);
await mkdir(cache, { recursive: true });
const outfile = fileURLToPath(new URL("CompareShowcase.workflow.mjs", cache));
await bundleWorkspaceModule(fileURLToPath(new URL("../src/compare/CompareShowcase.tsx", import.meta.url)),outfile,{
  define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' },
  plugins: [{ name: "local-suite-asset", setup(build) {
    build.onResolve({ filter: /terrain-comparison-suite\.json\?url$/ }, () => ({ path: "suite-asset", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export default "/qa/suite.json"', loader: "js" }));
  } }],
});
const Showcase = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const group = (root, label) => root.findByProps({ role: "group", "aria-label": label });

for(const [cityId,cityName,adverse] of [['liverpool','利物浦',/大 16\.5%/],['sheffield','谢菲尔德',/大 17\.5%/],['leeds','利兹',/大 21\.9%/],['nottingham','诺丁汉',/大 45\.2%/]]){
test(`non-Bristol ${cityId} page retains its exact terrain result link and never reads formal city or foreign snapshot`,()=>{
  const beforeWindow=globalThis.window,beforeDocument=globalThis.document,beforeFetch=globalThis.fetch;
  const listeners=new Map();let r;
  try{
    globalThis.window={location:new URL(`http://localhost/compare?city=${cityId}&terrain_scope=${cityId}&terrain_target=.25&terrain_site=${cityId}-north-quarter#${cityId}-terrain-results`),
      addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
      removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn)};
    globalThis.document={getElementById:()=>null};
    globalThis.fetch=()=>assert.fail('Non-Bristol result page must not initialize city or read Bristol revision');
    act(()=>r=create(React.createElement(Showcase,{workspace:{id:cityId,name:cityName,status:'available',coverage_label:'中心街区局部样本'}})));
    assert.equal(r.root.findByProps({'aria-label':'跨城对标样区'}).props.value,`${cityId}-north-quarter`);
    assert.equal(r.root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.25);
    assert.match(text(r.toJSON()),adverse);
    assert.match(text(r.toJSON()),/本城建筑存储、城市剖面与软件计时尚无同源报告/);
    assert.equal(r.root.findAllByProps({'aria-label':'城市实测快照校对'}).length,0);
    assert.equal(r.root.findAllByType('canvas').length,0);
    act(()=>r.unmount());r=null;assert.ok([...listeners.values()].every(s=>s.size===0));
  }finally{
    if(r)act(()=>r.unmount());globalThis.fetch=beforeFetch;
    if(beforeWindow===undefined)delete globalThis.window;else globalThis.window=beforeWindow;
    if(beforeDocument===undefined)delete globalThis.document;else globalThis.document=beforeDocument;
  }
});
}

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
    assert.equal(root.findAllByProps({id:'validated-advantages'}).length,1);
    assert.equal(root.findAllByProps({id:'source-format-results'}).length,1);
    assert.equal(root.findAllByProps({id:'principal-direction-results'}).length,1);
    assert.equal(root.findAllByProps({id:'source-function-results'}).length,1);
    assert.equal(root.findAllByProps({id:'native-query-results'}).length,1);
    assert.equal(root.findAllByProps({id:'gugis-function-results'}).length,0);
    assert.equal(root.findAllByProps({id:'order-structure-results'}).length,0);
    assert.equal(root.findByProps({'aria-label':'对比展示导航'}).findAllByType('a').length,6);
    await act(async()=>root.findByProps({id:'function-controls'}).props.onToggle({currentTarget:{open:true}}));
    assert.equal(root.findAllByProps({id:'gugis-function-results'}).length,1);
    assert.equal(root.findAllByProps({id:'order-structure-results'}).length,1);
    act(()=>root.findByProps({id:'function-controls'}).props.onToggle({currentTarget:{open:false}}));
    act(()=>root.findByProps({'aria-label':'真实地形结果误差目标'}).props.onChange({target:{value:'.25'}}));
    await act(async()=>root.findByProps({id:'real-evidence'}).props.onToggle({currentTarget:{open:true}}));
    assert.equal(root.findByProps({'aria-label':'真实 Bristol 最大误差目标'}).props.value,.25);
    act(()=>root.findByProps({'aria-label':'真实 Bristol 最大误差目标'}).props.onChange({target:{value:'.5'}}));
    assert.equal(root.findByProps({'aria-label':'真实地形结果误差目标'}).props.value,.5);
    act(()=>root.findByProps({id:'real-evidence'}).props.onToggle({currentTarget:{open:false}}));
    // The page now leads with paper metrics. The historical engineering workflow
    // is mounted only when its disclosure is opened.
    assert.equal(root.findAllByProps({role:"group","aria-label":"查看离散档位"}).length,0);
    await act(async()=>root.findByProps({id:"supplementary-evidence"}).props.onToggle({currentTarget:{open:true}}));
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
