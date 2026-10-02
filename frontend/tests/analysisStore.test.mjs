import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cartesian3, Cartographic, Matrix4, Transforms, Math as CesiumMath } from "cesium";
import { encodeCity, decodeCity } from "../src/studio/cityArchive.ts";

const outdir = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/analysis-store", import.meta.url));
await build({ entryPoints: ["analysisStore", "terrainAnalysis"].map(name =>
  fileURLToPath(new URL(`../src/studio/${name}.ts`, import.meta.url))),
  bundle: true, platform: "node", format: "esm", packages: "external", outdir });
const { analysisKey, analysisAlgorithm, readAnalyses, writeAnalyses, terrainFingerprint } =
  await import(pathToFileURL(`${outdir}/analysisStore.js`).href);
const { analyzePath } = await import(pathToFileURL(`${outdir}/terrainAnalysis.js`).href);

function fixture() {
  const terrain = {
    version: "1.0", name: "带 NoData 的原生测试平面", longitude: -2.603, latitude: 51.454,
    vertical_datum: "ODN", reference_height: 100, demonstration: true,
    source: { "文件名": "synthetic.asc", "许可": "合成测试" },
    points: [[0, 0, 100], [0, 100, 100], [43, 0, 100], [43, 100, 100],
      [44, 0, 100], [44, 100, 100], [100, 0, 100], [100, 100, 100]],
    patches: [{ id: "left", kind: "ruled-strip", left: [0, 2], right: [1, 3] },
      { id: "right", kind: "ruled-strip", left: [4, 6], right: [5, 7] }],
  };
  const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(terrain.longitude, terrain.latitude));
  const points = [1, 99].map(x => {
    const geo = Cartographic.fromCartesian(Matrix4.multiplyByPoint(frame, new Cartesian3(x, 50, 0), new Cartesian3()));
    return { longitude: CesiumMath.toDegrees(geo.longitude), latitude: CesiumMath.toDegrees(geo.latitude), altitude: 0 };
  });
  const result = analyzePath(points, terrain, 60);
  const record = { id: "profile-1", name: "公园路线", createdAt: "2026-09-23T08:00:00.000Z", points,
    spacing: 60, terrainFingerprint: terrainFingerprint(terrain), result, algorithm: analysisAlgorithm,
    coordinateSystem: "WGS84_DEGREES_LOCAL_HEIGHT_METERS", source: structuredClone(terrain.source), referenceHeight: 100 };
  const city = { format: "gugis-city", version: "1.0", coordinate_system: "ENU_METERS_WGS84", name: "Test",
    assets: {}, instances: [], roads: [], metadata: { "既有数据": "保留此内容" },
    environment: { version: "1.0", terrain, feature_assets: {}, features: [], drape_buildings: true } };
  return { terrain, record, city };
}
const withRecords = (city, records) => ({ ...city, metadata: { ...city.metadata,
  [analysisKey]: JSON.stringify({ version: 1, records }) } });

test("saved analysis survives GUGIS encoding with source datum and sub-sample native gaps intact", () => {
  const { city, record } = fixture();
  assert.equal(record.result.samples[1].gapBefore, true);
  assert.ok(record.result.samples.every(sample => sample.height === 100));
  assert.equal(record.result.surfaceDistance, null);
  const saved = writeAnalyses(city, [record]);
  const restored = decodeCity(JSON.parse(JSON.stringify(encodeCity(saved))));
  assert.deepEqual(readAnalyses(restored), [record]);
  assert.equal(restored.metadata["既有数据"], "保留此内容");
  assert.equal(readAnalyses(restored)[0].referenceHeight, 100);
  assert.equal(readAnalyses(restored)[0].result.verticalDatum, "ODN");
  assert.deepEqual(readAnalyses(restored)[0].source, record.source);
  assert.deepEqual(restored.environment, city.environment);
});

test("saving and reading produce detached records without mutating the source city", () => {
  const { city, record } = fixture();
  const before = JSON.stringify(city);
  Object.freeze(city.metadata);
  Object.freeze(city);
  const saved = writeAnalyses(city, [record]);
  assert.notEqual(saved, city);
  assert.notEqual(saved.metadata, city.metadata);
  assert.equal(JSON.stringify(city), before);
  record.points[0].altitude = 999;
  record.result.samples[0].height = 999;
  record.source["文件名"] = "changed.asc";
  const restored = readAnalyses(saved);
  assert.equal(restored[0].points[0].altitude, 0);
  assert.equal(restored[0].result.samples[0].height, 100);
  assert.equal(restored[0].source["文件名"], "synthetic.asc");
  restored[0].name = "Changed read result";
  assert.equal(readAnalyses(saved)[0].name, "公园路线");
});

