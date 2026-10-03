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
    build.onResolve({ filter: /^\.\/studio\/(CityStudio|cityApi)$/ }, args => ({ path: args.path, namespace: "test" }));
    build.onResolve({ filter: /^\.\/compare\/CompareShowcase$/ }, args => ({ path: args.path, namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => path.endsWith("cityApi") ? {
      contents: "export const createCityApi = cityId => ({cityId});",
    } : { contents: `import React from 'react';export default function View(props){
      React.useEffect(()=>{globalThis.cityShellEvents.push('mount:'+props.workspace.id);globalThis.cityShellProps=props;
        props.onWorkspaceState?.(props.workspace.id,false,!!globalThis.cityShellDrafts[props.workspace.id]);
        return ()=>globalThis.cityShellEvents.push('unmount:'+props.workspace.id)},[]);
      return React.createElement('div',{'aria-label':'city view'},props.workspace.id);
    }` });
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  } }] });
const App = (await import(pathToFileURL(outfile).href)).default;
const cities = ["bristol", "london", "birmingham"].map((id, i) => ({ id, name: ["布里斯托", "伦敦", "伯明翰"][i], status: "ready",
  coverage_kind: "sample-area", coverage_label: "局部中心街区，非全城覆盖", building_count: 800, road_count: 500 }));
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");

async function fixture(t, href = "http://localhost/", drafts = {}) {
  const originals = { window: globalThis.window, fetch: globalThis.fetch };
  const listeners = new Map(), requests = [], history = [];
  globalThis.cityShellEvents = []; globalThis.cityShellDrafts = drafts;
  globalThis.window = { location: new URL(href), history: { state: null,
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
  assert.equal(window.location.search, "?city=birmingham&workspace=environment");
  assert.deepEqual(f.requests, ["/api/cities"], "the selector loads only a small catalog, never other city models");
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
  assert.equal(window.location.search, "?city=birmingham");
  assert.equal(globalThis.cityShellProps.workspace.id, "birmingham");
  act(() => current.onWorkspaceState("birmingham", false, false));
  await f.choose("london");
  assert.equal(globalThis.cityShellProps.workspace.id, "london");
});

test("back navigation restores the city; an in-progress write retains its bound URL", async t => {
  const f = await fixture(t);
  await f.choose("london");
  await f.pop("http://localhost/");
  assert.equal(globalThis.cityShellProps.workspace.id, "bristol");
  act(() => globalThis.cityShellProps.onWorkspaceState("bristol", true, false));
  await f.pop("http://localhost/?city=london");
  assert.equal(globalThis.cityShellProps.workspace.id, "bristol");
  assert.equal(window.location.search, "");
});
