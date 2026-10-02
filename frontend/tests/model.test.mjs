import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  descendants,
  initialView,
  presentation,
  serialize,
  statistics,
} from "../src/studio/model.ts";
const doc = JSON.parse(
  readFileSync(
    new URL("../src/studio/data/example.json", import.meta.url),
    "utf8",
  ),
);

test("floor filtering includes the entire dwelling and excludes other floors", () => {
  const view = { ...initialView(12), mode: "isolate", from: 8, to: 8 };
  const visible = doc.nodes.filter(
    (n) => n.template && presentation(n, view).visible,
  );
  assert.equal(visible.length, 110);
  assert.deepEqual([...new Set(visible.map((n) => n.floor))], [8]);
  assert.equal(visible.filter((n) => n.category === "window").length, 8);
});
test("upper floor transforms are inclusive, non-destructive and reversible", () => {
  const before = serialize(doc),
    view = { ...initialView(12), mode: "lift", split: 11, lift: 12 };
  for (const n of doc.nodes.filter((n) => n.template))
    assert.equal(presentation(n, view).offset, n.floor >= 11 ? 12 : 0);
  assert.equal(serialize(doc), before);
  for (const n of doc.nodes.filter((n) => n.template))
    assert.equal(presentation(n, initialView(12)).offset, 0);
});
test("hide from floor 11 removes its roof too", () => {
  const view = { ...initialView(12), mode: "hide", split: 11 };
  assert.equal(
    doc.nodes.filter((n) => n.template && presentation(n, view).visible).length,
    1100,
  );
  assert.ok(
    doc.nodes
      .filter((n) => n.category === "roof")
      .every((n) => !presentation(n, view).visible),
  );
});
test("focus fades outside interval and category visibility composes with it", () => {
  const view = { ...initialView(12), mode: "focus", from: 8, to: 11 };
  const outside = doc.nodes.find((n) => n.template && n.floor === 1);
  assert.equal(presentation(outside, view).alpha, 0.12);
  view.categories.delete("window");
  assert.ok(
    doc.nodes
      .filter((n) => n.category === "window")
      .every((n) => !presentation(n, view).visible),
  );
});
test("group selection has no adjacent households", () => {
  const ids = descendants(doc, "u1f8d1");
  assert.equal(ids.size, 22);
  assert.ok(!ids.has("u1f8d2"));
  for (const n of doc.nodes.filter((n) => ids.has(n.id)))
    assert.equal(n.floor, 8);
});
test("export retains full model and measures UTF-8 bytes, not character count", () => {
  const text = serialize(doc),
    parsed = JSON.parse(text),
    stats = statistics(doc);
  assert.equal(parsed.nodes.length, doc.nodes.length);
  assert.equal(stats.bytes, Buffer.byteLength(text, "utf8"));
  assert.ok(stats.bytes > text.length);
  assert.ok(stats.saving > 0);
  assert.equal(parsed.version, "1.0");
});
