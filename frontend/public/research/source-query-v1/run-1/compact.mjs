// workspace-source:C:\Users\Bole Zhang\Documents\Codex\2026-09-08\w\GUGIS3D-DOT-2026-10-03\frontend\src\compare\principalRuledMath.ts
function validatePrincipalModel(value) {
  const m = value;
  if (m?.format !== "gugis-research-surface" || m.version !== 3 || m.coordinate_system !== "LOCAL_METERS" || !Array.isArray(m.clip_bounds) || m.clip_bounds.length !== 4 || m.clip_bounds.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e4) || m.clip_bounds[0] >= m.clip_bounds[2] || m.clip_bounds[1] >= m.clip_bounds[3] || !Array.isArray(m.points) || m.points.length < 3 || m.points.length > 2e4 || m.points.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((n) => !Number.isFinite(n) || Math.abs(n) > 1e4)) || !Array.isArray(m.patches) || !m.patches.length || m.patches.length > 8192) throw new Error("Invalid principal-surface protocol or capacity");
  let work = 0;
  for (const p of m.patches) {
    const ids = p?.kind === "quadratic-ruled" && Array.isArray(p.left) && Array.isArray(p.right) ? [...p.left, ...p.right] : (p?.kind === "triangle-strip" || p?.kind === "lagrange-triangle") && Array.isArray(p.indices) ? p.indices : [];
    if (ids.length < 3 || ids.length > 256 || ids.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= m.points.length)) throw new Error("Invalid principal-surface indices");
    work += ids.length;
    if (p.kind === "quadratic-ruled") {
      if (p.left.length !== 3 || p.right.length !== 3) throw new Error("Quadratic boundaries require three nodes");
      const a = p.left.map((i) => m.points[i]), b = p.right.map((i) => m.points[i]);
      const e = [a[2][0] - a[0][0], a[2][1] - a[0][1]], d = [b[0][0] - a[0][0], b[0][1] - a[0][1]], det = e[0] * d[1] - e[1] * d[0];
      if (Math.abs(det) <= 1e-12 * Math.max(1, Math.hypot(...e) * Math.hypot(...d))) throw new Error("Degenerate or folded horizontal projection");
      for (let j = 0; j < 3; j++) for (let k = 0; k < 2; k++) if (Math.abs(a[j][k] - (a[0][k] + j * e[k] / 2)) > 1e-9 || Math.abs(b[j][k] - a[j][k] - d[k]) > 1e-9) throw new Error("Horizontal boundaries must form a parallelogram");
    } else if (p.kind === "lagrange-triangle") {
      if (p.degree !== 2 || p.indices.length !== 6) throw new Error("P2 triangle requires six nodes");
      const nodes = p.indices.map((i) => m.points[i]), a = nodes[0], b = nodes[3], c = nodes[5];
      if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-12) throw new Error("Degenerate P2 triangle");
      for (const [node, left, right] of [[1, 0, 3], [2, 0, 5], [4, 3, 5]]) for (let k = 0; k < 2; k++) if (Math.abs(nodes[node][k] - (nodes[left][k] + nodes[right][k]) / 2) > 1e-9) throw new Error("Invalid P2 node placement");
    } else if (p.kind !== "triangle-strip") throw new Error("Unsupported principal-surface primitive");
    else for (let j = 0; j < p.indices.length - 2; j++) {
      const [a, b, c] = p.indices.slice(j, j + 3).map((i) => m.points[i]);
      if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-12) throw new Error("Degenerate triangle");
    }
  }
  if (work > 1e5) throw new Error("Principal-surface work capacity exceeded");
  return m;
}
function preparePrincipalQuery(value) {
  const source = validatePrincipalModel(value), model = JSON.parse(JSON.stringify(source)), primitives = [];
  const append = (patch, kind, a, c, b, coefficients, corners) => {
    const e = c.map((v, k) => v - a[k]), d = b.map((v, k) => v - a[k]), det = e[0] * d[1] - e[1] * d[0];
    primitives.push({ patch, kind, origin: a, along: e, across: d, inverse: [d[1] / det, -d[0] / det, -e[1] / det, e[0] / det], coefficients, bounds: [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))] });
  };
  model.patches.forEach((p, index) => {
    if (p.kind === "quadratic-ruled") {
      const a = p.left.map((i) => model.points[i]), b = p.right.map((i) => model.points[i]), d = b.map((q, i) => q[2] - a[i][2]);
      append(index, p.kind, a[0], a[2], b[0], [a[0][2], 2 * (a[1][2] - a[0][2]), a[0][2] - 2 * a[1][2] + a[2][2], d[0], 2 * (d[1] - d[0]), d[0] - 2 * d[1] + d[2]], [a[0], a[2], b[0], b[2]]);
    } else if (p.kind === "lagrange-triangle") {
      const z = p.indices.map((i) => model.points[i][2]), [a, ab, ac, b, bc, c] = z;
      append(
        index,
        p.kind,
        model.points[p.indices[0]],
        model.points[p.indices[3]],
        model.points[p.indices[5]],
        [a, -3 * a + 4 * ab - b, -3 * a + 4 * ac - c, 2 * a - 4 * ab + 2 * b, 4 * a - 4 * ab - 4 * ac + 4 * bc, 2 * a - 4 * ac + 2 * c],
        [model.points[p.indices[0]], model.points[p.indices[3]], model.points[p.indices[5]]]
      );
    } else for (let j = 0; j < p.indices.length - 2; j++) {
      const [a, b, c] = p.indices.slice(j, j + 3).map((i) => model.points[i]);
      append(index, p.kind, a, b, c, [a[2], b[2] - a[2], c[2] - a[2]], [a, b, c]);
    }
  });
  const [west, south, east, north] = model.clip_bounds, side = 32, cellX = (east - west) / side, cellY = (north - south) / side;
  const cell = (x, y) => [Math.min(side - 1, Math.max(0, Math.floor((x - west) / cellX))), Math.min(side - 1, Math.max(0, Math.floor((y - south) / cellY)))];
  const grid = Array.from({ length: side * side }, () => []), indexed = primitives.length > 8;
  if (indexed) primitives.forEach((p, i) => {
    const [x0, y0] = cell(p.bounds[0], p.bounds[1]), [x1, y1] = cell(p.bounds[2], p.bounds[3]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) grid[y * side + x].push(i);
  });
  const all = primitives.map((_, i) => i);
  const query = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < west || x > east || y < south || y > north) return null;
    const [ix, iy] = cell(x, y), candidates = indexed ? grid[iy * side + ix] : all;
    for (const index of candidates) {
      const p = primitives[index], dx = x - p.origin[0], dy = y - p.origin[1], u = p.inverse[0] * dx + p.inverse[1] * dy, v = p.inverse[2] * dx + p.inverse[3] * dy;
      if (u < -1e-11 || v < -1e-11 || u > 1 + 1e-11 || v > 1 + 1e-11 || p.kind !== "quadratic-ruled" && u + v > 1 + 1e-11) continue;
      const a = p.coefficients;
      const height = p.kind === "quadratic-ruled" ? a[0] + u * (a[1] + u * a[2]) + v * (a[3] + u * (a[4] + u * a[5])) : p.kind === "lagrange-triangle" ? a[0] + u * a[1] + v * a[2] + u * u * a[3] + u * v * a[4] + v * v * a[5] : a[0] + u * a[1] + v * a[2];
      const du = p.kind === "quadratic-ruled" ? a[1] + 2 * u * a[2] + v * (a[4] + 2 * u * a[5]) : p.kind === "lagrange-triangle" ? a[1] + 2 * u * a[3] + v * a[4] : a[1], dv = p.kind === "quadratic-ruled" ? a[3] + u * (a[4] + u * a[5]) : p.kind === "lagrange-triangle" ? a[2] + u * a[4] + 2 * v * a[5] : a[2];
      return { height, gradient: [du * p.inverse[0] + dv * p.inverse[2], du * p.inverse[1] + dv * p.inverse[3]], patch: p.patch, primitive: index, kind: p.kind, u, v };
    }
    return null;
  };
  return { query, primitives: primitives.length, indexed };
}

