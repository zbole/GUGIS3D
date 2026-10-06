import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/city-workspace-shell.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/App.tsx", import.meta.url))], bundle: true, platform: "node", format: "esm",
  packages: "external", outfile, define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' }, plugins: [{ name: "city-shell-doubles", setup(build) {
    build.onResolve({ filter: /^react$/ }, () => ({ path: "react", external: true }));
    build.onResolve({ filter: /^\.\/studio\/(CityStudio|CityTilePreview|cityApi)$/ }, args => ({ path: args.path, namespace: "test" }));
    build.onResolve({ filter: /^\.\/compare\/CompareShowcase$/ }, args => ({ path: args.path, namespace: "test" }));
    build.onResolve({ filter: /^\.\/datasets\/DatasetExplorer$/ }, args => ({ path: args.path, namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => path.endsWith("DatasetExplorer") ? {
      contents:"import React from 'react';export default function DatasetView(){return React.createElement('div',{'aria-label':'dataset view'},'dataset');}",
    } : path.endsWith("cityApi") ? {
      contents: "export const createCityApi = cityId => ({cityId});",
    } : { contents: `import React from 'react';export default function View(props){
      globalThis.cityShellProps=props;React.useEffect(()=>{globalThis.cityShellEvents.push('${path.endsWith("CityTilePreview") ? "tile-" : ""}mount:'+props.workspace.id);globalThis.cityShellProps=props;
        props.onWorkspaceState?.(props.workspace.id,false,!!globalThis.cityShellDrafts[props.workspace.id]);
        return ()=>globalThis.cityShellEvents.push('${path.endsWith("CityTilePreview") ? "tile-" : ""}unmount:'+props.workspace.id)},[]);
      return React.createElement('div',{'aria-label':'city view','data-mode':'${path.endsWith("CityTilePreview") ? "tiles" : "editor"}'},props.workspace.id);
    }` });
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  } }] });
const App = (await import(pathToFileURL(outfile).href)).default;
const cities = ["bristol", "london", "birmingham"].map((id, i) => ({ id, name: ["布里斯托", "伦敦", "伯明翰"][i], status: "ready",
  quality_warnings: id === "london" ? [{code:"test-height",message:"已知源高度被旧模型改写，请核对。",osm_ids:[123]}] : [],
  coverage_kind: "sample-area", coverage_label: "局部中心街区，非全城覆盖", building_count: 800, road_count: 500 }));
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");

async function fixture(t, href = "http://localhost/?city=bristol", drafts = {}) {
  const originals = { window: globalThis.window, fetch: globalThis.fetch };
  const listeners = new Map(), requests = [], history = [];
  globalThis.cityShellEvents = []; globalThis.cityShellDrafts = drafts;
  globalThis.window = { confirm: () => { throw new Error("Native confirmation must not block navigation"); }, location: new URL(href), history: { state: null,
    pushState(state, unused, url) { history.push(url); window.location = new URL(url); },
    replaceState(state, unused, url) { window.location = new URL(url); } },
    addEventListener(name, callback) { listeners.set(name, callback); },
    removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); } };
  globalThis.fetch = async url => { requests.push(url); return new Response(JSON.stringify({ cities }), { status: 200 }); };
  let renderer;
  await act(async () => { renderer = create(React.createElement(App)); });
  t.after(() => {
    act(() => renderer.unmount());
    globalThis.window = originals.window; globalThis.fetch = originals.fetch;
    delete globalThis.cityShellDrafts; delete globalThis.cityShellEvents; delete globalThis.cityShellProps;
  });
  return { requests, history, get root() { return renderer.root; },
    async choose(cityId) { await act(async () => renderer.root.findByProps({ "aria-label": "选择城市" }).props.onChange({ target: { value: cityId } })); },
    async hash(url) { window.location = new URL(url); await act(async () => listeners.get("hashchange")?.()); },
    async pop(url) { window.location = new URL(url); await act(async () => listeners.get("popstate")?.()); },
  };
}

