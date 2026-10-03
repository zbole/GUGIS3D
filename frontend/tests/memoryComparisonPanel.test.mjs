import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";

const Panel = await componentBundle("MemoryComparison");
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");

test("unmeasured cities never display Bristol's previous measurements or a numerical comparison", () => {
  for (const cityId of ["london", "birmingham"]) {
    let renderer;
    act(() => { renderer = create(React.createElement(Panel, { cityId, revision: "a".repeat(64) })); });
    assert.match(text(renderer.root), /当前城市内存基准待测/);
    assert.doesNotMatch(text(renderer.root), /上次测量|项目已修改|\d+\.\d+%|\d+\.\d+ MB/);
    assert.equal(renderer.root.findAllByType("table").length, 0);
    act(() => renderer.unmount());
  }
});

test("Bristol retains its explicitly stale report when its current revision differs", () => {
  let renderer;
  act(() => { renderer = create(React.createElement(Panel, { cityId: "bristol", revision: "a".repeat(64) })); });
  assert.match(text(renderer.root), /上次测量结果，当前项目需重新测量/);
  assert.equal(renderer.root.findAllByType("table").length, 1);
  act(() => renderer.unmount());
});
