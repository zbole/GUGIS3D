import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";
import { readinessFixture } from "./helpers/ukReadinessFixture.mjs";
const Progress = await componentBundle("UkCoverageProgress", [{ name: "api-base", setup(build) {
  build.initialOptions.define = { "import.meta.env.VITE_API_BASE_URL": '"/api"' };
  build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
} }]);
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const toggle = async (renderer, open) => act(async () => renderer.root.findByType("details").props.onToggle({ currentTarget: { open } }));
const button = (root, label) => root.findAllByType("button").find(node => text(node) === label);
const change = async (renderer, label, value) => act(async () => renderer.root.findByProps({ "aria-label": label }).props.onChange({ target: { value } }));
const cityRows = renderer => renderer.root.findByType("tbody").findAllByType("tr");
const filterLabels = ["接入进度地区", "搜索登记城市", "接入进度样本状态", "接入进度边界回执"];
function mixedReadiness() {
  const data = readinessFixture();
  data.cities.find(city => city.id === "uk-eng-bristol").boundary = { state: "receipt-recorded", receipt: { topology: "not_checked" } };
  data.cities.find(city => city.id === "uk-eng-birmingham").boundary = { state: "validation-failed", receipt: null };
  data.cities.find(city => city.id === "uk-eng-westminster").boundary = { state: "validation-failed", receipt: null, reason_code: "unsupported-platform" };
  return data;
}
function fixture(t, fetcher) {
  const old = globalThis.fetch; globalThis.fetch = fetcher;
  let renderer; act(() => { renderer = create(React.createElement(Progress)); });
  t.after(() => { act(() => renderer.unmount()); globalThis.fetch = old; });
  return renderer;
}
test("collapsed progress loads nothing; opening filters 76 entries without opening any workspace", async t => {
  const requests = [];
  const renderer = fixture(t, async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(readinessFixture())); });
  assert.equal(requests.length, 0);
  await toggle(renderer, true);
  assert.deepEqual(requests.map(r => r.url), ["/api/coverage/uk-cities"]);
  assert.match(text(renderer.root), /76 个登记城市/); assert.match(text(renderer.root), /全城覆盖尚未评估/);
  await act(async () => renderer.root.findByProps({ "aria-label": "搜索登记城市" }).props.onChange({ target: { value: "Bangor" } }));
  assert.match(text(renderer.root), /显示 2 \/ 76/);
  await act(async () => renderer.root.findByProps({ "aria-label": "接入进度地区" }).props.onChange({ target: { value: "Wales" } }));
  assert.match(text(renderer.root), /显示 1 \/ 76/);
  assert.equal(requests.length, 1);
});
test("closing aborts pending reads and obsolete results cannot replace a newer response", async t => {
  const pending = [], requests = [];
  const renderer = fixture(t, (url, options) => { requests.push(options); return new Promise(resolve => pending.push(resolve)); });
  await toggle(renderer, true); await toggle(renderer, false);
  assert.equal(requests[0].signal.aborted, true);
  await toggle(renderer, true);
  const newer = readinessFixture(); newer.samples[0].building_count = 222;
  await act(async () => pending[1](new Response(JSON.stringify(newer))));
  const older = readinessFixture(); older.samples[0].building_count = 111;
  await act(async () => pending[0](new Response(JSON.stringify(older))));
  assert.match(text(renderer.root), /222 栋/); assert.doesNotMatch(text(renderer.root), /111 栋/);
});
test("failures have explicit retry and unavailable counts do not masquerade as zero buildings", async t => {
  let fail = true;
  const data = readinessFixture(); Object.assign(data.samples[0], { status: "unavailable", building_count: null, road_count: null, data_revision: null });
  data.cities.find(c => c.id === data.samples[0].related_city_id).sample.state = "unavailable";
  data.summary.available_sample_workspaces = 2;
  const renderer = fixture(t, async () => fail ? new Response("offline", { status: 503 }) : new Response(JSON.stringify(data)));
  await toggle(renderer, true); assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 1);
  fail = false; await act(async () => button(renderer.root, "重试进度目录").props.onClick());
  assert.match(text(renderer.root), /工作区数量未读取/); assert.match(text(renderer.root), /2 个可用/);
  assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
});