test("direct city links mount only that city and switching releases the previous workspace", async t => {
  const f = await fixture(t, "http://localhost/?city=london&workspace=environment");
  assert.deepEqual(globalThis.cityShellEvents, ["mount:london"]);
  assert.equal(globalThis.cityShellProps.api.cityId, "london");
  await f.choose("birmingham");
  assert.deepEqual(globalThis.cityShellEvents, ["mount:london", "unmount:london", "mount:birmingham"]);
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
  assert.equal(window.location.searchParams.get("city"), "birmingham");
  assert.equal(window.location.searchParams.get("workspace"), "environment");
  assert.deepEqual(f.requests, ["/api/cities"], "the selector loads only a small catalog, never other city models");
});

test('dataset route never loads the city directory or mounts an editor, even with city query fields',async t=>{
  const f=await fixture(t,'http://localhost/datasets?dataset=york&city=york&cities=york');
  assert.equal(f.root.findAllByProps({'aria-label':'dataset view'}).length,1);
  assert.deepEqual(f.requests,[]);assert.deepEqual(globalThis.cityShellEvents,[]);
  assert.equal(f.root.findAllByProps({'aria-label':'city view'}).length,0);
  assert.equal(window.location.searchParams.get('dataset'),'york');
});

test("city switches preserve saved drafts, ignore obsolete callbacks, and block writes in progress", async t => {
  const f = await fixture(t, "http://localhost/?city=london", { london: true });
  const old = globalThis.cityShellProps;
  await f.choose("birmingham");
  assert.match(text(f.root), /原城市草稿已独立保留/);
  act(() => old.onWorkspaceState("london", true, true));
  assert.equal(f.root.findByProps({ "aria-label": "选择城市" }).props.disabled, false, "unmounted workspaces cannot lock the new city");
  const current = globalThis.cityShellProps;
  act(() => current.onWorkspaceState("birmingham", true, false));
  assert.equal(f.root.findByProps({ "aria-label": "选择城市" }).props.disabled, true);
  await f.choose("bristol");
  assert.equal(window.location.searchParams.get("city"), "birmingham");
  assert.equal(globalThis.cityShellProps.workspace.id, "birmingham");
  act(() => current.onWorkspaceState("birmingham", false, false));
  await f.choose("london");
  assert.equal(globalThis.cityShellProps.workspace.id, "london");
});

test("back navigation restores the city; an in-progress write retains its bound URL", async t => {
  const f = await fixture(t);
  await f.choose("london");
  await f.pop("http://localhost/?city=bristol");
  assert.equal(globalThis.cityShellProps.workspace.id, "bristol");
  act(() => globalThis.cityShellProps.onWorkspaceState("bristol", true, false));
  await f.pop("http://localhost/?city=london");
  assert.equal(globalThis.cityShellProps.workspace.id, "bristol");
  assert.equal(window.location.searchParams.get("city"), "bristol");
});

const button = (root, label) => root.findAllByType("button").find(node => text(node) === label);
async function click(root, label) { await act(async () => button(root, label).props.onClick()); }
async function select(root, name) { await act(async () => root.findByProps({ "aria-label": `选择${name}` }).props.onClick()); }

test("fresh entry loads only the directory and requires an explicit city choice", async t => {
  const f = await fixture(t, "http://localhost/");
  assert.deepEqual(globalThis.cityShellEvents, []);
  assert.deepEqual(f.requests, ["/api/cities"]);
  assert.equal(button(f.root, "进入工作区 →").props.disabled, true);
  await select(f.root, "伦敦"); await click(f.root, "进入工作区 →");
  assert.deepEqual(globalThis.cityShellEvents, ["mount:london"]);
  assert.equal(globalThis.cityShellProps.api.cityId, "london");
  const options = f.root.findByProps({ "aria-label": "选择城市" }).findAllByType("option");
  assert.deepEqual(options.map(node => node.props.value), ["london"]);
});

