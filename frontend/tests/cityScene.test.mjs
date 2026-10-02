import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { Cartographic, JulianDate, ScreenSpaceEventType } from "cesium";
import { componentBundle } from "./helpers/componentBundle.mjs";
import { viewState } from "./helpers/cesiumMock.mjs";
import { emptyEnvironment, featurePresets } from "../src/studio/environment.ts";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
const analysisBundle = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/scene-analysis.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/terrainAnalysis.ts", import.meta.url))], bundle: true,
  platform: "node", format: "esm", packages: "external", outfile: analysisBundle });
const { analyzePath } = await import(pathToFileURL(analysisBundle).href);
const mockPath = new URL("./helpers/cesiumMock.mjs", import.meta.url).href;
const Scene = await componentBundle("CityScene", [
  {
    name: "viewer-lifecycle-double",
    setup(build) {
      build.onResolve({ filter: /^cesium$/ }, () => ({
        path: mockPath,
        external: true,
      }));
    },
  },
]);
const lamp = (id) => ({
  id,
  asset: "lamp",
  name: id,
  longitude: -2.603,
  latitude: 51.454,
  altitude: 0,
  scale: 1,
  heading: 0,
  layer: "surface",
});
const terrain = {
  version: "1.0",
  name: "plane",
  longitude: -2.603,
  latitude: 51.454,
  reference_height: 0,
  vertical_datum: "local",
  source: {},
  demonstration: true,
  points: [
    [-100, -100, 20],
    [100, -100, 20],
    [-100, 100, 20],
    [100, 100, 20],
  ],
  patches: [{ id: "plane", kind: "ruled-strip", left: [0, 1], right: [2, 3] }],
};
const city = {
  format: "gugis-city",
  version: "1.0",
  name: "test",
  coordinate_system: "ENU_METERS_WGS84",
  assets: {
    simple: {
      parameters: { kind: "georgian", scale: 1 },
      templates: { wall: { kind: "box", size: [5, 5, 5], color: "#abcdef" } },
      nodes: [
        {
          id: "wall",
          template: "wall",
          position: [0, 0, 2.5],
          category: "wall",
        },
      ],
    },
  },
  instances: [
    {
      id: "building",
      asset: "simple",
      name: "test",
      longitude: -2.603,
      latitude: 51.454,
      altitude: 0,
      heading: 0,
    },
  ],
  roads: [],
  metadata: {},
  environment: {
    ...emptyEnvironment(),
    terrain,
    feature_assets: { lamp: featurePresets.lamp },
    features: [lamp("one"), lamp("two")],
  },
};
function fixture(overrides = {}) {
  let renderer,
    props = {
      city,
      selected: null,
      onSelect() {},
      context: true,
      ...overrides,
    };
  act(() => {
    renderer = create(React.createElement(Scene, props), {
      createNodeMock: () => ({}),
    });
  });
  const viewer = viewState.viewers.at(-1);
  act(() => viewer.scene.postRender.raiseEvent());
  return {
    viewer,
    renderer,
    update(next) {
      props = { ...props, ...next };
      act(() => renderer.update(React.createElement(Scene, props)));
      act(() => viewer.scene.postRender.raiseEvent());
    },
    close() {
      act(() => renderer.unmount());
    },
  };
}
test("feature selection creates no geometry and never moves the camera", () => {
  const f = fixture();
  const count = viewState.primitives.length,
    flights = f.viewer.camera.flights.length;
  f.update({ selectedFeature: "one" });
  f.update({ selectedFeature: "two" });
  assert.equal(viewState.primitives.length, count);
  assert.equal(f.viewer.camera.flights.length, flights);
  assert.ok(
    f.viewer.entities.values.some((e) => e.label?.text?.getValue() === "two"),
  );
  f.close();
});
test("saving a feature retains building batches, terrain and wire entities; building edits retain feature markers", () => {
  const f = fixture({ selectedFeature: "one", terrainWire: true });
  const initialBatches = [...f.viewer.scene.primitives.values];
  const wires = f.viewer.entities.values.filter((e) => e.polyline);
  const nextCity = {
    ...city,
    environment: {
      ...city.environment,
      features: city.environment.features.map((f) => ({ ...f, heading: 15 })),
    },
  };
  f.update({ city: nextCity });
  for (const batch of initialBatches.slice(0, 3))
    assert.ok(f.viewer.scene.primitives.values.includes(batch));
  for (const wire of wires) assert.ok(f.viewer.entities.contains(wire));
  const marker = f.viewer.entities.values.find(
    (e) => e.label?.text?.getValue() === "one",
  );
  f.update({
    city: {
      ...nextCity,
      instances: nextCity.instances.map((i) => ({ ...i, heading: 20 })),
    },
  });
  assert.ok(f.viewer.entities.contains(marker));
  for (const wire of wires) assert.ok(f.viewer.entities.contains(wire));
  assert.equal(f.viewer.camera.flights.length, 1);
  f.close();
});
test("feature placement stays on terrain when building draping is disabled, including after placement ends", () => {
  const f = fixture({
    city: {
      ...city,
      environment: { ...city.environment, drape_buildings: false },
    },
    placement: { longitude: -2.603, latitude: 51.454, altitude: 2 },
    placementKind: "feature",
    placing: true,
  });
  f.update({ placing: false });
  const marker = f.viewer.entities.getById("placement-preview");
  assert.ok(marker);
  const point = marker.position.getValue(JulianDate.now());
  assert.ok(Math.abs(Cartographic.fromCartesian(point).height - 22.5) < 1e-5);
  f.close();
});
test("clicking terrain is never treated as a building ID and opacity preserves native geometry", () => {
  let picked = "unchanged";
  const f = fixture({
    onSelect: (id) => {
      picked = id;
    },
  });
  const count = viewState.primitives.length;
  f.viewer.picked = { id: "terrain/ruled-strip" };
  act(() =>
    viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK)({
      position: {},
    }),
  );
  assert.equal(picked, null);
  f.update({ terrainOpacity: 0.5 });
  assert.equal(viewState.primitives.length, count);
  assert.equal(f.viewer.entities.getById("city-ground-plane").show, false);
  f.update({ terrainOpacity: 1 });
  assert.equal(f.viewer.entities.getById("city-ground-plane").show, true);
  f.close();
});

