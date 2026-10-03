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
  assert.match(text(renderer.root), /当前平台未检查/);
  assert.doesNotMatch(text(renderer.root), /回执校验失败/);
  assert.match(text(renderer.root), /全城覆盖尚未评估/);
});