test("terrain identity changes with geometry, datum and reference height but ignores object key order", () => {
  const { terrain } = fixture();
  const key = terrainFingerprint(terrain);
  assert.equal(terrainFingerprint(), "none");
  const reordered = Object.fromEntries(Object.entries(terrain).toReversed());
  reordered.source = Object.fromEntries(Object.entries(terrain.source).toReversed());
  reordered.patches = terrain.patches.map(p => Object.fromEntries(Object.entries(p).toReversed()));
  assert.equal(terrainFingerprint(reordered), key);
  for (const mutate of [t => t.points[0][2]++, t => t.vertical_datum = "local",
    t => t.reference_height++, t => t.patches[0].left = [2, 0], t => t.source["文件名"] = "other.asc"]) {
    const changed = structuredClone(terrain);
    mutate(changed);
    assert.notEqual(terrainFingerprint(changed), key);
  }
});

test("imported malformed records, unsupported versions and duplicate IDs are rejected", () => {
  const { city, record } = fixture();
  const invalid = [null, {}, { version: 2, records: [record] }, { version: 1, records: {} },
    { version: 1, records: [record, record] }];
  for (const envelope of invalid) {
    const imported = { ...city, metadata: { [analysisKey]: JSON.stringify(envelope) } };
    assert.throws(() => readAnalyses(imported));
  }
  for (const mutate of [r => r.points = [r.points[0]], r => r.points = Array(65).fill(r.points[0]),
    r => r.points[0].longitude = 181, r => r.points[0].latitude = 90,
    r => r.name = " ", r => r.createdAt = "not-a-date", r => r.algorithm = "future/99",
    r => r.coordinateSystem = "EPSG:27700", r => r.result.samples = [],
    r => r.result.samples = Array(502).fill(r.result.samples[0]), r => r.source = ["not a mapping"],
    r => r.result.spatialDistance = -1, r => r.result.surfaceDistance = -1,
    r => r.result.ascent = -1, r => r.result.descent = -1,
    r => r.result.coverage = 1.1, r => r.sectionWidth = 1, r => r.sectionWidth = 201,
    r => r.result.samples[1].gapBefore = "yes",
    r => r.result.samples[1].distance = r.result.samples[0].distance]) {
    const changed = structuredClone(record);
    mutate(changed);
    assert.throws(() => readAnalyses(withRecords(city, [changed])), `accepted ${mutate}`);
  }
  assert.throws(() => readAnalyses(withRecords(city,
    Array.from({ length: 101 }, (_, i) => ({ ...record, id: `record-${i}` })))));
});

test("non-finite sample values are rejected before JSON can silently convert them to null", () => {
  const { city, record } = fixture();
  for (const field of ["height", "slope", "distance"])
    for (const value of [NaN, Infinity, -Infinity]) {
      const changed = structuredClone(record);
      changed.result.samples[0][field] = value;
      assert.throws(() => writeAnalyses(city, [changed]), `accepted ${field}=${value}`);
    }
  const imported = withRecords(city, [record]);
  imported.metadata[analysisKey] = imported.metadata[analysisKey].replace('"height":100', '"height":1e999');
  assert.throws(() => readAnalyses(imported));
});

test("invalid existing analysis metadata is preserved and never replaced by saving", () => {
  const { city, record } = fixture();
  const imported = { ...city, metadata: { ...city.metadata, [analysisKey]: "{broken analysis data" } };
  const before = JSON.stringify(imported);
  assert.throws(() => readAnalyses(imported));
  assert.throws(() => writeAnalyses(imported, [record]));
  assert.throws(() => writeAnalyses(imported, []));
  assert.equal(JSON.stringify(imported), before);
  assert.equal(readAnalyses(city).length, 0);
});

test("metadata capacity is checked without removing unrelated project metadata", () => {
  const { city, record } = fixture();
  const full = { ...city, metadata: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field-${i}`, "keep"])) };
  const before = JSON.stringify(full);
  assert.throws(() => writeAnalyses(full, [record]));
  assert.equal(JSON.stringify(full), before);
});