test("surface and underground isolation changes visibility without rewriting geometry, data or camera", () => {
  const sceneCity = {
    ...city,
    environment: {
      ...city.environment,
      features: [lamp("one"), { ...lamp("two"), layer: "underground", altitude: -10 }],
    },
  };
  const source = JSON.stringify(sceneCity);
  const f = fixture({ city: sceneCity, selectedFeature: "one" });
  const batch = f.viewer.scene.primitives.values.find((p) => p.getGeometryInstanceAttributes("feature:one/base"));
  const geometryCount = viewState.primitives.length;
  const flights = f.viewer.camera.flights.length;
  const visible = (id) => batch.getGeometryInstanceAttributes(`feature:${id}/base`).show[0];
  f.update({ isolateFeature: true });
  assert.equal(visible("one"), 1);
  assert.equal(visible("two"), 0);
  f.update({ selectedFeature: "two", terrainOpacity: 0 });
  assert.equal(visible("one"), 0);
  assert.equal(visible("two"), 1);
  assert.equal(f.viewer.entities.getById("city-ground-plane").show, false);
  f.update({ isolateFeature: false, featureLayer: "surface" });
  assert.equal(visible("one"), 1);
  assert.equal(visible("two"), 0);
  f.update({ featureLayer: "underground" });
  assert.equal(visible("one"), 0);
  assert.equal(visible("two"), 1);
  f.update({ featureLayer: "all" });
  assert.equal(visible("one"), 1);
  assert.equal(visible("two"), 1);
  assert.equal(viewState.primitives.length, geometryCount);
  assert.equal(f.viewer.camera.flights.length, flights);
  assert.equal(JSON.stringify(sceneCity), source);
  f.close();
});

test("hiding feature markers removes labels and anchors but placement still offers a preview", () => {
  const f = fixture({ selectedFeature: "one", placementKind: "feature", placement: { longitude: -2.603, latitude: 51.454, altitude: 0 } });
  f.update({ showFeatureMarkers: false });
  assert.equal(f.viewer.entities.getById("placement-preview"), undefined);
  assert.ok(!f.viewer.entities.values.some((e) => e.label?.text?.getValue() === "one"));
  f.update({ placing: true });
  assert.ok(f.viewer.entities.getById("placement-preview"));
  f.close();
});

