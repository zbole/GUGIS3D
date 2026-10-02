/** Publish a compact, versioned snapshot without putting the full city in the landing bundle. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cityPath = fileURLToPath(new URL("../../.local/city/current.gugis.json", import.meta.url));
const memoryPath = fileURLToPath(new URL("../../shared/current-city-memory-benchmark.json", import.meta.url));
const terrainPath = fileURLToPath(new URL("../../shared/terrain-multipatch-benchmark.json", import.meta.url));
const outputPath = fileURLToPath(new URL("../../shared/compare-evidence.json", import.meta.url));
const content = readFileSync(cityPath);
const revision = createHash("sha256").update(content).digest("hex");
const city = JSON.parse(content);
const memory = JSON.parse(readFileSync(memoryPath, "utf8"));
const terrainBenchmark = JSON.parse(readFileSync(terrainPath, "utf8"));
const terrainSuite = JSON.parse(readFileSync(fileURLToPath(new URL("../../shared/terrain-comparison-suite.json", import.meta.url)), "utf8"));
if (memory.file_sha256 !== revision) {
  throw new Error("The memory benchmark belongs to a different city snapshot; rerun city-memory.mjs first.");
}
if (terrainBenchmark.cityRevision !== revision) {
  throw new Error("The terrain MultiPatch benchmark belongs to a different city snapshot; rerun benchmark_terrain.py first.");
}
if (terrainSuite.cityRevision !== revision || terrainSuite.variants.find(v => v.ruledSubdivisions === 2)?.multipatchFilesBytes !== terrainBenchmark.multipatchFilesBytes) {
  throw new Error("The multi-resolution suite differs from the displayed terrain snapshot; rerun benchmark_terrain_suite.py first.");
}
const sample = memory.measurements.shared.samples[0];
if (sample.instances !== city.instances.length) {
  throw new Error("The benchmark instance count differs from the saved city.");
}
const demo = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("./demo-core-functions.mjs", import.meta.url))], {
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  windowsHide: true,
}));
if (demo.city.buildings !== city.instances.length || !Object.values(demo.inMemoryRoundTrip).every(Boolean)) {
  throw new Error("The core-function example did not validate this city snapshot.");
}
const evidence = {
  revision,
  archive: "布里斯托起始街区（并非整座城市）",
  city: {
    buildings: city.instances.length,
    modelDefinitions: Object.keys(city.assets).length,
    roads: city.roads.length,
    geometryLibraryRecords: Object.keys(city.geometry_library ?? {}).length,
    terrainPatches: city.environment?.terrain?.patches?.length ?? 0,
    functionFeatures: city.environment?.features?.length ?? 0,
    placedComponents: sample.component_instances,
  },
  provenance: {
    scope: city.metadata?.["范围"] ?? "",
    terrainFile: city.environment?.terrain?.source?.["文件"] ?? "",
    terrainAccuracy: city.environment?.terrain?.source?.["误差说明"] ?? "",
  },
  memory: {
    method: memory.method,
    runs: memory.runs,
    runtime: memory.runtime,
    sharedBytes: memory.measurements.shared.median_bytes,
    independentWireBytes: memory.measurements.wire.median_bytes,
    independentMeshBytes: memory.measurements.mesh.median_bytes,
    wireSavingPercent: memory.saving_percent.wire,
    meshSavingPercent: memory.saving_percent.mesh,
  },
  terrainBenchmark,
  terrainSuiteBundleId: terrainSuite.bundleId,
  analysis: demo.analysis,
  roundTripPassed: demo.inMemoryRoundTrip,
};
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(`${outputPath}\n${revision}\n${city.instances.length} buildings; ${memory.saving_percent.wire.toFixed(2)}% vs independent point-and-line baseline`);