test("multiple cities are selected together while exactly one scene remains mounted", async t => {
  const f = await fixture(t, "http://localhost/");
  await click(f.root, "多选城市"); await select(f.root, "伦敦"); await select(f.root, "伯明翰");
  await click(f.root, "进入工作区 →"); await f.choose("birmingham");
  assert.deepEqual(globalThis.cityShellEvents, ["mount:london", "unmount:london", "mount:birmingham"]);
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
  assert.equal(window.location.searchParams.get("cities"), "london,birmingham");
  assert.equal(globalThis.cityShellProps.api.cityId, "birmingham");
  await f.choose("bristol");
  assert.equal(globalThis.cityShellProps.workspace.id, "birmingham", "unselected city cannot bypass the entry choice");
});

test("single mode reduces selections and return-to-selection honours cancellation", async t => {
  const f = await fixture(t, "http://localhost/");
  await click(f.root, "多选城市"); await select(f.root, "布里斯托"); await select(f.root, "伦敦");
  await click(f.root, "单选城市"); await click(f.root, "进入工作区 →");
  assert.equal(window.location.searchParams.get("cities"), "bristol");
  await click(f.root, "重新选择城市");
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
  assert.equal(f.root.findByProps({ role: "alertdialog" }).props["aria-modal"], "false");
  await click(f.root, "留在当前工作区");
  assert.equal(window.location.searchParams.get("city"), "bristol");
  await click(f.root, "重新选择城市");
  await click(f.root, "确认返回城市选择");
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 0);
  assert.equal(window.location.search, "");
});

test("Back returns to first-step selection and cannot discard a write in progress", async t => {
  const f = await fixture(t, "http://localhost/?city=london&cities=london");
  const current = globalThis.cityShellProps;
  act(() => current.onWorkspaceState("london", true, false));
  await f.pop("http://localhost/?city=birmingham&cities=birmingham");
  assert.equal(window.location.searchParams.get("city"), "london");
  assert.equal(globalThis.cityShellProps.workspace.id, "london");
  await f.pop("http://localhost/");
  assert.equal(window.location.searchParams.get("city"), "london");
  act(() => current.onWorkspaceState("london", false, false));
  await f.pop("http://localhost/");
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 0);
  await f.pop("http://localhost/?city=birmingham&cities=london,birmingham");
  assert.equal(globalThis.cityShellProps.workspace.id, "birmingham");
});


test("lightweight entry never mounts an editor and preserves mode during city switches", async t => {
  const f = await fixture(t, "http://localhost/");
  await act(async () => f.root.findByProps({ "aria-label": "轻量分块浏览（只读）" }).props.onChange({ target: { checked: true } }));
  await click(f.root, "多选城市"); await select(f.root, "伦敦"); await select(f.root, "伯明翰");
  await click(f.root, "进入工作区 →");
  assert.deepEqual(globalThis.cityShellEvents, ["tile-mount:london"]);
  assert.deepEqual(f.requests, ["/api/cities"]);
  assert.equal(window.location.searchParams.get("view_mode"), "tiles");
  assert.equal(globalThis.cityShellProps.api, undefined, "read-only view never receives edit APIs");
  await f.choose("birmingham");
  assert.deepEqual(globalThis.cityShellEvents, ["tile-mount:london", "tile-unmount:london", "tile-mount:birmingham"]);
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
  assert.equal(window.location.searchParams.get("view_mode"), "tiles");
});

