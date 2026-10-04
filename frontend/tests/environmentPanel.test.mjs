import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";
import { featurePresets, emptyEnvironment } from "../src/studio/environment.ts";

let demoCalls = 0;
globalThis.environmentApiMock = {
  demoTerrain: async () => {
    demoCalls++;
    return { terrain: null };
  },
  importTerrain: async () => {
    throw new Error("test import error");
  },
  upgradeLegacyTerrain: async (terrain) => ({ terrain }),
};
const Panel = await componentBundle("EnvironmentPanel", [
  {
    name: "local-api-double",
    setup(build) {
      build.onResolve({ filter: /^\.\/cityApi$/ }, () => ({
        path: "cityApi",
        namespace: "test",
      }));
      build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
        contents:
          "export const { demoTerrain, importTerrain, upgradeLegacyTerrain } = globalThis.environmentApiMock; export const terrainMultipatchUrl='test-terrain';",
      }));
    },
  },
]);
const noop = () => {};
const text = (node) =>
  typeof node === "string" ? node : (node.children ?? []).map(text).join("");
const button = (root, title) =>
  root.findAllByType("button").find((n) => text(n) === title);
const lamp = (id) => ({
  id,
  asset: "lamp",
  name: id,
  longitude: -2.603,
  latitude: 51.454,
  altitude: 0,
  heading: 0,
  scale: 1,
  layer: "surface",
});
function fixture(overrides = {}) {
  let renderer,
    props = {
      environment: emptyEnvironment(),
      busy: false,
      save: async () => true,
      position: { longitude: -2.603, latitude: 51.454, altitude: 0 },
      setPosition: noop,
      placing: false,
      onPick: noop,
      onCenter: noop,
      selected: null,
      onSelect: noop,
      focus: noop,
      opacity: 1,
      setOpacity: noop,
      wire: false,
      setWire: noop,
      query: false,
      setQuery: noop,
      hit: null,
      onEditingChange: noop,
      ...overrides,
    };
  act(() => {
    renderer = create(React.createElement(Panel, props));
  });
  return {
    get root() {
      return renderer.root;
    },
    update(next) {
      props = { ...props, ...next };
      act(() => renderer.update(React.createElement(Panel, props)));
    },
    close() {
      act(() => renderer.unmount());
    },
  };
}

test("cancelling the DEM file picker neither generates terrain nor saves the city", async () => {
  let saves = 0;
  const f = fixture({
    save: async () => {
      saves++;
      return true;
    },
  });
  const before = demoCalls;
  await act(async () =>
    f.root
      .findByProps({ "aria-label": "选择 DEM 文件" })
      .props.onChange({ target: { files: [] } }),
  );
  assert.equal(demoCalls, before);
  assert.equal(saves, 0);
  f.close();
});

const terrainFixture = () => ({ id: "qa-terrain", name: "QA 合成地形", longitude: -2.603, latitude: 51.454,
  reference_height: 0, vertical_datum: "local", demonstration: true, source: { 来源: "test-only" },
  points: [[0,0,0], [10,0,1], [0,10,2], [10,10,3]],
  patches: [{ id: "strip", kind: "ruled-strip", left: [0,1], right: [2,3] }] });

test("DEM and demonstration generation create a preview without calling the formal environment save", async () => {
  const imported = terrainFixture(), calls = [], previews = [];
  const env = { ...emptyEnvironment(), feature_assets: { lamp: featurePresets.lamp }, features: [lamp("retained")] };
  let saves = 0;
  const f = fixture({ environment: env, initialSection: "terrain", save: async () => { saves++; return true; },
    previewTerrain: async (terrain, label) => { previews.push({ terrain, label }); return true; },
    api: { demoTerrain: async () => ({ terrain: imported }), importTerrain: async (...args) => { calls.push(args); return { terrain: imported }; } } });
  await act(async () => button(f.root, "创建演示地形（非实测）").props.onClick());
  assert.equal(saves, 0);
  assert.equal(previews[0].terrain, imported);
  assert.match(previews[0].label, /非实测.*预览/);
  const chosen = { name: "sample.asc", size: 50 };
  await act(async () => f.root.findByProps({ "aria-label": "选择 DEM 文件" }).props.onChange({ target: { files: [chosen] } }));
  assert.deepEqual(calls[0], [chosen, "", "unknown", 10]);
  assert.equal(saves, 0);
  assert.equal(previews.length, 2);
  assert.deepEqual(env.features, [lamp("retained")]);
  assert.equal(env.terrain, undefined);
  f.close();
});

test("overlapping terrain actions are coalesced and abandoning the panel prevents a late draft", async () => {
  let resolve, requests = 0, previews = 0;
  const pending = new Promise(yes => { resolve = yes; });
  const f = fixture({ previewTerrain: async () => { previews++; return true; },
    api: { demoTerrain: () => { requests++; return pending; } } });
  const create = button(f.root, "创建演示地形（非实测）").props.onClick;
  act(() => { create(); create(); });
  assert.equal(requests, 1);
  assert.match(text(f.root.findByProps({ role: "status" })), /独立预览草稿/);
  f.close();
  await act(async () => resolve({ terrain: terrainFixture() }));
  assert.equal(previews, 0);
});

