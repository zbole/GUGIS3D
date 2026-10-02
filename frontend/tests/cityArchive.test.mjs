import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeCity, decodeCity } from "../src/studio/cityArchive.ts";
import { placedDocument, putBuilding } from "../src/studio/cityModel.ts";
const wire = JSON.parse(
  readFileSync(
    new URL("../../backend/data/bristol.gugis.json", import.meta.url),
    "utf8",
  ),
);
const city = decodeCity(wire);

test("whole city archive preserves every component, color, transform, road and semantic attribute", () => {
  const original = JSON.stringify(city);
  const archive = encodeCity(city);
  assert.equal(archive.version, "1.1");
  // JSON.stringify normalizes -0 to 0 in old and new formats alike.
  const restored = decodeCity(JSON.parse(JSON.stringify(archive)));
  const expected = JSON.parse(original);
  for (const key of Object.keys(expected.assets))
    assert.deepEqual(restored.assets[key], expected.assets[key], key);
  const { assets: _, ...otherExpected } = expected;
  const { assets: __, ...otherRestored } = restored;
  assert.deepEqual(otherRestored, otherExpected);
  assert.equal(JSON.stringify(city), original);
  assert.equal(
    Object.values(archive.geometry_library).filter((g) => g.kind === "box")
      .length,
    1,
  );
  assert.ok(
    Object.values(archive.geometry_library).some((g) => g.kind === "box-set"),
  );
  assert.ok(
    Object.values(archive.geometry_library).some((g) => g.kind === "mesh"),
  );
});

test("cross-building geometry sharing keeps colors independent and edits use new arrays", () => {
  const doc = placedDocument(city, "georgian0");
  const meshKey = Object.keys(doc.templates).find(
    (k) => doc.templates[k].kind === "mesh",
  );
  const small = {
    ...city,
    assets: {
      original: doc,
      copy: {
        ...doc,
        templates: {
          ...doc.templates,
          [meshKey]: { ...doc.templates[meshKey], color: "#123456" },
        },
      },
    },
    instances: city.instances
      .slice(0, 2)
      .map((i, index) => ({
        ...i,
        id: index ? "copy" : "original",
        asset: index ? "copy" : "original",
      })),
  };
  const decoded = decodeCity(encodeCity(small));
  assert.equal(
    decoded.assets.original.templates[meshKey].vertices,
    decoded.assets.copy.templates[meshKey].vertices,
  );
  assert.notEqual(
    decoded.assets.original.templates[meshKey].color,
    decoded.assets.copy.templates[meshKey].color,
  );
  const before = JSON.stringify(placedDocument(decoded, "copy"));
  const editable = structuredClone(placedDocument(decoded, "original"));
  editable.templates[meshKey].vertices[0][0] += 0.0123;
  const next = decodeCity(
    encodeCity(putBuilding(decoded, editable, "original", true)),
  );
  assert.equal(JSON.stringify(placedDocument(next, "copy")), before);
  assert.notDeepEqual(
    placedDocument(next, "original").templates[meshKey].vertices,
    decoded.assets.original.templates[meshKey].vertices,
  );
});

test("missing references and mismatched unit-box parameters never silently generate substitute shapes", () => {
  const doc = placedDocument(city, "georgian0");
  const small = { ...city, assets: { original: doc }, instances: [] };
  const archive = encodeCity(small);
  const bindings = archive.assets.original.templates;
  const key = Object.keys(bindings).find((k) => bindings[k].size);
  const missing = structuredClone(archive);
  missing.assets.original.templates[key].geometry = "absent";
  assert.throws(() => decodeCity(missing), /缺少共享几何/);
  delete bindings[key].size;
  assert.throws(() => decodeCity(archive), /尺寸参数/);
});
