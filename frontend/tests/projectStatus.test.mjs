import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";

const Panel = await componentBundle("ProjectStatusPanel");
const text = node => typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const placement = id => ({
  id, asset: "house", name: id, longitude: -2.603, latitude: 51.454,
  altitude: 0, heading: 0,
});
const road = id => ({
  id, name: id, width: 6, coordinates: [[-2.61, 51.45], [-2.6, 51.46]],
});
const terrain = demonstration => ({
  version: "1.0", name: "Current terrain", longitude: -2.603, latitude: 51.454,
  vertical_datum: "local", reference_height: 0, demonstration, source: {},
  points: [[0, 0, 10], [10, 0, 10], [0, 10, 10]],
  patches: [{ id: "surface", kind: "triangle-strip", indices: [0, 1, 2] }],
});
const city = {
  format: "gugis-city", version: "1.0", coordinate_system: "ENU_METERS_WGS84",
  name: "Formal city", metadata: { "范围": "Current project area" }, assets: {},
  instances: [placement("house")], roads: [road("road")],
  environment: {
    version: "1.0", terrain: terrain(true), feature_assets: {}, features: [],
    drape_buildings: true,
  },
};

function fixture(overrides = {}) {
  let renderer, props = {
    city, revision: "formal-revision-123", hasDraft: false, canSave: true,
    onAction: () => {}, ...overrides,
  };
  act(() => { renderer = create(React.createElement(Panel, props)); });
  return {
    get root() { return renderer.root; },
    update(next) {
      props = { ...props, ...next };
      act(() => renderer.update(React.createElement(Panel, props)));
    },
    close() { act(() => renderer.unmount()); },
  };
}

const writeStatus = root => root.findByProps({ className: "project-status__state" }).findAllByType("dd")[2];
const writeReason = root => text(root.findByProps({ className: "project-status__save-reason" }));
const sourceRows = root => root.findAllByProps({ className: "project-status__source" });
const counts = root => root.findByProps({ className: "project-status__counts" })
  .findAllByType("strong").map(node => text(node));

test("synthetic terrain cannot be relabelled as measured by caller source props", t => {
  const f = fixture({ sources: { terrain: { kind: "measured", detail: "Verified measured terrain" } } });
  t.after(f.close);
  const row = sourceRows(f.root)[2];
  assert.equal(row.findByProps({ className: "project-status__source-kind is-demonstration" }).children[0], "演示数据");
  assert.doesNotMatch(text(row), /Verified measured terrain|实测数据/);
  assert.equal(sourceRows(f.root)[0].findByProps({ className: "project-status__source-kind is-unknown" }).children[0], "来源未标注");
  f.update({ city: { ...city, environment: { ...city.environment, terrain: terrain(false) } },
    sources: { terrain: { kind: "user-imported", detail: "Provided DTM" } } });
  assert.match(text(sourceRows(f.root)[2]), /用户导入.*Provided DTM/);
});

test("independent draft, busy work, failed draft loading and parent denial block formal writes", t => {
  const f = fixture();
  t.after(f.close);
  assert.equal(text(writeStatus(f.root)), "允许正式写入");
  for (const [state, label, reason] of [
    [{ hasDraft: true }, "需先确认草稿", /先确认写入或放弃草稿/],
    [{ busy: true }, "处理中", /正在处理当前操作/],
    [{ draftUnavailable: true }, "暂不可写入", /独立草稿状态读取失败/],
    [{ canSave: false, saveReason: "Resolve pending edits first" }, "暂不可写入", /Resolve pending edits first/],
  ]) {
    f.update({ hasDraft: false, busy: false, draftUnavailable: false, canSave: true, saveReason: undefined, ...state });
    assert.equal(text(writeStatus(f.root)), label);
    assert.equal(writeStatus(f.root).props.className, "is-pending");
    assert.match(writeReason(f.root), reason);
  }
  f.update({ hasDraft: false, busy: false, draftUnavailable: false, canSave: true, saveReason: undefined });
  assert.equal(text(writeStatus(f.root)), "允许正式写入");
});

