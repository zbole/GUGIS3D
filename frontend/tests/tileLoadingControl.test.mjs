import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { useTileLoadingControl } from "../src/studio/useTileLoadingControl.ts";

function visibilityFixture(t, hidden = false) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  const listeners = new Set();
  const doc = { hidden,
    addEventListener(name, callback) { assert.equal(name, "visibilitychange"); listeners.add(callback); },
    removeEventListener(name, callback) { assert.equal(name, "visibilitychange"); listeners.delete(callback); } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  let state;
  function Probe() { state = useTileLoadingControl(); return null; }
  let renderer;
  act(() => { renderer = create(React.createElement(Probe)); });
  t.after(() => {
    act(() => renderer.unmount());
    if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document;
  });
  return { listeners, get state() { return state; },
    visibility(hidden) { doc.hidden = hidden; act(() => { for (const fn of listeners) fn(); }); },
    manual(paused) { act(() => state.setManualPaused(paused)); },
    unmount() { act(() => renderer.unmount()); },
    remount() { act(() => { renderer = create(React.createElement(Probe)); }); } };
}

test("hidden pages pause tile loading and visibility does not override manual pause", t => {
  const f = visibilityFixture(t);
  assert.equal(f.state.paused, false);
  assert.equal(f.listeners.size, 1);
  f.visibility(true);
  assert.equal(f.state.pageHidden, true); assert.equal(f.state.paused, true);
  f.manual(true); f.visibility(false);
  assert.equal(f.state.pageHidden, false); assert.equal(f.state.paused, true);
  f.manual(false); assert.equal(f.state.paused, false);
  f.visibility(true); f.manual(true); f.manual(false);
  assert.equal(f.state.paused, true, "manual resume cannot override a still hidden page");
  f.visibility(false); assert.equal(f.state.paused, false);
});

test("initial hidden state, repeated events and session cleanup are safe", t => {
  const f = visibilityFixture(t, true);
  assert.equal(f.state.paused, true);
  f.visibility(true); f.visibility(true); assert.equal(f.listeners.size, 1);
  f.manual(true); f.unmount(); assert.equal(f.listeners.size, 0);
  f.visibility(false); f.remount();
  assert.equal(f.state.paused, false, "new city/session does not inherit manual pause");
  assert.equal(f.listeners.size, 1);
});

test("non-browser rendering requires no document or visibility listener", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  delete globalThis.document;
  let state, renderer;
  function Probe() { state = useTileLoadingControl(); return null; }
  try {
    act(() => { renderer = create(React.createElement(Probe)); });
    assert.equal(state.paused, false); assert.equal(state.pageHidden, false);
    act(() => state.setManualPaused(true)); assert.equal(state.paused, true);
  } finally {
    act(() => renderer?.unmount());
    if (original) Object.defineProperty(globalThis, "document", original);
  }
});
