import type { Vec3 } from "./model";
import type { Terrain, TerrainPatch } from "./environment";
type Cell = { patch: TerrainPatch; points: Vec3[]; quad: boolean };
export interface TerrainHit {
  patch: string;
  kind: TerrainPatch["kind"];
  height: number;
  slope: number;
  aspect: number | null;
  u: number;
  v: number;
  x: number;
  y: number;
}
export function patchFaces(p: TerrainPatch): Vec3[] {
  if (p.kind === "ruled-strip")
    return p.left!.slice(0, -1).flatMap(
      (a, i) =>
        [
          [a, p.left![i + 1], p.right![i]],
          [p.left![i + 1], p.right![i + 1], p.right![i]],
        ] as Vec3[],
    );
  if (p.kind === "triangle-strip")
    return p
      .indices!.slice(0, -2)
      .map((a, i) =>
        i % 2
          ? [a, p.indices![i + 2], p.indices![i + 1]]
          : [a, p.indices![i + 1], p.indices![i + 2]],
      ) as Vec3[];
  return p.ring!.map(
    (a, i) => [p.hub!, a, p.ring![(i + 1) % p.ring!.length]] as Vec3,
  );
}
export function ruledPoint(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  d: Vec3,
  u: number,
  v: number,
): Vec3 {
  return a.map(
    (_, i) =>
      (1 - u) * ((1 - v) * a[i] + v * b[i]) + u * ((1 - v) * c[i] + v * d[i]),
  ) as Vec3;
}
const subtract = (a: Vec3, b: Vec3) => a.map((x, i) => x - b[i]) as Vec3;
const dot = (a: Vec3, b: Vec3) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function roots(a: number, b: number, c: number) {
  const epsilon = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), 1) * 1e-12;
  if (Math.abs(a) < epsilon) return Math.abs(b) < epsilon ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -epsilon) return [];
  const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, discriminant)));
  return Math.abs(q) < epsilon ? [-b / (2 * a)] : [q / a, c / q];
}

