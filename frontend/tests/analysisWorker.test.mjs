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
    act(() => w.onmessage({ data: { id: first.id, result: { horizontalDistance: 100 } } }));
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

test("editing and clearing terminate busy analysis, while obsolete errors cannot affect a replacement", async () => {
  const original = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    messages = [];
    constructor() { workers.push(this); }
    postMessage(data) { this.messages.push(data); }
    terminate() { this.terminated = true; }
  };
  let state, renderer;
  const terrain = { name: "Test" };
  function Probe(props) { state = usePathAnalysis(props.points, terrain, props.spacing); return null; }
  try {
    act(() => { renderer = create(React.createElement(Probe, { points, spacing: 5 })); });
    await settle();
    const first = workers[0];
    act(() => renderer.update(React.createElement(Probe, { points, spacing: 10 })));
    assert.equal(first.terminated, true, "cancel superseded computation without waiting for the debounce");
    await settle();
    const second = workers[1];
    assert.equal(second.messages[0].terrain, terrain, "a replacement needs its own terrain cache");
    act(() => first.onerror());
    act(() => first.onmessage({ data: { id: first.messages[0].id, result: { obsolete: true } } }));
    assert.equal(second.terminated, undefined);
    assert.equal(state.busy, true);
    assert.equal(state.error, "");
    assert.equal(state.result, null);
    act(() => renderer.update(React.createElement(Probe, { points: [], spacing: 10 })));
    assert.equal(second.terminated, true, "clearing must stop CPU work, not merely hide its result");
    act(() => second.onerror());
    assert.equal(state.result, null);
    assert.equal(state.busy, false);
    assert.equal(state.error, "");
    await settle();
    assert.equal(workers.length, 2, "an empty route must not launch a replacement");
    act(() => renderer.update(React.createElement(Probe, { points, spacing: 10 })));
    await settle();
    const third = workers[2];
    act(() => third.onmessage({ data: { id: third.messages[0].id, result: { horizontalDistance: 300 } } }));
    assert.equal(state.result.horizontalDistance, 300);
    assert.equal(state.busy, false);
    act(() => renderer.unmount()); renderer = null;
    assert.equal(third.terminated, true);
  } finally {
    if (renderer) act(() => renderer.unmount());
    if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original;
  }
});

test("worker post failures discard the broken instance and retry with a fresh terrain cache", async () => {
  const original = globalThis.Worker, workers = [];
  globalThis.Worker = class {
    messages = [];
    constructor() { workers.push(this); }
    postMessage(data) {
      if (workers.length === 1) throw new Error("Cannot send analysis data");
      this.messages.push(data);
    }
    terminate() { this.terminated = true; }
  };
  let state, renderer;
  const terrain = { name: "Test" };
  function Probe(props) { state = usePathAnalysis(props.points, terrain); return null; }
  try {
    act(() => { renderer = create(React.createElement(Probe, { points })); });
    await settle();
    assert.equal(workers[0].terminated, true);
    assert.equal(state.busy, false);
    assert.equal(state.error, "Cannot send analysis data");
    act(() => state.retry());
    await settle();
    assert.equal(workers.length, 2);
    assert.equal(workers[1].messages[0].terrain, terrain);
    act(() => workers[1].onmessage({ data: { id: workers[1].messages[0].id, result: { horizontalDistance: 100 } } }));
    assert.equal(state.error, "");
    assert.equal(state.result.horizontalDistance, 100);
  } finally {
    if (renderer) act(() => renderer.unmount());
    if (original === undefined) delete globalThis.Worker; else globalThis.Worker = original;
  }
});
