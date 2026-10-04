import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Cartesian3, Cartographic, Matrix4, Transforms, Math as CM } from "@cesium/engine";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/spatial-analysis.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/spatialAnalysis.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile });
const { queryCityPoint, analyzeCitySection } = await import(pathToFileURL(outfile).href);
const origin = { longitude: -2.603, latitude: 51.454 };
const frame = Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(origin.longitude, origin.latitude));
const point = (x, y, altitude = 0) => {
  const geo = Cartographic.fromCartesian(Matrix4.multiplyByPoint(frame, new Cartesian3(x, y, 0), new Cartesian3()));
  return { longitude: CM.toDegrees(geo.longitude), latitude: CM.toDegrees(geo.latitude), altitude };
};
const terrain = {
  version: "1.0", name: "synthetic native DTM", ...origin,
  vertical_datum: "ODN", reference_height: 100, demonstration: true, source: {},
  points: [[0, 0, 100], [200, 0, 100], [0, 200, 100], [200, 200, 100]],
  patches: [{ id: "native-plane", kind: "ruled-strip", left: [0, 1], right: [2, 3] }],
};
const document = {
  parameters: { kind: "georgian", floor_height: 3, floors: 2, scale: 1 },
  templates: { wall: { kind: "box", size: [10, 10, 10], color: "#987654" } },
  nodes: [{ id: "wall", category: "wall", template: "wall", position: [0, 0, 5] }],
};
const box = { name: "design duct", kind: "round-plaza", components: [
  { id: "solid", category: "body", function: "box", parameters: { width: 4, depth: 4, height: 2 }, position: [0, 0, 0], color: "#999999" },
] };
function city() {
  return { format: "gugis-city", version: "1.0", coordinate_system: "ENU_METERS_WGS84", name: "test",
    metadata: {}, assets: { house: document },
    instances: [{ id: "house-1", asset: "house", name: "House", ...point(60, 50), heading: 0 },
      { id: "house-2", asset: "house", name: "Far house", ...point(175, 50), heading: 0 }],
    roads: [{ id: "road", name: "Test road", width: 5, coordinates: [point(0, 50), point(200, 50)].map(p => [p.longitude, p.latitude]) }],
    environment: { version: "1.0", terrain, drape_buildings: true,
      feature_assets: { duct: box }, features: [{ id: "duct-1", asset: "duct", name: "Duct", ...point(80, 50),
        altitude: -4, heading: 0, scale: 1, layer: "underground" }] } };
}
const profile = { horizontalDistance: 140, samples: [] };

test("joint query traces native terrain, building envelope, road and underground burial", () => {
  const result = queryCityPoint(city(), point(80, 50), 30, { id: "duct-1", layer: "underground" });
  assert.equal(result.terrain.patch, "native-plane");
  assert.equal(result.terrain.height, 100);
  assert.equal(result.nearestRoad.id, "road");
  assert.ok(result.nearestRoad.distance < .01);
  assert.ok(result.buildings.some(o => o.id === "house-1" && o.top === 110 && o.bottom === 100));
  const duct = result.features.find(o => o.id === "duct-1");
  assert.equal(duct.top, 97);
  assert.equal(duct.bottom, 95);
  assert.equal(duct.burialDepth, 3);
  assert.equal(duct.basis, "model-envelope");
  assert.equal(result.inspected.id, "duct-1");
});

test("positive origin-reference cover can coexist with an exposed model edge on a slope", () => {
  const c = city();
  c.environment.terrain = { ...terrain,
    points: [[0, 0, 260], [200, 0, -140], [0, 200, 260], [200, 200, -140]] };
  const reference = queryCityPoint(c, point(80, 50), 30);
  const duct = reference.features.find(o => o.id === "duct-1");
  assert.ok(Math.abs(reference.terrain.height - 100) < .001);
  assert.ok(Math.abs(duct.top - 97) < .001);
  assert.ok(Math.abs(duct.burialDepth - 3) < .001);
  const edge = queryCityPoint(c, point(82, 50), 30);
  assert.ok(Math.abs(edge.terrain.height - 96) < .001);
  assert.ok(duct.top > edge.terrain.height, "3 m at the origin does not imply the entire 4 m wide model is buried");
});

