import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/usePathAnalysis.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/usePathAnalysis.ts", import.meta.url))], bundle: true,
  platform: "node", format: "esm", packages: "external", outfile });
const { usePathAnalysis } = await import(pathToFileURL(outfile).href);
const points = [{ longitude: -2.6, latitude: 51.45, altitude: 0 }, { longitude: -2.601, latitude: 51.451, altitude: 3 }];
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });

test("background analysis ignores stale replies, reuses terrain, resets on clear, and terminates on unmount", async () => {
  const original = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    messages = [];
    constructor() { workers.push(this); }
    postMessage(data) { this.messages.push(data); }
    terminate() { this.terminated = true; }
  };
  let state, renderer;
  const terrain = { name: "Test" };
  function Probe(props) { state = usePathAnalysis(props.points, props.terrain); return null; }
  try {
    act(() => { renderer = create(React.createElement(Probe, { points, terrain })); });
    await settle();
    const w = workers[0], first = w.messages[0];
    assert.equal(first.terrain, terrain);
    act(() => renderer.update(React.createElement(Probe, { points: [...points, { ...points[1], longitude: -2.602 }], terrain })));
    await settle();
    assert.equal(w.messages.length, 2);
    assert.ok(!("terrain" in w.messages[1]));
    act(() => w.onmessage({ data: { id: first.id, result: { obsolete: true } } }));
    assert.equal(state.result, null);
    assert.equal(state.busy, true);
    const current = { horizontalDistance: 300 };
    act(() => w.onmessage({ data: { id: w.messages[1].id, result: current } }));
    assert.equal(state.result, current);
    act(() => renderer.update(React.createElement(Probe, { points: [], terrain })));
    act(() => w.onmessage({ data: { id: w.messages[1].id, result: current } }));
    assert.equal(state.result, null);
    assert.equal(state.busy, false);
    act(() => renderer.unmount()); renderer = null;
    assert.equal(w.terminated, true);
  } finally {
    if (renderer) act(() => renderer.unmount());
    if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original;
  }
});