test("switching editor and tile preview confirms unsaved state and ignores obsolete mode callbacks", async t => {
  const f = await fixture(t, "http://localhost/?city=london", { london: true });
  const editor = globalThis.cityShellProps;
  await click(f.root, "轻量分块浏览");
  assert.deepEqual(globalThis.cityShellEvents, ["mount:london"]);
  await click(f.root, "留在当前工作区");
  await click(f.root, "轻量分块浏览");
  assert.match(text(f.root), /独立草稿会保留/);
  await click(f.root, "确认切换浏览");
  assert.deepEqual(globalThis.cityShellEvents, ["mount:london", "unmount:london", "tile-mount:london"]);
  act(() => editor.onWorkspaceState("london", true, true));
  assert.equal(button(f.root, "切换至完整编辑").props.disabled, false);
  const preview = globalThis.cityShellProps;
  await click(f.root, "切换至完整编辑");
  assert.equal(f.root.findByProps({ "aria-label": "city view" }).props["data-mode"], "editor");
  assert.equal(window.location.searchParams.has("view_mode"), false);
  act(() => globalThis.cityShellProps.onWorkspaceState("london", true, true));
  act(() => preview.onWorkspaceState("london", false, false));
  assert.equal(button(f.root, "轻量分块浏览").props.disabled, true, "stale preview cannot unlock a current editor write");
  await click(f.root, "轻量分块浏览");
  assert.equal(f.root.findByProps({ "aria-label": "city view" }).props["data-mode"], "editor");
});

test("mode-aware Back and Forward restore one view without losing write locks", async t => {
  const f = await fixture(t, "http://localhost/?city=london&view_mode=tiles");
  assert.deepEqual(globalThis.cityShellEvents, ["tile-mount:london"]);
  await f.pop("http://localhost/?city=london");
  assert.equal(f.root.findByProps({ "aria-label": "city view" }).props["data-mode"], "editor");
  act(() => globalThis.cityShellProps.onWorkspaceState("london", true, false));
  await f.pop("http://localhost/?city=london&view_mode=tiles");
  assert.equal(window.location.searchParams.has("view_mode"), false);
  assert.equal(f.root.findByProps({ "aria-label": "city view" }).props["data-mode"], "editor");
  act(() => globalThis.cityShellProps.onWorkspaceState("london", false, false));
  await f.pop("http://localhost/?city=birmingham&view_mode=tiles");
  assert.equal(f.root.findByProps({ "aria-label": "city view" }).props["data-mode"], "tiles");
  assert.equal(globalThis.cityShellProps.workspace.id, "birmingham");
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
});

const cameraHash = (city = "london", height = 1600) => `#gugis-view=1&city=${city}&revision=${"a".repeat(64)}&pose=-0.1276,51.5072,${height},18,-45,0`;
test("same-city camera Back, Forward and hash navigation reach the existing preview once", async t => {
  const base = "http://localhost/?city=london&cities=london,birmingham&view_mode=tiles";
  const f = await fixture(t, base + cameraHash());
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "valid");
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.bookmark.pose[2], 1600);
  assert.equal(window.location.hash, cameraHash());
  const first = globalThis.cityShellProps.cameraNavigation.sequence;
  await f.pop(base + cameraHash("london", 800));
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.bookmark.pose[2], 800);
  const second = globalThis.cityShellProps.cameraNavigation.sequence;
  assert.ok(second > first);
  await f.hash(base + cameraHash("london", 800));
  assert.equal(globalThis.cityShellProps.cameraNavigation.sequence, second, "paired browser events do not restore twice");
  await f.hash(base + cameraHash("london", 400));
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.bookmark.pose[2], 400);
  await f.pop(base + cameraHash());
  assert.deepEqual(globalThis.cityShellEvents, ["tile-mount:london"], "camera history never remounts the workspace");
  await f.pop(base);
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "none");
});

test("city, editor and home actions clear camera fragments while cross-city history binds the destination", async t => {
  const base = "http://localhost/?city=london&cities=london,birmingham&view_mode=tiles";
  const f = await fixture(t, base + cameraHash());
  await f.choose("birmingham");
  assert.equal(window.location.hash, "");
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "none");
  await f.pop(base + cameraHash());
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.bookmark.city, "london");
  await f.pop(base.replace("city=london", "city=birmingham") + cameraHash());
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "invalid", "London pose is never applied to Birmingham");
  await f.pop(base + cameraHash());
  await click(f.root, "切换至完整编辑");
  assert.equal(window.location.hash, "");
  await f.pop(base + cameraHash());
  await click(f.root, "重新选择城市");
  await click(f.root, "确认返回城市选择");
  assert.equal(window.location.hash, "");
});