test("dense point queries retain the inspected building within the twelve-result budget", () => {
  for (const clickedX of [80, 150]) {
    const c = city();
    c.instances = Array.from({ length: 12 }, (_, i) => ({ ...c.instances[0],
      id: `near-${i}`, ...point(i + 1, 50) }));
    c.instances.push({ ...c.instances[0], id: "clicked", ...point(clickedX, 50) });
    const inspected = { layer: "building", id: "clicked", component: "wall" };
    const result = queryCityPoint(c, point(0, 50), 100, inspected);
    assert.equal(result.buildings.length, 12);
    assert.equal(new Set(result.buildings.map(o => o.id)).size, 12);
    assert.ok(result.buildings.some(o => o.id === "clicked" && o.components === 1));
    assert.ok(!result.buildings.some(o => o.id === "near-11"));
    assert.deepEqual(result.inspected, inspected);
    assert.deepEqual(result.buildings.map(o => o.distance), result.buildings.map(o => o.distance).sort((a, b) => a - b));
    const ordinary = queryCityPoint(c, point(0, 50), 100);
    assert.deepEqual(ordinary.buildings.map(o => o.id), c.instances.slice(0, 12).map(o => o.id));
  }
});

test("dense mixed-layer feature queries retain the clicked component inside and outside the radius", () => {
  for (const clickedX of [80, 150]) {
    const c = city(), prototype = c.environment.features[0];
    c.environment.features = Array.from({ length: 12 }, (_, i) => ({ ...prototype,
      id: `near-${i}`, layer: "surface", ...point(i + 1, 50) }));
    c.environment.features.push({ ...prototype, id: "clicked", ...point(clickedX, 50) });
    const inspected = { layer: "underground", id: "clicked", component: "solid" };
    const result = queryCityPoint(c, point(0, 50), 100, inspected);
    assert.equal(result.features.length, 12);
    assert.equal(new Set(result.features.map(o => o.id)).size, 12);
    assert.ok(result.features.some(o => o.id === "clicked" && o.layer === "underground" && o.components === 1));
    assert.ok(!result.features.some(o => o.id === "near-11"));
    assert.deepEqual(result.inspected, inspected);
    assert.deepEqual(result.features.map(o => o.distance), result.features.map(o => o.distance).sort((a, b) => a - b));
  }
});

test("section corridor keeps native ground separate from model envelope and respects width and route ends", () => {
  const c = city(), route = [point(10, 50), point(150, 50)];
  const section = analyzeCitySection(c, route, profile, 10);
  assert.equal(section.length, 140);
  assert.equal(section.verticalDatum, "ODN");
  assert.equal(section.buildings, 1);
  assert.equal(section.underground, 1);
  assert.deepEqual(section.objects.map(o => o.id), ["house-1", "duct-1"]);
  assert.ok(Math.abs(section.objects[0].station - 50) < .01);
  assert.ok(Math.abs(section.objects[1].station - 70) < .01);
  assert.ok(section.objects.every(o => o.offset < .01));
  const offsetRoute = [point(10, 80), point(150, 80)];
  assert.equal(analyzeCitySection(c, offsetRoute, profile, 10).objects.length, 0);
  assert.equal(analyzeCitySection(c, offsetRoute, profile, 60).objects.length, 2);
});

test("empty overviews use real component bounds when filtering a section corridor", () => {
  const c = city();
  c.instances = c.instances.slice(0, 1);
  c.environment.features = [];
  c.assets.house = { ...document, templates: { wall: { ...document.templates.wall, size: [80, 80, 10] } } };
  const route = [point(10, 75), point(150, 75)];
  const expected = analyzeCitySection(c, route, profile, 10);
  assert.equal(expected.buildings, 1, "the route crosses the model envelope away from its origin");
  const imported = { ...c, assets: { house: { ...c.assets.house, overview: {} } } };
  const source = JSON.stringify(imported);
  assert.deepEqual(analyzeCitySection(imported, route, profile, 10), expected);
  assert.equal(JSON.stringify(imported), source, "the fallback must not rewrite imported data");
});

test("an undersized display overview cannot exclude real components from a section corridor", () => {
  const c = city();
  c.instances = c.instances.slice(0, 1);
  c.environment.features = [];
  c.assets.house = { ...document, version: "1.2", templates: { wall: { ...document.templates.wall, size: [80, 80, 10] } } };
  const route = [point(10, 75), point(150, 75)];
  const expected = analyzeCitySection(c, route, profile, 10);
  assert.equal(expected.buildings, 1);
  const overview = { small: { kind: "box", size: [1, 1, 1], color: "#987654" } };
  const imported = { ...c, assets: { house: { ...c.assets.house, overview } } };
  const source = JSON.stringify(imported);
  assert.deepEqual(analyzeCitySection(imported, route, profile, 10), expected);
  assert.deepEqual(analyzeCitySection(imported, route, profile, 10), expected, "cached envelopes preserve the result");
  assert.equal(JSON.stringify(imported), source, "analysis never expands or replaces display geometry");
});

