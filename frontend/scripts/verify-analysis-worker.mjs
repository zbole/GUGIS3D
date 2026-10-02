import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

// This deliberately runs the Vite production artifact. Bundling the source
// again for a unit test would miss vite-plugin-cesium's global rewrites.
const assets = new URL("../dist/assets/", import.meta.url);
let names;
try {
  names = (await readdir(assets)).filter(name => /^analysisWorker-.*\.js$/.test(name));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  throw new Error("Production output is missing. Run npm run build before npm run test:worker.");
}
assert.ok(names.length, "No production analysis worker found. Run npm run build before npm run test:worker.");
const candidates = await Promise.all(names.map(async name => ({
  name, modified: (await stat(new URL(name, assets))).mtimeMs,
})));
candidates.sort((a, b) => b.modified - a.modified);
const asset = new URL(candidates[0].name, assets);
const source = await readFile(asset, "utf8");
assert.ok(!/\bCesium\./.test(source), "Production worker references the page-only Cesium global.");

const bridge = `
  import { parentPort, workerData } from "node:worker_threads";
  import vm from "node:vm";
  // No window, document or Cesium is supplied. These are unavailable in a
  // browser worker; this isolated VM must execute the shipped bundle alone.
  const context = vm.createContext({
    console, URL, URLSearchParams, TextEncoder, TextDecoder, performance,
    setTimeout, clearTimeout, postMessage: value => parentPort.postMessage(value),
  });
  context.self = context;
  vm.runInContext(workerData, context, { filename: "production-analysis-worker.js", timeout: 10000 });
  if (typeof context.onmessage !== "function") throw new Error("Worker did not register a message handler.");
  parentPort.on("message", data => context.onmessage({ data }));
`;
const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(bridge)}`), {
  workerData: source, name: "verify-production-analysis-worker",
});
let pending = null;
let fatal = null;
worker.on("message", message => pending?.finish(null, message));
worker.on("error", error => { fatal = error; pending?.finish(error); });
worker.on("exit", code => {
  if (pending) pending.finish(new Error(`Analysis worker exited before responding (code ${code}).`));
});
function request(data) {
  if (fatal) return Promise.reject(fatal);
  assert.equal(pending, null, "Regression requests run sequentially.");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => pending?.finish(new Error(`Worker request ${data.id} timed out.`)), 10000);
    pending = { finish(error, message) {
      clearTimeout(timer);
      pending = null;
      if (error) reject(error);
      else if (message.id !== data.id) reject(new Error(`Wrong worker response id: ${message.id}.`));
      else resolve(message);
    } };
    worker.postMessage(data);
  });
}

try {
  const terrain = {
    version: "1.0", name: "Production worker fixture", longitude: 0, latitude: 0,
    vertical_datum: "ODN", reference_height: 100, demonstration: true, source: { test: "synthetic" },
    points: [[-100, -100, 100], [-100, 100, 100], [100, -100, 100], [100, 100, 100]],
    patches: [{ id: "plane", kind: "ruled-strip", left: [0, 2], right: [1, 3] }],
  };
  const points = [{ longitude: 0, latitude: 0, altitude: 0 },
    { longitude: 0.0005, latitude: 0, altitude: 2 }];
  const first = await request({ id: 1, points, terrain, spacing: 5 });
  assert.equal(first.error, undefined);
  assert.equal(first.result.coverage, 1);
  assert.equal(first.result.verticalDatum, "ODN");
  assert.equal(first.result.samples[0].height, 100, "Retain source elevation, not relative display height.");
  assert.ok(first.result.horizontalDistance > 55 && first.result.horizontalDistance < 56);
  assert.ok(first.result.samples.length > 2);

  const cached = await request({ id: 2, points, spacing: 10 });
  assert.equal(cached.error, undefined);
  assert.equal(cached.result.terrainName, terrain.name, "Omitted terrain reuses the worker's current source.");
  assert.equal(cached.result.coverage, 1);

  const invalid = await request({ id: 3, points, spacing: 0 });
  assert.equal(typeof invalid.error, "string");
  assert.ok(invalid.error.length > 0);
  assert.equal(invalid.result, undefined);

  const cleared = await request({ id: 4, points, terrain: null, spacing: 5 });
  assert.equal(cleared.error, undefined);
  assert.equal(cleared.result.terrainName, null, "Explicit null clears the cached source after an error.");
  assert.equal(cleared.result.coverage, 0);
  assert.equal(cleared.result.surfaceDistance, null);
  assert.ok(cleared.result.samples.every(sample => sample.height === null));

  const stillCleared = await request({ id: 5, points, spacing: 5 });
  assert.equal(stillCleared.result.terrainName, null);
  assert.equal(stillCleared.result.coverage, 0);
  console.log(`Production analysis worker verified: ${fileURLToPath(asset)}`);
  console.log("5 requests passed: native profile, cached source, validation error, explicit reset, retained reset.");
} finally {
  await worker.terminate();
}
