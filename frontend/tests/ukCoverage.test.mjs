import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readinessFixture } from "./helpers/ukReadinessFixture.mjs";
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/uk-coverage.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/ukCoverage.ts", import.meta.url))], outfile, bundle: true,
  format: "esm", platform: "node", define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' } });
const { parseUkReadiness, filterReadinessCities, safeSourceUrl, loadUkReadiness } = await import(pathToFileURL(outfile).href);
test("membership preserves both Bangors and separates Westminster sample from official London", () => {
  const data = parseUkReadiness(readinessFixture());
  assert.equal(data.cities.length, 76);
  assert.deepEqual(data.country_counts, { England: 55, "Northern Ireland": 6, Scotland: 8, Wales: 7 });
  const bangors = filterReadinessCities(data.cities, "", "bangor");
  assert.equal(bangors.length, 2); assert.equal(new Set(bangors.map(c => c.id)).size, 2);
  assert.equal(filterReadinessCities(data.cities, "Wales", "bangor").length, 1);
  assert.deepEqual(data.cities.find(c => c.source_name === "London").sample.workspace_ids, []);
  assert.deepEqual(data.cities.find(c => c.source_name === "Westminster").sample.workspace_ids, ["london"]);
  assert.equal(filterReadinessCities(data.cities, "", "Derry")[0].source_name, "Londonderry");
});
test("no sample, bbox, receipt or count is accepted as proof of coverage", () => {
  for (const mutate of [d => { d.summary.coverage_assessment = "complete"; }, d => { d.cities[0].coverage.state = "complete"; },
    d => { d.cities[0].sample.boundary_membership_verified = true; }, d => { d.cities[0].import.scope = "whole-city"; },
    d => { d.cities[0].country_code = "NIR"; }, d => { d.cities[0].id = d.cities[1].id; },
    d => { d.country_counts.England++; }, d => { d.cities.find(c => c.source_name === "London").sample.workspace_ids = ["london"]; }]) {
    const data = readinessFixture(); mutate(data); assert.throws(() => parseUkReadiness(data));
  }
  const data = readinessFixture(); data.cities[0].boundary = { state: "receipt-recorded", receipt: { topology: "not_checked" } };
  assert.equal(parseUkReadiness(data).cities[0].coverage.state, "not-assessed");
});
test("unavailable sample counts remain unknown and sources cannot execute script URLs", () => {
  const data = readinessFixture(); Object.assign(data.samples[0], { status: "unavailable", building_count: null, road_count: null, data_revision: null });
  data.cities.find(c => c.id === data.samples[0].related_city_id).sample.state = "unavailable";
  data.summary.available_sample_workspaces = 2;
  assert.equal(parseUkReadiness(data).samples[0].building_count, null);
  for (const url of ["javascript:alert(1)", "file:///tmp/test", "https://user:secret@example.test", "/relative"])
    assert.equal(safeSourceUrl(url), null);
});
test("read-only fetch is bounded and rejects bad responses instead of loading models", async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  const requests = [];
  globalThis.fetch = async (url, options) => { requests.push({ url, options }); return new Response(JSON.stringify(readinessFixture())); };
  assert.equal((await loadUkReadiness(new AbortController().signal)).cities.length, 76);
  assert.equal(requests[0].url, "/api/coverage/uk-cities");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.method, undefined);
  globalThis.fetch = async () => new Response("x".repeat(1024 * 1024 + 1));
  await assert.rejects(loadUkReadiness(new AbortController().signal), /1 MiB/);
  globalThis.fetch = async () => new Response("down", { status: 503 });
  await assert.rejects(loadUkReadiness(new AbortController().signal), /503/);
});
