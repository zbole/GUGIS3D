import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { Cartesian3, Cartographic, Matrix4, Transforms, Math as CM } from "@cesium/engine";
import { componentBundle } from "./helpers/componentBundle.mjs";

const Panel = await componentBundle("SpatialPanel");
const noop = () => {};
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const button = (root, title) => root.findAllByType("button").find(node => text(node) === title);
const terrain = { name: "Synthetic DTM", vertical_datum: "ODN", source: {} };
const city = {
  assets: { house: { parameters: { floors: 2 }, templates: { wall: { kind: "box" } },
    nodes: [{ id: "wall", name: "Wall", category: "wall", template: "wall" }] } },
  instances: [{ id: "house", asset: "house", name: "House" }], roads: [],
  environment: { features: [{ id: "duct", asset: "duct", layer: "underground", scale: 1 }],
    feature_assets: { duct: { components: [{ id: "body", category: "body", function: "box",
      parameters: { width: 4, depth: 4, height: 2 } }] } } },
};
const building = { id: "house", name: "House", asset: "house", kind: "georgian", layer: "building",
  components: 1, radius: 7, distance: 10, bottom: 100, top: 110, burialDepth: 0, basis: "model-envelope", station: 10, offset: 0 };
const duct = { id: "duct", name: "Duct", asset: "duct", kind: "round-plaza", layer: "underground",
  components: 1, radius: 3, distance: 10, bottom: 95, top: 97, burialDepth: 3, basis: "model-envelope", station: 30, offset: 0 };
const query = { position: { longitude: -2.603, latitude: 51.454, altitude: 0 },
  terrain: { height: 100, patch: "native", kind: "ruled-strip", slope: 5 },
  buildings: [building], features: [duct], nearestRoad: { id: "r", name: "Park Street", distance: 4 },
  inspected: { layer: "underground", id: "duct", component: "body" }, radius: 100 };
const profile = { horizontalDistance: 40, samples: [
  { distance: 0, height: 100 }, { distance: 10, height: 101 },
  { distance: 20, height: null }, { distance: 30, height: 102, gapBefore: true }, { distance: 40, height: 103 },
] };
const section = { width: 30, length: 40, objects: [building, duct], buildings: 1, surface: 0, underground: 1,
  verticalDatum: "ODN", sourceName: "Synthetic DTM" };
function fixture(overrides = {}) {
  let renderer, props = { city, points: [], terrain, query: null, section: null, profile: null,
    width: 30, setWidth: noop, picking: false, setPicking: noop, onFocus: noop,
    onSave: async () => true, canSave: true, busy: false, selectedName: null, hasSavedRecord: false,
    onEnvironment: noop, ...overrides };
  act(() => { renderer = create(React.createElement(Panel, props)); });
  return { get root() { return renderer.root; }, update(next) { props = { ...props, ...next }; act(() => renderer.update(React.createElement(Panel, props))); },
    close() { act(() => renderer.unmount()); } };
}

test("point query reveals source height and selected function component with design depth", () => {
  const picks = [], focuses = [];
  const f = fixture({ query, setPicking: p => picks.push(p), onFocus: o => focuses.push(o.id) });
  assert.match(text(f.root.findByProps({ "aria-label": "城市联合分析面板" })), /100 m/);
  assert.match(text(f.root.findByProps({ "aria-label": "对象结构详情" })), /body.*box/s);
  assert.match(text(f.root.findByProps({ "aria-label": "对象结构详情" })), /height.*2/s);
  assert.match(text(f.root.findByProps({ "aria-label": "对象结构详情" })), /3 m/);
  assert.match(text(f.root.findByProps({ "aria-label": "对象结构详情" })), /基点参考覆土：3 m/);
  assert.match(text(f.root), /正值仅表示基点参考间距，不能证明整个模型位于地表下方/);
  act(() => button(f.root, "在场景中选点查询").props.onClick());
  assert.deepEqual(picks, [true]);
  const objectButton = f.root.findAllByProps({ className: "spatial-object" }).find(node => text(node).includes("House"));
  act(() => objectButton.props.onClick());
  assert.deepEqual(focuses, ["house"]);
  f.close();
});

test("a picked building component exposes its parent node and floor path", () => {
  const hierarchyCity = { ...city, assets: { house: { ...city.assets.house, nodes: [
    { id: "floor-2", name: "Second floor", category: "floor", floor: 2 },
    { id: "wall", name: "Wall", category: "wall", parent: "floor-2", floor: 2,
      unit: 1, template: "wall" },
  ] } } };
  const f = fixture({ city: hierarchyCity, query: { ...query, inspected: { layer: "building", id: "house", component: "wall" } } });
  assert.match(text(f.root.findByProps({ "aria-label": "对象结构详情" })), /Second floor.*Wall.*第 2 层.*单元 1/s);
  f.close();
});

