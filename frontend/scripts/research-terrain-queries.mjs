/** Same native kernel as the site; timing is Node CPU, not browser/ArcGIS. */
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve, join } from "node:path";
const directory = resolve(process.argv[2]);
const offgrid = process.argv.includes('--offgrid');
const cache = fileURLToPath(new URL("../node_modules/.cache/gugis-examples/", import.meta.url));
await mkdir(cache, { recursive: true });
const outfile = join(cache, "research-terrain.mjs");
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/terrainMath.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", outfile });
const { terrainIndex } = await import(pathToFileURL(outfile).href);
const fixtureBytes = await readFile(join(directory, offgrid ? 'offgrid-fixture.json' : 'query-fixture.json'));
const fixture = JSON.parse(fixtureBytes);
const reports = [];
for (const stride of [2, 4, 8, 16, 32, 64]) {
  const archiveBytes = await readFile(join(directory, `gugis-${stride}m.json`));
  const terrain = JSON.parse(archiveBytes);
  const started = performance.now(), index = terrainIndex(terrain), indexMs = performance.now() - started;
  const run = () => offgrid ? fixture.xy.map(([x,y])=>index.query(x,y)?.height ?? null)
    : fixture.query.map(([row, col]) => index.query(col * 499.5, -row * 499.5)?.height ?? null);
  run();
  const times = [];
  let values;
  for (let repetition = 0; repetition < 5; repetition++) {
    const start = performance.now(); values = run(); times.push(performance.now() - start);
  }
  const probeValues = (fixture.probes ?? []).map(([row, col]) => index.query(col - 499.5, 499.5 - row)?.height ?? null);
  const outside = [[-500,0],[500,0],[0,-500],[0,500]].map(([x,y]) => index.query(x,y));
  if (outside.some(Boolean) || values.some(value => value === null) || probeValues.some(value => value === null))
    throw new Error(`Native coverage failed for ${stride} m`);
  reports.push({ id: `gugis-${stride}m`, index_ms: indexMs, query_repetitions_ms: times,
    query_count: (offgrid ? fixture.xy : fixture.query).length, values, probe_values: probeValues,
    ...(offgrid ? {archive_sha256:createHash('sha256').update(archiveBytes).digest('hex'),
      fixture_sha256:createHash('sha256').update(fixtureBytes).digest('hex')} : {}) });
  console.log(JSON.stringify({ id: `gugis-${stride}m`, index_ms: indexMs, query_repetitions_ms: times }));
}
await writeFile(join(directory, offgrid ? 'offgrid-native-queries.json' : 'native-queries.json'), JSON.stringify({ runtime: process.version, kernel: "frontend/src/studio/terrainMath.ts:terrainIndex.query", reports }));
