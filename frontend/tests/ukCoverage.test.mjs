import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readinessFixture } from "./helpers/ukReadinessFixture.mjs";
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/uk-coverage.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/ukCoverage.ts", import.meta.url))], outfile, bundle: true,
  format: "esm", platform: "node", define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' } });
const { parseUkReadiness, filterReadinessCities, boundaryReadinessStatus, safeSourceUrl, loadUkReadiness } = await import(pathToFileURL(outfile).href);
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
test("each sample status is filtered independently, with no sample distinct from missing or unknown data", () => {
  for (const status of ["available", "missing", "invalid", "unavailable"]) {
    const data = readinessFixture();
    for (const sample of data.samples) {
      Object.assign(sample, { status, building_count: status === "available" ? 100 : null,
        road_count: status === "available" ? 20 : null, data_revision: status === "available" ? "a".repeat(64) : null });
      data.cities.find(city => city.id === sample.related_city_id).sample.state = status;
    }
    data.summary.available_sample_workspaces = status === "available" ? 3 : 0;
    const cities = parseUkReadiness(data).cities;
    assert.deepEqual(filterReadinessCities(cities, "", "", { sample: status }).map(city => city.id).sort(),
      data.samples.map(sample => sample.related_city_id).sort());
    assert.equal(filterReadinessCities(cities, "", "", { sample: "none" }).length, 73);
    assert.deepEqual(filterReadinessCities(cities, "", "Westminster", { sample: status })[0].sample.workspace_ids, ["london"]);
    assert.equal(filterReadinessCities(cities, "", "London", { sample: status }).some(city => city.source_name === "London"), false);
    for (const other of ["available", "missing", "invalid", "unavailable"].filter(value => value !== status))
      assert.deepEqual(filterReadinessCities(cities, "", "", { sample: other }), []);
  }
});
test("boundary filters separate unavailable platform checks from checked failures without claiming coverage", () => {
  const data = readinessFixture();
  const recorded = data.cities.find(city => city.id === "uk-eng-bristol");
  const failed = data.cities.find(city => city.id === "uk-eng-birmingham");
  const unsupported = data.cities.find(city => city.id === "uk-eng-westminster");
  recorded.boundary = { state: "receipt-recorded", receipt: { topology: "not_checked" } };
  failed.boundary = { state: "validation-failed", receipt: null, reason_code: "invalid-receipt" };
  unsupported.boundary = { state: "validation-failed", receipt: null, reason_code: "unsupported-platform" };
  const cities = parseUkReadiness(data).cities;
  const before = structuredClone(cities);
  for (const [boundary, expected] of [["receipt-recorded", recorded], ["validation-failed", failed], ["unsupported-platform", unsupported]]) {
    assert.equal(boundaryReadinessStatus(expected), boundary);
    assert.deepEqual(filterReadinessCities(cities, "", "", { boundary }).map(city => city.id), [expected.id]);
    assert.equal(expected.coverage.state, "not-assessed");
  }
  assert.equal(filterReadinessCities(cities, "", "", { boundary: "not-recorded" }).length, 73);
  assert.deepEqual(filterReadinessCities(cities, "England", "  BRISTOL  ", { sample: "available", boundary: "receipt-recorded" }), [recorded]);
  assert.deepEqual(filterReadinessCities(cities, "Wales", "bristol", { sample: "available", boundary: "receipt-recorded" }), []);
  assert.deepEqual(filterReadinessCities(cities, "England", "bristol", { sample: "none", boundary: "receipt-recorded" }), []);
  assert.deepEqual(filterReadinessCities(cities, "", "", { sample: "", boundary: "" }), cities);
  assert.deepEqual(cities, before, "local filtering must not mutate any readiness record");
});
test("combined filters retain both Bangor identities and search aliases and display names", () => {
  const data = parseUkReadiness(readinessFixture());
  const statuses = { sample: "none", boundary: "not-recorded" };
  assert.deepEqual(filterReadinessCities(data.cities, "", "bAnGoR", statuses).map(city => city.id).sort(), ["uk-nir-bangor", "uk-wls-bangor"]);
  assert.deepEqual(filterReadinessCities(data.cities, "Northern Ireland", "bangor", statuses).map(city => city.id), ["uk-nir-bangor"]);
  assert.deepEqual(filterReadinessCities(data.cities, "Wales", "bangor", statuses).map(city => city.id), ["uk-wls-bangor"]);
  assert.equal(filterReadinessCities(data.cities, "Northern Ireland", "  DERRY  ", statuses)[0].source_name, "Londonderry");
  data.cities.find(city => city.id === "uk-wls-bangor").display_name = "Synthetic display name";
  assert.deepEqual(filterReadinessCities(data.cities, "Wales", "synthetic display", statuses).map(city => city.id), ["uk-wls-bangor"]);
  assert.deepEqual(filterReadinessCities(data.cities, "", "No matching city", statuses), []);
  assert.deepEqual(filterReadinessCities([], "", "", statuses), []);
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