test("busy editor history rejection strips incoming camera links, including same-city hash events", async t => {
  const f = await fixture(t, "http://localhost/?city=london");
  act(() => globalThis.cityShellProps.onWorkspaceState("london", true, false));
  await f.pop("http://localhost/?city=birmingham&view_mode=tiles" + cameraHash("birmingham"));
  assert.equal(window.location.searchParams.get("city"), "london");
  assert.equal(window.location.searchParams.has("view_mode"), false);
  assert.equal(window.location.hash, "");
  await f.hash(window.location.href + cameraHash());
  assert.equal(window.location.hash, "");
  assert.deepEqual(globalThis.cityShellEvents, ["mount:london"]);
  act(() => globalThis.cityShellProps.onWorkspaceState("london", false, false));
  await click(f.root, "轻量分块浏览");
  await click(f.root, "确认切换浏览");
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "none");
});

test("default-view dismissal removes the owned URL and issues a fresh accepted navigation", async t => {
  const f = await fixture(t, "http://localhost/?city=london&view_mode=tiles" + cameraHash());
  const before = globalThis.cityShellProps.cameraNavigation.sequence;
  act(() => globalThis.cityShellProps.onCameraBookmarkDismiss());
  assert.equal(window.location.hash, "");
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "none");
  assert.ok(globalThis.cityShellProps.cameraNavigation.sequence > before);
});


test("initial entry exposes an explicit disabled-by-default profile choice and enters economy without an editor", async t => {
  const f = await fixture(t, "http://localhost/");
  assert.equal(f.root.findByType("fieldset").props.disabled, true);
  assert.equal(f.root.findByProps({ "aria-label": "均衡分块读取" }).props.checked, true);
  assert.match(text(f.root), /非 GPU \/ JS 内存或帧率保证/);
  await act(async () => f.root.findByProps({ "aria-label": "轻量分块浏览（只读）" }).props.onChange({ target: { checked: true } }));
  assert.equal(f.root.findByType("fieldset").props.disabled, false);
  await act(async () => f.root.findByProps({ "aria-label": "低资源分块读取" }).props.onChange());
  await click(f.root, "多选城市"); await select(f.root, "伦敦"); await select(f.root, "伯明翰");
  await click(f.root, "进入工作区 →");
  assert.deepEqual(globalThis.cityShellEvents, ["tile-mount:london"]);
  assert.equal(globalThis.cityShellProps.tileProfile, "economy");
  assert.equal(window.location.searchParams.get("tile_profile"), "economy");
  await f.choose("birmingham");
  assert.equal(globalThis.cityShellProps.tileProfile, "economy");
  assert.equal(window.location.searchParams.get("tile_profile"), "economy");
  await click(f.root, "重新选择城市");
  await click(f.root, "确认返回城市选择");
  assert.equal(window.location.searchParams.has("tile_profile"), false);
  assert.equal(f.root.findByProps({ "aria-label": "低资源分块读取" }).props.checked, true);
  await act(async () => f.root.findByProps({ "aria-label": "均衡分块读取" }).props.onChange());
  await click(f.root, "进入工作区 →");
  assert.equal(globalThis.cityShellProps.tileProfile, "balanced");
  assert.equal(window.location.searchParams.has("tile_profile"), false);
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
  assert.deepEqual(f.requests, ["/api/cities"], "entry choices do not fetch full-city data");
});

