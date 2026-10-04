import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";
import { emptyEnvironment, featurePresets } from "../src/studio/environment.ts";

const Review = await componentBundle("FeaturePreviewReview");
const lamp = id => ({ id, name: id, asset: "lamp", longitude: -2.603, latitude: 51.454, altitude: 0, scale: 1, heading: 0, layer: "surface" });
const env = (...ids) => ({ ...emptyEnvironment(), feature_assets: { lamp: structuredClone(featurePresets.lamp) }, features: ids.map(lamp) });
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
function render(before, after) {
  let renderer; act(() => { renderer = create(React.createElement(Review, { before, after })); });
  return renderer;
}

test("shared function-definition changes list every affected placement without changing source data", () => {
  const before = env("above", "below"); before.features[1].layer = "underground"; before.features[1].altitude = -5;
  const after = structuredClone(before); after.feature_assets.lamp.components[0].parameters.radius = 0.6;
  const source = JSON.stringify([before, after]), r = render(before, after);
  assert.match(text(r.root), /新增 0 \/ 修改 2 \/ 移除 0/);
  assert.match(text(r.root), /above · 修改.*below · 修改/);
  assert.match(text(r.root), /地下 · 距地形 -5 m/);
  assert.match(text(r.root), /4 个组件 · 圆柱 \+ 球体/);
  assert.equal(JSON.stringify([before, after]), source);
  act(() => r.unmount());
});

test("additions, removal and placement edits remain distinct, unchanged cloned definitions show no false changes", () => {
  const before = env("remove", "move", "same"), after = structuredClone(before);
  after.features = after.features.slice(1); after.features[0].longitude += 0.001; after.features.push(lamp("new"));
  const r = render(before, after);
  assert.match(text(r.root), /新增 1 \/ 修改 1 \/ 移除 1/);
  assert.doesNotMatch(text(r.root), /same · 修改/);
  act(() => r.unmount());
  const same = render(before, structuredClone(before)); assert.equal(same.toJSON(), null); act(() => same.unmount());
  const empty = render(undefined, undefined); assert.equal(empty.toJSON(), null); act(() => empty.unmount());
});

test("large affected sets report the full count while bounding review rows", () => {
  const after = env(...Array.from({ length: 200 }, (_, i) => `lamp-${i}`)), r = render(undefined, after);
  assert.match(text(r.root), /新增 200/);
  assert.match(text(r.root), /共影响 200 个地物，此处列出前 25 个/);
  assert.equal(r.root.findAllByType("tr").length, 26);
  act(() => r.unmount());
});
