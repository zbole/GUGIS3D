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
  return collectTopology(terrain, Infinity).lines;
}

/** Refuse an incomplete overlay; stop collecting at the first edge beyond the display budget. */
export function terrainTopologyPreview(terrain: Terrain, limit = 20000) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Topology display budget must be a positive integer");
  return collectTopology(terrain, limit);
}

function collectTopology(terrain: Terrain, limit: number): { lines: TerrainTopologyLine[]; limited: boolean } {
  const lines = new Map<string, TerrainTopologyLine>();
  const exceeded = () => ({ lines: [], limited: true });
  const edge = (a: number, b: number, role: TerrainLineRole) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const existing = lines.get(key);
    if (!existing) {
      if (lines.size >= limit) return false;
      lines.set(key, { points: [terrain.points[a], terrain.points[b]], role });
    }
    else if (rolePriority[role] > rolePriority[existing.role]) existing.role = role;
    return true;
  };
  for (const patch of terrain.patches) {
    if (patch.kind === "ruled-strip") {
      for (let index = 0; index < patch.left!.length; index++) {
        const left = patch.left![index];
        if (!edge(left, patch.right![index], "generator")) return exceeded();
        if (index) {
          if (!edge(patch.left![index - 1], left, "boundary") ||
            !edge(patch.right![index - 1], patch.right![index], "boundary")) return exceeded();
        }
      }
    } else if (patch.kind === "triangle-fan") {
      for (let index = 0; index < patch.ring!.length; index++) {
        const point = patch.ring![index];
        if (!edge(patch.hub!, point, "triangle-fan") ||
          !edge(point, patch.ring![(index + 1) % patch.ring!.length], "triangle-fan")) return exceeded();
      }
    } else {
      for (let index = 0; index < patch.indices!.length; index++) {
        const point = patch.indices![index];
        if (index && !edge(patch.indices![index - 1], point, "triangle-strip")) return exceeded();
        if (index > 1 && !edge(patch.indices![index - 2], point, "triangle-strip")) return exceeded();
      }
    }
  }
  return { lines: [...lines.values()], limited: false };
}
