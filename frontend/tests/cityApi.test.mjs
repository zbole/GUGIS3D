import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/city-api.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/cityApi.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile,
  define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' } });
const { commitDraft, createCityApi } = await import(pathToFileURL(outfile).href);

function mockResponse(t, status, detail) {
  const original = globalThis.fetch, requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ detail }), { status, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = original; });
  return requests;
}

test("snapshot-integrity failures retain backup instructions instead of claiming another window edited", async t => {
  const message = "历史快照校验失败，正式城市未覆盖。请先导出当前项目备份。";
  const requests = mockResponse(t, 409, { code: "snapshot_integrity", message });
  await assert.rejects(commitDraft("a".repeat(64)), error => error.message === message);
  assert.equal(requests.length, 1, "an integrity error must not retry a write automatically");
  assert.equal(requests[0].url, "/api/city/draft/commit");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), { revision: "a".repeat(64) });
});

test("ordinary revision conflicts still explain that current drafts remain preserved", async t => {
  mockResponse(t, 409, "City changed in another window");
  await assert.rejects(commitDraft("a".repeat(64)), /另一窗口已修改项目.*当前草稿仍保留/);
});

test("validation failures retain field details through the common city request handler", async t => {
  mockResponse(t, 422, [{ loc: ["body", "revision"], msg: "Field required" }]);
  await assert.rejects(commitDraft(""), /文件校验未通过.*body.revision：缺少必需字段/);
});

test("city-bound requests and export links retain their city after another workspace is created", async t => {
  const london = createCityApi("london");
  const requests = mockResponse(t, 200, null);
  const inFlight = london.commitDraft("london-draft");
  const birmingham = createCityApi("birmingham");
  await birmingham.discardDraft("birmingham-draft");
  await inFlight;
  assert.deepEqual(requests.map(item => item.url), ["/api/cities/london/city/draft/commit", "/api/cities/birmingham/city/draft/discard"]);
  assert.equal(london.cityExportUrl, "/api/cities/london/city/export");
  assert.equal(birmingham.terrainMultipatchUrl, "/api/cities/birmingham/city/terrain/benchmark.zip");
});

test("city-bound history, terrain uploads, and validation stay in the selected workspace", async t => {
  const api = createCityApi("london");
  const requests = mockResponse(t, 200, null);
  await api.listVersions(20);
  await api.importTerrain(new File(["dem"], "london.asc"), "EPSG:27700", "ODN", 2);
  assert.equal(requests[0].url, "/api/cities/london/city/versions?offset=20");
  assert.match(requests[1].url, /^\/api\/cities\/london\/city\/terrain\/import\?filename=london.asc&/);
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.headers["Content-Type"], "application/octet-stream");
});

test("invalid city ids cannot inject a workspace route", () => {
  for (const id of ["../bristol", "london/current", "London", "london?city=bristol"])
    assert.throws(() => createCityApi(id), /城市标识无效/);
});
