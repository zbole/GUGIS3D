import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/city-api.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/cityApi.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile,
  define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' } });
const { commitDraft, createCityApi } = await import(pathToFileURL(outfile).href);
const studioFile = outfile.replace("city-api", "studio-api");
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/api.ts", import.meta.url))], outfile: studioFile,
  bundle: true, platform: "node", format: "esm", packages: "external", define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' } });
const { saveDocument, loadExample, generateBuilding } = await import(pathToFileURL(studioFile).href);

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

test("HTML gateway failures show HTTP status, keep writes uncertain and never replay them", async t => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response("<html>private gateway trace</html>", { status: 502 }); };
  t.after(() => { globalThis.fetch = original; });
  const api = createCityApi("london");
  await assert.rejects(api.listVersions(), /502：本地服务暂不可用/);
  await assert.rejects(api.commitDraft("draft"), /502：本地服务暂不可用.*操作结果未确认/);
  await assert.rejects(api.importTerrain(new File(["test"], "qa.asc"), "", "unknown", 1), /502：本地服务暂不可用/);
  await assert.rejects(saveDocument({ parameters: { name: "QA" } }), /502：本地服务暂不可用.*操作结果未确认/);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(call => call.options.method === "POST").length, 3);
});

test("timeouts and disconnections distinguish reads, calculations and uncertain writes", async t => {
  const original = globalThis.fetch; let calls = 0, cause = new DOMException("QA timed out", "TimeoutError");
  globalThis.fetch = async () => { calls++; throw cause; }; t.after(() => { globalThis.fetch = original; });
  const api = createCityApi("london");
  await assert.rejects(api.commitDraft("draft"), /请求超时，操作结果未确认.*重新载入核对/);
  const emptyCity = { format: "gugis-city", version: "1.0", coordinate_system: "ENU_METERS_WGS84", name: "QA", assets: {}, instances: [], roads: [], metadata: {} };
  await assert.rejects(api.persistDraft(emptyCity, "formal", null, "QA"), /请求超时，操作结果未确认/);
  await assert.rejects(loadExample(), /请求超时。请确认本地服务/);
  await assert.rejects(generateBuilding({ name: "QA" }), error => /请求超时/.test(error.message) && !/操作结果未确认/.test(error.message));
  cause = new TypeError("Failed to fetch");
  await assert.rejects(api.loadCity(), /无法连接本地服务/);
  await assert.rejects(saveDocument({}), /无法连接本地服务，操作结果未确认/);
  assert.equal(calls, 6);
});

test("successful HTTP status with an unreadable body never confirms a save or hides an interrupted response", async t => {
  const original = globalThis.fetch; let calls = 0, interrupted = false;
  globalThis.fetch = async () => { calls++; return interrupted
    ? { ok: true, status: 200, json: async () => { throw new DOMException("QA body read aborted", "AbortError"); } }
    : new Response("<html>not JSON</html>", { status: 200 }); };
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(commitDraft("draft"), /HTTP 200.*操作结果未确认/);
  await assert.rejects(loadExample(), /HTTP 200.*检查本地服务/);
  interrupted = true;
  await assert.rejects(commitDraft("draft"), /请求已中断，操作结果未确认/);
  assert.equal(calls, 3);
});

test("malformed validation entries and empty error bodies retain an actionable failure", async t => {
  mockResponse(t, 422, [null, { msg: "Field required" }, { loc: ["body", 0], msg: "not valid" }]);
  await assert.rejects(commitDraft("draft"), /输入：缺少必需字段.*body.0：not valid/);
  globalThis.fetch = async () => new Response(null, { status: 413 });
  await assert.rejects(createCityApi("london").importTerrain(new File(["test"], "qa.asc"), "", "unknown", 1), /413：文件过大/);
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
