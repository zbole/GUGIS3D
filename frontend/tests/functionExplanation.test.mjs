import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";
import { featurePresets, functionSolid } from "../src/studio/environment.ts";
const Explanation = await componentBundle("FunctionExplanation");
const text = (n) =>
  typeof n === "string" ? n : (n.children ?? []).map(text).join("");
test("function explanation exposes composition, formula, live parameters and native stored JSON", () => {
  const asset = structuredClone(featurePresets.lamp);
  let r;
  act(() => {
    r = create(React.createElement(Explanation, { asset, references: 4 }));
  });
  assert.match(text(r.root), /球体函数/);
  assert.match(text(r.root), /圆柱函数/);
  assert.match(text(r.root), /ρ sinφ cosθ/);
  assert.match(text(r.root), /被 4 个已保存地物引用/);
  asset.components[3].parameters.radius = 0.8;
  act(() =>
    r.update(React.createElement(Explanation, { asset, references: 4 })),
  );
  const native = JSON.parse(text(r.root.findByType("pre")));
  assert.equal(native.components[3].parameters.radius, 0.8);
  assert.equal(native.components[3].function, "sphere");
  assert.equal("vertices" in native.components[3], false);
  act(() => r.unmount());
});
test("arch formula depth domain agrees with generated local geometry", () => {
  const part = featurePresets["arched-door"].components[0];
  const ys = functionSolid(part).vertices.map((p) => p[1]);
  assert.equal(Math.min(...ys), -part.parameters.depth / 2);
  assert.equal(Math.max(...ys), part.parameters.depth / 2);
  let r;
  act(() => {
    r = create(
      React.createElement(Explanation, {
        asset: featurePresets["arched-door"],
      }),
    );
  });
  assert.match(text(r.root), /−厚度\/2 ≤ t ≤ 厚度\/2/);
  act(() => r.unmount());
});
