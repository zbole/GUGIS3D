import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";

const Panel = await componentBundle("AnalysisPanel");
const noop = () => {};
const text = (node) => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const button = (root, title) => root.findAllByType("button").find((node) => text(node) === title);
const points = [
  { longitude: -2.6, latitude: 51.45, altitude: 0 },
  { longitude: -2.6, latitude: 51.45036, altitude: 4 },
];
const result = {
  horizontalDistance: 40, spatialDistance: 40.2, elevationChange: 4,
  surfaceDistance: null, ascent: null, descent: null, coverage: 0.7,
  samples: [
    { distance: 0, height: 100, slope: 5, patch: "a", kind: "ruled-strip" },
    { distance: 10, height: 101, slope: 5, patch: "a", kind: "ruled-strip" },
    { distance: 20, height: null, slope: null, patch: null, kind: null },
    { distance: 30, height: 103, slope: 5, patch: "b", kind: "triangle-strip" },
    { distance: 40, height: 104, slope: 5, patch: "c", kind: "triangle-fan", gapBefore: true },
  ],
  sampleSpacing: 10, terrainName: "合成 DEM 非实测", verticalDatum: "local",
};
const record = {
  id: "saved", name: "路线 A", createdAt: "2026-09-23T00:00:00Z", points,
  spacing: 10, terrainFingerprint: "old", result,
};
function fixture(overrides = {}) {
  let renderer;
  let props = {
    points: [], result: null, drawing: false, busy: false, canSave: true,
    records: [], selectedId: null, fingerprint: "current", onDrawing: noop,
    onUndo: noop, onClear: noop, onHover: noop, onSave: async () => true,
    onOpen: noop, onDelete: noop, ...overrides,
  };
  act(() => { renderer = create(React.createElement(Panel, props)); });
  return {
    get root() { return renderer.root; },
    update(next) { props = { ...props, ...next }; act(() => renderer.update(React.createElement(Panel, props))); },
    close() { act(() => renderer.unmount()); },
  };
}

test("drawing remains a preview and saving requires an explicit enabled action", async () => {
  const calls = [];
  const f = fixture({ onDrawing: (value) => calls.push(["drawing", value]), onSave: async (name) => { calls.push(["save", name]); return true; } });
  assert.equal(button(f.root, "保存分析").props.disabled, true);
  act(() => button(f.root, "开始绘制").props.onClick());
  assert.deepEqual(calls, [["drawing", true]]);
  f.update({ points, result, drawing: true });
  act(() => button(f.root, "完成绘制").props.onClick());
  assert.equal(calls.length, 2);
  f.update({ drawing: false, canSave: false });
  assert.equal(button(f.root, "保存分析").props.disabled, true);
  assert.match(text(f.root), /草稿/);
  f.update({ canSave: true });
  act(() => f.root.findByProps({ "aria-label": "分析名称" }).props.onChange({ target: { value: "  河岸剖面  " } }));
  await act(async () => button(f.root, "保存分析").props.onClick());
  assert.deepEqual(calls.at(-1), ["save", "河岸剖面"]);
  assert.match(text(f.root), /分析已保存到 GUGIS/);
  f.close();
});

test("profile lines break for sampled and between-station gaps, with keyboard scene linking", () => {
  const distances = [];
  const f = fixture({ points, result, onHover: (distance) => distances.push(distance) });
  const path = f.root.findByProps({ className: "analysis-chart-line" });
  assert.equal((path.props.d.match(/M/g) ?? []).length, 3);
  assert.equal((path.props.d.match(/L/g) ?? []).length, 1);
  const chart = f.root.findAllByType("svg").find((node) => node.props.role === "img");
  act(() => chart.props.onKeyDown({ key: "End", preventDefault: noop }));
  assert.equal(distances.at(-1), 40);
  assert.match(text(f.root), /高程 104 m/);
  act(() => chart.props.onKeyDown({ key: "ArrowLeft", preventDefault: noop }));
  assert.equal(distances.at(-1), 30);
  act(() => chart.props.onKeyDown({ key: "ArrowLeft", preventDefault: noop }));
  assert.equal(distances.at(-1), 20);
  assert.match(text(f.root), /高程 无数据/);
  act(() => chart.props.onBlur());
  assert.equal(distances.at(-1), null);
  assert.match(text(f.root), /70%/);
  assert.match(text(f.root), /合成 DEM 非实测/);
  assert.match(text(f.root), /局部高程基准/);
  f.close();
});

test("saved analyses mark changed terrain and reopening is explicit", () => {
  const events = [];
  const f = fixture({ records: [record], onOpen: (value) => events.push(["open", value.id]), onDelete: (id) => events.push(["delete", id]) });
  assert.match(text(f.root), /地形已变更/);
  assert.deepEqual(events, []);
  act(() => f.root.findByProps({ className: "analysis-record" }).props.onClick());
  assert.deepEqual(events, [["open", "saved"]]);
  f.update({ selectedId: "saved", fingerprint: "old" });
  assert.equal(f.root.findByProps({ "aria-label": "分析名称" }).props.value, "路线 A");
  act(() => f.root.findByProps({ "aria-label": "分析名称" }).props.onChange({ target: { value: "尚未保存的新名称" } }));
  f.update({ points: structuredClone(record.points) });
  assert.equal(f.root.findByProps({ "aria-label": "分析名称" }).props.value, "路线 A", "reopening the same record restores its saved name");
  assert.equal(button(f.root, "更新分析").props.disabled, true, "an empty preview cannot be updated");
  assert.doesNotMatch(text(f.root), /地形已变更/);
  act(() => f.root.findByProps({ "aria-label": "删除分析 路线 A" }).props.onClick());
  assert.deepEqual(events.at(-1), ["delete", "saved"]);
  f.close();
});

test("zero-length paths cannot save and floating coverage rounding does not invent NoData gaps", () => {
  const f = fixture({ points, result: { ...result, horizontalDistance: 0, surfaceDistance: 0, coverage: 0.999999999999 } });
  assert.equal(button(f.root, "保存分析").props.disabled, true);
  assert.equal(button(f.root, "导出 CSV").props.disabled, true);
  assert.equal(f.root.findAllByProps({ className: "analysis-caution" }).length, 0);
  f.close();
});

test("CSV preserves source datum and gaps and escapes spreadsheet formulas", async () => {
  const originalDocument = globalThis.document;
  const originalCreate = URL.createObjectURL;
  let blob, clicked = false, removed = false, anchor;
  URL.createObjectURL = (value) => { blob = value; return "blob:gugis-test"; };
  globalThis.document = {
    createElement: () => (anchor = { click() { clicked = true; }, remove() { removed = true; } }),
    body: { appendChild() {} },
  };
  const f = fixture({ points, result: { ...result, terrainName: "=SUM(1,2)" } });
  try {
    act(() => button(f.root, "导出 CSV").props.onClick());
    assert.equal(clicked, true);
    assert.equal(removed, true);
    assert.match(anchor.download, /\.csv$/);
    const csv = await blob.text();
    assert.match(csv, /"高程基准","local"/);
    assert.match(csv, /"地形来源","'=SUM\(1,2\)"/);
    assert.match(csv, /"20","","","","","否"/);
    assert.match(csv, /"40","104","5","c","triangle-fan","是"/);
  } finally {
    f.close();
    URL.createObjectURL = originalCreate;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