test("same-city profile Back and Forward replace one session and preserve camera navigation", async t => {
  const base = "http://localhost/?city=london&cities=london,birmingham&view_mode=tiles";
  const economy = base + "&tile_profile=economy" + cameraHash();
  const f = await fixture(t, economy);
  assert.equal(globalThis.cityShellProps.tileProfile, "economy");
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "valid");
  await f.pop(base + cameraHash());
  assert.equal(globalThis.cityShellProps.tileProfile, "balanced");
  assert.equal(window.location.searchParams.has("tile_profile"), false);
  await f.pop(economy);
  assert.equal(globalThis.cityShellProps.tileProfile, "economy");
  assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "valid");
  assert.deepEqual(globalThis.cityShellEvents, ["tile-mount:london", "tile-unmount:london", "tile-mount:london", "tile-unmount:london", "tile-mount:london"]);
  const events = [...globalThis.cityShellEvents];
  await f.hash(economy);
  assert.deepEqual(globalThis.cityShellEvents, events, "paired hash and pop events cannot remount twice");
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
  await click(f.root, "切换至完整编辑");
  assert.equal(window.location.searchParams.has("tile_profile"), false);
  assert.equal(window.location.hash, "");
  assert.equal(globalThis.cityShellProps.tileProfile, undefined, "editor never receives tile budgets");
  act(() => globalThis.cityShellProps.onWorkspaceState("london", true, false));
  await f.pop(economy);
  assert.equal(window.location.searchParams.has("tile_profile"), false, "blocked navigation cannot leave an incoming budget setting on the editor");
  assert.equal(f.root.findByProps({ "aria-label": "city view" }).props["data-mode"], "editor");
  act(() => globalThis.cityShellProps.onWorkspaceState("london", false, false));
  await f.pop(economy);
  assert.equal(globalThis.cityShellProps.tileProfile, "economy");
  await f.pop("http://localhost/?tile_profile=economy");
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 0);
  assert.equal(window.location.searchParams.has("tile_profile"), false);
});

for (const value of ["custom", "__proto__", "{activeBytes:999999999}"]) {
  test(`unknown tile profile ${value} normalizes to balanced on direct entry and history`, async t => {
    const base = "http://localhost/?city=london&view_mode=tiles";
    const f = await fixture(t, `${base}&tile_profile=${encodeURIComponent(value)}&activeBytes=999999999&concurrency=99`);
    assert.equal(globalThis.cityShellProps.tileProfile, "balanced");
    assert.equal(globalThis.cityShellProps.budget, undefined);
    assert.equal(window.location.searchParams.has("tile_profile"), false);
    await f.pop(base + "&tile_profile=economy");
    await f.pop(base + `&tile_profile=${encodeURIComponent(value)}`);
    assert.equal(globalThis.cityShellProps.tileProfile, "balanced");
    assert.equal(window.location.searchParams.has("tile_profile"), false);
  });
}

test("full-editor and home direct entries remove irrelevant profile parameters", async t => {
  const f = await fixture(t, "http://localhost/?city=london&tile_profile=economy");
  assert.equal(window.location.searchParams.has("tile_profile"), false);
  assert.equal(globalThis.cityShellProps.tileProfile, undefined);
  await f.pop("http://localhost/?tile_profile=economy");
  assert.equal(window.location.searchParams.has("tile_profile"), false);
  assert.equal(f.root.findByProps({ "aria-label": "均衡分块读取" }).props.checked, true);
});


for (const query of ["city=london&city=london&view_mode=tiles", "city=london&view_mode=tiles&view_mode=tiles", "city=unknown&cities=london&view_mode=tiles"]) {
  test(`profile history cleanup never authorizes invalid camera identity: ${query}`, async t => {
    const f = await fixture(t, "http://localhost/?city=london&view_mode=tiles&tile_profile=economy");
    await f.pop(`http://localhost/?${query}&tile_profile=invalid` + cameraHash());
    assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "invalid");
    assert.equal(globalThis.cityShellProps.tileProfile, "balanced");
    const sequence = globalThis.cityShellProps.cameraNavigation.sequence;
    await f.hash(window.location.href);
    assert.equal(globalThis.cityShellProps.cameraNavigation.sequence, sequence);
    assert.equal(globalThis.cityShellProps.cameraNavigation.result.kind, "invalid");
  });
}