const detailedCity = {
  ...city,
  assets: {
    simple: {
      ...city.assets.simple,
      parameters: { kind: "urban", scale: 1 },
      overview: { body: { kind: "box", size: [5, 5, 5], color: "#abcdef" } },
      templates: {
        ...city.assets.simple.templates,
        window: { kind: "box", size: [1, 0.1, 1], color: "#123456" },
      },
      nodes: [
        ...city.assets.simple.nodes,
        { id: "window", template: "window", position: [0, -2.55, 3], category: "window" },
      ],
    },
  },
  instances: Array.from({ length: 7 }, (_, i) => ({
    ...city.instances[0], id: `building-${i}`, longitude: -2.603 + i * 0.0001,
  })),
};
const fineBatch = (viewer, id) => viewer.scene.primitives.values.find(
  p => p.getGeometryInstanceAttributes(`${id}/window`),
);
async function settleDetails(viewer) {
  for (let i = 0; i < 100; i++) {
    if (detailedCity.instances.every(item => fineBatch(viewer, item.id))) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.fail("all unselected buildings should receive fine geometry");
}

test("visible nearby buildings load detail without selection; styling preserves geometry, camera and archive", async t => {
  const source = JSON.stringify(detailedCity);
  const f = fixture({ city: detailedCity });
  t.after(() => f.close());
  const flights = f.viewer.camera.flights.length;
  await settleDetails(f.viewer);
  const overview = f.viewer.scene.primitives.values.find(p => p.getGeometryInstanceAttributes("building-0/overview_body"));
  for (const item of detailedCity.instances) {
    assert.ok(fineBatch(f.viewer, item.id));
    assert.equal(overview.getGeometryInstanceAttributes(`${item.id}/overview_body`).show[0], 0);
  }
  const count = viewState.primitives.length;
  const batch = fineBatch(f.viewer, "building-0");
  const natural = [...batch.getGeometryInstanceAttributes("building-0/window").color];
  f.update({ selected: "building-4", colorMode: "category" });
  assert.notDeepEqual([...batch.getGeometryInstanceAttributes("building-0/window").color], natural);
  f.update({ selected: null, colorMode: "material" });
  assert.deepEqual([...batch.getGeometryInstanceAttributes("building-0/window").color], natural);
  assert.equal(viewState.primitives.length, count);
  assert.equal(f.viewer.camera.flights.length, flights);
  assert.equal(JSON.stringify(detailedCity), source);
});

test("zooming away and hiding context release GPU primitives, and returning reloads details without selection", async t => {
  const f = fixture({ city: detailedCity });
  t.after(() => f.close());
  await settleDetails(f.viewer);
  f.viewer.camera.pixelSize = 1000;
  act(() => f.viewer.camera.changed.raiseEvent());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  assert.ok(detailedCity.instances.every(item => !fineBatch(f.viewer, item.id)));
  const overview = f.viewer.scene.primitives.values.find(p => p.getGeometryInstanceAttributes("building-0/overview_body"));
  assert.equal(overview.getGeometryInstanceAttributes("building-0/overview_body").show[0], 1);
  f.viewer.camera.pixelSize = 0.1;
  act(() => f.viewer.camera.moveEnd.raiseEvent());
  await settleDetails(f.viewer);
  f.update({ context: false });
  assert.ok(detailedCity.instances.every(item => !fineBatch(f.viewer, item.id)));
  f.update({ context: true });
  await settleDetails(f.viewer);
  f.viewer.camera.visible = false;
  act(() => f.viewer.camera.moveEnd.raiseEvent());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
  assert.ok(detailedCity.instances.every(item => !fineBatch(f.viewer, item.id)));
});

test("terrain querying at any opacity uses native rays without the failing translucent depth pass", () => {
  let hit;
  const f = fixture({ queryTerrain: true, onTerrainQuery: value => { hit = value; } });
  assert.equal(f.viewer.scene.pickTranslucentDepth, false);
  assert.equal(f.viewer.options.scene3DOnly, true);
  const click = viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK);
  f.viewer.scene.pickPosition = () => { throw Error("GPU depth must not be queried"); };
  for (const opacity of [1, 0.5, 0]) {
    f.update({ terrainOpacity: opacity });
    act(() => click({ position: {} }));
    assert.ok(Math.abs(hit.height - 20) < 1e-6);
    assert.equal(hit.kind, "ruled-strip");
  }
  f.close();
});

test("light overview removes fine geometry, restores silhouettes and can return to full detail", async t => {
  const f = fixture({ city: detailedCity });
  t.after(() => f.close());
  await settleDetails(f.viewer);
  const flights = f.viewer.camera.flights.length;
  const overview = f.viewer.scene.primitives.values.find(p => p.getGeometryInstanceAttributes("building-0/overview_body"));
  f.update({ fullDetails: false });
  for (const item of detailedCity.instances) {
    assert.equal(fineBatch(f.viewer, item.id), undefined);
    assert.equal(overview.getGeometryInstanceAttributes(`${item.id}/overview_body`).show[0], 1);
  }
  f.update({ fullDetails: true });
  await settleDetails(f.viewer);
  assert.equal(f.viewer.camera.flights.length, flights);
});

test("leaving or disabling the scene cancels pending detail work", async () => {
  const f = fixture({ city: detailedCity });
  f.update({ fullDetails: false });
  const count = viewState.primitives.length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  assert.equal(viewState.primitives.length, count);
  f.update({ fullDetails: true });
  f.close();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(viewState.primitives.length, count);
});

