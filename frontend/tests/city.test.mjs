import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeCity } from "../src/studio/cityArchive.ts";
import {
  placedDocument,
  putBuilding,
  removeBuilding,
  collectAssets,
} from "../src/studio/cityModel.ts";
const city = decodeCity(
  JSON.parse(
    readFileSync(
      new URL("../../backend/data/bristol.gugis.json", import.meta.url),
      "utf8",
    ),
  ),
);
test("append retains all existing objects, roads and provenance", () => {
  const source = JSON.stringify(city),
    doc = placedDocument(city, "georgian0");
  const next = putBuilding(
    city,
    { ...doc, parameters: { ...doc.parameters, name: "New test" } },
    "test_new",
  );
  assert.equal(next.instances.length, city.instances.length + 1);
  assert.deepEqual(next.roads, city.roads);
  assert.deepEqual(next.metadata, city.metadata);
  assert.equal(JSON.stringify(city), source);
});
test("editing a shared building uses copy-on-write and retains geographic placement", () => {
  const doc = placedDocument(city, "georgian0"),
    neighbour = placedDocument(city, "georgian1");
  let next = putBuilding(
    city,
    { ...doc, parameters: { ...doc.parameters, heading: 30, name: "Edited" } },
    "georgian0",
    true,
  );
  assert.equal(placedDocument(next, "georgian0").parameters.heading, 30);
  assert.deepEqual(placedDocument(next, "georgian1"), neighbour);
  const source = next.instances.find((i) => i.id === "georgian0");
  next = { ...next, instances: [...next.instances, { ...source, id: "copy" }] };
  const before = placedDocument(next, "copy");
  next = putBuilding(
    next,
    { ...doc, parameters: { ...doc.parameters, name: "Edited again" } },
    "georgian0",
    true,
  );
  assert.deepEqual(placedDocument(next, "copy"), before);
});
test("delete prunes only unreferenced assets and undo can restore the previous immutable snapshot", () => {
  const next = removeBuilding(city, "georgian0");
  assert.equal(next.instances.length, city.instances.length - 1);
  assert.ok(next.assets.georgian);
  assert.ok(placedDocument(city, "georgian0"));
  assert.equal(placedDocument(next, "georgian0"), null);
  assert.equal(collectAssets(city).instances.length, 615);
});
test("complete JSON roundtrip retains shared models and editable node graphs", () => {
  const restored = JSON.parse(JSON.stringify(city));
  assert.deepEqual(
    placedDocument(restored, "wills"),
    placedDocument(city, "wills"),
  );
  assert.equal(
    restored.instances.filter((i) => i.asset === "victorian").length,
    6,
  );
  assert.throws(() =>
    putBuilding(city, placedDocument(city, "wills"), "missing", true),
  );
});
