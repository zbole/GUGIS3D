import { build } from "esbuild";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

// Read-only local benchmark for the existing city. It reports GUGIS timings;
// a claim against another GIS requires the same data and hardware there too.
const dir = new URL("../node_modules/.cache/gugis-tests/city-section-benchmark/", import.meta.url);
await mkdir(dir, { recursive: true });
await build({ stdin: { contents: `export {decodeCity} from './cityArchive.ts';
  export {analyzePath} from './terrainAnalysis.ts';
  export {queryCityPoint,analyzeCitySection} from './spatialAnalysis.ts';
  export {traceCityObject} from './sectionTrace.ts';`,
  resolveDir: fileURLToPath(new URL("../src/studio/", import.meta.url)), sourcefile: "benchmark-entry.ts" },
  bundle: true, platform: "node", format: "esm", packages: "external",
  outfile: fileURLToPath(new URL("benchmark.mjs", dir)) });
const { decodeCity, analyzePath, queryCityPoint, analyzeCitySection, traceCityObject } =
  await import(pathToFileURL(fileURLToPath(new URL("benchmark.mjs", dir))).href);
const raw = JSON.parse(await readFile(new URL("../../.local/city/current.gugis.json", import.meta.url), "utf8"));
const city = decodeCity(raw);
const route = [
  { longitude: -2.6098, latitude: 51.4535, altitude: 0 },
  { longitude: -2.6091, latitude: 51.4538, altitude: 0 },
  { longitude: -2.6084, latitude: 51.4538, altitude: 0 },
];
const profile = analyzePath(route, city.environment?.terrain);
const begin = performance.now();
const query = queryCityPoint(city, route[1]);
const queryColdMs = performance.now() - begin;
const sectionStart = performance.now();
const section = analyzeCitySection(city, route, profile, 30);
const sectionColdMs = performance.now() - sectionStart;
const times = [];
for (let i = 0; i < 10; i++) {
  const start = performance.now();
  queryCityPoint(city, route[1]);
  analyzeCitySection(city, route, profile, 30);
  times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
const traceBuilding = city.instances.find(item => city.assets[item.asset]?.nodes.some(node => node.template && node.position)
  && queryCityPoint(city, { longitude: item.longitude, latitude: item.latitude, altitude: 0 }, 1).terrain);
let traceMs = null, traceSegments = null, traceUnavailable = null;
if (traceBuilding) {
  const routeThroughBuilding = [
    { longitude: traceBuilding.longitude - .0007, latitude: traceBuilding.latitude, altitude: 0 },
    { longitude: traceBuilding.longitude + .0007, latitude: traceBuilding.latitude, altitude: 0 },
  ];
  const start = performance.now();
  const trace = traceCityObject(city, routeThroughBuilding, traceBuilding.id);
  traceMs = +(performance.now() - start).toFixed(1);
  traceSegments = trace.segments.length;
  traceUnavailable = trace.unavailable ?? null;
}
console.log(JSON.stringify({ buildings: city.instances.length, features: city.environment?.features.length ?? 0,
  terrainPatches: city.environment?.terrain?.patches.length ?? 0,
  queryColdMs: +queryColdMs.toFixed(1), sectionColdMs: +sectionColdMs.toFixed(1),
  combinedMedianMs: +times[5].toFixed(1), combinedMaxMs: +times.at(-1).toFixed(1),
  nearbyBuildings: query.buildings.length, nearbyFeatures: query.features.length,
  sectionBuildings: section.buildings, sectionSurface: section.surface, sectionUnderground: section.underground,
  traceBuilding: traceBuilding?.id ?? null, traceMs, traceSegments, traceUnavailable }, null, 2));
