/** Read-only fixture using the same native query kernel as the website. */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const cache = new URL("../node_modules/.cache/gugis-examples/", import.meta.url);
await mkdir(cache, { recursive: true });
const outfile = fileURLToPath(new URL("terrain-comparison.mjs", cache));
await build({
  entryPoints: [fileURLToPath(new URL("../src/studio/terrainMath.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", outfile,
});
const { terrainIndex, ruledPoint, terrainStatistics } = await import(pathToFileURL(outfile).href);
const content = await readFile(process.argv[2] ?? new URL("../../.local/city/current.gugis.json", import.meta.url));
const terrain = JSON.parse(content).environment?.terrain;
if (!terrain) throw new Error("The project has no terrain to compare");
const index = terrainIndex(terrain);
const bounds = terrain.points.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]),
  Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const point = (id, x, y, extra = {}) => {
  const hit = index.query(x, y);
  return { id, x, y, height: hit?.height ?? null, patch: hit?.patch ?? null,
    kind: hit?.kind ?? null, slope: hit?.slope ?? null, aspect: hit?.aspect ?? null,
    nativeOnEdge: hit ? (Math.min(hit.u, hit.v) < 1e-7 || (hit.kind === "ruled-strip"
      ? Math.max(hit.u, hit.v) > 1 - 1e-7 : hit.u + hit.v > 1 - 1e-7)) : null, ...extra };
};
const points = [];
for (let row = 0; row < 41; row++) for (let col = 0; col < 41; col++) {
  points.push(point(`q${points.length}`, bounds[0] + (col + .37) / 41 * (bounds[2] - bounds[0]),
    bounds[1] + (row + .61) / 41 * (bounds[3] - bounds[1])));
}
// Four explicit out-of-domain probes must remain NoData in both expressions.
for (const [x, y] of [[bounds[0] - 10, bounds[1]], [bounds[2] + 10, bounds[3]],
  [bounds[0], bounds[1] - 10], [bounds[2], bounds[3] + 10]]) points.push(point(`q${points.length}`, x, y));
const atFraction = (x, y) => [bounds[0] + x * (bounds[2] - bounds[0]), bounds[1] + y * (bounds[3] - bounds[1])];
const route = [atFraction(.13, .18), atFraction(.43, .71), atFraction(.87, .78)];
const lengths = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
const total = lengths.reduce((a, b) => a + b, 0);
const distances = [...new Set([...Array.from({ length: 241 }, (_, i) => total * i / 240), lengths[0]])].sort((a, b) => a - b);
const cityProfile = distances.map((distance, i) => {
  const segment = distance <= lengths[0] ? 0 : 1, start = segment ? lengths[0] : 0;
  const t = (distance - start) / lengths[segment], a = route[segment], b = route[segment + 1];
  return point(`city${i}`, a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), { distance });
});
let worst = null;
for (const patch of terrain.patches.filter(p => p.kind === "ruled-strip")) {
  for (let i = 0; i < patch.left.length - 1; i++) {
    const corners = [patch.left[i], patch.right[i], patch.left[i + 1], patch.right[i + 1]].map(j => terrain.points[j]);
    const delta = Math.abs(corners[0][2] - corners[1][2] - corners[2][2] + corners[3][2]);
    if (!worst || delta > worst.delta) worst = { patch: patch.id, corners, delta };
  }
}
const cellProfile = [];
if (worst) {
  let distance = 0, previous;
  for (let i = 0; i <= 80; i++) {
    const t = .01 + .98 * i / 80;
    const p = ruledPoint(...worst.corners, t, t);
    if (previous) distance += Math.hypot(p[0] - previous[0], p[1] - previous[1]);
    cellProfile.push(point(`cell${i}`, p[0], p[1], { distance }));
    previous = p;
  }
}
console.log(JSON.stringify({ schema: "gugis-terrain-query-fixture-v1",
  cityRevision: createHash("sha256").update(content).digest("hex"),
  nativeKernel: "frontend/src/studio/terrainMath.ts:terrainIndex.query",
  statistics: terrainStatistics(terrain), boundsENU: bounds, points,
  profiles: [{ id: "city", name: "街区路线", points: cityProfile },
    { id: "cell", name: "最大扭曲区段", points: cellProfile }].filter(p => p.points.length),
  worstRuledCell: worst,
}));
