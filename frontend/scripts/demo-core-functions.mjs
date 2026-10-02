import { build } from "esbuild";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// A read-only, reproducible example using the current saved Bristol project.
// The bundle is only a temporary executable cache; the city archive is never written.
const cache = new URL("../node_modules/.cache/gugis-examples/", import.meta.url);
await mkdir(cache, { recursive: true });
await build({
  stdin: {
    contents: `export { decodeCity, encodeCity } from "./cityArchive.ts";
      export { analyzePath } from "./terrainAnalysis.ts";
      export { queryCityPoint, analyzeCitySection } from "./spatialAnalysis.ts";
      export { traceCityObject } from "./sectionTrace.ts";`,
    resolveDir: fileURLToPath(new URL("../src/studio/", import.meta.url)),
    sourcefile: "demo-core-entry.ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: fileURLToPath(new URL("core.mjs", cache)),
});
const { decodeCity, encodeCity, analyzePath, queryCityPoint, analyzeCitySection, traceCityObject } =
  await import(pathToFileURL(fileURLToPath(new URL("core.mjs", cache))).href);

const archive = JSON.parse(await readFile(new URL("../../.local/city/current.gugis.json", import.meta.url), "utf8"));
const city = decodeCity(archive);
const plaza = city.environment?.features.find(item => item.id === "function_plaza");
if (!plaza || !city.environment?.terrain) throw new Error("Current project needs its plaza and terrain example");

// One native point query reaches terrain topology, nearby semantic objects and roads.
const point = { longitude: plaza.longitude, latitude: plaza.latitude, altitude: 0 };
const query = queryCityPoint(city, point, 100, { id: plaza.id, layer: plaza.layer });

// The profile reads native terrain. The corridor adds objects; selecting one
// object computes the finite vertical plane's intersection with its triangles.
const route = [
  { longitude: -2.6098, latitude: 51.4535, altitude: 0 },
  point,
  { longitude: -2.6084, latitude: 51.4538, altitude: 0 },
];
const profile = analyzePath(route, city.environment.terrain);
const corridor = analyzeCitySection(city, route, profile, 30);
const trace = traceCityObject(city, route, plaza.id);

// Re-encode and decode in memory to demonstrate that instances, terrain,
// function parameters and semantic nodes survive a complete GUGIS round-trip.
const restored = decodeCity(encodeCity(city));
const report = {
  city: { name: city.name, version: archive.version, buildings: city.instances.length,
    models: Object.keys(city.assets).length, roads: city.roads.length,
    geometryLibraryRecords: Object.keys(archive.geometry_library ?? {}).length },
  functionExample: { instance: plaza.id, definition: plaza.asset,
    components: city.environment.feature_assets[plaza.asset].components.map(component => ({
      name: component.category, function: component.function, parameters: component.parameters,
    })) },
  terrain: { name: city.environment.terrain.name, verticalDatum: city.environment.terrain.vertical_datum,
    nativePatches: city.environment.terrain.patches.length,
    hit: query.terrain && { patch: query.terrain.patch, kind: query.terrain.kind,
      height: +query.terrain.height.toFixed(2), slope: +query.terrain.slope.toFixed(2) } },
  analysis: { routeMetres: +profile.horizontalDistance.toFixed(1),
    terrainCoverage: +profile.coverage.toFixed(3), corridorMetres: corridor.width,
    selectedObjects: corridor.objects.length, modelIntersectionSegments: trace.segments.length,
    intersectionUnavailable: trace.unavailable ?? null },
  inMemoryRoundTrip: {
    buildingsPreserved: restored.instances.length === city.instances.length,
    terrainPatchesPreserved: restored.environment?.terrain?.patches.length === city.environment.terrain.patches.length,
    functionComponentsPreserved: restored.environment?.feature_assets[plaza.asset]?.components.length ===
      city.environment.feature_assets[plaza.asset].components.length,
  },
};
console.log(JSON.stringify(report, null, 2));