// workspace-source:C:\Users\Bole Zhang\Documents\Codex\2026-09-08\w\GUGIS3D-DOT-2026-10-03\frontend\src\compare\sourceRuledBandMath.ts
function validateFrame(m) {
  if (!Array.isArray(m.clip_bounds) || m.clip_bounds.length !== 4 || m.clip_bounds.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e4) || m.clip_bounds[0] >= m.clip_bounds[2] || m.clip_bounds[1] >= m.clip_bounds[3] || !Array.isArray(m.origin_bng) || m.origin_bng.length !== 2 || m.origin_bng.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e8) || m.horizontal_epsg !== 27700 || m.vertical_datum !== "ODN") throw new Error("Invalid source BNG / ODN coordinate frame");
}
function expandSourceModel(value) {
  const m = value;
  validateFrame(m);
  if (m.format !== "gugis-research-surface" || m.version !== 4 || m.coordinate_system !== "LOCAL_METERS" || !Array.isArray(m.points) || m.points.length < 3 || m.points.length > 2e4 || m.points.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e4)) || !Array.isArray(m.patches) || !m.patches.length || m.patches.length > 8192) throw new Error("Invalid source-band protocol capacity");
  const points = m.points.map((p) => [...p]), patches = [], bindings = [];
  const pool = new Map(points.map((p, i) => [JSON.stringify(p), i]));
  let work = 0;
  const midpoint = (a, b) => {
    const p = a.map((v, k) => (v + b[k]) / 2), key = JSON.stringify(p);
    if (pool.has(key)) return pool.get(key);
    if (points.length >= 2e4) throw new Error("Source execution-point capacity exceeded");
    pool.set(key, points.length);
    points.push(p);
    return points.length - 1;
  };
  m.patches.forEach((p, index) => {
    if (p.kind === "ruled-strip") {
      if (!Array.isArray(p.left) || !Array.isArray(p.right) || p.left.length !== p.right.length || p.left.length < 2 || p.left.length > 128) throw new Error("Invalid source-band boundary count");
      const ids = [...p.left, ...p.right];
      work += ids.length;
      if (ids.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= m.points.length)) throw new Error("Invalid source-band index");
      for (let j = 0; j < p.left.length - 1; j++) {
        const a = p.left[j], c = p.left[j + 1], b = p.right[j], d = p.right[j + 1];
        patches.push({ kind: "quadratic-ruled", left: [a, midpoint(points[a], points[c]), c], right: [b, midpoint(points[b], points[d]), d] });
        bindings.push({ patch: index, segment: j });
        if (patches.length > 8192) throw new Error("Source execution-face capacity exceeded");
      }
    } else {
      if (p.kind !== "quadratic-ruled" && p.kind !== "triangle-strip" && p.kind !== "lagrange-triangle") throw new Error("Unsupported source surface");
      work += p.kind === "quadratic-ruled" ? 6 : p.indices?.length ?? 100001;
      patches.push(p);
      bindings.push({ patch: index, segment: null });
    }
  });
  if (work > 1e5) throw new Error("Source index-work capacity exceeded");
  const native = { format: m.format, version: 3, coordinate_system: m.coordinate_system, clip_bounds: [...m.clip_bounds], points, patches };
  validatePrincipalModel(native);
  return { model: m, native, bindings };
}
function validateSourceBandModel(value) {
  return expandSourceModel(value).model;
}
function prepareSourceBandQuery(value) {
  const { model, native, bindings } = expandSourceModel(value), prepared = preparePrincipalQuery(native), origin = [...model.origin_bng];
  const query = (x, y) => {
    const q = prepared.query(x, y);
    if (!q) return null;
    const binding = bindings[q.patch];
    return { ...q, patch: binding.patch, segment: binding.segment, kind: binding.segment === null ? q.kind : "ruled-strip", easting: origin[0] + x, northing: origin[1] + y };
  };
  return { query, primitives: prepared.primitives, execution_points: native.points.length, stored_points: model.points.length, stored_patches: model.patches.length };
}

