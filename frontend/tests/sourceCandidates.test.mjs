import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { candidateFixture, candidateResponse } from "./helpers/sourceCandidateFixture.mjs";
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/source-candidates.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/sourceCandidates.ts", import.meta.url))], outfile, bundle: true,
  format: "esm", platform: "node", define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' } });
const { parseSourceCandidates, catalogueCandidateRelation, candidateSourceUrl, loadSourceCandidates, sourceCandidateDownloadUrl } = await import(pathToFileURL(outfile).href);

test("candidate facts retain baseline versus candidate identity, omissions and fixed hash-bound download paths", () => {
  for (const city of ["london", "birmingham"]) {
    const value = candidateFixture(city), result = parseSourceCandidates(value, city), c = result.candidates[0];
    assert.equal(c.baseline.building_count - c.candidate.building_count, 1);
    assert.equal(c.changes.removed_buildings.length, 1); assert.equal(c.changes.preexisting_omissions.length, 1);
    assert.notDeepEqual(c.source.query_bbox_wgs84, c.source.actual_data_bbox_wgs84);
    assert.equal(c.status, "non-active");
    assert.equal(sourceCandidateDownloadUrl(c.downloads.archive), `/api${c.downloads.archive.url}`);
  }
  const empty = candidateFixture(); empty.city_id = "bristol"; empty.candidates = [];
  assert.equal(parseSourceCandidates(empty, "bristol").candidates.length, 0);
});
test("parser rejects unsafe URLs, wrong-city downloads, mismatched hashes, fabricated coverage and inconsistent changes", () => {
  for (const mutate of [d => d.city_id = "birmingham", d => d.comparison_basis = "current-project-diff",
    d => d.candidates[0].status = "active", d => d.candidates[0].source.scope = "whole-city",
    d => d.candidates[0].source.query_bbox_wgs84 = [-1, Infinity, 0, 52],
    d => d.candidates[0].source.licence_url = "javascript:alert(1)",
    d => d.candidates[0].source.attribution_url = "https://user:password@example.test",
    d => d.candidates[0].candidate.height_policy.assumed = 99,
    d => d.candidates[0].candidate.building_count = 2,
    d => d.candidates[0].candidate.road_count = 6,
    d => d.candidates[0].changes.added_osm_ways = [444],
    d => d.candidates[0].changes.unchanged.parameters = false,
    d => d.candidates[0].changes.height_corrections[0].candidate_height_m = NaN,
    d => d.candidates[0].changes.height_corrections[0].osm_way = 222,
    d => d.candidates[0].changes.preexisting_omissions[0].osm_way = 222,
    d => d.candidates[0].changes.assumed_height_wording_changes = 4,
    d => d.candidates[0].downloads.archive.url = "/cities/birmingham/source-candidates/v2/downloads/" + "a".repeat(64) + "/archive",
    d => d.candidates[0].downloads.archive.url = "https://example.test/archive",
    d => d.candidates[0].downloads.archive.sha256 = "0".repeat(64),
    d => d.candidates[0].downloads.archive.filename = "../../private.json",
    d => d.candidates[0].downloads.archive.byte_length = 17 * 1024 * 1024,
    d => d.candidates[0].downloads.archive.media_type = "text/html",
    d => d.candidates.push(structuredClone(d.candidates[0]))]) {
    const value = candidateFixture(); mutate(value); assert.throws(() => parseSourceCandidates(value, "london"));
  }
  for (const bad of ["data:text/plain,test", "file:///tmp/private", "/relative", "https://name:secret@example.test"])
    assert.equal(candidateSourceUrl(bad), null);
});
test("catalogue relation is exact-revision and city scoped, never a merge-safety assessment", () => {
  const c = candidateFixture().candidates[0], workspace = { id: "london", status: "ready", data_revision: c.baseline.revision };
  assert.equal(catalogueCandidateRelation(workspace, c, "london"), "baseline");
  assert.equal(catalogueCandidateRelation({ ...workspace, data_revision: c.candidate.revision }, c, "london"), "candidate");
  assert.equal(catalogueCandidateRelation({ ...workspace, data_revision: "0".repeat(64) }, c, "london"), "different");
  for (const invalid of [undefined, { ...workspace, status: "invalid" }, { ...workspace, data_revision: null }, { ...workspace, id: "birmingham" }])
    assert.equal(catalogueCandidateRelation(invalid, c, "london"), "unknown");
});
test("catalogue loading is GET-only, byte bounded and validates exact ETag bytes with cancellation", async t => {
  const original = globalThis.fetch, calls = []; t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return candidateResponse(candidateFixture()); };
  assert.equal((await loadSourceCandidates("london", new AbortController().signal)).candidates.length, 1);
  assert.equal(calls[0].url, "/api/cities/london/source-candidates");
  assert.equal(calls[0].options.method, undefined); assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[0].options.cache, "no-store");
  await assert.rejects(loadSourceCandidates("unknown", new AbortController().signal), /不支持/);
  assert.equal(calls.length, 1);
  globalThis.fetch = async () => candidateResponse(candidateFixture(), { etag: `W/"${"a".repeat(64)}"` });
  await assert.rejects(loadSourceCandidates("london", new AbortController().signal), /ETag/);
  globalThis.fetch = async () => new Response("x".repeat(256 * 1024 + 1));
  await assert.rejects(loadSourceCandidates("london", new AbortController().signal), /256 KiB/);
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(loadSourceCandidates("london", new AbortController().signal), /503/);
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const controller = new AbortController(), pending = loadSourceCandidates("london", controller.signal);
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(pending, { name: "AbortError" }); assert.equal(cancelled, true);
});
