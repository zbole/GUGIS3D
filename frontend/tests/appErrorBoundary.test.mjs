import assert from "node:assert/strict";
import test from "node:test";
import React, { Suspense, lazy } from "react";
import { act, create } from "react-test-renderer";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/AppErrorBoundary.mjs", import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL("../src/AppErrorBoundary.tsx", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile,
  plugins: [{
    name: "ignore-recovery-css-in-component-tests",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
    },
  }],
});
const Boundary = (await import(pathToFileURL(outfile).href)).default;
const text = (node) => typeof node === "string" ? node : (node.children ?? []).map(text).join("");

function RenderFailure() {
  throw new Error("Simulated component render failure");
}

function mount(t, child) {
  let renderer;
  act(() => { renderer = create(React.createElement(Boundary, null, child)); });
  t.after(() => act(() => renderer.unmount()));
  return renderer;
}

test("healthy children and their local recovery controls remain available", (t) => {
  let recovered = 0;
  const renderer = mount(t, React.createElement("button", { onClick: () => recovered++ }, "Local scene recovery"));
  assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
  const button = renderer.root.findByType("button");
  assert.equal(text(button), "Local scene recovery");
  act(() => button.props.onClick());
  assert.equal(recovered, 1);
});

test("a simulated render failure shows recovery guidance and expandable diagnostics", (t) => {
  t.mock.method(console, "error", () => {});
  const renderer = mount(t, React.createElement(RenderFailure));
  const alert = renderer.root.findByProps({ role: "alert" });
  assert.match(text(alert), /页面暂时无法显示/);
  assert.match(text(alert), /服务端已保存的城市项目和独立草稿/);
  assert.match(text(alert), /尚未生成预览的表单参数可能需要重新输入/);
  const details = renderer.root.findByType("details");
  assert.equal(details.props.open, undefined, "technical details should be collapsed initially");
  assert.equal(text(details.findByType("summary")), "查看技术原因");
  assert.match(text(details.findByType("pre")), /Simulated component render failure/);
});

test("fallback refresh is explicit and navigation offers the city and comparison pages", (t) => {
  t.mock.method(console, "error", () => {});
  const previousWindow = globalThis.window;
  let reloads = 0;
  globalThis.window = { location: { reload: () => reloads++ } };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  const renderer = mount(t, React.createElement(RenderFailure));
  assert.equal(reloads, 0, "catching a failure must not automatically refresh the page");
  act(() => renderer.update(React.createElement(Boundary, null, React.createElement(RenderFailure))));
  assert.equal(reloads, 0, "rerendering the fallback must not start a refresh loop");
  const refresh = renderer.root.findByType("button");
  assert.equal(text(refresh), "刷新页面");
  act(() => refresh.props.onClick());
  assert.equal(reloads, 1);
  assert.deepEqual(renderer.root.findAllByType("a").map(link => [link.props.href, text(link)]), [
    ["/", "返回城市工作台"],
    ["/compare", "打开证据对比"],
  ]);
});

test("a simulated lazy import rejection leaves Suspense loading and reaches the recovery page", async (t) => {
  t.mock.method(console, "error", () => {});
  let rejectChunk;
  const LazyPage = lazy(() => new Promise((_resolve, reject) => { rejectChunk = reject; }));
  const child = React.createElement(Suspense, { fallback: React.createElement("p", null, "Loading test page") }, React.createElement(LazyPage));
  const renderer = mount(t, child);
  assert.equal(text(renderer.root.findByType("p")), "Loading test page");
  await act(async () => { rejectChunk(new Error("Simulated dynamic module load failure")); });
  assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 1);
  assert.match(text(renderer.root.findByType("pre")), /Simulated dynamic module load failure/);
});
