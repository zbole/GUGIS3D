import test from "node:test";
import assert from "node:assert/strict";
import { solidGeometry, solidCorners } from "../src/studio/geometry.ts";

test("local box placement is baked into geometry, including a floor with only one component", () => {
  const solid = { kind: "box", color: "#abcdef", size: [4, 2, 6] };
  const original = JSON.stringify(solid),
    g = solidGeometry(solid, [12, -5, 30]);
  const p = Array.from(g.attributes.position.values),
    axes = [0, 1, 2].map((k) => p.filter((_, i) => i % 3 === k));
  assert.deepEqual(
    axes.map((a) => Math.min(...a)),
    [10, -6, 27],
  );
  assert.deepEqual(
    axes.map((a) => Math.max(...a)),
    [14, -4, 33],
  );
  assert.deepEqual(
    [
      g.boundingSphere.center.x,
      g.boundingSphere.center.y,
      g.boundingSphere.center.z,
    ],
    [12, -5, 30],
  );
  assert.equal(JSON.stringify(solid), original);
});
test("explicit meshes retain their shape and crisp face normals after local translation", () => {
  const solid = {
    kind: "mesh",
    color: "#abcdef",
    vertices: [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 3],
    ],
    triangles: [
      [0, 2, 1],
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ],
  };
  const original = JSON.stringify(solid),
    g = solidGeometry(solid, [10, 20, 30]);
  const p = Array.from(g.attributes.position.values),
    n = Array.from(g.attributes.normal.values);
  assert.equal(p.length, 36);
  assert.deepEqual(p.slice(0, 9), [10, 20, 30, 10, 22, 30, 12, 20, 30]);
  for (let i = 0; i < n.length; i += 9) {
    assert.deepEqual(n.slice(i, i + 3), n.slice(i + 3, i + 6));
    assert.deepEqual(n.slice(i, i + 3), n.slice(i + 6, i + 9));
  }
  assert.equal(JSON.stringify(solid), original);
});

test("local facade rotation rotates geometry, normals and picking bounds around the component origin", () => {
  const solid = { kind: "box", color: "#abcdef", size: [4, 2, 6] };
  const geometry = solidGeometry(solid, [10, 20, 30], 90);
  const positions = Array.from(geometry.attributes.position.values);
  const axes = [0, 1, 2].map((k) => positions.filter((_, i) => i % 3 === k));
  assert.deepEqual(
    axes.map((a) => Math.min(...a)),
    [9, 18, 27],
  );
  assert.deepEqual(
    axes.map((a) => Math.max(...a)),
    [11, 22, 33],
  );
  const corners = solidCorners(solid, 90);
  assert.ok(
    corners.every((p) => Math.abs(p.x) <= 1.00001 && Math.abs(p.y) <= 2.00001),
  );
  const normals = Array.from(geometry.attributes.normal.values);
  for (let i = 0; i < normals.length; i += 3)
    assert.ok(Math.abs(Math.hypot(...normals.slice(i, i + 3)) - 1) < 1e-6);
});
