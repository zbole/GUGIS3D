import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { create, act } from "react-test-renderer";

const outfile = fileURLToPath(new URL("../node_modules/.cache/gugis-tests/workspaceHook.mjs", import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL("../src/studio/useWorkspaceNavigation.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", packages: "external", outfile });
const { useWorkspaceNavigation } = await import(pathToFileURL(outfile).href);

function fixture(href) {
  const previous = globalThis.window;
  const entries = [href], listeners = new Set();
  let index = 0, pushes = 0, replaces = 0, navigate, renderer;
  const location = new URL(href);
  const update = value => { location.href = new URL(value, location).href; };
  globalThis.window = {
    location, history: { state: { project: "retained" },
      pushState(state, _, value) { assert.deepEqual(state, { project: "retained" }); pushes++; entries.splice(++index); entries[index] = String(value); update(value); },
      replaceState(_, __, value) { replaces++; entries[index] = String(value); update(value); },
    },
    addEventListener(name, listener) { if (name === "popstate") listeners.add(listener); },
    removeEventListener(name, listener) { if (name === "popstate") listeners.delete(listener); },
  };
  function Harness() { const [tab, go] = useWorkspaceNavigation(); navigate = go; return React.createElement("output", null, tab); }
  act(() => { renderer = create(React.createElement(Harness)); });
  return {
    get tab() { return renderer.root.findByType("output").children[0]; },
    get href() { return location.href; }, get pushes() { return pushes; }, get replaces() { return replaces; },
    navigate(tab) { act(() => navigate(tab)); },
    move(step) { act(() => { index += step; update(entries[index]); for (const listener of listeners) listener(); }); },
    close() { act(() => renderer.unmount()); assert.equal(listeners.size, 0); globalThis.window = previous; },
  };
}

test("deep links and explicit workspace switches track back and forward without duplicate history", () => {
  const f = fixture("http://localhost/?workspace=environment&view=terrain&source=demo#result");
  try {
    assert.equal(f.tab, "environment");
    f.navigate("author"); f.navigate("author"); f.navigate("analysis");
    assert.equal(f.pushes, 2);
    assert.equal(f.href, "http://localhost/?workspace=analysis&source=demo#result");
    f.move(-1); assert.equal(f.tab, "author");
    f.move(-1); assert.equal(f.tab, "environment"); assert.match(f.href, /view=terrain/);
    f.move(1); assert.equal(f.tab, "author");
    assert.equal(f.pushes, 2, "restoring history never writes a new entry");
    assert.equal(f.replaces, 0);
  } finally { f.close(); }
});

test("unknown entry links normalise once and preserve unrelated context", () => {
  const f = fixture("http://localhost/?workspace=invalid&view=terrain&source=demo#result");
  try {
    assert.equal(f.tab, "city"); assert.equal(f.replaces, 1); assert.equal(f.pushes, 0);
    assert.equal(f.href, "http://localhost/?source=demo#result");
  } finally { f.close(); }
});