test("a rendering failure stops pending GPU uploads and offers an explicit recovery action", async t => {
  let retries = 0;
  const f = fixture({ city: detailedCity, onRetry: () => { retries++; } });
  t.after(() => f.close());
  act(() => f.viewer.scene.renderError.raiseEvent({}, new TypeError("Cannot read properties of undefined (reading '_target')")));
  const count = viewState.primitives.length;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  assert.equal(viewState.primitives.length, count);
  assert.ok(JSON.stringify(f.renderer.toJSON()).includes("_target"));
  const retry = f.renderer.root.findAllByType("button").find(b => b.children.includes("恢复三维视图"));
  act(() => retry.props.onClick());
  assert.equal(retries, 1);
});

test("analysis selects native ground without selecting buildings or moving the camera; previews clean up independently", () => {
  const points = [], selections = [];
  const f = fixture({ analysisDrawing: true, selectedFeature: "one", onAnalysisPoint: p => points.push(p), onSelect: id => selections.push(id) });
  const count = viewState.primitives.length, flights = f.viewer.camera.flights.length;
  const click = viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK);
  f.viewer.picked = { id: "building/wall" };
  act(() => click({ position: { x: 200, y: 200 } }));
  assert.equal(points.length, 1);
  assert.equal(selections.length, 0);
  assert.ok(Math.abs(points[0].altitude - 20) < 1e-4);
  const route = [points[0], { ...points[0], longitude: points[0].longitude + .0001 }];
  const result = analyzePath(route, terrain);
  f.update({ analysisPoints: route, analysisProfile: result, analysisHover: route[1] });
  assert.ok(f.viewer.entities.values.some(e => e.id === "analysis:hover"));
  assert.ok(f.viewer.entities.values.some(e => e.id === "analysis:surface:0"));
  assert.equal(viewState.primitives.length, count);
  assert.equal(f.viewer.camera.flights.length, flights);
  f.update({ analysisPoints: [], analysisProfile: null, analysisHover: null, analysisDrawing: false });
  assert.ok(!f.viewer.entities.values.some(e => e.id.startsWith("analysis:")));
  assert.ok(f.viewer.entities.values.some(e => e.label?.text?.getValue() === "one"));
  act(() => click({ position: { x: 200, y: 200 } }));
  assert.deepEqual(selections, ["building"]);
  let placement;
  f.update({ placing: true, onPlace: p => { placement = p; } });
  act(() => click({ position: { x: 200, y: 200 } }));
  assert.deepEqual(Object.keys(placement).sort(), ["latitude", "longitude"], "analysis elevations must not overwrite authored placement altitude");
  f.close();
});

test("analysis overlay breaks at native NoData gaps without clearing terrain or feature layers", () => {
  const points = [{ longitude: -2.603, latitude: 51.454, altitude: 20 }, { longitude: -2.602, latitude: 51.454, altitude: 20 }];
  const result = analyzePath(points, terrain, 5);
  result.samples[4].gapBefore = true;
  const f = fixture({ analysisPoints: points, analysisProfile: result });
  assert.equal(f.viewer.entities.values.filter(e => e.id.startsWith("analysis:surface:")).length, 2);
  f.close();
});

test("unified point query keeps picked semantics, uses native ground and adds no GPU batch", () => {
  const queries = [], selected = [], drawings = [];
  const f = fixture({ spatialPicking: true, analysisDrawing: true,
    onSpatialPoint: (position, id) => queries.push({ position, id }),
    onAnalysisPoint: point => drawings.push(point), onSelect: id => selected.push(id) });
  const count = viewState.primitives.length, flights = f.viewer.camera.flights.length;
  const click = viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK);
  f.viewer.picked = { id: "feature:one/solid" };
  act(() => click({ position: { x: 200, y: 200 } }));
  assert.equal(queries.length, 1);
  assert.equal(queries[0].id, "feature:one/solid");
  assert.ok(Math.abs(queries[0].position.altitude - 20) < 1e-4);
  assert.deepEqual(drawings, []);
  assert.deepEqual(selected, []);
  f.update({ spatialPoint: queries[0].position, spatialPicking: false, analysisDrawing: false });
  assert.ok(f.viewer.entities.values.some(entity => entity.id === "spatial:query-point"));
  assert.equal(viewState.primitives.length, count);
  assert.equal(f.viewer.camera.flights.length, flights);
  act(() => click({ position: { x: 200, y: 200 } }));
  assert.equal(queries.length, 1, "stale query mode must not capture later normal scene clicks");
  f.update({ spatialPoint: null });
  assert.ok(!f.viewer.entities.values.some(entity => entity.id === "spatial:query-point"));
  f.close();
});
