import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";

const Inspector = await componentBundle("LoadedBuildingInspector");
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const entry = (i, overrides = {}) => ({ placement: { id: `id-${String(i).padStart(3, "0")}`, name: `Building ${String(i).padStart(3, "0")}`,
  asset: "source-asset", longitude: -.127612345678, latitude: 51.507212345678, altitude: -2.375, heading: 359.987654321, ...overrides },
  quality: "full-fallback", kind: "urban", primitiveCount: 7, tileIds: ["x0_y0", "x1_y0"] });
const manifest = { city_id: "london", revision: "a".repeat(64) };
function setup(t, overrides = {}) {
  let renderer, props = { manifest, buildings: Array.from({ length: 63 }, (_, i) => entry(i)), selected: null,
    onSelect: () => {}, onFocus: () => {}, ...overrides };
  act(() => { renderer = create(React.createElement(Inspector, props)); });
  t.after(() => act(() => renderer.unmount()));
  return {
    get root() { return renderer.root; },
    get content() { return text(renderer.toJSON()); },
    get input() { return renderer.root.findByType("input"); },
    get rows() { return renderer.root.findByType("ul").findAllByType("li"); },
    change(query) { act(() => renderer.root.findByType("input").props.onChange({ target: { value: query } })); },
    click(label) { const button = renderer.root.findAllByType("button").find(node => text(node) === label); assert.ok(button, label); act(() => button.props.onClick()); },
    update(next) { props = { ...props, ...next }; act(() => renderer.update(React.createElement(Inspector, props))); },
  };
}

test("the keyboard-accessible list is bounded, labels its loaded-only scope, and searches all pages", t => {
  const f = setup(t);
  assert.equal(f.rows.length, 25);
  assert.match(f.content, /仅查询当前驻留瓦片中的 63 栋唯一建筑，不搜索全城/);
  assert.match(f.content, /匹配 63 \/ 63 栋已加载建筑 · 显示 1–25/);
  assert.equal(f.root.findByType("label").props.htmlFor, f.input.props.id);
  assert.equal(f.input.props["aria-controls"], f.root.findByType("ul").props.id);
  assert.ok(f.root.findByProps({ id: f.input.props["aria-describedby"] }));
  assert.equal(f.input.props.type, "search");
  assert.equal(f.input.props.maxLength, 256);
  f.click("下一页"); f.click("下一页");
  assert.equal(f.rows.length, 13);
  assert.match(f.content, /显示 51–63/);
  f.change(" ID-062 ");
  assert.equal(f.rows.length, 1);
  assert.match(f.content, /匹配 1 \/ 63/);
  assert.match(f.content, /id-062/);
  assert.equal(f.root.findAllByType("nav").length, 0);
  let prevented = false;
  act(() => f.input.props.onKeyDown({ key: "Escape", preventDefault: () => { prevented = true; } }));
  assert.equal(prevented, true);
  assert.equal(f.input.props.value, "");
  assert.equal(f.rows.length, 25);
  f.change("unloaded area");
  assert.equal(f.rows.length, 0);
  assert.match(f.content, /未加载区域尚未搜索/);
  f.click("清空搜索");
  assert.equal(f.input.props.value, "");
});

test("selection and focus are explicit; details retain exact source values, quality and revision with no invented provenance", t => {
  const calls = [], selected = entry(0, { name: '<img src=x onerror="alert(1)">', id: "osm_123" });
  const f = setup(t, { buildings: [selected], onSelect: id => calls.push(["select", id]), onFocus: id => calls.push(["focus", id]) });
  const row = f.rows[0].findByType("button");
  assert.equal(row.props["aria-pressed"], false);
  act(() => row.props.onClick());
  assert.deepEqual(calls, [["select", "osm_123"]]);
  f.update({ selected: "osm_123" });
  assert.equal(f.rows[0].findByType("button").props["aria-pressed"], true);
  const detail = text(f.root.findByProps({ className: "tile-building-details" }));
  for (const expected of ["source-asset", "urban", "完整源构件回退（full-fallback）", "7（非三角面数）", "-0.127612345678", "51.507212345678", "-2.375", "359.987654321", "x0_y0、x1_y0", manifest.revision]) assert.ok(detail.includes(expected), expected);
  assert.match(detail, /放置高程不是建筑高度/);
  assert.match(detail, /垂直基准未经独立核验/);
  assert.match(detail, /不含原始 OSM 标签/);
  assert.match(detail, /不能据此判断单栋建筑精度/);
  assert.equal(f.root.findAllByType("img").length, 0);
  assert.equal(f.root.findAllByType("a").length, 0, "IDs/names must not be converted into guessed provenance links");
  const html = renderToStaticMarkup(React.createElement(Inspector, { manifest, buildings: [selected], selected: "osm_123", onSelect() {}, onFocus() {} }));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  f.change("no match");
  assert.equal(f.rows.length, 0);
  assert.ok(f.content.includes("source-asset"), "filtering does not erase a selected loaded building");
  f.click("定位所选建筑"); f.click("清除选择");
  assert.deepEqual(calls, [["select", "osm_123"], ["focus", "osm_123"], ["select", null]]);
  f.update({ buildings: [{ ...selected, quality: "overview" }] });
  assert.match(f.content, /源模型既有总览（overview）/);
  f.update({ buildings: [] });
  assert.doesNotMatch(f.content, /source-asset|源模型既有总览|osm_123/);
  assert.match(f.content, /所选建筑已不在当前加载范围/);
  assert.ok(!f.root.findAllByType("button").some(node => text(node) === "定位所选建筑"));
});

test("eviction clamps pages permanently and an empty stream never claims there are no buildings in the city", t => {
  const f = setup(t);
  f.click("下一页"); f.click("下一页");
  f.update({ buildings: [entry(0), entry(1)] });
  assert.equal(f.rows.length, 2);
  assert.match(f.content, /显示 1–2/);
  f.update({ buildings: Array.from({ length: 63 }, (_, i) => entry(i)) });
  assert.match(f.content, /第 1 \/ 3 页/);
  f.update({ buildings: [] });
  assert.equal(f.rows.length, 0);
  assert.match(f.content, /当前没有已加载建筑/);
  assert.match(f.content, /等待瓦片读取，或移动视口/);
});

test("a filtered-out selection is explicit and returning to its list finds the correct page without clearing selection", t => {
  const selections = [];
  const f = setup(t, { selected: "id-062", onSelect: id => selections.push(id) });
  f.change("Building 000");
  assert.equal(f.rows.length, 1);
  assert.match(f.content, /所选建筑不符合当前搜索条件，选择仍然保留/);
  assert.match(text(f.root.findByProps({ className: "tile-selected-name" })), /Building 062/);
  f.click("查看所选建筑所在列表");
  assert.equal(f.input.props.value, "");
  assert.match(f.content, /第 3 \/ 3 页/);
  assert.ok(f.rows.some(row => row.findByType("button").props["aria-pressed"]));
  assert.doesNotMatch(f.content, /所选建筑不符合当前搜索条件/);
  assert.deepEqual(selections, [], "returning to results does not unselect or replace the selected building");
  f.update({ hidden: true, panelId: "inspector-panel" });
  assert.equal(f.root.findByType("aside").props.hidden, true);
  assert.equal(f.root.findByType("aside").props.id, "inspector-panel");
  f.update({ hidden: false });
  assert.match(f.content, /第 3 \/ 3 页/);
  assert.match(f.content, /source-asset/);
});
