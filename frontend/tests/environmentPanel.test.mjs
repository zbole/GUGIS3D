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
