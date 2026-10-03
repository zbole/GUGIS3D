import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { candidateFixture, candidateResponse } from "./helpers/sourceCandidateFixture.mjs";
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/SourceCandidateReview.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/SourceCandidateReview.tsx", import.meta.url))], outfile, bundle: true,
  format: "esm", platform: "node", packages: "external", define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' },
  plugins: [{ name: "ignore-style", setup(b) { b.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" })); } }] });
const Review = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
async function until(condition, message) {
  for (let i = 0; i < 100 && !condition(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  assert.ok(condition(), message);
}
function setup(t) {
  const original = globalThis.fetch, requests = [];
  let renderer, cities = [{ id: "london", status: "ready", data_revision: "c".repeat(64) }, { id: "birmingham", status: "ready", data_revision: "0".repeat(64) }];
  globalThis.fetch = (url, options) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
  const element = () => React.createElement(Review, { cities });
  act(() => { renderer = create(element()); });
  t.after(() => { act(() => renderer.unmount()); globalThis.fetch = original; });
  const f = { requests,
    get root() { return renderer.root; }, get content() { return text(renderer.toJSON()); },
    get downloads() { return renderer.root.findAllByType("a").filter(a => a.props.download); },
    open(value) { act(() => renderer.root.findByProps({ className: "source-candidate-review" }).props.onToggle({ currentTarget: { open: value } })); },
    city(value) { act(() => renderer.root.findByProps({ "aria-label": "源修订候选城市" }).props.onChange({ target: { value } })); },
    click(label) { const button = renderer.root.findAllByType("button").find(b => text(b) === label); assert.ok(button, label); act(() => button.props.onClick()); },
    update(next) { cities = next; act(() => renderer.update(element())); },
    async reply(request, response) { await act(async () => { request.resolve(response); await new Promise(resolve => setTimeout(resolve, 0)); }); },
    async load(city = "london", request = requests.at(-1)) {
      await f.reply(request, candidateResponse(candidateFixture(city)));
      await until(() => f.downloads.length === 3, "validated candidate and download links displayed");
    },
    assertReadOnly() { assert.ok(requests.every(r => /^\/api\/cities\/(london|birmingham)\/source-candidates$/.test(r.url) && !r.options.method && !r.options.body)); } };
  return f;
}

test("candidate review is lazy, uses no project/model requests, and describes the whole-replacement risk", async t => {
  const f = setup(t); assert.equal(f.requests.length, 0); assert.equal(f.downloads.length, 0);
  f.open(true); assert.equal(f.requests.length, 1); await f.load();
  assert.match(f.content, /原始供应种子/); assert.match(f.content, /非默认修订候选/);
  assert.match(f.content, /4 栋 \/ 5 条道路/); assert.match(f.content, /3 栋 \/ 5 条道路/);
  assert.match(f.content, /9.6 m → 源标签 0.5 m/);
  assert.match(f.content, /新增移除 1 栋/); assert.match(f.content, /原种子已遗漏 1 栋/);
  assert.match(f.content, /不会创建草稿或启用候选/);
  assert.match(f.content, /提交可能移除候选中没有的自建建筑、道路、地形、功能要素和分析信息/);
  assert.match(f.content, /不是实时项目检查/); assert.match(f.content, /目录版本与原始种子完全一致/);
  assert.match(f.content, /不是城市行政边界/); assert.match(f.content, /没有实测 DEM/);
  for (const link of f.downloads) {
    assert.ok(link.props.href.startsWith("/api/cities/london/source-candidates/v2/downloads/"));
    assert.match(link.props.download, /^london-v2-/);
  }
  assert.equal(f.requests.length, 1, "rendering links does not fetch their bytes"); f.assertReadOnly();
});

test("city switching and collapse abort reads and cannot display stale reports or downloads", async t => {
  const f = setup(t); f.open(true); const london = f.requests[0];
  f.city("birmingham"); assert.equal(london.options.signal.aborted, true);
  const birmingham = f.requests[1]; await f.load("birmingham", birmingham);
  assert.match(f.content, /源标签 155 m/); assert.match(f.content, /目录版本不同/);
  await f.reply(london, candidateResponse(candidateFixture("london")));
  assert.ok(f.downloads.every(a => a.props.href.includes("/birmingham/")));
  assert.doesNotMatch(f.content, /london fixture/);
  f.click("重新检查候选"); const refresh = f.requests.at(-1);
  assert.equal(f.downloads.length, 0);
  f.open(false); assert.equal(refresh.options.signal.aborted, true);
  await f.reply(refresh, candidateResponse(candidateFixture("birmingham")));
  assert.equal(f.downloads.length, 0);
  f.open(true); await f.load("birmingham");
  assert.equal(f.root.findByType("select").props.value, "birmingham"); f.assertReadOnly();
});

test("failed or malformed responses hide downloads and an explicit retry can recover", async t => {
  const f = setup(t); f.open(true);
  await f.reply(f.requests[0], new Response("unavailable", { status: 503 }));
  await until(() => f.content.includes("503"), "failure is visible"); assert.equal(f.downloads.length, 0);
  f.click("重试候选目录");
  const invalid = candidateFixture(); invalid.candidates[0].downloads.archive.url = "https://evil.invalid/payload";
  await f.reply(f.requests.at(-1), candidateResponse(invalid));
  await until(() => f.content.includes("下载地址"), "unsafe download is rejected"); assert.equal(f.downloads.length, 0);
  f.click("重试候选目录"); await f.load();
  assert.equal(f.downloads.length, 3); f.assertReadOnly();
});

test("catalogue relation updates independently and missing or invalid revisions stay unknown", async t => {
  const f = setup(t); f.open(true); await f.load();
  f.update([{ id: "london", status: "ready", data_revision: "a".repeat(64) }]);
  assert.match(f.content, /目录版本与此候选完全一致/);
  f.update([{ id: "london", status: "invalid", data_revision: "c".repeat(64) }]);
  assert.match(f.content, /目录版本未知/); assert.doesNotMatch(f.content, /目录版本与原始种子完全一致/);
  f.update([{ id: "birmingham", status: "ready", data_revision: "c".repeat(64) }]);
  assert.match(f.content, /目录版本未知/); assert.equal(f.requests.length, 1);
});
