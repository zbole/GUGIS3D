import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/city-api.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/cityApi.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile,
  define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' } });
const { commitDraft } = await import(pathToFileURL(outfile).href);

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