// Intersect the native bilinear/triangular surface, independent of GPU depth,
// transparency, buildings above it, or the tessellation used for display.
function rayCell(cell: Cell, origin: Vec3, direction: Vec3, n1: Vec3, n2: Vec3) {
  const [a, b, c, d] = cell.points;
  const du = subtract(cell.quad ? c : b, a), dv = subtract(cell.quad ? b : c, a);
  const twist: Vec3 = cell.quad ? d.map((x, i) => x - b[i] - c[i] + a[i]) as Vec3 : [0, 0, 0];
  const relative = subtract(a, origin);
  const [A, B, C, D] = [relative, du, dv, twist].map(p => dot(p, n1));
  const [E, F, G, H] = [relative, du, dv, twist].map(p => dot(p, n2));
  let nearest: { distance: number; hit: TerrainHit } | null = null;
  for (const u of roots(B * H - F * D, A * H + B * G - E * D - F * C, A * G - E * C)) {
    const denominator = Math.abs(C + D * u) > Math.abs(G + H * u) ? C + D * u : G + H * u;
    if (Math.abs(denominator) < 1e-12) continue;
    const v = Math.abs(C + D * u) > Math.abs(G + H * u) ? -(A + B * u) / denominator : -(E + F * u) / denominator;
    if (u < -1e-7 || v < -1e-7 || u > 1 + 1e-7 || v > 1 + 1e-7 || (!cell.quad && u + v > 1 + 1e-7)) continue;
    const point = a.map((x, i) => x + du[i] * u + dv[i] * v + twist[i] * u * v) as Vec3;
    const distance = dot(subtract(point, origin), direction);
    if (distance < 0 || (nearest && distance >= nearest.distance)) continue;
    if (Math.hypot(...point.map((x, i) => x - origin[i] - distance * direction[i])) > 1e-5) continue;
    const hit = sample(cell, point[0], point[1]);
    if (hit) nearest = { distance, hit };
  }
  return nearest;
}
function sample(cell: Cell, x: number, y: number): TerrainHit | null {
  const [a, b, c, d] = cell.points;
  let u = 0.5,
    v = 0.5,
    du: Vec3,
    dv: Vec3,
    z: number;
  if (cell.quad) {
    for (let k = 0; k < 12; k++) {
      const s = ruledPoint(a, b, c, d, u, v);
      du = a.map((_, i) => (1 - v) * (c[i] - a[i]) + v * (d[i] - b[i])) as Vec3;
      dv = a.map((_, i) => (1 - u) * (b[i] - a[i]) + u * (d[i] - c[i])) as Vec3;
      const det = du[0] * dv[1] - du[1] * dv[0];
      if (Math.abs(det) < 1e-10) return null;
      const ex = s[0] - x,
        ey = s[1] - y;
      u -= (ex * dv[1] - ey * dv[0]) / det;
      v -= (du[0] * ey - du[1] * ex) / det;
      if (Math.abs(ex) + Math.abs(ey) < 1e-7) break;
    }
    if (u < -1e-7 || u > 1 + 1e-7 || v < -1e-7 || v > 1 + 1e-7) return null;
    const s = ruledPoint(a, b, c, d, u, v);
    if (Math.hypot(s[0] - x, s[1] - y) > 1e-5) return null;
    z = s[2];
    du = a.map((_, i) => (1 - v) * (c[i] - a[i]) + v * (d[i] - b[i])) as Vec3;
    dv = a.map((_, i) => (1 - u) * (b[i] - a[i]) + u * (d[i] - c[i])) as Vec3;
  } else {
    du = subtract(b, a);
    dv = subtract(c, a);
    const det = du[0] * dv[1] - du[1] * dv[0];
    if (Math.abs(det) < 1e-10) return null;
    u = ((x - a[0]) * dv[1] - (y - a[1]) * dv[0]) / det;
    v = (du[0] * (y - a[1]) - du[1] * (x - a[0])) / det;
    if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) return null;
    z = a[2] + u * du[2] + v * dv[2];
  }
  const det = du[0] * dv[1] - du[1] * dv[0],
    gx = (du[2] * dv[1] - du[1] * dv[2]) / det,
    gy = (du[0] * dv[2] - du[2] * dv[0]) / det;
  return {
    patch: cell.patch.id,
    kind: cell.patch.kind,
    height: z,
    slope: (Math.atan(Math.hypot(gx, gy)) * 180) / Math.PI,
    aspect:
      Math.hypot(gx, gy) < 1e-10
        ? null
        : ((Math.atan2(-gx, -gy) * 180) / Math.PI + 360) % 360,
    u,
    v,
    x,
    y,
  };
}
function buildTerrainIndex(terrain: Terrain) {
  type BoundedCell = Cell & { bounds: [number, number, number, number] };
  const bins = new Map<string, BoundedCell[]>();
  const cells: Cell[] = [];
  for (const patch of terrain.patches) {
    if (patch.kind === "ruled-strip") {
      for (let i = 0; i < patch.left!.length - 1; i++)
        cells.push({
          patch,
          quad: true,
          points: [
            patch.left![i],
            patch.right![i],
            patch.left![i + 1],
            patch.right![i + 1],
          ].map((j) => terrain.points[j]),
        });
    } else
      for (const f of patchFaces(patch))
        cells.push({
          patch,
          quad: false,
          points: f.map((j) => terrain.points[j]),
        });
  }
  // Meter bins bound the candidate search; queries evaluate the native surface.
  const rayCells = cells.map(cell => ({ cell,
    min: [0, 1, 2].map(i => Math.min(...cell.points.map(p => p[i]))),
    max: [0, 1, 2].map(i => Math.max(...cell.points.map(p => p[i]))),
  }));
  const boundedCells = cells.map(cell => {
    const xs = cell.points.map((p) => p[0]), ys = cell.points.map((p) => p[1]);
    const bounds: BoundedCell["bounds"] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    // Match the native inverse's parameter tolerance, including strip edges.
    const epsilon = Math.max(1, bounds[2] - bounds[0], bounds[3] - bounds[1]) * 2e-7;
    bounds[0] -= epsilon; bounds[1] -= epsilon; bounds[2] += epsilon; bounds[3] += epsilon;
    return { ...cell, bounds } as BoundedCell;
  });
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const { bounds: b } of boundedCells) {
    west = Math.min(west, b[0]); south = Math.min(south, b[1]);
    east = Math.max(east, b[2]); north = Math.max(north, b[3]);
  }
  // A fixed 64m bucket contains thousands of faces in a 2m DEM. Target
  // roughly 16 cells per bucket, with 8..64m initial sizes. Long or highly
  // overlapping cells can require larger bins to keep indexing work bounded.
  const targetSize = Math.sqrt(Math.max(1, east - west) * Math.max(1, north - south) * 16 / Math.max(1, cells.length));
  let binSize = Number.isFinite(targetSize) ? Math.min(64, Math.max(8, 2 ** Math.ceil(Math.log2(targetSize)))) : 64;
  const membershipBudget = 4_000_000;
  function estimateMemberships(size: number) {
    let total = 0;
    for (const { bounds: b } of boundedCells) {
      total += (Math.floor(b[2] / size) - Math.floor(b[0] / size) + 1) *
        (Math.floor(b[3] / size) - Math.floor(b[1] / size) + 1);
      if (total > membershipBudget) break;
    }
    return total;
  }
  let memberships = estimateMemberships(binSize);
  while (memberships > membershipBudget) {
    binSize *= 2;
    if (!Number.isFinite(binSize)) throw new RangeError('Terrain spatial index cannot meet its bounded work budget');
    memberships = estimateMemberships(binSize);
  }
  let maxCandidatesPerBucket = 0;
  for (const candidate of boundedCells) {
    const bounds = candidate.bounds;
    const minX = Math.floor(bounds[0] / binSize), maxX = Math.floor(bounds[2] / binSize);
    const minY = Math.floor(bounds[1] / binSize), maxY = Math.floor(bounds[3] / binSize);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++) {
        const key = `${x},${y}`;
        const bin = bins.get(key) ?? [];
        bin.push(candidate);
        maxCandidatesPerBucket = Math.max(maxCandidatesPerBucket, bin.length);
        bins.set(key, bin);
      }
  }
  return {
    cells,
    statistics: Object.freeze({ binSizeMetres: binSize, cells: cells.length, bucketCount: bins.size,
      memberships, maxCandidatesPerBucket, membershipBudget }),
    raycast: (origin: Vec3, rayDirection: Vec3): TerrainHit | null => {
      const length = Math.hypot(...rayDirection);
      if (!length || ![...origin, ...rayDirection].every(Number.isFinite)) return null;
      const direction = rayDirection.map(x => x / length) as Vec3;
      const n1 = cross(direction, Math.abs(direction[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0]);
      const n2 = cross(direction, n1);
      let nearest: { distance: number; hit: TerrainHit } | null = null;
      for (const { cell, min, max } of rayCells) {
        let near = 0, far = nearest?.distance ?? Infinity;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(direction[i]) < 1e-12) {
            if (origin[i] < min[i] - 1e-7 || origin[i] > max[i] + 1e-7) { far = -1; break; }
          } else {
            const a = (min[i] - origin[i] - 1e-7) / direction[i], b = (max[i] - origin[i] + 1e-7) / direction[i];
            near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
          }
        }
        if (near > far) continue;
        const result = rayCell(cell, origin, direction, n1, n2);
        if (result && (!nearest || result.distance < nearest.distance)) nearest = result;
      }
      return nearest?.hit ?? null;
    },
    query: (x: number, y: number) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      for (const cell of bins.get(
        `${Math.floor(x / binSize)},${Math.floor(y / binSize)}`,
      ) ?? []) {
        const [minX, minY, maxX, maxY] = cell.bounds;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        const hit = sample(cell, x, y);
        if (hit) return hit;
      }
      return null;
    },
  };
}
// City terrain snapshots are immutable. Scene picking, route analysis and
// semantic queries share one native index instead of rebuilding thousands of
// ruled/triangle cells on the first click in each workspace.
const nativeIndexCache = new WeakMap<Terrain, ReturnType<typeof buildTerrainIndex>>();
export function terrainIndex(terrain: Terrain) {
  let value = nativeIndexCache.get(terrain);
  if (!value) { value = buildTerrainIndex(terrain); nativeIndexCache.set(terrain, value); }
  return value;
}
export function terrainStatistics(terrain: Terrain) {
  const count = { "ruled-strip": 0, "triangle-strip": 0, "triangle-fan": 0 };
  let indices = 0,
    triangles = 0;
  for (const p of terrain.patches) {
    count[p.kind]++;
    indices +=
      p.kind === "ruled-strip"
        ? p.left!.length * 2
        : p.kind === "triangle-strip"
          ? p.indices!.length
          : 1 + p.ring!.length;
    triangles += p.kind === "ruled-strip" ? (p.left!.length - 1) * 2
      : p.kind === "triangle-strip" ? p.indices!.length - 2 : p.ring!.length;
  }
  return {
    count,
    points: terrain.points.length,
    indices,
    triangles,
    indexSaving: triangles ? (1 - indices / (triangles * 3)) * 100 : 0,
  };
}