test("inline leave confirmation survives neither cancellation nor history and rechecks a new write lock", async t => {
  const f = await fixture(t, "http://localhost/?city=london");
  const editor = globalThis.cityShellProps;
  await click(f.root, "轻量分块浏览");
  assert.equal(f.root.findByProps({ "aria-label": "选择城市" }).props.disabled, true);
  act(() => editor.onWorkspaceState("london", true, true));
  assert.equal(button(f.root, "确认切换浏览").props.disabled, true);
  await click(f.root, "确认切换浏览");
  assert.deepEqual(globalThis.cityShellEvents, ["mount:london"]);
  let prevented = false;
  act(() => f.root.findByProps({ role: "alertdialog" }).props.onKeyDown({ key: "Escape", preventDefault() { prevented = true; } }));
  assert.equal(prevented, true);
  assert.equal(f.root.findAllByProps({ role: "alertdialog" }).length, 0);
  act(() => editor.onWorkspaceState("london", false, true));
  await click(f.root, "重新选择城市");
  const staleConfirm = button(f.root, "确认返回城市选择").props.onClick;
  await f.pop("http://localhost/?city=birmingham");
  assert.equal(f.root.findAllByProps({ role: "alertdialog" }).length, 0);
  await act(async () => staleConfirm());
  assert.equal(globalThis.cityShellProps.workspace.id, "birmingham");
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
  assert.equal(window.location.searchParams.get("city"), "birmingham");
  await click(f.root, "重新选择城市");
  await act(async () => staleConfirm());
  assert.equal(f.root.findAllByProps({ role: "alertdialog" }).length, 1, "a retired confirmation cannot accept a new request");
});

test("explicit profile changes restore the captured camera and release the old session without loading an editor", async t => {
  const base = "http://localhost/?city=london&cities=london,birmingham&view_mode=tiles&tile_profile=economy";
  const f = await fixture(t, base);
  const old = globalThis.cityShellProps;
  const bookmark = { city: "london", revision: "a".repeat(64), pose: [-.13, 51.5, 900, 18, -45, 0] };
  await act(async () => old.onTileProfileChange("balanced", bookmark));
  assert.equal(window.location.searchParams.has("tile_profile"), false);
  assert.equal(globalThis.cityShellProps.tileProfile, "balanced");
  assert.deepEqual(globalThis.cityShellProps.cameraNavigation.result.bookmark, bookmark);
  assert.equal(f.root.findAllByProps({ "aria-label": "city view" }).length, 1);
  assert.deepEqual(globalThis.cityShellEvents, ["tile-mount:london", "tile-unmount:london", "tile-mount:london"]);
  const events = [...globalThis.cityShellEvents];
  await act(async () => old.onTileProfileChange("economy", bookmark));
  assert.deepEqual(globalThis.cityShellEvents, events, "retired profile callback cannot change the new session");
  await act(async () => globalThis.cityShellProps.onTileProfileChange("economy", bookmark));
  assert.equal(window.location.searchParams.get("tile_profile"), "economy", "local session restores the explicit budget after share-link encoding");
  assert.deepEqual(globalThis.cityShellProps.cameraNavigation.result.bookmark, bookmark);
  const economyUrl = window.location.href;
  await f.pop(base.replace("&tile_profile=economy", "") + cameraHash());
  assert.equal(globalThis.cityShellProps.tileProfile, "balanced");
  await f.pop(economyUrl);
  assert.equal(globalThis.cityShellProps.tileProfile, "economy");
  assert.deepEqual(globalThis.cityShellProps.cameraNavigation.result.bookmark, bookmark);
  await act(async () => globalThis.cityShellProps.onTileProfileChange("balanced", bookmark));
  const current = globalThis.cityShellProps;
  await f.choose("birmingham");
  await act(async () => current.onTileProfileChange("economy", bookmark));
  assert.equal(globalThis.cityShellProps.workspace.id, "birmingham");
  assert.equal(globalThis.cityShellProps.tileProfile, "balanced");
  await act(async () => globalThis.cityShellProps.onTileProfileChange("economy", bookmark));
  assert.equal(window.location.hash, "", "foreign-city camera is not restored");
  assert.equal(globalThis.cityShellProps.tileProfile, "economy");
  assert.deepEqual(f.requests, ["/api/cities"]);
});