test("DEM datum stays unknown until explicitly selected and horizontal CRS does not set it", async () => {
  const calls = [];
  const f = fixture({ initialSection: "terrain", previewTerrain: async () => true,
    api: { importTerrain: async (...args) => { calls.push(args); return { terrain: terrainFixture() }; } } });
  const datum = () => f.root.findAllByType("select").find(n => n.findAllByType("option").some(o => o.props.value === "ODN"));
  const crs = f.root.findAllByType("select").find(n => n.findAllByType("option").some(o => o.props.value === "EPSG:27700"));
  assert.equal(datum().props.value, "unknown");
  act(() => crs.props.onChange({ target: { value: "EPSG:27700" } }));
  assert.equal(datum().props.value, "unknown");
  assert.match(text(f.root), /默认不推断高程基准/);
  for (const value of ["ODN", "ellipsoidal", "unknown"]) {
    act(() => datum().props.onChange({ target: { value } }));
    const chosen = { name: "qa.asc", size: 10 };
    await act(async () => f.root.findByProps({ "aria-label": "选择 DEM 文件" }).props.onChange({ target: { files: [chosen] } }));
    assert.deepEqual(calls.at(-1), [chosen, "EPSG:27700", value, 10]);
  }
  f.close();
});

test("failed terrain conversion and oversized DEM cannot create a draft or save formal data", async () => {
  let previews = 0, saves = 0, imports = 0;
  const f = fixture({ save: async () => { saves++; return true; }, previewTerrain: async () => { previews++; return true; },
    api: { demoTerrain: async () => { throw new Error("conversion failed"); }, importTerrain: async () => { imports++; throw new Error("unexpected"); } } });
  await act(async () => button(f.root, "创建演示地形（非实测）").props.onClick());
  assert.match(text(f.root.findByProps({ role: "alert" })), /conversion failed/);
  await act(async () => f.root.findByProps({ "aria-label": "选择 DEM 文件" }).props.onChange({ target: { files: [{ size: 128*1024*1024 + 1 }] } }));
  assert.match(text(f.root.findByProps({ role: "alert" })), /128 MiB/);
  assert.equal(previews + saves + imports, 0);
  f.close();
});

test("legacy fan conversion also stages a preview and draft views cannot download stale formal terrain", async () => {
  const original = { ...terrainFixture(), patches: [{ id: "legacy", kind: "triangle-fan", hub: 0, ring: [1,2,3] }] };
  const converted = terrainFixture(), env = { ...emptyEnvironment(), terrain: original };
  let staged, saves = 0;
  const f = fixture({ environment: env, initialSection: "terrain", save: async () => { saves++; return true; },
    previewTerrain: async (terrain, label) => { staged = { terrain, label }; return true; },
    api: { upgradeLegacyTerrain: async () => ({ terrain: converted }), terrainMultipatchUrl: "formal-only" } });
  await act(async () => button(f.root, "转换旧三角扇为三角带（保留原三角面）").props.onClick());
  assert.equal(staged.terrain, converted);
  assert.match(staged.label, /保留原三角面/);
  assert.equal(saves, 0);
  assert.equal(env.terrain, original);
  f.update({ terrainIsDraft: true, busy: true, environment: { ...env, terrain: converted } });
  assert.equal(f.root.findAllByType("a").filter(a => a.props.href === "formal-only").length, 0);
  assert.match(text(f.root), /确认写入后可下载/);
  f.close();
});

test("undo/reload refreshes the selected feature form even when its ID is unchanged", () => {
  const before = {
    ...emptyEnvironment(),
    feature_assets: { lamp: featurePresets.lamp },
    features: [lamp("same")],
  };
  const f = fixture({ environment: before, selected: "same" });
  const after = {
    ...before,
    features: [{ ...before.features[0], name: "after undo", scale: 2 }],
  };
  f.update({ environment: after });
  assert.equal(
    f.root.findAllByType("input").find((n) => n.props.maxLength === 80).props
      .value,
    "after undo",
  );
  assert.equal(
    f.root.findAllByType("input").find((n) => n.props.max === "20").props.value,
    2,
  );
  f.close();
});

