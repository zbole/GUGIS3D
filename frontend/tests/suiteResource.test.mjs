import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadComparisonSuite } from "../src/compare/suiteResource.ts";

test("separate experiment data requires matching bytes and source identity, with recoverable HTTP failures", async () => {
  const originalFetch = globalThis.fetch;
  const body = JSON.stringify({ schema: "gugis-terrain-comparison-suite-v1", cityRevision: "a".repeat(64), bundleId: "b".repeat(64) });
  const expected = { reportSha256: createHash('sha256').update(body).digest('hex'), cityRevision: "a".repeat(64), bundleId: "b".repeat(64) };
  const controller = new AbortController();
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, '/data.json'); assert.equal(options.signal, controller.signal);
      return new Response(body);
    };
    assert.equal((await loadComparisonSuite('/data.json', expected, controller.signal)).bundleId, expected.bundleId);
    await assert.rejects(loadComparisonSuite('/data.json', { ...expected, reportSha256: '0'.repeat(64) }, controller.signal), /校验不一致/);
    await assert.rejects(loadComparisonSuite('/data.json', { ...expected, cityRevision: 'c'.repeat(64) }, controller.signal), /同一个实验/);
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    await assert.rejects(loadComparisonSuite('/data.json', expected, controller.signal), /HTTP 503/);
    globalThis.fetch = async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1));
    await assert.rejects(loadComparisonSuite('/data.json', expected, controller.signal), /加载上限/);
  } finally { globalThis.fetch = originalFetch; }
});