export function terrainMesh(terrain: Terrain, kind: TerrainPatch["kind"]) {
  const vertices: Vec3[] = [],
    triangles: Vec3[] = [];
  const divisions = terrain.points.length > 50000 ? 1 : 2;
  // Display vertices share native point IDs and edge midpoints. Avoid welding
  // by rounded coordinates: that could close real NoData holes or thin gaps.
  const shared = new Map<string, number>();
  const vertex = (key: string, point: () => Vec3) => {
    const found = shared.get(key);
    if (found !== undefined) return found;
    const id = vertices.length;
    vertices.push(point());
    shared.set(key, id);
    return id;
  };
  const native = (id: number) => vertex(`p${id}`, () => terrain.points[id]);
  const midpoint = (a: number, b: number) => vertex(`e${Math.min(a,b)}/${Math.max(a,b)}`,
    () => terrain.points[a].map((x, j) => (x + terrain.points[b][j]) / 2) as Vec3);
  for (const p of terrain.patches.filter((p) => p.kind === kind)) {
    if (p.kind !== "ruled-strip") {
      for (const face of patchFaces(p)) {
        triangles.push(face.map(native) as Vec3);
      }
    } else
      for (let i = 0; i < p.left!.length - 1; i++) {
        const ids = [
          p.left![i],
          p.right![i],
          p.left![i + 1],
          p.right![i + 1],
        ];
        const [a, b, c, d] = ids.map((j) => terrain.points[j]);
        const grid: number[] = [];
        for (let v = 0; v <= divisions; v++)
          for (let u = 0; u <= divisions; u++) {
            if ((u === 0 || u === divisions) && (v === 0 || v === divisions))
              grid.push(native(ids[(u === divisions ? 2 : 0) + (v === divisions ? 1 : 0)]));
            else if (u === 0) grid.push(midpoint(ids[0], ids[1]));
            else if (u === divisions) grid.push(midpoint(ids[2], ids[3]));
            else if (v === 0) grid.push(midpoint(ids[0], ids[2]));
            else if (v === divisions) grid.push(midpoint(ids[1], ids[3]));
            else {
              grid.push(vertices.length);
              vertices.push(ruledPoint(a, b, c, d, u / divisions, v / divisions));
            }
          }
        for (let v = 0; v < divisions; v++)
          for (let u = 0; u < divisions; u++) {
            const k = v * (divisions + 1) + u;
            triangles.push(
              [grid[k], grid[k + 1], grid[k + divisions + 1]],
              [grid[k + 1], grid[k + divisions + 2], grid[k + divisions + 1]],
            );
          }
      }
  }
  return { vertices, triangles };
}
