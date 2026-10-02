import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cartesian3, Cartographic, Matrix4, Transforms, Math as CM } from "@cesium/engine";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/section-trace.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/sectionTrace.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile });
const { traceCityObject } = await import(pathToFileURL(outfile).href);
const origin = { longitude: -2.603, latitude: 51.454 };
const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(origin.longitude, origin.latitude));
const point = (x, y) => {
  const geo = Cartographic.fromCartesian(Matrix4.multiplyByPoint(frame, new Cartesian3(x, y, 0), new Cartesian3()));
  return { longitude: CM.toDegrees(geo.longitude), latitude: CM.toDegrees(geo.latitude), altitude: 0 };
};
const terrain = {
  version: "1.0", name: "native DTM", ...origin,
  vertical_datum: "ODN", reference_height: 100, demonstration: true, source: {},
  points: [[0, 0, 100], [200, 0, 100], [0, 200, 100], [200, 200, 100]],
  patches: [{ id: "native-plane", kind: "ruled-strip", left: [0, 1], right: [2, 3] }],
};
const building = { parameters: { kind: "georgian", floors: 2 },
  templates: { wall: { kind: "box", size: [10, 10, 10], color: "#987654" } },
  nodes: [{ id: "wall", category: "wall", template: "wall", position: [0, 0, 5] }] };
const duct = { name: "duct", kind: "round-plaza", components: [{ id: "body", category: "body", function: "box",
  parameters: { width: 4, depth: 4, height: 2 }, position: [0, 0, 0], color: "#999999" }] };
function city() {
  return { assets: { house: building }, instances: [{ id: "house-1", asset: "house", name: "House",
    ...point(60, 50), heading: 0 }], roads: [],
  environment: { version: "1.0", terrain, drape_buildings: true,
    feature_assets: { duct }, features: [{ id: "duct-1", asset: "duct", name: "Duct",
      ...point(80, 50), altitude: -4, heading: 0, scale: 1, layer: "underground" }] } };
}
const endpoints = trace => trace.segments.flatMap(segment => [segment.start, segment.end]);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < .1, `${actual} ≈ ${expected}`);

test("displayed building triangles form a section outline at source elevation", () => {
  const trace = traceCityObject(city(), [point(10, 50), point(150, 50)], "house-1");
  assert.equal(trace.unavailable, undefined);
  assert.ok(trace.segments.length >= 4);
  assert.equal(trace.truncated, false);
  const coordinates = endpoints(trace);
  close(Math.min(...coordinates.map(p => p[0])), 45);
  close(Math.max(...coordinates.map(p => p[0])), 55);
  close(Math.min(...coordinates.map(p => p[1])), 100);
  close(Math.max(...coordinates.map(p => p[1])), 110);
  assert.deepEqual(traceCityObject(city(), [point(10, 80), point(150, 80)], "house-1").segments, []);
});

test("route corners accumulate stations and underground box keeps its design depth", () => {
  const bent = traceCityObject(city(), [point(10, 20), point(80, 20), point(80, 100)], "duct-1");
  assert.ok(bent.segments.length >= 4);
  const coordinates = endpoints(bent);
  close(Math.min(...coordinates.map(p => p[0])), 98);
  close(Math.max(...coordinates.map(p => p[0])), 102);
  close(Math.min(...coordinates.map(p => p[1])), 95);
  close(Math.max(...coordinates.map(p => p[1])), 97);
});

test("missing source terrain never yields invented section elevations", () => {
  const c = city();
  c.environment.terrain = { ...terrain, patches: [] };
  const missing = traceCityObject(c, [point(10, 50), point(150, 50)], "house-1");
  assert.equal(missing.unavailable, "no-source-height");
  assert.deepEqual(missing.segments, []);
  c.environment.drape_buildings = false;
  assert.equal(traceCityObject(c, [point(10, 50), point(150, 50)], "house-1").unavailable,
    "no-source-height");
  c.environment.terrain = null;
  assert.equal(traceCityObject(c, [point(10, 50), point(150, 50)], "duct-1").unavailable, "no-terrain");
});

test("editing a shared function definition refreshes its section geometry", () => {
  const c = city(), route = [point(10, 50), point(150, 50)];
  const oldTop = Math.max(...endpoints(traceCityObject(c, route, "duct-1")).map(p => p[1]));
  c.environment.feature_assets = { duct: { ...duct, components: [
    { ...duct.components[0], parameters: { width: 4, depth: 4, height: 6 } }] } };
  const newTop = Math.max(...endpoints(traceCityObject(c, route, "duct-1")).map(p => p[1]));
  close(oldTop, 97); close(newTop, 99);
});

test("a function sphere is intersected through its displayed triangulation", () => {
  const c = city();
  c.environment.feature_assets.duct = { ...duct, components: [{ ...duct.components[0],
    function: "sphere", parameters: { radius: 2 } }] };
  const trace = traceCityObject(c, [point(10, 50), point(150, 50)], "duct-1");
  assert.ok(trace.segments.length > 0);
  assert.equal(trace.basis, "rendered-solid-triangles");
  const heights = endpoints(trace).map(p => p[1]);
  close(Math.min(...heights), 94);
  close(Math.max(...heights), 98);
});

test("city-scale routes keep geodetic source heights free of ENU curvature drift", () => {
  const c = city();
  c.environment.terrain = { ...terrain, points: [[0, 0, 100], [3000, 0, 100],
    [0, 3000, 100], [3000, 3000, 100]] };
  c.instances[0] = { ...c.instances[0], ...point(2000, 50) };
  const trace = traceCityObject(c, [point(1950, 50), point(2050, 50)], "house-1");
  assert.ok(trace.segments.length > 0);
  const heights = endpoints(trace).map(p => p[1]);
  close(Math.min(...heights), 100);
  close(Math.max(...heights), 110);
});
