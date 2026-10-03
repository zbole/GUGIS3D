import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";
const Warning = await componentBundle("CitySourceWarnings");
const workspace = { id: "birmingham", data_revision: "a".repeat(64), quality_warnings: [
  { code: "known-height", message: "The Octagon 源高度为 155 m，旧模型错误使用了 9.6 m", osm_ids: [1436375109] },
] };
function render(props) { let renderer; act(() => { renderer = create(React.createElement(Warning, props)); }); return renderer; }
test("exact loaded revision shows known precision issue without claiming a repair", () => {
  const renderer = render({ workspace, revision: "a".repeat(64) });
  const output = JSON.stringify(renderer.toJSON());
  assert.match(output, /155 m/); assert.match(output, /9.6 m/); assert.match(output, /未被自动替换/);
  act(() => renderer.unmount());
});
test("stale catalog and drafts cannot inherit a seed-specific claim", () => {
  for (const props of [{ workspace, revision: "b".repeat(64) }, { workspace, revision: "" },
    { workspace, revision: "a".repeat(64), draft: true }, { workspace: { id: "bristol" }, revision: "a".repeat(64) }]) {
    const renderer = render(props); assert.equal(renderer.toJSON(), null); act(() => renderer.unmount());
  }
});
