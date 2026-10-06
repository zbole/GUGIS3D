// workspace-source:C:\Users\Bole Zhang\Documents\Codex\2026-09-08\w\GUGIS3D-DOT-2026-10-03\frontend\src\compare\curvedRuledMath.ts
function bezierPoint(points, u) {
  return [0, 1, 2].map((k) => (1 - u) ** 2 * points[0][k] + 2 * u * (1 - u) * points[1][k] + u * u * points[2][k]);
}
function triangleFaces(patch) {
  return Array.from({ length: patch.indices.length - 2 }, (_, i) => {
    const [a, b, c] = patch.indices.slice(i, i + 3);
    return i % 2 ? [a, c, b] : [a, b, c];
  });
}
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
function curveQuery(model, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (let index = 0; index < model.patches.length; index++) {
    const p = model.patches[index];
    if (p.kind === "quadratic-ruled") {
      const a = model.points[p.left[0]], c = model.points[p.left[2]], b = model.points[p.right[0]];
      const along = Math.abs(c[0] - a[0]) > 1e-8 ? 0 : 1, across = 1 - along, xy = [x, y];
      const u = (xy[along] - a[along]) / (c[along] - a[along]), v = (xy[across] - a[across]) / (b[across] - a[across]);
      if (u >= -1e-12 && u <= 1 + 1e-12 && v >= -1e-12 && v <= 1 + 1e-12) {
        const left = p.left.map((i) => model.points[i]), right = p.right.map((i) => model.points[i]);
        const aa = bezierPoint(left, u), bb = bezierPoint(right, u);
        const du = (q) => 2 * (1 - u) * (q[1][2] - q[0][2]) + 2 * u * (q[2][2] - q[1][2]);
        const gradients = [0, 0];
        gradients[along] = ((1 - v) * du(left) + v * du(right)) / (c[along] - a[along]);
        gradients[across] = (bb[2] - aa[2]) / (b[across] - a[across]);
        return { height: aa[2] * (1 - v) + bb[2] * v, patch: index, u, v, gradient: gradients, kind: p.kind };
      }
    } else for (const face of triangleFaces(p)) {
      const [a, b, c] = face.map((i) => model.points[i]);
      const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1], det = bx * cy - by * cx;
      if (Math.abs(det) < 1e-12) continue;
      const u = ((x - a[0]) * cy - (y - a[1]) * cx) / det, v = (bx * (y - a[1]) - by * (x - a[0])) / det;
      if (u >= -1e-12 && v >= -1e-12 && u + v <= 1 + 1e-12) return {
        height: a[2] + u * (b[2] - a[2]) + v * (c[2] - a[2]),
        patch: index,
        u,
        v,
        gradient: [((b[2] - a[2]) * cy - (c[2] - a[2]) * by) / det, (bx * (c[2] - a[2]) - cx * (b[2] - a[2])) / det],
        kind: p.kind
      };
    }
  }
  return null;
}