test("unsupported receipt I/O is not presented as invalid boundary geometry", async t => {
  const data = readinessFixture();
  data.cities[0].boundary = { state: "validation-failed", receipt: null, reason_code: "unsupported-platform" };
  const renderer = fixture(t, async () => new Response(JSON.stringify(data)));
  await toggle(renderer, true);
  assert.match(text(renderer.root.findByType("tbody")), /当前平台未检查/);
  assert.doesNotMatch(text(renderer.root.findByType("tbody")), /回执校验失败/);
  assert.match(text(renderer.root), /全城覆盖尚未评估/);
});

test("all four accessible filters combine locally, show no matches, and clear without extra requests", async t => {
  const requests = [];
  const renderer = fixture(t, async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(mixedReadiness())); });
  await toggle(renderer, true);
  assert.equal(renderer.root.findAllByProps({ "aria-label": "接入进度地区" }).length, 1);
  assert.equal(renderer.root.findByProps({ "aria-label": "登记城市筛选" }).props.role, "group");
  assert.equal(renderer.root.findByProps({ "aria-label": "登记城市接入状态列表" }).props.tabIndex, 0);
  assert.equal(button(renderer.root, "清除筛选").props.disabled, true);
  for (const [label, value] of filterLabels.map((label, index) => [label, ["England", "  BRISTOL  ", "available", "receipt-recorded"][index]]))
    await change(renderer, label, value);
  assert.equal(cityRows(renderer).length, 1);
  assert.match(text(cityRows(renderer)[0]), /Bristol/);
  const count = renderer.root.findByProps({ className: "uk-coverage-result-count" });
  assert.equal(count.props.role, "status"); assert.equal(count.props["aria-live"], "polite"); assert.equal(count.props["aria-atomic"], "true");
  assert.equal(text(count), "显示 1 / 76 个登记城市");
  assert.equal(button(renderer.root, "清除筛选").props.disabled, false);
  await change(renderer, "接入进度样本状态", "none");
  assert.equal(cityRows(renderer).length, 0);
  assert.match(text(renderer.root), /没有匹配的登记城市，请调整或清除筛选/);
  assert.equal(text(count), "显示 0 / 76 个登记城市");
  await act(async () => button(renderer.root, "清除筛选").props.onClick());
  assert.equal(cityRows(renderer).length, 76);
  for (const label of filterLabels) assert.equal(renderer.root.findByProps({ "aria-label": label }).props.value, "");
  assert.equal(button(renderer.root, "清除筛选").props.disabled, true);
  assert.doesNotMatch(text(renderer.root), /没有匹配的登记城市/);
  assert.deepEqual(requests.map(request => request.url), ["/api/coverage/uk-cities"]);
  assert.equal(requests[0].options.method, undefined);
});

test("boundary status choices filter by what was checked rather than raw failure state", async t => {
  let requests = 0;
  const renderer = fixture(t, async () => { requests++; return new Response(JSON.stringify(mixedReadiness())); });
  await toggle(renderer, true);
  for (const [status, name, label] of [
    ["receipt-recorded", "Bristol", "已有结构检查回执"],
    ["validation-failed", "Birmingham", "回执校验失败"],
    ["unsupported-platform", "Westminster", "当前平台未检查"],
  ]) {
    await change(renderer, "接入进度边界回执", status);
    assert.equal(cityRows(renderer).length, 1);
    assert.match(text(cityRows(renderer)[0]), new RegExp(name));
    assert.match(text(cityRows(renderer)[0]), new RegExp(label));
    assert.match(text(cityRows(renderer)[0]), /尚未评估/);
  }
  await change(renderer, "接入进度边界回执", "not-recorded");
  assert.equal(cityRows(renderer).length, 73);
  await change(renderer, "搜索登记城市", "Bangor");
  assert.equal(cityRows(renderer).length, 2);
  await change(renderer, "接入进度地区", "Wales");
  assert.equal(cityRows(renderer).length, 1);
  assert.match(text(cityRows(renderer)[0]), /威尔士/);
  assert.equal(requests, 1);
});

