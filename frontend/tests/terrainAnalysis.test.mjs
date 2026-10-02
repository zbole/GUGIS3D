import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cartesian3, Cartographic, Matrix4, Transforms, Math as CesiumMath } from "cesium";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/terrainAnalysis.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/terrainAnalysis.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile });
const { analyzePath, pathPointAtDistance, createPathLocator } = await import(pathToFileURL(outfile).href);
const origin = { longitude: -2.603, latitude: 51.454 };
const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(origin.longitude, origin.latitude));
function point(x, y, altitude = 0) {
  const geo = Cartographic.fromCartesian(Matrix4.multiplyByPoint(frame, new Cartesian3(x, y, 0), new Cartesian3()));
  return { longitude: CesiumMath.toDegrees(geo.longitude), latitude: CesiumMath.toDegrees(geo.latitude), altitude };
}
function rectangle(x0, x1, y0, y1, height = () => 100) {
  return {
    version: "1.0", name: "Native DTM", ...origin, vertical_datum: "ODN", reference_height: 100,
    demonstration: true, source: {},
    points: [[x0, y0, height(x0, y0)], [x0, y1, height(x0, y1)],
      [x1, y0, height(x1, y0)], [x1, y1, height(x1, y1)]],
    patches: [{ id: "native", kind: "ruled-strip", left: [0, 2], right: [1, 3] }],
  };
}
const near = (actual, expected, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) < tolerance,
  `expected ${actual} ≈ ${expected}`);

test("native flat profile retains source datum and separates scene height from source elevation", () => {
  const result = analyzePath([point(1, 1, 3), point(99, 1, 13)], rectangle(0, 100, 0, 100), 10);
  near(result.horizontalDistance, 98);
  near(result.spatialDistance, Math.hypot(98, 10));
  assert.equal(result.elevationChange, 10);
  near(result.surfaceDistance, 98);
  near(result.coverage, 1);
  assert.equal(result.terrainName, "Native DTM");
  assert.equal(result.verticalDatum, "ODN");
  near(result.ascent, 0);
  near(result.descent, 0);
  assert.ok(result.samples.every(s => Math.abs(s.height - 100) < 1e-10 && s.slope === 0
    && s.patch === "native" && s.kind === "ruled-strip"));
  assert.equal(result.samples[0].distance, 0);
  assert.equal(result.samples.at(-1).distance, result.horizontalDistance);
});

test("inclined planes return analytic slope, surface distance, ascent and reverse descent", () => {
  const terrain = rectangle(0, 100, 0, 100, (x, y) => 100 + x + 2 * y);
  const points = [point(1, 1), point(99, 1)];
  const result = analyzePath(points, terrain);
  near(result.surfaceDistance, 98 * Math.SQRT2);
  near(result.ascent, 98);
  near(result.descent, 0);
  near(result.samples[0].slope, CesiumMath.toDegrees(Math.atan(Math.sqrt(5))));
  const reverse = analyzePath(points.toReversed(), terrain);
  near(reverse.surfaceDistance, result.surfaceDistance);
  near(reverse.ascent, 0);
  near(reverse.descent, 98);
});

test("ruled profiles evaluate bilinear surfaces rather than display triangles", () => {
  const terrain = rectangle(0, 10, 0, 10, (x, y) => 100 + x * y / 10);
  const result = analyzePath([point(1, 1), point(9, 9)], terrain, 6);
  assert.equal(result.samples.length, 3);
  near(result.samples[1].height, 102.5);
  near(result.samples[1].slope, CesiumMath.toDegrees(Math.atan(Math.SQRT1_2)));
  near(result.ascent, 8);
  assert.ok(result.surfaceDistance > Math.hypot(result.horizontalDistance, 8),
    "curved terrain is longer than the endpoint chord");
});

test("triangle strips and fans expose their original patch identity and source elevations", () => {
  for (const patch of [
    { id: "tri-strip", kind: "triangle-strip", indices: [1, 0, 3, 2] },
    { id: "tri-fan", kind: "triangle-fan", hub: 4, ring: [0, 2, 3, 1] },
  ]) {
    const terrain = rectangle(0, 10, 0, 10, x => 100 + x);
    terrain.points.push([5, 5, 105]);
    terrain.patches = [patch];
    const result = analyzePath([point(1, 5), point(9, 5)], terrain, 2);
    assert.ok(result.samples.every(s => s.kind === patch.kind && s.patch === patch.id));
    near(result.samples[0].height, 101);
    near(result.samples.at(-1).height, 109);
    near(result.surfaceDistance, 8 * Math.SQRT2);
  }
});

test("thin NoData gaps are detected even when every displayed station has an elevation", () => {
  const left = rectangle(0, 43, 0, 100), right = rectangle(44, 100, 0, 100);
  const terrain = { ...left, points: [...left.points, ...right.points], patches: [
    left.patches[0], { id: "right", kind: "ruled-strip", left: [4, 6], right: [5, 7] },
  ] };
  const result = analyzePath([point(1, 50), point(99, 50)], terrain, 60);
  assert.ok(result.samples.every(s => s.height !== null), "the gap lies between uniform samples");
  assert.equal(result.samples[1].gapBefore, true, "the chart must break even without a null sample");
  assert.equal(result.samples[2].gapBefore, undefined);
  near(result.coverage, 97 / 98);
  assert.equal(result.surfaceDistance, null);
  assert.equal(result.ascent, null);
  assert.equal(result.descent, null);
  const dense = analyzePath([point(1, 50), point(99, 50)], terrain, 0.2);
  assert.ok(dense.samples.some(s => s.height === null && s.patch === null && s.slope === null));
});