test("an unloaded city reports missing data and prohibits writes even if the parent grants them", t => {
  const f = fixture({ city: null, revision: "", canSave: true,
    sources: { buildings: { kind: "measured" }, terrain: { kind: "measured" } } });
  t.after(f.close);
  assert.equal(text(writeStatus(f.root)), "暂不可写入");
  assert.match(writeReason(f.root), /城市尚未载入/);
  assert.deepEqual(counts(f.root), ["0", "0", "0", "0"]);
  assert.equal(f.root.findAllByProps({ className: "project-status__source-kind is-missing" }).length, 4);
  assert.equal(f.root.findAllByType("button").every(button => button.props.disabled), true);
});

test("preview counts and provenance update without replacing the formal revision", t => {
  const f = fixture();
  t.after(f.close);
  assert.deepEqual(counts(f.root), ["1", "1", "1", "0"]);
  const preview = {
    ...city, name: "Draft city",
    instances: [placement("first"), placement("second")],
    roads: [road("first"), road("second"), road("third")],
    environment: {
      ...city.environment,
      terrain: { ...terrain(false), patches: [...terrain(false).patches, { id: "second", kind: "triangle-strip", indices: [0, 1, 2] }] },
      features: [
        { ...placement("lamp"), layer: "surface", scale: 1 },
        { ...placement("duct"), layer: "underground", scale: 1 },
      ],
    },
  };
  f.update({ city: preview, hasDraft: true, draftLabel: "Pending city changes",
    sources: { terrain: { kind: "user-imported", detail: "Draft DTM" } } });
  assert.deepEqual(counts(f.root), ["2", "3", "2", "2"]);
  const state = f.root.findByProps({ className: "project-status__state" });
  assert.equal(text(state.findAllByType("dd")[0]), "formal-revision-123");
  assert.equal(text(state.findAllByType("dd")[1]), "Pending city changes");
  assert.match(text(sourceRows(f.root)[2]), /用户导入.*Draft DTM/);
  assert.match(text(sourceRows(f.root)[3]), /地上 1 个.*地下 1 个/);
  assert.match(text(f.root.findByProps({ className: "project-status__draft-note" })), /独立草稿.*正式修订号/);
});

test("rendering, expanding and navigation leave the supplied city document intact", t => {
  const input = structuredClone(city);
  const freeze = value => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const before = JSON.stringify(input), actions = [];
  const f = fixture({ city: freeze(input), onAction: action => actions.push(action) });
  t.after(f.close);
  assert.deepEqual(actions, []);
  assert.equal(f.root.findByType("details").props.open, false);
  act(() => f.root.findByType("details").props.onToggle({ currentTarget: { open: true } }));
  assert.equal(f.root.findByType("details").props.open, true);
  act(() => f.root.findAllByType("button")[0].props.onClick());
  assert.deepEqual(actions, ["city"]);
  assert.equal(JSON.stringify(input), before);
});

test("workspace actions report only the chosen navigation target", t => {
  const actions = [];
  const f = fixture({ activeWorkspace: "analysis", onAction: action => actions.push(action) });
  t.after(f.close);
  const buttons = f.root.findAllByType("button");
  assert.equal(buttons.length, 5);
  assert.equal(buttons[3].props["aria-current"], "page");
  assert.equal(buttons.every(button => !button.props.disabled), true);
  for (const button of buttons) act(() => button.props.onClick());
  assert.deepEqual(actions, ["city", "author", "environment", "analysis", "recovery"]);
  f.update({ busy: true });
  assert.equal(f.root.findAllByType("button").every(button => button.props.disabled), true);
});

test("invalid location anchors never leak NaN or infinity into the range", t => {
  const f = fixture({ city: { ...city, metadata: {}, instances: [{ ...placement("invalid"), longitude: NaN, latitude: 91 }],
    roads: [], environment: undefined } });
  t.after(f.close);
  assert.doesNotMatch(text(f.root.findByProps({ className: "project-status__location" })), /NaN|Infinity/);
});
