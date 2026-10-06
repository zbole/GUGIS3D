// workspace-source:C:\Users\Bole Zhang\Documents\Codex\2026-09-08\w\GUGIS3D-DOT-2026-10-03\frontend\src\compare\curvedRuledMath.ts
function validateCurveModel(value) {
  const m = value;
  if (m?.format !== "gugis-research-surface" || m.version !== 1 || m.coordinate_system !== "LOCAL_METERS" || !Array.isArray(m.points) || m.points.length < 3 || m.points.length > 2e4 || !Array.isArray(m.patches) || m.patches.length < 1 || m.patches.length > 8192)
    throw new Error("\u7814\u7A76\u6A21\u578B\u534F\u8BAE\u6216\u5BB9\u91CF\u65E0\u6548");
  if (m.points.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((x) => !Number.isFinite(x) || Math.abs(x) > 1e4))) throw new Error("\u7814\u7A76\u63A7\u5236\u70B9\u65E0\u6548");
  let work = 0;
  for (const p of m.patches) {
    const ids = p.kind === "triangle-strip" ? p.indices : p.kind === "quadratic-ruled" ? [...p.left ?? [], ...p.right ?? []] : [];
    if (ids.length < 3 || ids.length > 256 || ids.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= m.points.length)) throw new Error("\u7814\u7A76\u7D22\u5F15\u65E0\u6548");
    if (p.kind === "quadratic-ruled") {
      if (p.left?.length !== 3 || p.right?.length !== 3) throw new Error("\u4E8C\u6B21\u8FB9\u754C\u9700\u8981\u5404\u4E09\u4E2A\u63A7\u5236\u70B9");
      const a = p.left.map((i) => m.points[i]), b = p.right.map((i) => m.points[i]);
      const xAxis = Math.abs(a[2][0] - a[0][0]) > 1e-8;
      const along = xAxis ? 0 : 1, across = xAxis ? 1 : 0;
      if (a[2][along] <= a[0][along] || b[0][across] <= a[0][across] || a.some((q, j) => Math.abs(q[across] - a[0][across]) > 1e-10 || Math.abs(q[along] - (a[0][along] + j * (a[2][along] - a[0][along]) / 2)) > 1e-10) || b.some((q, j) => Math.abs(q[across] - b[0][across]) > 1e-10 || Math.abs(q[along] - a[j][along]) > 1e-10)) throw new Error("\u7814\u7A76\u66F2\u9762\u6C34\u5E73\u6295\u5F71\u987B\u4E3A\u975E\u6298\u53E0\u77E9\u5F62");
    } else if (p.kind !== "triangle-strip") throw new Error("\u672A\u77E5\u7814\u7A76\u51FD\u6570");
    work += ids.length;
  }
  if (work > 1e5) throw new Error("\u7814\u7A76\u6A21\u578B\u67E5\u8BE2\u9884\u7B97\u8D85\u9650");
  return m;
}

// workspace-source:C:\Users\Bole Zhang\Documents\Codex\2026-09-08\w\GUGIS3D-DOT-2026-10-03\frontend\src\compare\terrainOrderMath.ts
function nodeOrders(degree) {
  if (degree !== 2 && degree !== 3) throw new Error("\u4EC5\u652F\u6301\u4E8C\u6B21\u6216\u4E09\u6B21\u7814\u7A76\u4E09\u89D2\u9762");
  const result = [];
  for (let a = degree; a >= 0; a--) for (let b = degree - a; b >= 0; b--) result.push([a, b, degree - a - b]);
  return result;
}
function vertices(model, patch) {
  const p = patch.degree;
  return [0, p * (p + 1) / 2, (p + 1) * (p + 2) / 2 - 1].map((i) => model.points[patch.nodes[i]]);
}
function validateOrderModel(value) {
  const m = value;
  if (m?.format !== "gugis-research-surface" || m.version !== 2 || m.coordinate_system !== "LOCAL_METERS" || !Array.isArray(m.points) || !Array.isArray(m.patches) || m.points.length < 3 || m.points.length > 2e4 || m.patches.length < 1 || m.patches.length > 8192) throw new Error("\u9636\u6570\u5BF9\u7167\u6A21\u578B\u534F\u8BAE\u6216\u5BB9\u91CF\u65E0\u6548");
  if (m.patches.every((p) => p?.kind === "quadratic-ruled")) {
    validateCurveModel({ ...m, version: 1 });
    return m;
  }
  if (m.points.some((p) => !Array.isArray(p) || p.length !== 3 || p.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e4))) throw new Error("\u9636\u6570\u5BF9\u7167\u8282\u70B9\u65E0\u6548");
  let work = 0;
  const degree = m.patches[0].degree;
  for (const p of m.patches) {
    if (p?.kind !== "lagrange-triangle" || p.degree !== degree || !Array.isArray(p.nodes) || p.nodes.length !== (p.degree + 1) * (p.degree + 2) / 2 || p.nodes.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= m.points.length)) throw new Error("\u9636\u6570\u5BF9\u7167\u9762\u7247\u65E0\u6548");
    const orders = nodeOrders(p.degree), [a, b, c] = vertices(m, p), det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (det <= 1e-12) throw new Error("\u9AD8\u9636\u4E09\u89D2\u9762\u9000\u5316\u6216\u53CD\u5411");
    for (let i = 0; i < orders.length; i++) for (let k = 0; k < 2; k++) {
      const expected = (a[k] * orders[i][0] + b[k] * orders[i][1] + c[k] * orders[i][2]) / p.degree;
      if (Math.abs(m.points[p.nodes[i]][k] - expected) > 1e-9) throw new Error("\u9AD8\u9636\u8282\u70B9\u4F4D\u7F6E\u4E0D\u7B26\u5408 Lagrange \u7EA6\u5B9A");
    }
    work += p.nodes.length;
  }
  if (work > 1e5) throw new Error("\u9636\u6570\u5BF9\u7167\u8BA1\u7B97\u9884\u7B97\u8D85\u9650");
  return m;
}