// workspace-source:C:\Users\Bole Zhang\Documents\Codex\2026-09-08\w\GUGIS3D-DOT-2026-10-03\frontend/src/compare/terrainOrderMath.ts
function nodeOrders(degree) {
  if (degree !== 2 && degree !== 3) throw new Error("\u4EC5\u652F\u6301\u4E8C\u6B21\u6216\u4E09\u6B21\u7814\u7A76\u4E09\u89D2\u9762");
  const result = [];
  for (let a = degree; a >= 0; a--) for (let b = degree - a; b >= 0; b--) result.push([a, b, degree - a - b]);
  return result;
}
function lagrangeBasis(lambda, degree) {
  return nodeOrders(degree).map((alpha) => {
    const factors = alpha.map((n, axis) => {
      const f = Array.from({ length: n }, (_, j) => (degree * lambda[axis] - j) / (n - j));
      const val = f.reduce((a, b) => a * b, 1);
      const derivative = f.reduce((sum, _, j) => sum + degree / (n - j) * f.reduce((product, z, k) => product * (k === j ? 1 : z), 1), 0);
      return { val, derivative };
    });
    return { value: factors.reduce((a, b) => a * b.val, 1), derivative: factors.map((f, j) => f.derivative * factors.reduce((product, z, k) => product * (k === j ? 1 : z.val), 1)) };
  });
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
function decodeOrderBinary(bytes) {
  if (bytes.byteLength < 16 || bytes.byteLength > 1024 * 1024) throw new Error("\u9636\u6570\u4E8C\u8FDB\u5236\u6863\u6848\u957F\u5EA6\u65E0\u6548");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const u = () => {
    if (offset + 4 > bytes.byteLength) throw new Error("\u9636\u6570\u4E8C\u8FDB\u5236\u6863\u6848\u4E0D\u5B8C\u6574");
    const n = v.getUint32(offset, true);
    offset += 4;
    return n;
  };
  if (String.fromCharCode(...bytes.slice(0, 4)) !== "GOC2") throw new Error("\u9636\u6570\u4E8C\u8FDB\u5236\u6807\u8BB0\u65E0\u6548");
  offset = 4;
  const version = u(), np = u(), nk = u();
  if (version !== 2 || np < 3 || np > 2e4 || nk < 1 || nk > 8192 || np * 24 > bytes.byteLength - offset) throw new Error("\u9636\u6570\u4E8C\u8FDB\u5236\u5BB9\u91CF\u65E0\u6548");
  const points = [];
  for (let i = 0; i < np; i++) {
    const p = [0, 1, 2].map(() => {
      const n = v.getFloat64(offset, true);
      offset += 8;
      return n;
    });
    points.push(p);
  }
  const patches = [];
  for (let i = 0; i < nk; i++) {
    const kind = u(), degree = u(), count = u();
    if (!(kind === 1 && degree === 2 && count === 6 || kind === 2 && (degree === 2 || degree === 3) && count === (degree + 1) * (degree + 2) / 2)) throw new Error("\u9636\u6570\u4E8C\u8FDB\u5236\u9762\u7247\u6807\u8BB0\u65E0\u6548");
    const nodes = Array.from({ length: count }, () => u());
    patches.push(kind === 1 ? { kind: "quadratic-ruled", left: nodes.slice(0, 3), right: nodes.slice(3) } : { kind: "lagrange-triangle", degree, nodes });
  }
  if (offset !== bytes.byteLength) throw new Error("\u9636\u6570\u4E8C\u8FDB\u5236\u5B58\u5728\u591A\u4F59\u6570\u636E");
  return validateOrderModel({ format: "gugis-research-surface", version: 2, coordinate_system: "LOCAL_METERS", points, patches });
}
var indices = /* @__PURE__ */ new WeakMap();
function indexModel(model) {
  const old = indices.get(model);
  if (old) return old;
  const bounds = [Math.min(...model.points.map((p) => p[0])), Math.min(...model.points.map((p) => p[1])), Math.max(...model.points.map((p) => p[0])), Math.max(...model.points.map((p) => p[1]))];
  const cell = (x, axis) => Math.max(0, Math.min(31, Math.floor((x - bounds[axis]) * 32 / (bounds[axis + 2] - bounds[axis]))));
  const cells = /* @__PURE__ */ new Map();
  for (let i = 0; i < model.patches.length; i++) {
    const verts = vertices(model, model.patches[i]);
    const xmin = cell(Math.min(...verts.map((v) => v[0])), 0), xmax = cell(Math.max(...verts.map((v) => v[0])), 0);
    const ymin = cell(Math.min(...verts.map((v) => v[1])), 1), ymax = cell(Math.max(...verts.map((v) => v[1])), 1);
    for (let x = xmin; x <= xmax; x++) for (let y = ymin; y <= ymax; y++) {
      const key = x + 32 * y, list = cells.get(key) ?? [];
      list.push(i);
      cells.set(key, list);
    }
  }
  const index = { bounds, cells };
  indices.set(model, index);
  return index;
}
function orderQuery(model, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (model.patches[0].kind === "quadratic-ruled") return curveQuery({ ...model, version: 1 }, x, y);
  const { bounds, cells } = indexModel(model);
  if (x < bounds[0] - 1e-12 || x > bounds[2] + 1e-12 || y < bounds[1] - 1e-12 || y > bounds[3] + 1e-12) return null;
  const bx = Math.max(0, Math.min(31, Math.floor((x - bounds[0]) * 32 / (bounds[2] - bounds[0])))), by = Math.max(0, Math.min(31, Math.floor((y - bounds[1]) * 32 / (bounds[3] - bounds[1]))));
  for (const index of cells.get(bx + 32 * by) ?? []) {
    const p = model.patches[index], [a, b, c] = vertices(model, p), bb = [b[0] - a[0], b[1] - a[1]], cc = [c[0] - a[0], c[1] - a[1]], det = bb[0] * cc[1] - bb[1] * cc[0];
    const u = ((x - a[0]) * cc[1] - (y - a[1]) * cc[0]) / det, v = (bb[0] * (y - a[1]) - bb[1] * (x - a[0])) / det;
    if (u < -1e-12 || v < -1e-12 || u + v > 1 + 1e-12) continue;
    const basis = lagrangeBasis([1 - u - v, u, v], p.degree), derivative = [0, 0, 0];
    let height = 0;
    for (let j = 0; j < basis.length; j++) {
      const z = model.points[p.nodes[j]][2];
      height += z * basis[j].value;
      for (let k = 0; k < 3; k++) derivative[k] += z * basis[j].derivative[k];
    }
    const du = derivative[1] - derivative[0], dv = derivative[2] - derivative[0];
    return { height, gradient: [(du * cc[1] - dv * bb[1]) / det, (dv * bb[0] - du * cc[0]) / det], patch: index, u, v, kind: p.kind };
  }
  return null;
}
export {
  decodeOrderBinary,
  lagrangeBasis,
  nodeOrders,
  orderQuery,
  validateOrderModel
};