test("out-of-bounds paths never extrapolate and uncovered routes keep only placement measurements", () => {
  const points = [point(-10, 50, 1), point(110, 50, 5)];
  const result = analyzePath(points, rectangle(0, 100, 0, 100), 5);
  near(result.coverage, 100 / 120);
  assert.equal(result.samples[0].height, null);
  assert.equal(result.samples.at(-1).height, null);
  assert.equal(result.surfaceDistance, null);
  const missing = analyzePath(points);
  near(missing.horizontalDistance, 120);
  assert.equal(missing.elevationChange, 4);
  assert.equal(missing.coverage, 0);
  assert.equal(missing.surfaceDistance, null);
  assert.equal(missing.terrainName, null);
  assert.ok(missing.samples.every(s => s.height === null));
});

test("multi-segment routes preserve corners even with coarse requested spacing", () => {
  const terrain = rectangle(-1, 101, -1, 101, (x, y) => 100 + x + 2 * y);
  const result = analyzePath([point(0, 0, 5), point(100, 0, 15), point(100, 100, 5)], terrain, 1000);
  assert.equal(result.samples.length, 3);
  near(result.horizontalDistance, 200);
  near(result.spatialDistance, 2 * Math.hypot(100, 10));
  assert.equal(result.elevationChange, 0);
  near(result.surfaceDistance, 100 * (Math.SQRT2 + Math.sqrt(5)));
  near(result.ascent, 300);
  near(result.descent, 0);
  assert.equal(result.coverage, 1, "complete coverage must not trigger a floating-point NoData warning");
});

test("a hill peak at a route corner remains visible even when regular stations only include endpoints", () => {
  const terrain = rectangle(-1, 101, -1, 101, x => x);
  const result = analyzePath([point(0, 0), point(100, 0), point(0, 100)], terrain, 1000);
  assert.equal(result.samples.length, 3);
  near(result.samples[1].height, 100);
  near(result.ascent, 100);
  near(result.descent, 100);
  near(result.samples[0].height, result.samples.at(-1).height);
  assert.equal(result.coverage, 1);
});

test("profile station positions interpolate the original ENU route and clamp to its endpoints", () => {
  const terrain = rectangle(-1, 101, -1, 101);
  const points = [point(0, 0, 5), point(100, 0, 15), point(100, 100, 5)];
  const analysis = analyzePath(points, terrain);
  const middle = pathPointAtDistance(points, terrain, 150);
  const expected = point(100, 50, 10);
  near(middle.longitude, expected.longitude, 1e-9);
  near(middle.latitude, expected.latitude, 1e-9);
  near(middle.altitude, expected.altitude);
  assert.deepEqual(pathPointAtDistance(points, terrain, -5), points[0]);
  assert.deepEqual(pathPointAtDistance(points, terrain, analysis.horizontalDistance + 5), points.at(-1));
  assert.equal(pathPointAtDistance([], terrain, 10), null);
  assert.equal(pathPointAtDistance(points, terrain, NaN), null);
  const locate = createPathLocator(points, terrain);
  assert.deepEqual(locate(150), middle);
  assert.deepEqual(locate(50), pathPointAtDistance(points, terrain, 50));
});

test("sampling is capped at 501 uniform stations and reports the actual spacing", () => {
  const result = analyzePath([point(0, 0), point(1000, 0)], rectangle(-1, 1001, -1, 1), 0.001);
  assert.equal(result.samples.length, 501);
  near(result.sampleSpacing, result.horizontalDistance / 500, 1e-12);
  for (let i = 1; i < result.samples.length; i++)
    near(result.samples[i].distance - result.samples[i - 1].distance, result.sampleSpacing, 1e-10);
  assert.equal(result.samples.at(-1).distance, result.horizontalDistance);
  near(result.coverage, 1);
  const points = Array.from({ length: 64 }, (_, i) => point(i * 10, i % 2 ? 1 : 0));
  const multi = analyzePath(points, rectangle(-1, 641, -1, 2), 0.001);
  assert.ok(multi.samples.length <= 501);
  assert.ok(multi.samples.length >= 64);
  assert.equal(multi.coverage, 1);
});

test("empty, single and vertical-only paths do not fabricate surface totals", () => {
  const terrain = rectangle(-1, 1, -1, 1);
  const empty = analyzePath([], terrain);
  assert.deepEqual(empty.samples, []);
  assert.equal(empty.surfaceDistance, null);
  const single = analyzePath([point(0, 0, 3)], terrain);
  assert.equal(single.samples.length, 1);
  assert.equal(single.surfaceDistance, null);
  assert.equal(single.coverage, 1);
  const vertical = analyzePath([point(0, 0, 3), point(0, 0, 13)], terrain);
  assert.equal(vertical.horizontalDistance, 0);
  assert.equal(vertical.spatialDistance, 10);
  assert.equal(vertical.elevationChange, 10);
  assert.equal(vertical.surfaceDistance, null);
});

test("analysis does not mutate frozen source data and rejects non-finite coordinates or spacing", () => {
  const freeze = value => {
    if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  const terrain = freeze(rectangle(0, 100, 0, 100));
  const points = freeze([point(1, 1), point(99, 99)]);
  const before = JSON.stringify({ terrain, points });
  analyzePath(points, terrain);
  assert.equal(JSON.stringify({ terrain, points }), before);
  for (const spacing of [0, -1, NaN, Infinity]) assert.throws(() => analyzePath(points, terrain, spacing), RangeError);
  assert.throws(() => analyzePath(Array(65).fill(points[0]), terrain), RangeError);
  for (const point of [{ longitude: NaN, latitude: 0, altitude: 0 },
    { longitude: 0, latitude: 91, altitude: 0 }, { longitude: 181, latitude: 0, altitude: 0 },
    { longitude: 0, latitude: 0, altitude: Infinity }])
    assert.throws(() => analyzePath([point], terrain), RangeError);
});
