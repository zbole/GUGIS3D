import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import React from "react";
import { act, create } from "react-test-renderer";
import { useProjectFreshness } from "../src/compare/useProjectFreshness.ts";

const snapshot = "a".repeat(64), changed = "b".repeat(64);
const evidence = JSON.parse(await readFile(new URL("../../shared/compare-evidence.json", import.meta.url), "utf8"));
const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/CompareShowcase.freshness.mjs", import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL("../src/compare/CompareShowcase.tsx", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile,
  loader: { ".css": "empty" }, define: { "import.meta.env.VITE_API_BASE_URL": '"/api"' },
  plugins: [{ name: "omit-unrelated-terrain-loader", setup(build) {
    build.onResolve({ filter: /\/TerrainComparisonLoader$/ }, () => ({ path: "terrain", namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default () => null", loader: "js" }));
  } }],
});
const CompareShowcase = (await import(pathToFileURL(outfile).href)).default;
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function events() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name) { for (const listener of listeners.get(name) ?? []) listener(); },
    get count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function fixture(t, { visibility = "visible", component = null, revision = snapshot, apiBase = "/api" } = {}) {
  const originals = Object.fromEntries(["window", "document", "fetch"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const win = events(), doc = Object.assign(events(), { visibilityState: visibility, title: "" });
  const timers = new Map(), requests = [], states = [];
  let nextTimer = 0, now = 0, renderer, result, closed = false;
  win.setTimeout = (callback, delay) => {
    timers.set(++nextTimer, { callback, due: now + delay });
    return nextTimer;
  };
  win.clearTimeout = id => timers.delete(id);
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.fetch = (url, options) => {
    const pending = deferred();
    requests.push({ ...pending, url, options });
    // Deliberately ignore abort, so stale-response isolation is independently tested.
    return pending.promise;
  };
  function Harness(props) {
    result = useProjectFreshness(props.revision, props.apiBase);
    states.push(result.freshness);
    return React.createElement("output", null, result.freshness);
  }
  const Component = component ?? Harness;
  act(() => { renderer = create(React.createElement(Component, { revision, apiBase })); });
  const f = {
    win, doc, timers, requests, states,
    get root() { return renderer.root; },
    get status() { return result.freshness; },
    get recheckCallback() { return result.recheck; },
    focus() { act(() => win.dispatch("focus")); },
    blur() { act(() => win.dispatch("blur")); },
    visibility(value) { act(() => { doc.visibilityState = value; doc.dispatch("visibilitychange"); }); },
    recheck() { act(() => result.recheck()); },
    update(props) { act(() => renderer.update(React.createElement(Component, { revision, apiBase, ...props }))); },
    async respond(index, body, status = 200) {
      await act(async () => { requests[index].resolve({ ok: status >= 200 && status < 300, json: async () => body }); });
    },
    async response(index, response) { await act(async () => { requests[index].resolve(response); }); },
    async reject(index, error = new Error("Offline")) { await act(async () => { requests[index].reject(error); }); },
    tick(milliseconds) {
      act(() => {
        now += milliseconds;
        for (const [id, timer] of [...timers]) {
          if (timer.due <= now) { timers.delete(id); timer.callback(); }
        }
      });
    },
    unmount() { if (renderer) { act(() => renderer.unmount()); renderer = null; } },
    close() {
      if (closed) return;
      f.unmount();
      for (const [key, descriptor] of Object.entries(originals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
      closed = true;
    },
  };
  t.after(f.close);
  return f;
}

test("returning focus changes a previously current snapshot to historical, using only uncached reads", async t => {
  const f = fixture(t, { apiBase: "http://localhost:8000/" });
  assert.equal(f.status, "checking");
  await f.respond(0, { revision: snapshot });
  assert.equal(f.status, "current");
  assert.equal(f.timers.size, 0);
  f.focus();
  assert.equal(f.status, "checking", "do not retain a current claim while rechecking");
  await f.respond(1, { revision: changed });
  assert.equal(f.status, "changed");
  assert.deepEqual(f.states, ["checking", "current", "checking", "changed"]);
  for (const { url, options } of f.requests) {
    assert.equal(url, "http://localhost:8000/city/revision");
    assert.equal(options.method, "GET");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.body, undefined);
  }
});

test("network and HTTP failures can be explicitly retried without reloading saved evidence", async t => {
  const f = fixture(t);
  await f.reject(0);
  assert.equal(f.status, "offline");
  f.recheck();
  assert.equal(f.status, "checking");
  await f.respond(1, { revision: snapshot }, 503);
  assert.equal(f.status, "offline");
  f.recheck();
  await f.respond(2, { revision: snapshot });
  assert.equal(f.status, "current");
  assert.equal(f.timers.size, 0);
});

test("superseded responses and errors cannot overwrite a newer check or clear its timeout", async t => {
  const f = fixture(t);
  f.recheck();
  assert.equal(f.requests[0].options.signal.aborted, true);
  await f.respond(0, { revision: snapshot });
  assert.equal(f.status, "checking");
  assert.equal(f.timers.size, 1);
  f.recheck();
  assert.equal(f.requests[1].options.signal.aborted, true);
  await f.respond(2, { revision: changed });
  assert.equal(f.status, "changed");
  await f.reject(1);
  assert.equal(f.status, "changed");
  assert.equal(f.timers.size, 0);

  f.recheck();
  f.recheck();
  await f.respond(4, { revision: snapshot });
  await f.respond(3, { revision: changed });
  assert.equal(f.status, "current", "a late successful response also stays isolated");
});

test("supersession also isolates a response whose JSON body is still loading", async t => {
  const f = fixture(t), body = deferred();
  await f.response(0, { ok: true, json: () => body.promise });
  f.recheck();
  await f.respond(1, { revision: changed });
  await act(async () => { body.resolve({ revision: snapshot }); });
  assert.equal(f.status, "changed");
  assert.equal(f.timers.size, 0);
});

test("hidden pages pause network checks and discard in-flight results until visible again", async t => {
  const f = fixture(t, { visibility: "hidden" });
  assert.equal(f.status, "paused");
  assert.equal(f.requests.length, 0);
  f.focus();
  f.recheck();
  assert.equal(f.requests.length, 0);
  f.visibility("visible");
  assert.equal(f.status, "checking");
  await f.respond(0, { revision: snapshot });
  assert.equal(f.status, "current");
  f.visibility("hidden");
  assert.equal(f.status, "paused");
  f.focus();
  assert.equal(f.requests.length, 1);
  f.visibility("visible");
  assert.equal(f.status, "checking");
  f.visibility("hidden");
  assert.equal(f.requests[1].options.signal.aborted, true);
  assert.equal(f.timers.size, 0);
  await f.respond(1, { revision: snapshot });
  assert.equal(f.status, "paused");
  f.visibility("visible");
  await f.respond(2, { revision: changed });
  assert.equal(f.status, "changed");
});

test("visibility and focus coalesce, but leaving focus during a request requires a fresh check", async t => {
  const f = fixture(t, { visibility: "hidden" });
  f.visibility("visible");
  f.focus();
  assert.equal(f.requests.length, 1, "the browser's paired return events share one request");
  assert.equal(f.requests[0].options.signal.aborted, false);
  f.blur();
  f.focus();
  assert.equal(f.requests.length, 2, "an actual focus return cannot reuse an earlier in-flight revision");
  assert.equal(f.requests[0].options.signal.aborted, true);
  await f.respond(0, { revision: snapshot });
  assert.equal(f.status, "checking");
  await f.respond(1, { revision: changed });
  assert.equal(f.status, "changed");
});

test("malformed JSON and invalid SHA-256 revisions never become current or historical evidence", async t => {
  const f = fixture(t);
  const invalid = [null, [], {}, "revision", { revision: null }, { revision: 123 },
    { revision: "" }, { revision: "a".repeat(63) }, { revision: "a".repeat(65) },
    { revision: "z".repeat(64) }, { revision: "A".repeat(64) }, { revision: ` ${snapshot}` }];
  for (const [index, body] of invalid.entries()) {
    if (index) f.recheck();
    await f.respond(index, body);
    assert.equal(f.status, "offline", JSON.stringify(body));
  }
  f.recheck();
  await f.response(invalid.length, { ok: true, json: async () => { throw new SyntaxError("Malformed JSON"); } });
  assert.equal(f.status, "offline");
  f.recheck();
  await f.respond(invalid.length + 1, { revision: snapshot });
  assert.equal(f.status, "current");
});

test("timeout reports an unverified project, aborts the request, and permits recovery", async t => {
  const f = fixture(t);
  f.tick(6999);
  assert.equal(f.status, "checking");
  f.tick(1);
  assert.equal(f.status, "offline");
  assert.equal(f.requests[0].options.signal.aborted, true);
  assert.equal(f.timers.size, 0);
  f.recheck();
  await f.respond(0, { revision: snapshot });
  assert.equal(f.status, "checking");
  assert.equal(f.timers.size, 1);
  await f.respond(1, { revision: changed });
  assert.equal(f.status, "changed");
});

test("unmount removes listeners and timers and ignores late completion and retained callbacks", async t => {
  const f = fixture(t), retry = f.recheckCallback;
  assert.equal(f.win.count, 2);
  assert.equal(f.doc.count, 1);
  assert.equal(f.timers.size, 1);
  f.unmount();
  assert.equal(f.win.count, 0);
  assert.equal(f.doc.count, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.requests[0].options.signal.aborted, true);
  f.focus();
  f.visibility("visible");
  retry();
  await f.reject(0);
  f.tick(7000);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.states, ["checking"]);
});

test("changing the expected snapshot or API cancels the old check and installs just one listener pair", async t => {
  const f = fixture(t);
  f.update({ revision: changed, apiBase: "/other/" });
  assert.equal(f.requests[0].options.signal.aborted, true);
  assert.equal(f.win.count, 2);
  assert.equal(f.doc.count, 1);
  assert.equal(f.requests[1].url, "/other/city/revision");
  await f.respond(1, { revision: changed });
  await f.reject(0);
  assert.equal(f.status, "current");
});

test("the rendered comparison exposes recheck/retry, announces honest status, and preserves saved numbers", async t => {
  const f = fixture(t, { component: CompareShowcase });
  act(()=>f.root.findByProps({id:"supplementary-evidence"}).props.onToggle({currentTarget:{open:true}}));
  const status = () => f.root.findByProps({ className: "cmp-snapshot-copy" });
  const button = () => f.root.findByProps({ className: "cmp-snapshot-recheck" });
  const snapshotMetadata = () => text(status().findByType("small"));
  const measured = () => text(f.root.findByProps({ className: "cmp-memory-lead" }));
  const originalMetadata = snapshotMetadata(), originalMeasured = measured();
  assert.equal(f.root.findByType("main").findAllByProps({ "aria-label": "城市实测快照校对" }).length, 1);
  assert.match(text(status()), /布里斯托扩展样本街区.*地形为合成演示.*ArcGIS 软件运行值待测/);
  assert.equal(button().props.type, "button");
  assert.equal(button().props.disabled, true);
  assert.equal(status().props["aria-live"], "polite");
  assert.equal(status().props["aria-busy"], true);
  assert.match(text(status()), /正在校对当前项目修订号/);
  await f.respond(0, { revision: evidence.revision });
  assert.match(text(status()), /实测快照与当前项目一致/);
  assert.equal(status().props["aria-busy"], false);
  assert.equal(text(button()), "重新校对");
  assert.equal(button().props.disabled, false);
  act(() => button().props.onClick());
  assert.equal(button().props.disabled, true);
  await f.reject(1);
  assert.match(text(status()), /无法校对当前项目/);
  assert.doesNotMatch(text(status()), /与当前项目一致/);
  assert.equal(text(button()), "重试校对");
  act(() => button().props.onClick());
  await f.respond(2, { revision: snapshot === evidence.revision ? changed : snapshot });
  assert.match(text(status()), /项目已改变/);
  f.visibility("hidden");
  assert.match(text(status()), /页面已暂停校对/);
  f.visibility("visible");
  await f.respond(3, { revision: evidence.revision });
  assert.equal(snapshotMetadata(), originalMetadata);
  assert.equal(measured(), originalMeasured);
  assert.ok(originalMetadata.includes(evidence.revision.slice(0, 16)));
  assert.ok(originalMeasured.includes(evidence.memory.wireSavingPercent.toFixed(2)));
  assert.match(text(status()), /不会重新测量或修改项目/);
  assert.match(text(f.root.findByProps({id:"paper-results"})),/N 是实际三角形数/);
  assert.match(text(f.root.findByProps({id:"real-terrain-results"})),/真实城市/);
  assert.ok(f.requests.every(request => request.url === "/api/city/revision" && request.options.method === "GET"));
});
