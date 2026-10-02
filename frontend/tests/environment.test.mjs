import test from "node:test";
import assert from "node:assert/strict";
import { functionSolid, featurePresets } from "../src/studio/environment.ts";
import {
  terrainIndex,
  ruledPoint,
  terrainMesh,
  terrainStatistics,
} from "../src/studio/terrainMath.ts";
import { encodeCity, decodeCity } from "../src/studio/cityArchive.ts";
const terrain = {
  version: "1.0",
  name: "Saddle",
  longitude: 0,
  latitude: 0,
  vertical_datum: "local",
  reference_height: 0,
  demonstration: true,
  source: {},
  points: [
    [0, 0, 0],
    [0, 10, 0],
    [10, 0, 0],
    [10, 10, 10],
  ],
  patches: [{ id: "saddle", kind: "ruled-strip", left: [0, 2], right: [1, 3] }],
};
test("ruled surface query preserves bilinear height and analytic gradient, not a flat triangle approximation", () => {
  const index = terrainIndex(terrain),
    hit = index.query(5, 5);
  assert.equal(hit.height, 2.5);
  assert.ok(
    Math.abs(hit.slope - (Math.atan(Math.SQRT1_2) * 180) / Math.PI) < 1e-10,
  );
  assert.equal(hit.aspect, 225);
  assert.equal(index.query(-1, 5), null);
  assert.equal(index.query(0, 0).aspect, null);
  const mesh = terrainMesh(terrain, "ruled-strip");
  assert.ok(
    mesh.vertices.some((p) => p[0] === 5 && p[1] === 5 && p[2] === 2.5),
  );
});
test("native terrain ray queries preserve the ruled surface and choose the nearest intersection", () => {
  const index = terrainIndex(terrain);
  const vertical = index.raycast([5, 5, 20], [0, 0, -1]);
  assert.ok(Math.abs(vertical.height - 2.5) < 1e-10);
  const double = index.raycast([0, 10, 2], [1, -1, 0]);
  assert.ok(Math.abs(double.x - (10 - Math.sqrt(20)) / 2) < 1e-7);
  const oblique = index.raycast([-5, -5, 0], [1, 1, 0.4]);
  assert.ok(Math.abs(oblique.x - (4 + Math.sqrt(96)) / 2) < 1e-7);
  assert.equal(index.raycast([5, 5, 20], [0, 0, 1]), null);
  assert.equal(index.raycast([50, 50, 20], [0, 0, -1]), null);
  assert.equal(index.raycast([5, 5, 20], [1, 0, 0]), null);
});
test("native triangle strip/fan ray queries retain holes and absolute elevations", () => {
  for (const patch of [
    { id: "strip", kind: "triangle-strip", indices: [1, 0, 3, 2] },
    { id: "fan", kind: "triangle-fan", hub: 4, ring: [0, 2, 3, 1] },
  ]) {
    const t = { ...terrain, reference_height: 100,
      points: [...terrain.points, [5, 5, 3]].map(p => [p[0], p[1], p[2] + 100]), patches: [patch] };
    const index = terrainIndex(t), hit = index.raycast([4, 4, 200], [0, 0, -1]);
    assert.ok(Math.abs(hit.height - index.query(4, 4).height) < 1e-7);
    assert.equal(hit.kind, patch.kind);
  }
  assert.equal(terrainIndex({ ...terrain, patches: [] }).raycast([5, 5, 20], [0, 0, -1]), null);
});
test("surface inverse handles skewed boundaries and both triangle strip and fan queries", () => {
  const skew = {
    ...terrain,
    points: [
      [0, 0, 0],
      [3, 10, 3],
      [10, 1, 1],
      [14, 12, 8],
    ],
  };
  const point = ruledPoint(...skew.points, 0.3, 0.7);
  assert.ok(
    Math.abs(terrainIndex(skew).query(point[0], point[1]).height - point[2]) <
      1e-7,
  );
  for (const patch of [
    { id: "strip", kind: "triangle-strip", indices: [1, 0, 3, 2] },
    { id: "fan", kind: "triangle-fan", hub: 4, ring: [0, 2, 3, 1] },
  ]) {
    const t = {
      ...terrain,
      points: [...terrain.points, [5, 5, 3]],
      patches: [patch],
    };
    const hit = terrainIndex(t).query(4, 4);
    assert.ok(hit);
    assert.equal(hit.kind, patch.kind);
    assert.equal(terrainIndex(t).query(40, 40), null);
  }
});
test("display mesh shares topology vertices without closing disconnected gaps", () => {
  const adjacent = {...terrain, points: [...terrain.points, [20,0,0],[20,10,0]], patches:[
    {id:"two",kind:"ruled-strip",left:[0,2,4],right:[1,3,5]},
  ]};
  const mesh = terrainMesh(adjacent, "ruled-strip");
  assert.equal(mesh.vertices.length, 15); // 18 before, 3 common boundary vertices.
  assert.equal(mesh.triangles.length, 16);
  assert.equal(terrainIndex(adjacent).query(10,5).height, 5);
  assert.equal(terrainIndex(adjacent).query(NaN,5), null);
  const disconnected = {...terrain, points:[...terrain.points,...terrain.points], patches:[
    ...terrain.patches, {id:"separate",kind:"ruled-strip",left:[4,6],right:[5,7]}
  ]};
  assert.equal(terrainMesh(disconnected,"ruled-strip").vertices.length,18);
  assert.equal(terrainStatistics(adjacent).triangles,4);
  assert.equal(terrainStatistics({...terrain,patches:[]}).indexSaving,0);
});
test("all function presets produce closed outward solids without degenerate triangles", () => {
  for (const asset of Object.values(featurePresets))
    for (const part of asset.components) {
      const solid = functionSolid(part, 24);
      if (solid.kind === "box") continue;
      const edges = new Map();
      let volume = 0;
      for (const [i, j, k] of solid.triangles) {
        const [a, b, c] = [i, j, k].map((n) => solid.vertices[n]);
        const ab = b.map((x, n) => x - a[n]),
          ac = c.map((x, n) => x - a[n]);
        const cross = [
          ab[1] * ac[2] - ab[2] * ac[1],
          ab[2] * ac[0] - ab[0] * ac[2],
          ab[0] * ac[1] - ab[1] * ac[0],
        ];
        assert.ok(Math.hypot(...cross) > 1e-9, `${part.id} degenerate`);
        volume += a.reduce((s, x, n) => s + x * cross[n], 0) / 6;
        for (const [s, t] of [
          [i, j],
          [j, k],
          [k, i],
        ]) {
          const key = [s, t].sort((a, b) => a - b).join(",");
          const list = edges.get(key) ?? [];
          list.push([s, t]);
          edges.set(key, list);
        }
      }
      assert.ok(volume > 0, `${part.id} inward`);
      for (const pair of edges.values()) {
        assert.equal(pair.length, 2, part.id);
        assert.deepEqual(pair[0], pair[1].toReversed());
      }
    }
});
test("City 1.2 archive preserves functional parameters and native terrain topology verbatim", () => {
  const city = {
    format: "gugis-city",
    version: "1.0",
    coordinate_system: "ENU_METERS_WGS84",
    name: "Test",
    assets: {},
    instances: [],
    roads: [],
    metadata: {},
    environment: {
      version: "1.0",
      terrain,
      feature_assets: featurePresets,
      features: [],
      drape_buildings: true,
    },
  };
  const archive = encodeCity(city);
  assert.equal(archive.version, "1.2");
  assert.deepEqual(decodeCity(archive), city);
  assert.equal(
    archive.environment.feature_assets.lamp.components[3].function,
    "sphere",
  );
  assert.equal(archive.environment.terrain.patches[0].kind, "ruled-strip");
  assert.equal("triangles" in archive.environment.terrain, false);
});