test("repeated component templates compute shape bounds once and retain all instance extents", () => {
  const c = city();
  let shapeReads = 0;
  c.assets.house = { ...document,
    templates: { wall: { kind: "box", color: "#987654", get size() { shapeReads++; return [10, 10, 10]; } } },
    nodes: [
      { ...document.nodes[0], id: "west", position: [-20, 0, 5] },
      { ...document.nodes[0], id: "east", position: [20, 0, 15] },
    ],
  };
  const result = queryCityPoint(c, point(80, 50), 200);
  assert.equal(result.buildings.length, 2);
  for (const building of result.buildings) {
    assert.equal(building.components, 2);
    assert.equal(building.bottom, 100);
    assert.equal(building.top, 120);
    assert.equal(building.radius, 20 + Math.hypot(10, 10) / 2);
  }
  assert.equal(shapeReads, 1, "template shape bounds and model envelopes are reused");
  analyzeCitySection(c, [point(10, 50), point(150, 50)], profile, 30);
  assert.equal(shapeReads, 1, "section analysis reuses the validated component envelope");
  const replacement = { ...c, assets: { house: { ...c.assets.house,
    templates: { wall: { kind: "box", color: "#987654", size: [100, 100, 10] } },
  } } };
  const updated = queryCityPoint(replacement, point(80, 50), 200).buildings[0];
  assert.equal(updated.radius, 20 + Math.hypot(100, 100) / 2, "a replaced document recomputes the same template key");
  assert.equal(updated.components, 2);
  assert.equal(queryCityPoint(c, point(80, 50), 200).buildings[0].radius, result.buildings[0].radius);
});

test("terrain NoData makes source elevations and burial unknown, without inventing a height", () => {
  const c = city(); c.environment.terrain = { ...terrain, patches: [] };
  const result = queryCityPoint(c, point(80, 50));
  assert.equal(result.terrain, null);
  assert.equal(result.features[0].top, null);
  assert.equal(result.features[0].burialDepth, null);
  assert.equal(result.buildings[0].top, null);
  const section = analyzeCitySection(c, [point(10, 50), point(150, 50)], profile, 10);
  assert.ok(section.objects.every(o => o.top === null));
});

test("changing a shared function definition updates every instance query without changing its placement", () => {
  const c = city();
  const before = queryCityPoint(c, point(80, 50)).features[0];
  const next = { ...c, environment: { ...c.environment,
    feature_assets: { duct: { ...box, components: [{ ...box.components[0], parameters: { width: 4, depth: 4, height: 6 } }] } } } };
  const after = queryCityPoint(next, point(80, 50)).features[0];
  assert.equal(before.burialDepth, 3);
  assert.equal(after.burialDepth, 1);
  assert.equal(next.environment.features[0].longitude, c.environment.features[0].longitude);
});

test("an arch uses the displayed rotated sweep for its source elevation envelope", () => {
  const c = city();
  c.environment.feature_assets.arch = { name: "arch", kind: "arched-door", components: [{
    id: "curve", category: "arch", function: "arch-prism",
    parameters: { outer_radius: 5, inner_radius: 3, depth: 1 },
    position: [0, 0, 2], color: "#999999",
  }] };
  c.environment.features.push({ id: "arch-1", asset: "arch", name: "Arch",
    ...point(100, 50), altitude: 0, heading: 0, scale: 1, layer: "surface" });
  const arch = queryCityPoint(c, point(100, 50), 10).features.find(o => o.id === "arch-1");
  assert.equal(arch.bottom, 102);
  assert.equal(arch.top, 107);
});

test("underground corridor reports conservative vertical envelope gaps and overlap", () => {
  const c = city();
  c.environment.features.push({ id: "near-duct", asset: "duct", name: "Near duct",
    ...point(62, 50), altitude: -4, heading: 0, scale: 1, layer: "underground" });
  const route = [point(10, 50), point(150, 50)];
  const first = analyzeCitySection(c, route, profile, 10).clearances.find(item =>
    item.undergroundId === "near-duct" && item.otherId === "house-1");
  assert.ok(first);
  assert.equal(first.verticalGap, 3);
  assert.equal(first.verticalOverlap, 0);
  assert.ok(first.horizontalDistance < 3);
  c.environment.features[c.environment.features.length - 1] =
    { ...c.environment.features.at(-1), altitude: 0 };
  const second = analyzeCitySection(c, route, profile, 10).clearances.find(item =>
    item.undergroundId === "near-duct" && item.otherId === "house-1");
  assert.equal(second.verticalGap, 0);
  assert.equal(second.verticalOverlap, 1);
});

test("invalid corridor settings and query radius fail explicitly", () => {
  assert.throws(() => analyzeCitySection(city(), [point(0, 0), point(1, 1)], profile, 201), RangeError);
  assert.throws(() => analyzeCitySection(city(), [point(0, 0)], profile, 20), RangeError);
  assert.throws(() => queryCityPoint(city(), point(80, 50), -1), RangeError);
});
