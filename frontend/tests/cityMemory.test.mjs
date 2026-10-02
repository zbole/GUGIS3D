import test from "node:test";
import assert from "node:assert/strict";
import {
  meshFor,
  boundaryEdges,
  expandCity,
  numericPayload,
} from "../scripts/city-memory.mjs";

const box = { kind: "box", size: [2, 4, 6], color: "#123456" };
const city = {
  format: "gugis-city",
  version: "1.0",
  coordinate_system: "ENU_METERS_WGS84",
  name: "Memory fixture",
  roads: [],
  metadata: { source: "test" },
  assets: {
    a: {
      parameters: { name: "Test" },
      templates: { box },
      nodes: [
        { id: "root", name: "Building", category: "building" },
        {
          id: "wall",
          name: "Wall",
          template: "box",
          category: "wall",
          position: [10, 20, 30],
          rotation_z: 90,
        },
      ],
    },
  },
  instances: [
    { id: "one", asset: "a", longitude: 1, latitude: 2 },
    { id: "two", asset: "a", longitude: 3, latitude: 4 },
  ],
};

test("wire baseline uses 8 box points and 12 real edges instead of triangle diagonals", () => {
  const mesh = meshFor(box);
  assert.equal(mesh.vertices.length, 8);
  assert.equal(mesh.triangles.length, 12);
  const edges = boundaryEdges(mesh);
  assert.equal(edges.length, 12);
  for (const [a, b] of edges)
    assert.equal(
      mesh.vertices[a].filter((v, i) => v !== mesh.vertices[b][i]).length,
      1,
    );
});

test("baseline bakes local transforms, retains semantics, and duplicates every placed shape", () => {
  const before = JSON.stringify(city),
    next = expandCity(city, "edges_faces");
  const first = next.assets.one.nodes[1],
    second = next.assets.two.nodes[1];
  assert.deepEqual(first.solid.vertices[0], [12, 19, 27]);
  assert.equal(first.solid.edges.length, 12);
  assert.equal(first.solid.triangles.length, 12);
  assert.equal(first.template, undefined);
  assert.equal(first.position, undefined);
  assert.equal(first.category, "wall");
  assert.notEqual(first.solid.vertices, second.solid.vertices);
  assert.notEqual(first.solid.vertices[0], second.solid.vertices[0]);
  assert.notEqual(first.solid.edges[0], second.solid.edges[0]);
  assert.notEqual(first.solid.triangles[0], second.solid.triangles[0]);
  assert.deepEqual(next.roads, city.roads);
  assert.deepEqual(next.metadata, city.metadata);
  assert.equal(JSON.stringify(city), before);
});

test("memory baselines expose their different capabilities and numeric accounting", () => {
  const wire = expandCity(city, "wire"),
    mesh = expandCity(city, "mesh");
  assert.equal(wire.assets.one.nodes[1].solid.triangles, undefined);
  assert.equal(mesh.assets.one.nodes[1].solid.edges, undefined);
  // Two independent boxes: 16 XYZ Float64 vertices, 24 indexed edges, two RGBA colors.
  assert.equal(
    numericPayload(wire, false).bytes,
    16 * 3 * 8 + 24 * 2 * 4 + 2 * 4,
  );
  assert.equal(
    numericPayload(mesh, false).bytes,
    16 * 3 * 8 + 24 * 3 * 4 + 2 * 4,
  );
  // One reusable box: 3 Float64 dimensions, 4 transform scalars, one index and RGBA.
  assert.equal(numericPayload(city, true).bytes, 3 * 8 + 4 * 8 + 4 + 4);
  assert.throws(() => expandCity(city, "unknown"));
});