// workspace-source:C:\Users\Bole Zhang\Documents\Codex\2026-09-08\w\GUGIS3D-DOT-2026-10-03\frontend/src/compare/preparedOrderQuery.ts
var powers = [[0, 0], [1, 0], [0, 1], [2, 0], [1, 1], [0, 2], [3, 0], [2, 1], [1, 2], [0, 3]];
function multiplyLinear(values, constant, u, v) {
  const result = Array(10).fill(0);
  for (let i = 0; i < powers.length; i++) {
    const [a, b] = powers[i];
    result[i] += constant * values[i];
    for (const [da, db, factor] of [[1, 0, u], [0, 1, v]]) {
      if (!factor || !values[i]) continue;
      const next = powers.findIndex(([x, y]) => x === a + da && y === b + db);
      if (next < 0) throw new Error("\u7814\u7A76\u591A\u9879\u5F0F\u9636\u6570\u8D85\u9650");
      result[next] += factor * values[i];
    }
  }
  return result;
}
function coefficients(model, patch) {
  const c = Array(10).fill(0), reference = model.points[patch.nodes[0]][2];
  c[0] = reference;
  nodeOrders(patch.degree).forEach((alpha, i) => {
    let basis = Array(10).fill(0);
    basis[0] = 1;
    for (let axis = 0; axis < 3; axis++) for (let j = 0; j < alpha[axis]; j++) {
      const denominator = alpha[axis] - j, p = patch.degree;
      basis = multiplyLinear(
        basis,
        (axis === 0 ? p - j : -j) / denominator,
        (axis === 0 ? -p : axis === 1 ? p : 0) / denominator,
        (axis === 0 ? -p : axis === 2 ? p : 0) / denominator
      );
    }
    const z = model.points[patch.nodes[i]][2] - reference;
    for (let k = 0; k < 10; k++) c[k] += z * basis[k];
  });
  return c;
}
function gridForBoxes(bounds, boxes) {
  if (boxes.length <= 8) {
    const indices = boxes.map((_, i) => i);
    return { candidates: (_x, _y) => indices };
  }
  const cell = (x, axis) => Math.max(0, Math.min(31, Math.floor((x - bounds[axis]) * 32 / (bounds[axis + 2] - bounds[axis]))));
  const cells = /* @__PURE__ */ new Map();
  boxes.forEach((box, index) => {
    for (let x = cell(box[0], 0); x <= cell(box[2], 0); x++) for (let y = cell(box[1], 1); y <= cell(box[3], 1); y++) {
      const key = x + 32 * y, list = cells.get(key) ?? [];
      list.push(index);
      cells.set(key, list);
    }
  });
  return { candidates: (x, y) => cells.get(cell(x, 0) + 32 * cell(y, 1)) ?? [] };
}
function prepareOrderQuery(value) {
  const model = validateOrderModel(value);
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of model.points) {
    bounds[0] = Math.min(bounds[0], p[0]);
    bounds[1] = Math.min(bounds[1], p[1]);
    bounds[2] = Math.max(bounds[2], p[0]);
    bounds[3] = Math.max(bounds[3], p[1]);
  }
  if (model.patches[0].kind === "quadratic-ruled") {
    const curves = model.patches.map((value2) => {
      if (value2.kind !== "quadratic-ruled") throw new Error("\u7814\u7A76\u66F2\u9762\u7C7B\u578B\u6DF7\u5408");
      const a = value2.left.map((i) => model.points[i]), b = value2.right.map((i) => model.points[i]);
      const along = Math.abs(a[2][0] - a[0][0]) > 1e-8 ? 0 : 1, across = 1 - along;
      const d = b.map((p, i) => p[2] - a[i][2]);
      return {
        along,
        across,
        origin: [a[0][0], a[0][1]],
        inverseWidth: 1 / (a[2][along] - a[0][along]),
        inverseHeight: 1 / (b[0][across] - a[0][across]),
        c: [a[0][2], 2 * (a[1][2] - a[0][2]), a[0][2] - 2 * a[1][2] + a[2][2], d[0], 2 * (d[1] - d[0]), d[0] - 2 * d[1] + d[2]],
        box: [Math.min(a[0][0], a[2][0], b[0][0], b[2][0]), Math.min(a[0][1], a[2][1], b[0][1], b[2][1]), Math.max(a[0][0], a[2][0], b[0][0], b[2][0]), Math.max(a[0][1], a[2][1], b[0][1], b[2][1])]
      };
    });
    const { candidates: candidates2 } = gridForBoxes(bounds, curves.map((p) => p.box));
    return { query: (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < bounds[0] - 1e-12 || x > bounds[2] + 1e-12 || y < bounds[1] - 1e-12 || y > bounds[3] + 1e-12) return null;
      for (const index of candidates2(x, y)) {
        const p = curves[index], u = ((p.along === 0 ? x : y) - p.origin[p.along]) * p.inverseWidth, v = ((p.across === 0 ? x : y) - p.origin[p.across]) * p.inverseHeight;
        if (u < -1e-12 || u > 1 + 1e-12 || v < -1e-12 || v > 1 + 1e-12) continue;
        const c = p.c, gradient = [0, 0];
        gradient[p.along] = (c[1] + 2 * u * c[2] + v * (c[4] + 2 * u * c[5])) * p.inverseWidth;
        gradient[p.across] = (c[3] + u * (c[4] + u * c[5])) * p.inverseHeight;
        return { height: c[0] + u * (c[1] + u * c[2]) + v * (c[3] + u * (c[4] + u * c[5])), gradient, patch: index, u, v, kind: "quadratic-ruled" };
      }
      return null;
    } };
  }
  const faces = model.patches.map((value2, index) => {
    const p = value2, degree2 = p.degree;
    const [a, b, c] = [0, degree2 * (degree2 + 1) / 2, (degree2 + 1) * (degree2 + 2) / 2 - 1].map((i) => model.points[p.nodes[i]]);
    const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1], det = bx * cy - by * cx;
    return {
      a: [a[0], a[1]],
      inverse: [cy / det, -cx / det, -by / det, bx / det],
      c: coefficients(model, p),
      index,
      box: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1])]
    };
  });
  const { candidates } = gridForBoxes(bounds, faces.map((f) => f.box));
  const degree = model.patches[0].degree;
  return { query: (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < bounds[0] - 1e-12 || x > bounds[2] + 1e-12 || y < bounds[1] - 1e-12 || y > bounds[3] + 1e-12) return null;
    for (const i of candidates(x, y)) {
      const f = faces[i], dx = x - f.a[0], dy = y - f.a[1], inverse = f.inverse;
      const u = dx * inverse[0] + dy * inverse[1], v = dx * inverse[2] + dy * inverse[3];
      if (u < -1e-12 || v < -1e-12 || u + v > 1 + 1e-12) continue;
      const c = f.c;
      const height = degree === 2 ? c[0] + u * (c[1] + u * c[3] + v * c[4]) + v * (c[2] + v * c[5]) : c[0] + u * (c[1] + u * (c[3] + u * c[6]) + v * (c[4] + u * c[7] + v * c[8])) + v * (c[2] + v * (c[5] + v * c[9]));
      const du = degree === 2 ? c[1] + 2 * c[3] * u + c[4] * v : c[1] + 2 * c[3] * u + c[4] * v + 3 * c[6] * u * u + 2 * c[7] * u * v + c[8] * v * v;
      const dv = degree === 2 ? c[2] + c[4] * u + 2 * c[5] * v : c[2] + c[4] * u + 2 * c[5] * v + c[7] * u * u + 2 * c[8] * u * v + 3 * c[9] * v * v;
      return { height, gradient: [du * inverse[0] + dv * inverse[2], du * inverse[1] + dv * inverse[3]], patch: i, u, v, kind: "lagrange-triangle" };
    }
    return null;
  } };
}
export {
  prepareOrderQuery
};
