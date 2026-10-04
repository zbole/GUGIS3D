/** Same native kernel as the site; timing is Node CPU, not browser/ArcGIS. */
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
const directory = resolve(process.argv[2]);
const cache = fileURLToPath(new URL("../node_modules/.cache/gugis-examples/", import.meta.url));
await mkdir(cache, { recursive: true });
const outfile = join(cache, "research-terrain.mjs");
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/terrainMath.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", outfile });
const { terrainIndex } = await import(pathToFileURL(outfile).href);
const fixture = JSON.parse(await readFile(join(directory, "query-fixture.json"), "utf8"));
const reports = [];
for (const stride of [2, 4, 8, 16, 32, 64]) {
  const terrain = JSON.parse(await readFile(join(directory, `gugis-${stride}m.json`), "utf8"));
  const started = performance.now(), index = terrainIndex(terrain), indexMs = performance.now() - started;
  const run = () => fixture.query.map(([row, col]) => index.query(col * 499.5, -row * 499.5)?.height ?? null);
  run();
  const times = [];
  let values;
  for (let repetition = 0; repetition < 5; repetition++) {
    const start = performance.now(); values = run(); times.push(performance.now() - start);
  }
  const probeValues = fixture.probes.map(([row, col]) => index.query(col - 499.5, 499.5 - row)?.height ?? null);
  const outside = [[-500,0],[500,0],[0,-500],[0,500]].map(([x,y]) => index.query(x,y));
  if (outside.some(Boolean) || values.some(value => value === null) || probeValues.some(value => value === null))
    throw new Error(`Native coverage failed for ${stride} m`);
  reports.push({ id: `gugis-${stride}m`, index_ms: indexMs, query_repetitions_ms: times, query_count: fixture.query.length, values, probe_values: probeValues });
  console.log(JSON.stringify({ id: `gugis-${stride}m`, index_ms: indexMs, query_repetitions_ms: times }));
}
await writeFile(join(directory, "native-queries.json"), JSON.stringify({ runtime: process.version, kernel: "frontend/src/studio/terrainMath.ts:terrainIndex.query", reports }));
