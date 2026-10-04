import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";
import { componentFloors, hasFloorComponents } from "../src/studio/model.ts";

const Panel = await componentBundle("DetailPanel", [{ name: "detail-scene-fixture", setup(build) {
  build.onResolve({ filter: /^react$/, namespace: "detail-test" }, () => ({ path: "react", external: true }));
  build.onResolve({ filter: /^\.\/(BuildingScene|Inspector|SemanticTree)$/ }, args => ({ path: args.path, namespace: "detail-test" }));
  build.onLoad({ filter: /.*/, namespace: "detail-test" }, args => ({ contents: args.path === "./BuildingScene"
    ? 'import React from "react"; export default React.forwardRef((props, ref) => { globalThis.detailSceneFixture = props; return null; });'
    : "export default () => null", loader: "js" }));
} }]);
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const button = (root, label) => root.findAllByType("button").find(node => text(node) === label);
const outline = {
  format: "gugis-studio", version: "1.1", coordinate_system: "ENU_METERS_WGS84",
  parameters: { name: "Synthetic outline", kind: "footprint", floors: 8, units: 1, floor_height: 3,
    scale: 1, longitude: -2.6, latitude: 51.45, altitude: 0, heading: 0 },
  templates: { body: { kind: "box", size: [10, 10, 24], color: "#abcdef" } },
  nodes: [{ id: "body", template: "body", category: "wall", position: [0, 0, 12] }],
};
function fixture(document) {
  let renderer;
  act(() => { renderer = create(React.createElement(Panel, { document })); });
  return { get root() { return renderer.root; }, update(next) { act(() => renderer.update(React.createElement(Panel, { document: next }))); },
    close() { act(() => renderer.unmount()); delete globalThis.detailSceneFixture; } };
}

test("declared floors do not expose unsupported floor operations on an outline or unmarked model", () => {
  const f = fixture(outline);
  assert.equal(hasFloorComponents(outline), false);
  assert.deepEqual(componentFloors(outline), []);
  assert.match(text(f.root.findByProps({ "aria-label": "模型表达说明" })), /LoD1.*未存储内部和楼层构件/);
  for (const label of ["关注楼层", "移开上部", "隐藏上部", "仅看区间"]) assert.equal(button(f.root, label), undefined);
  const legacyOutline = { ...outline, parameters: { ...outline.parameters, floors: 1 },
    nodes: [{ ...outline.nodes[0], floor: 1 }] };
  f.update(legacyOutline);
  assert.equal(hasFloorComponents(legacyOutline), false);
  assert.deepEqual(componentFloors(legacyOutline), []);
  assert.equal(button(f.root, "移开上部"), undefined, "a LoD1 body's default floor 1 is not separate floor geometry");
  f.update({ ...outline, parameters: { ...outline.parameters, kind: "georgian" } });
  assert.match(text(f.root), /声明层数不代表已经存储楼层几何/);
  f.close();
});

test("only stored valid floor components appear in controls, and switching back to an outline resets the view", () => {
  const marked = { ...outline, parameters: { ...outline.parameters, kind: "urban" }, nodes: [
    { ...outline.nodes[0], id: "lower", floor: 1 }, { ...outline.nodes[0], id: "upper", floor: 3 },
    { id: "container", category: "floor", floor: 2 },
    { ...outline.nodes[0], id: "dangling", template: "missing", floor: 4 },
    { ...outline.nodes[0], id: "beyond", floor: 9 },
    { ...outline.nodes[0], id: "fraction", floor: 1.5 },
  ] };
  assert.equal(hasFloorComponents(marked), true);
  assert.deepEqual(componentFloors(marked), [1, 3]);
  const f = fixture(marked);
  act(() => button(f.root, "仅看区间").props.onClick());
  assert.deepEqual(f.root.findByProps({ "aria-label": "起始楼层" }).findAllByType("option").map(text), ["1", "3"]);
  assert.equal(f.root.findByProps({ "aria-label": "结束楼层" }).props.value, 3);
  act(() => button(f.root, "移开上部").props.onClick());
  assert.equal(f.root.findByProps({ "aria-label": "上部起始楼层" }).props.value, 3);
  assert.equal(globalThis.detailSceneFixture.view.mode, "lift");
  f.update(outline);
  assert.equal(globalThis.detailSceneFixture.view.mode, "all");
  assert.equal(button(f.root, "移开上部"), undefined);
  f.close();
});
