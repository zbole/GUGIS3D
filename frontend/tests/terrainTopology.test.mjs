import test from "node:test";
import assert from "node:assert/strict";
import { terrainTopologyLines, terrainLineColors } from "../src/studio/terrainTopology.ts";

const terrain = {
  points: [[0, 0, 0], [0, 10, 1], [10, 0, 2], [10, 10, 3], [20, 0, 4], [20, 10, 5]],
  patches: [{ id: "r", kind: "ruled-strip", left: [0, 2, 4], right: [1, 3, 5] }],
};

test("ruled-strip overlay shows native boundaries and straight generators without display diagonals", () => {
  const lines = terrainTopologyLines(terrain);
  assert.equal(lines.length, 7);
  assert.equal(lines.filter(line => line.role === "generator").length, 3);
  assert.equal(lines.filter(line => line.role === "boundary").length, 4);
  assert.ok(!lines.some(line => line.points.includes(terrain.points[0]) && line.points.includes(terrain.points[3])));
  assert.notEqual(terrainLineColors.generator, terrainLineColors.boundary);
});

test("shared control edges stay single and retain ruled-strip meaning", () => {
  const lines = terrainTopologyLines({ ...terrain, patches: [
    { id: "r", kind: "ruled-strip", left: [0, 2], right: [1, 3] },
    { id: "t", kind: "triangle-strip", indices: [0, 1, 2, 3] },
  ] });
  assert.equal(lines.length, 5);
  assert.equal(lines.filter(line => line.role === "generator").length, 2);
  assert.equal(lines.filter(line => line.role === "boundary").length, 2);
  assert.equal(lines.filter(line => line.role === "triangle-strip").length, 1);
});