test("vertical section breaks NoData, shows each layer and saves width only when clicked", async () => {
  const changes = [], saves = [];
  const f = fixture({ profile, section: { ...section, clearances: [{ undergroundId: "duct", otherId: "house",
    otherName: "House", otherLayer: "building", horizontalDistance: 1,
    verticalGap: 3, verticalOverlap: 0, basis: "model-envelope" }] }, setWidth: n => changes.push(n),
    onSave: async name => { saves.push(name); return true; } });
  assert.equal(saves.length, 0);
  assert.equal(f.root.findAllByProps({ className: "spatial-section-object underground" }).length, 1);
  assert.match(text(f.root.findByProps({ className: "spatial-clearances" })), /至少 3 m/);
  const path = f.root.findByProps({ className: "spatial-ground" }).props.d;
  assert.equal((path.match(/M/g) ?? []).length, 2);
  act(() => f.root.findByProps({ "aria-label": "剖面带宽" }).props.onChange({ target: { value: "40" } }));
  assert.deepEqual(changes, [40]);
  assert.equal(saves.length, 0);
  await act(async () => button(f.root, "保存路线与剖面带").props.onClick());
  assert.deepEqual(saves, ["布里斯托 · 城市联合剖面"]);
  f.close();
});

test("pending draft prevents city writes while no-data query retains unknown elevations", async () => {
  const f = fixture({ query: { ...query, terrain: null, buildings: [{ ...building, top: null, bottom: null }],
    features: [{ ...duct, top: null, bottom: null, burialDepth: null }] },
    profile, section, canSave: false });
  assert.match(text(f.root.findByProps({ "aria-label": "城市联合分析面板" })), /无地形数据/);
  assert.equal(button(f.root, "保存路线与剖面带").props.disabled, true);
  f.close();
});

test("section objects expose identity and selection, and keyboard activation never repeats", () => {
  const focuses = [], prevented = [];
  const f = fixture({ profile, section, onFocus: object => focuses.push(object.id) });
  const svg = f.root.findByType("svg");
  assert.equal(svg.props.role, "group");
  const objects = () => f.root.findAll(node => node.type === "g" && node.props.role === "button");
  assert.match(objects()[0].props["aria-label"], /House.*里程 10 m.*100 m 至 110 m/);
  assert.match(objects()[1].props["aria-label"], /Duct.*地下设计地物.*模型包络 95 m 至 97 m/);
  assert.deepEqual(objects().map(node => node.props["aria-pressed"]), [false, false]);
  const key = (index, value, repeat = false) => act(() => objects()[index].props.onKeyDown({
    key: value, repeat, preventDefault: () => prevented.push(value),
  }));
  key(0, "Enter");
  assert.deepEqual(focuses, ["house"]);
  assert.deepEqual(objects().map(node => node.props["aria-pressed"]), [true, false]);
  key(1, " ");
  assert.deepEqual(focuses, ["house", "duct"]);
  assert.deepEqual(objects().map(node => node.props["aria-pressed"]), [false, true]);
  key(1, " ", true); key(0, "Enter", true); key(0, "ArrowDown");
  assert.deepEqual(focuses, ["house", "duct"]);
  assert.deepEqual(prevented, ["Enter", " ", " ", "Enter"]);
  act(() => objects()[0].props.onClick());
  assert.deepEqual(focuses, ["house", "duct", "house"]);
  f.close();
});

test("selecting a section building draws a model trace and labels its accuracy", () => {
  const origin = { longitude: -2.603, latitude: 51.454 };
  const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(origin.longitude, origin.latitude));
  const point = (x, y) => {
    const geo = Cartographic.fromCartesian(Matrix4.multiplyByPoint(frame, new Cartesian3(x, y, 0), new Cartesian3()));
    return { longitude: CM.toDegrees(geo.longitude), latitude: CM.toDegrees(geo.latitude), altitude: 0 };
  };
  const traceCity = { ...city,
    assets: { house: { ...city.assets.house,
      templates: { wall: { kind: "box", size: [10, 10, 10], color: "#999999" } },
      nodes: [{ id: "wall", name: "Wall", category: "wall", template: "wall", position: [0, 0, 5] }] } },
    instances: [{ id: "house", asset: "house", name: "House", ...point(60, 50), heading: 0 }],
    environment: { ...city.environment, terrain: { version: "1.0", name: "native DTM", ...origin,
      vertical_datum: "ODN", reference_height: 100, demonstration: true, source: {},
      points: [[0, 0, 100], [200, 0, 100], [0, 200, 100], [200, 200, 100]],
      patches: [{ id: "native-plane", kind: "ruled-strip", left: [0, 1], right: [2, 3] }] } } };
  const f = fixture({ city: traceCity, points: [point(10, 50), point(150, 50)],
    profile: { horizontalDistance: 140, samples: [{ distance: 0, height: 100 }, { distance: 140, height: 100 }] },
    section: { ...section, length: 140, objects: [{ ...building, station: 50 }], underground: 0 } });
  assert.equal(f.root.findAllByProps({ className: "spatial-cutline" }).length, 0);
  act(() => f.root.findByProps({ className: "spatial-object" }).props.onClick());
  assert.match(f.root.findByProps({ className: "spatial-cutline" }).props.d, /M.*L/);
  assert.match(text(f.root.findByProps({ className: "spatial-trace-status" })), /模型交线/);
  f.close();
});
