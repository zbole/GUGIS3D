import type { Terrain } from "./environment";
import type { Vec3 } from "./model";

export type TerrainLineRole = "boundary" | "generator" | "triangle-strip" | "triangle-fan";

export interface TerrainTopologyLine {
  points: [Vec3, Vec3];
  role: TerrainLineRole;
}

export const terrainLineColors: Record<TerrainLineRole, string> = {
  boundary: "#24544c",
  generator: "#df9b30",
  "triangle-strip": "#976b39",
  "triangle-fan": "#71629b",
};

const rolePriority: Record<TerrainLineRole, number> = {
  boundary: 2,
  generator: 3,
  "triangle-strip": 1,
  "triangle-fan": 1,
};

/** Native control edges only; never include display-tessellation diagonals. */
export function terrainTopologyLines(terrain: Terrain): TerrainTopologyLine[] {
  const lines = new Map<string, TerrainTopologyLine>();
  const edge = (a: number, b: number, role: TerrainLineRole) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const existing = lines.get(key);
    if (!existing) lines.set(key, { points: [terrain.points[a], terrain.points[b]], role });
    else if (rolePriority[role] > rolePriority[existing.role]) existing.role = role;
  };
  for (const patch of terrain.patches) {
    if (patch.kind === "ruled-strip") {
      patch.left!.forEach((left, index) => {
        edge(left, patch.right![index], "generator");
        if (index) {
          edge(patch.left![index - 1], left, "boundary");
          edge(patch.right![index - 1], patch.right![index], "boundary");
        }
      });
    } else if (patch.kind === "triangle-fan") {
      patch.ring!.forEach((point, index) => {
        edge(patch.hub!, point, "triangle-fan");
        edge(point, patch.ring![(index + 1) % patch.ring!.length], "triangle-fan");
      });
    } else {
      patch.indices!.forEach((point, index) => {
        if (index) edge(patch.indices![index - 1], point, "triangle-strip");
        if (index > 1) edge(patch.indices![index - 2], point, "triangle-strip");
      });
    }
  }
  return [...lines.values()];
}