test("editing a component color uses copy-on-write; a copied feature reuses an unchanged asset", async () => {
  const env = {
    ...emptyEnvironment(),
    feature_assets: { lamp: featurePresets.lamp },
    features: [lamp("one"), lamp("two")],
  };
  let next;
  const f = fixture({
    environment: env,
    selected: "one",
    save: async (value) => {
      next = value;
      return true;
    },
  });
  const color = f.root.findAllByProps({ type: "color" })[0];
  act(() => color.props.onChange({ target: { value: "#123456" } }));
  await act(async () =>
    f.root.findByType("form").props.onSubmit({ preventDefault: noop }),
  );
  assert.notEqual(next.features[0].asset, "lamp");
  assert.equal(
    next.feature_assets[next.features[0].asset].components[0].color,
    "#123456",
  );
  assert.deepEqual(next.feature_assets.lamp, env.feature_assets.lamp);
  assert.equal(next.features[1].asset, "lamp");
  // Start a copy from the original definition. Its geometry should be shared.
  f.update({ selected: "two" });
  act(() => button(f.root, "复制为新地物草稿").props.onClick());
  f.update({ selected: null });
  await act(async () =>
    f.root.findByType("form").props.onSubmit({ preventDefault: noop }),
  );
  assert.equal(next.features.length, 3);
  assert.equal(next.features[2].asset, "lamp");
  assert.match(next.features[2].name, /副本/);
  f.close();
});

test("opt-in shared function edit previews affected instances and preserves each placement", async () => {
  const first = lamp("one"), second = { ...lamp("two"), altitude: -5, layer: "underground", heading: 47 };
  const env = { ...emptyEnvironment(), feature_assets: { lamp: featurePresets.lamp }, features: [first, second] };
  let saved;
  const f = fixture({ environment: env, selected: "one", save: async next => { saved = next; return true; } });
  const color = f.root.findAllByProps({ type: "color" })[0];
  act(() => color.props.onChange({ target: { value: "#345678" } }));
  const preview = f.root.findByProps({ className: "feature-batch-preview" });
  assert.match(text(preview), /2 个实例/);
  assert.match(text(preview), /仅更新当前实例/);
  act(() => f.root.findByProps({ "aria-label": "同步更新同定义地物" }).props.onChange({ target: { checked: true } }));
  assert.match(text(f.root.findByProps({ className: "feature-batch-preview" })), /将影响 2 个实例/);
  await act(async () => f.root.findByType("form").props.onSubmit({ preventDefault: noop }));
  assert.equal(saved.features.length, 2);
  assert.equal(saved.features[0].asset, saved.features[1].asset);
  assert.notEqual(saved.features[0].asset, "lamp");
  assert.equal(saved.feature_assets[saved.features[0].asset].components[0].color, "#345678");
  assert.deepEqual(saved.features[1], { ...second, asset: saved.features[0].asset });
  assert.equal(env.feature_assets.lamp.components[0].color, featurePresets.lamp.components[0].color);
  f.close();
});

test("invalid inner/outer radii are explained locally and never sent to the save API", async () => {
  let saves = 0;
  const f = fixture({
    save: async () => {
      saves++;
      return true;
    },
  });
  act(() => button(f.root, "函数地物").props.onClick());
  act(() =>
    f.root
      .findByProps({ "aria-label": "地物类型" })
      .props.onChange({ target: { value: "arched-door" } }),
  );
  const inner = f.root.findAllByType("input").find((n) => n.props.min === 0);
  act(() => inner.props.onChange({ target: { value: "999" } }));
  assert.match(
    text(f.root.findByProps({ role: "alert" })),
    /外半径必须大于内半径/,
  );
  assert.equal(button(f.root, "添加函数地物").props.disabled, true);
  await act(async () =>
    f.root.findByType("form").props.onSubmit({ preventDefault: noop }),
  );
  assert.equal(saves, 0);
  f.close();
});

test("switching panel sections exits query mode and hides the feature draft marker", () => {
  const editing = [],
    queries = [];
  const f = fixture({
    onEditingChange: (value) => editing.push(value),
    setQuery: (value) => queries.push(value),
  });
  act(() => button(f.root, "函数地物").props.onClick());
  assert.equal(editing.at(-1), true);
  act(() => button(f.root, "地形").props.onClick());
  assert.equal(editing.at(-1), false);
  assert.equal(queries.at(-1), false);
  f.close();
});

test("a selected function feature does not force the panel back from terrain on rerender", () => {
  const environment = {
    ...emptyEnvironment(),
    feature_assets: { lamp: featurePresets.lamp },
    features: [lamp("one")],
  };
  const f = fixture({ environment, selected: "one" });
  act(() => button(f.root, "地形").props.onClick());
  f.update({ environment: { ...environment } });
  assert.ok(button(f.root, "创建演示地形（非实测）"));
  assert.equal(button(f.root, "保存地物修改"), undefined);
  f.close();
});

test("the terrain comparison link opens terrain even with a preselected feature", () => {
  const environment = {
    ...emptyEnvironment(),
    feature_assets: { lamp: featurePresets.lamp },
    features: [lamp("one"), lamp("two")],
  };
  const f = fixture({ environment, selected: null, initialSection: "terrain" });
  f.update({ selected: "one" });
  assert.ok(button(f.root, "创建演示地形（非实测）"));
  assert.equal(button(f.root, "保存地物修改"), undefined);
  f.update({ selected: "two" });
  assert.ok(button(f.root, "保存地物修改"));
  f.close();
});