test("sample status filters preserve unknown counts, valid empty samples, and the legacy Westminster association", async t => {
  const data = readinessFixture();
  for (const sample of data.samples) {
    const status = sample.workspace_id === "bristol" ? "missing" : sample.workspace_id === "birmingham" ? "invalid" : "unavailable";
    Object.assign(sample, { status, building_count: status === "missing" ? 0 : null, road_count: status === "missing" ? 0 : null, data_revision: null });
    data.cities.find(city => city.id === sample.related_city_id).sample.state = status;
  }
  data.summary.available_sample_workspaces = 0;
  let requests = 0;
  const renderer = fixture(t, async () => { requests++; return new Response(JSON.stringify(data)); });
  await toggle(renderer, true);
  for (const [status, name] of [["missing", "Bristol"], ["invalid", "Birmingham"], ["unavailable", "Westminster"]]) {
    await change(renderer, "接入进度样本状态", status);
    assert.equal(cityRows(renderer).length, 1);
    assert.match(text(cityRows(renderer)[0]), new RegExp(name));
    assert.match(text(cityRows(renderer)[0]), /工作区数量未读取/);
    assert.doesNotMatch(text(cityRows(renderer)[0]), /null|0 栋|0 条道路/);
  }
  assert.match(text(cityRows(renderer)[0]), /london test sample/);
  await change(renderer, "接入进度样本状态", "available");
  assert.equal(cityRows(renderer).length, 0);
  await change(renderer, "接入进度样本状态", "none");
  assert.equal(cityRows(renderer).length, 73);
  await change(renderer, "搜索登记城市", "London");
  const london = cityRows(renderer).find(row => row.findByType("th").children[0] === "London");
  assert.ok(london); assert.doesNotMatch(text(london), /london test sample/);
  assert.equal(requests, 1);
});

test("refresh, failed retry, and collapse/reopen preserve active filters without per-city requests", async t => {
  const requests = [], pending = [];
  const renderer = fixture(t, (url, options) => {
    requests.push({ url, options });
    return requests.length === 1 ? Promise.resolve(new Response(JSON.stringify(mixedReadiness()))) : new Promise(resolve => pending.push(resolve));
  });
  await toggle(renderer, true);
  const selected = ["England", "bristol", "available", "receipt-recorded"];
  for (let index = 0; index < filterLabels.length; index++) await change(renderer, filterLabels[index], selected[index]);
  const checkFilters = () => filterLabels.forEach((label, index) => assert.equal(renderer.root.findByProps({ "aria-label": label }).props.value, selected[index]));
  await act(async () => button(renderer.root, "刷新进度").props.onClick());
  checkFilters(); assert.equal(cityRows(renderer).length, 1);
  assert.equal(button(renderer.root, "刷新进度").props.disabled, true);
  assert.match(text(renderer.root), /下方为上次成功读取的进度/);
  await act(async () => pending[0](new Response("offline", { status: 503 })));
  checkFilters(); assert.equal(cityRows(renderer).length, 1);
  assert.match(text(renderer.root), /下方为上次成功读取的进度/);
  await act(async () => button(renderer.root, "重试进度目录").props.onClick());
  const updated = mixedReadiness(); updated.samples.find(sample => sample.workspace_id === "bristol").building_count = 321;
  await act(async () => pending[1](new Response(JSON.stringify(updated))));
  checkFilters(); assert.equal(cityRows(renderer).length, 1);
  assert.match(text(cityRows(renderer)[0]), /321 栋/);
  assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
  await toggle(renderer, false); await toggle(renderer, true);
  checkFilters();
  updated.cities.find(city => city.id === "uk-eng-bristol").boundary = { state: "not-recorded", receipt: null };
  await act(async () => pending[2](new Response(JSON.stringify(updated))));
  checkFilters(); assert.equal(cityRows(renderer).length, 0);
  assert.match(text(renderer.root), /没有匹配的登记城市/);
  await act(async () => button(renderer.root, "清除筛选").props.onClick());
  assert.equal(cityRows(renderer).length, 76);
  assert.deepEqual(requests.map(request => request.url), Array(4).fill("/api/coverage/uk-cities"));
  assert.ok(requests.every(request => request.options.method === undefined));
});
