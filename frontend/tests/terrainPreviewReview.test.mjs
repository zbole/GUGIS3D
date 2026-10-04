import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";

const Review = await componentBundle("TerrainPreviewReview");
const terrain = (datum = "local", demonstration = true) => ({ id: "qa", name: "QA control grid", longitude: -2.603, latitude: 51.454,
  reference_height: 14, vertical_datum: datum, demonstration, source: {},
  points: [[0,0,-2], [10,0,0], [0,10,3], [10,10,8]],
  patches: [{ id: "r", kind: "ruled-strip", left: [0,1], right: [2,3] }, { id: "t", kind: "triangle-strip", indices: [0,1,2] }] });
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
function fixture(props) {
  let renderer; act(() => { renderer = create(React.createElement(Review, props)); });
  return { get root() { return renderer.root; }, close: () => act(() => renderer.unmount()) };
}

test("preview reports source control heights, native counts and the display offset without changing the terrain", () => {
  const before = terrain(), after = { ...terrain(), name: "Replacement", points: [[0,0,100], [10,0,102], [0,10,98], [10,10,101]], reference_height: 100 };
  const original = JSON.stringify([before, after]), f = fixture({ before, after });
  const rows = f.root.findAllByType("tr");
  const row = label => rows.find(r => r.findAllByType("th").some(n => text(n) === label));
  assert.match(text(row("控制点高程范围")), /-2 至 8 m.*98 至 102 m/);
  assert.match(text(row("显示参考高程")), /14 m.*100 m/);
  assert.match(text(row("原生面带")), /1 直纹面带 \/ 1 三角带/);
  assert.match(text(f.root), /合成演示 · 非实测/);
  assert.match(text(f.root), /不代表实测精度.*NoData 覆盖率/);
  assert.equal(JSON.stringify([before, after]), original);
  f.close();
});

test("datum changes open the review and preserve explicit conversion and unknown-datum cautions", () => {
  const f = fixture({ before: terrain("ODN", false), after: terrain("ellipsoidal", false) });
  assert.equal(f.root.findByType("details").props.open, true);
  assert.match(text(f.root), /高程基准已改变/);
  assert.match(text(f.root), /不会自动进行 ODN、椭球高或局部基准转换/);
  assert.match(text(f.root), /实测属性未独立核验/);
  f.close();
  const unknown = fixture({ after: terrain("unknown", false) });
  assert.match(text(unknown.root), /未声明高程基准/);
  assert.equal(unknown.root.findByType("details").props.open, true);
  unknown.close();
});

test("new and removed terrain are distinguished; unchanged objects add no review", () => {
  const same = terrain(), unchanged = fixture({ before: same, after: same });
  assert.equal(unchanged.root.findAllByType("details").length, 0); unchanged.close();
  const added = fixture({ after: same });
  const nameRow = added.root.findAllByType("tr").find(r => r.findAllByType("th").some(n => text(n) === "地形名称"));
  assert.deepEqual(nameRow.findAllByType("td").map(text), ["无地形", "QA control grid"]); added.close();
  const removed = fixture({ before: same });
  assert.match(text(removed.root), /无地形/); removed.close();
});

test("large control grids do not spread arguments and empty or nonfinite elevations are not fabricated", () => {
  const large = { ...terrain(), points: Array.from({ length: 300000 }, (_, i) => [i,0,i - 100]) };
  const f = fixture({ after: large }); assert.match(text(f.root), /-100 至 299,899 m/); f.close();
  const invalid = fixture({ after: { ...terrain(), points: [[0,0,NaN], [1,1,Infinity]] } });
  assert.match(text(invalid.root), /无有效控制点/); invalid.close();
});