// workspace-source:C:\Users\Bole Zhang\Documents\Codex\2026-09-08\w\GUGIS3D-DOT-2026-10-03\frontend/src/compare/compactSourceBandQuery.ts
function prepareCompactSourceBandQuery(value) {
  const model = validateSourceBandModel(value), [west, south, east, north] = model.clip_bounds;
  const regular = model.points.length === 4225 && model.patches.length === 64 && east - west === 64 && north - south === 64 && Number.isInteger(west) && Number.isInteger(south) && model.points.every((p, id) => p[0] === west + id % 65 && p[1] === south + Math.floor(id / 65) && Math.fround(p[2]) === p[2]) && model.patches.every((p, j) => p.kind === "ruled-strip" && p.left.length === 65 && p.right.length === 65 && p.left.every((id, i) => id === j * 65 + i) && p.right.every((id, i) => id === (j + 1) * 65 + i));
  if (!regular) return { ...prepareSourceBandQuery(model), implementation: "generic-source-band" };
  const heights = Float64Array.from(model.points, (p) => p[2]), origin = [...model.origin_bng];
  const locate = (coordinate, start) => {
    const offset = coordinate - start, bin = Math.min(31, Math.floor(offset / 2)), first = Math.max(0, 2 * bin - 1), last = Math.min(63, 2 * bin + 1);
    let cell = Math.max(first, Math.min(63, Math.floor(offset) - 1));
    while (cell <= last) {
      const local = coordinate - (start + cell);
      if (local >= -1e-11 && local <= 1 + 1e-11) return [cell, local];
      cell++;
    }
    return null;
  };
  const query = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < west || x > east || y < south || y > north) return null;
    const horizontal = locate(x, west), vertical = locate(y, south);
    if (!horizontal || !vertical) return null;
    const [i, u] = horizontal, [j, v] = vertical, a = heights[j * 65 + i], b = heights[j * 65 + i + 1], c = heights[(j + 1) * 65 + i], d = heights[(j + 1) * 65 + i + 1];
    const along = b - a, across = c - a, mixed = d - c - b + a;
    return { height: a + u * along + v * (across + u * mixed), gradient: [along + v * mixed, across + u * mixed], patch: j, primitive: j * 64 + i, kind: "ruled-strip", u, v, segment: i, easting: origin[0] + x, northing: origin[1] + y };
  };
  return { query, primitives: 4096, execution_points: 4225, stored_points: 4225, stored_patches: 64, implementation: "compact-source-band" };
}
export {
  prepareCompactSourceBandQuery
};
