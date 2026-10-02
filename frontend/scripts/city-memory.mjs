/** Retained data-heap benchmark. This does not measure a browser tab or GPU. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { decodeCity } from "../src/studio/cityArchive.ts";
import topology from "../../shared/box-topology.json" with { type: "json" };

const boxEdges = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

export function meshFor(solid) {
  if (solid.kind === "mesh")
    return { vertices: solid.vertices, triangles: solid.triangles };
  const bounds = solid.size
    .map((v) => -v / 2)
    .concat(solid.size.map((v) => v / 2));
  return {
    vertices: topology.corners.map((corner) => corner.map((i) => bounds[i])),
    triangles: topology.triangles,
  };
}

/** Keep boundary/crease edges; omit coplanar triangulation diagonals in wireframes. */
export function boundaryEdges(mesh) {
  const edges = new Map();
  for (const face of mesh.triangles) {
    const [a, b, c] = face.map((i) => mesh.vertices[i]);
    const u = b.map((v, i) => v - a[i]),
      v = c.map((v, i) => v - a[i]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    const length = Math.hypot(...normal);
    const unit = normal.map((n) => n / length);
    for (let j = 0; j < 3; j++) {
      const pair = [face[j], face[(j + 1) % 3]].sort((a, b) => a - b),
        key = pair.join(",");
      if (!edges.has(key)) edges.set(key, { pair, normals: [] });
      edges.get(key).normals.push(unit);
    }
  }
  return [...edges.values()]
    .filter(
      ({ normals }) =>
        normals.length !== 2 ||
        normals[0].reduce((sum, n, i) => sum + n * normals[1][i], 0) <
          1 - 1e-12,
    )
    .map((e) => e.pair);
}

/** No shared geometry arrays survive in the baseline: each placed component owns its points. */
export function expandCity(city, mode) {
  if (!["wire", "mesh", "edges_faces"].includes(mode))
    throw new Error("Unknown baseline mode");
  const edgeCache = new WeakMap();
  function expand(solid, node) {
    const mesh = meshFor(solid),
      angle = ((node?.rotation_z ?? 0) * Math.PI) / 180;
    const c = Math.cos(angle),
      s = Math.sin(angle),
      p = node?.position ?? [0, 0, 0];
    const result = {
      color: solid.color,
      vertices: mesh.vertices.map(([x, y, z]) => [
        x * c - y * s + p[0],
        x * s + y * c + p[1],
        z + p[2],
      ]),
    };
    if (mode !== "mesh") {
      let edges =
        solid.kind === "box" ? boxEdges : edgeCache.get(mesh.vertices);
      if (!edges) {
        edges = boundaryEdges(mesh);
        edgeCache.set(mesh.vertices, edges);
      }
      result.edges = edges.map((e) => [...e]);
    }
    if (mode !== "wire") result.triangles = mesh.triangles.map((t) => [...t]);
    return result;
  }
  const assets = {};
  for (const item of city.instances) {
    const { templates, overview, nodes, ...rest } = city.assets[item.asset];
    assets[item.id] = {
      ...rest,
      nodes: nodes.map((node) => {
        if (!node.template) return { ...node };
        const { template, position, rotation_z, ...semantic } = node;
        return { ...semantic, solid: expand(templates[template], node) };
      }),
      ...(overview
        ? {
            overview: Object.fromEntries(
              Object.entries(overview).map(([id, s]) => [id, expand(s)]),
            ),
          }
        : {}),
    };
  }
  return {
    ...city,
    format: "gugis-memory-baseline",
    geometry_space: "building_local",
    assets,
    instances: city.instances.map((i) => ({ ...i, asset: i.id })),
  };
}

export function numericPayload(document, shared) {
  const seen = new Set();
  let vertices = 0,
    edges = 0,
    triangles = 0,
    sizes = 0,
    transforms = 0,
    references = 0,
    colors = 0,
    components = 0;
  function vectors(array, type) {
    if (!array || seen.has(array)) return;
    seen.add(array);
    if (type === "vertex") vertices += array.length;
    if (type === "edge") edges += array.length;
    if (type === "triangle") triangles += array.length;
  }
  function solid(s) {
    if (s.size) sizes += 3;
    vectors(s.vertices, "vertex");
    vectors(s.edges, "edge");
    vectors(s.triangles, "triangle");
    colors++;
  }
  for (const doc of Object.values(document.assets)) {
    if (shared) for (const s of Object.values(doc.templates)) solid(s);
    for (const s of Object.values(doc.overview ?? {})) solid(s);
    for (const node of doc.nodes) {
      if (node.template) {
        transforms += 4;
        references++;
        components++;
      }
      if (node.solid) {
        solid(node.solid);
        components++;
      }
    }
  }
  // Explicit fixed-width representation, not the sizes of JavaScript objects.
  const coordinates_bytes = vertices * 3 * 8,
    edge_indices_bytes = edges * 2 * 4,
    face_indices_bytes = triangles * 3 * 4;
  return {
    vertices,
    edges,
    triangles,
    local_component_records: components,
    coordinates_bytes,
    edge_indices_bytes,
    face_indices_bytes,
    size_bytes: sizes * 8,
    transform_bytes: transforms * 8,
    reference_bytes: references * 4,
    color_bytes: colors * 4,
    bytes:
      coordinates_bytes +
      edge_indices_bytes +
      face_indices_bytes +
      sizes * 8 +
      transforms * 8 +
      references * 4 +
      colors * 4,
  };
}

function gc() {
  for (let i = 0; i < 3; i++) global.gc();
}
function memory() {
  const m = process.memoryUsage();
  return { heap: m.heapUsed, array_buffers: m.arrayBuffers };
}
function load(path) {
  return decodeCity(JSON.parse(readFileSync(path, "utf8")));
}
function build(path, mode) {
  // The source city and temporary decoding state leave the call stack before GC.
  const city = load(path);
  return mode === "shared" ? city : expandCity(city, mode);
}
function worker(path, mode) {
  if (!global.gc) throw new Error("Run with --expose-gc");
  gc();
  const before = memory();
  const data = build(path, mode);
  gc();
  const after = memory();
  const count = data.instances.reduce(
    (n, i) =>
      n +
      data.assets[i.asset].nodes.filter((n) => n.template || n.solid).length,
    0,
  );
  return {
    mode,
    heap_bytes: after.heap - before.heap,
    array_buffer_bytes: after.array_buffers - before.array_buffers,
    retained_bytes:
      after.heap + after.array_buffers - before.heap - before.array_buffers,
    instances: data.instances.length,
    component_instances: count,
    numeric_payload: numericPayload(data, mode === "shared"),
  };
}

function main() {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      runs: { type: "string", default: "3" },
      worker: { type: "string" },
    },
  });
  if (!values.input) throw new Error("--input is required");
  const input = resolve(values.input);
  if (values.worker) {
    console.log(JSON.stringify(worker(input, values.worker)));
    return;
  }
  if (!values.output) throw new Error("--output is required");
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10)
    throw new Error("Use 1-10 fresh-process repetitions");
  const result = {
    method: "fresh-process-retained-v8-data-heap",
    runtime: process.version,
    platform: process.platform,
    architecture: process.arch,
    file_sha256: createHash("sha256").update(readFileSync(input)).digest("hex"),
    runs,
    assumptions: [
      "Full city geometry and semantic data are loaded; no Cesium, DOM, GPU, history, transient parse strings or archive file bytes included.",
      "Each baseline building and component owns its vertices; indexed edges share vertices within that component. No cross-component or cross-building geometry deduplication.",
      "Wireframes omit coplanar triangulation diagonals using a 1e-12 normal-dot tolerance; a box has 8 vertices and 12 edges.",
      "wire omits faces; mesh has only indexed triangles; edges_faces keeps both edges and triangles.",
      "Shared mode uses the application's actual decodeCity output, including expanded box sets, overview geometry, colors and semantic nodes.",
      "Building georeferencing, roads and provenance are retained in all modes. Component transforms are baked into baseline coordinates in building-local metres.",
      "Retained memory is heapUsed plus arrayBuffers after three forced GCs minus a clean-process baseline. This is not browser process RAM or VRAM.",
      "Numeric payload is an additional fixed-width estimate: Float64 coordinates/transforms, Uint32 indices/references, 4-byte RGBA. It excludes strings, object overhead and common city/semantic fields.",
    ],
    measurements: {},
  };
  for (const mode of ["shared", "wire", "mesh", "edges_faces"]) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      const p = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          "--experimental-strip-types",
          fileURLToPath(import.meta.url),
          "--input",
          input,
          "--worker",
          mode,
        ],
        { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true },
      );
      if (p.status !== 0) throw new Error(p.stderr || String(p.error));
      samples.push(JSON.parse(p.stdout));
    }
    const bytes = samples.map((s) => s.retained_bytes).sort((a, b) => a - b);
    const median =
      bytes.length % 2
        ? bytes[(bytes.length - 1) / 2]
        : (bytes[bytes.length / 2 - 1] + bytes[bytes.length / 2]) / 2;
    result.measurements[mode] = {
      median_bytes: median,
      min_bytes: bytes[0],
      max_bytes: bytes.at(-1),
      samples,
    };
    console.log(
      `${mode}: median ${(median / 1e6).toFixed(2)} MB (${runs} processes)`,
    );
  }
  const shared = result.measurements.shared.median_bytes;
  if (
    createHash("sha256").update(readFileSync(input)).digest("hex") !==
    result.file_sha256
  )
    throw new Error(
      "Input changed during measurement; rerun against a stable city snapshot",
    );
  for (const group of Object.values(result.measurements))
    for (const sample of group.samples)
      if (
        sample.instances !== result.measurements.shared.samples[0].instances ||
        sample.component_instances !==
          result.measurements.shared.samples[0].component_instances
      )
        throw new Error("Baseline lost city instances or components");
  result.saving_percent = Object.fromEntries(
    ["wire", "mesh", "edges_faces"].map((mode) => [
      mode,
      100 * (1 - shared / result.measurements[mode].median_bytes),
    ]),
  );
  const output = resolve(values.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result.saving_percent));
  console.log(output);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
