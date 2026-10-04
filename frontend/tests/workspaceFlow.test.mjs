import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { create, act } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";
const doc = {
  format: "gugis-studio",
  version: "1.1",
  coordinate_system: "ENU_METERS_WGS84",
  parameters: {
    name: "One",
    kind: "georgian",
    floors: 2,
    units: 1,
    floor_height: 3.2,
    scale: 1,
    longitude: -2.603,
    latitude: 51.454,
    altitude: 0,
    heading: 0,
  },
  templates: { wall: { kind: "box", size: [5, 5, 5], color: "#abcdef" } },
  nodes: [
    { id: "building", name: "One", category: "building" },
    {
      id: "wall",
      parent: "building",
      name: "Wall",
      category: "wall",
      template: "wall",
      position: [0, 0, 2.5],
      floor: 1,
    },
  ],
};
const original = {
  format: "gugis-city",
  version: "1.0",
  coordinate_system: "ENU_METERS_WGS84",
  name: "Test city",
  assets: { a: doc },
  instances: [{ id: "one", asset: "a", ...doc.parameters }],
  roads: [],
  metadata: {},
};
const storage = { shared_geometries: 1, component_instances: 1 };
let saved, pending, revision, writes, stages, discards;
const noop = () => {};
globalThis.window = {
  location: { search: "" },
  addEventListener: noop,
  removeEventListener: noop,
  innerHeight: 900,
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;
globalThis.workspaceMock = {
  loadCity: async () => ({ document: saved, revision, storage }),
  loadDraft: async () => pending,
  persistCity: async (next, base) => {
    assert.equal(base, revision);
    saved = next;
    writes++;
    revision = "b".repeat(64);
    return { revision, storage, directory: "test", filename: "city.json" };
  },
  persistDraft: async (next, base, token, label, editor) => {
    assert.equal(base, revision);
    assert.equal(token, pending?.revision ?? null);
    stages++;
    pending = {
      document: next,
      base_revision: base,
      revision: "d".repeat(64),
      label,
      editor,
    };
    return { revision: pending.revision };
  },
  discardDraft: async (token) => {
    assert.equal(token, pending.revision);
    pending = null;
    discards++;
  },
  commitDraft: async (token) => {
    assert.equal(token, pending.revision);
    const result = await globalThis.workspaceMock.persistCity(pending.document, pending.base_revision);
    pending = null;
    return result;
  },
  listVersions: async () => ({
    versions: [
      {
        revision: "f".repeat(64),
        modified_at: "2026-09-01T00:00:00Z",
        bytes: 100,
        current: false,
      },
    ],
    has_more: false,
  }),
  loadVersion: async () => ({ ...original, name: "Historical city" }),
  generateBuilding: async (params) => ({ ...doc, parameters: params }),
  generateBlock: async (count) => ({
    assets: { block: doc },
    instances: Array.from({ length: count }, (_, i) => ({
      ...original.instances[0],
      id: `block${i}`,
      asset: "block",
    })),
  }),
};
const names = [
  "loadCity",
  "loadDraft",
  "persistCity",
  "persistDraft",
  "discardDraft",
  "commitDraft",
  "listVersions",
  "loadVersion",
  "generateBlock",
  "validateCity",
  "importGeoJSON",
  "refineBuilding",
  "demoTerrain",
  "importTerrain",
  "upgradeLegacyTerrain",
];
const App = await componentBundle("CityStudio", [
  {
    name: "workspace-test-doubles",
    setup(build) {
      build.onResolve({ filter: /^react$/ }, () => ({
        path: "react",
        external: true,
      }));
      build.onResolve(
        { filter: /^\.\/(cityApi|api|CityScene|DetailPanel)$/ },
        (args) => ({ path: args.path, namespace: "test" }),
      );
      build.onLoad({ filter: /.*/, namespace: "test" }, ({ path }) => {
        if (path === "./cityApi")
          return {
            contents: `export const cityExportUrl='test-export';export const terrainMultipatchUrl='test-terrain';${names.map((n) => `export const ${n}=(...a)=>globalThis.workspaceMock.${n}(...a);`).join("")}`,
          };
        if (path === "./api")
          return {
            contents: `${["generateBuilding", "validateDocument", "saveDocument", "downloadUrl"].map((n) => `export const ${n}=(...a)=>globalThis.workspaceMock.${n}(...a);`).join("")}`,
          };
        if (path === "./DetailPanel")
          return { contents: "export default function Detail(){return null}" };
        return {
          contents: `import React from 'react';export default React.forwardRef(function Scene(props,ref){globalThis.workspaceScene=props;React.useImperativeHandle(ref,()=>({centerPosition:()=>({longitude:-2.603,latitude:51.454}),reset(){},focus(){},top(){},focusFeature(){},focusBuilding(){}}));return null;})`,
        };
      });
      build.onLoad({ filter: /\.css$/ }, () => ({
        contents: "",
        loader: "js",
      }));
    },
  },
]);
const text = (n) =>
  typeof n === "string" ? n : (n.children ?? []).map(text).join("");
const button = (root, label) =>
  root.findAllByType("button").find((n) => text(n) === label);
async function mount(reset = true) {
  if (reset) {
    saved = structuredClone(original);
    pending = null;
    revision = "a".repeat(64);
    writes = 0;
    stages = 0;
    discards = 0;
  }
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(App));
  });
  return {
    get root() {
      return renderer.root;
    },
    close() {
      act(() => renderer.unmount());
    },
  };
}
async function generate(f) {
  await act(async () => button(f.root, "制作 / 更新").props.onClick());
  await act(async () =>
    f.root
      .findByProps({ className: "author-form" })
      .props.onSubmit({ preventDefault: noop }),
  );
}

const importChosen = (f, chosen) => f.root.findByProps({ "aria-label": "选择 GUGIS 文件" }).props.onChange({ target: { files: [chosen] } });
const importText = content => ({ size: content.length * 3, text: async () => content });

test("city import gives clear JSON root errors and accepts a UTF-8 BOM without changing the formal city", async t => {
  const previous = globalThis.workspaceMock.validateCity;
  let validations = 0;
  globalThis.workspaceMock.validateCity = async payload => { validations++; assert.deepEqual(payload, original); return { document: payload }; };
  t.after(() => { globalThis.workspaceMock.validateCity = previous; });
  const f = await mount(); t.after(() => f.close());
  for (const content of ["<html>Gateway error</html>", "null", "[]", '"text"', "42"]) {
    await act(async () => importChosen(f, importText(content)));
    assert.match(text(f.root.findByProps({ role: "alert" })), /不是有效的 JSON|文件顶层必须/);
    assert.equal(validations, 0); assert.equal(stages, 0); assert.equal(writes, 0);
    assert.equal(button(f.root, "导入城市 / 建筑").props.disabled, false);
  }
  await act(async () => importChosen(f, importText("\uFEFF" + JSON.stringify(original))));
  assert.equal(validations, 1); assert.equal(stages, 1); assert.equal(writes, 0);
  assert.deepEqual(saved, original); assert.deepEqual(pending.document, original);
});

test("duplicate file events coalesce while reading and pending or unavailable drafts block imports", async t => {
  const previous = globalThis.workspaceMock.validateCity, previousLoad = globalThis.workspaceMock.loadDraft;
  globalThis.workspaceMock.validateCity = async payload => ({ document: payload });
  t.after(() => { globalThis.workspaceMock.validateCity = previous; globalThis.workspaceMock.loadDraft = previousLoad; });
  const f = await mount(); t.after(() => f.close());
  let resolve, reads = 0;
  const chosen = { size: 10, text: () => { reads++; return new Promise(yes => { resolve = yes; }); } };
  act(() => { importChosen(f, chosen); importChosen(f, chosen); });
  assert.equal(reads, 1);
  await act(async () => resolve(JSON.stringify(original)));
  assert.equal(stages, 1); assert.equal(writes, 0);
  await act(async () => importChosen(f, chosen));
  assert.equal(reads, 1, "an existing independent draft cannot be silently replaced");
  f.close();
  globalThis.workspaceMock.loadDraft = async () => { throw Error("QA unavailable draft"); };
  const blocked = await mount(); t.after(() => blocked.close());
  assert.equal(button(blocked.root, "导入城市 / 建筑").props.disabled, true);
  await act(async () => importChosen(blocked, chosen));
  assert.equal(reads, 1); assert.equal(stages, 0);
});

test("leaving before file read or validation completes never starts a draft write", async t => {
  const previous = globalThis.workspaceMock.validateCity;
  t.after(() => { globalThis.workspaceMock.validateCity = previous; });
  for (const phase of ["file", "validation"]) {
    let resolve, validations = 0;
    const paused = new Promise(yes => { resolve = yes; });
    globalThis.workspaceMock.validateCity = async payload => { validations++; return phase === "validation" ? paused : { document: payload }; };
    const f = await mount();
    act(() => importChosen(f, { size: 10, text: () => phase === "file" ? paused : Promise.resolve(JSON.stringify(original)) }));
    await act(async () => { await Promise.resolve(); });
    assert.equal(validations, phase === "validation" ? 1 : 0);
    f.close();
    await act(async () => resolve(phase === "file" ? JSON.stringify(original) : { document: original }));
    assert.equal(stages, 0); assert.equal(writes, 0); assert.deepEqual(saved, original);
  }
});

const authorInput = (f, label) => f.root.findByProps({ className: "author-form" })
  .findAllByType("label").find(node => text(node).startsWith(label)).findByType("input");

for (const operation of ["generateBuilding", "generateBlock", "refineBuilding", "loadVersion"]) {
  for (const leave of [false, true]) {
    test(`${operation} coalesces stale repeated events and ${leave ? "never writes a draft after leaving" : "releases its lock for draft discard"}`, async t => {
      const previous = globalThis.workspaceMock[operation];
      t.after(() => { globalThis.workspaceMock[operation] = previous; });
      let resolve, calls = 0;
      const paused = new Promise(yes => { resolve = yes; });
      globalThis.workspaceMock[operation] = async () => { calls++; return paused; };
      const initial = await mount(); initial.close();
      if (operation === "refineBuilding") saved.assets.a.parameters.kind = "footprint";
      const before = JSON.stringify(saved), f = await mount(false);
      t.after(() => f.close());
      let click;
      if (operation === "generateBuilding" || operation === "generateBlock") {
        await act(async () => button(f.root, "制作 / 更新").props.onClick());
        const form = operation === "generateBuilding" ? f.root.findByProps({ className: "author-form" })
          : f.root.findByProps({ className: "block-form" }).findByType("form");
        click = () => form.props.onSubmit({ preventDefault: noop });
      } else if (operation === "refineBuilding") {
        click = button(f.root, "补全精细结构").props.onClick;
      } else {
        await act(async () => button(f.root, "历史版本 / 恢复").props.onClick());
        click = button(f.root, "仅恢复内置建筑（保留地形 / 地物）").props.onClick;
      }
      act(() => { click(); click(); });
      assert.equal(calls, 1, "duplicate events before React updates must share one operation");
      assert.equal(stages, 0); assert.equal(writes, 0);
      if (leave) f.close();
      const result = operation === "generateBlock" ? { assets: { block: doc }, instances: [] }
        : operation === "loadVersion" ? original : operation === "refineBuilding" ? { document: doc } : doc;
      await act(async () => resolve(result));
      assert.equal(stages, leave ? 0 : 1);
      assert.equal(writes, 0); assert.equal(JSON.stringify(saved), before);
      if (!leave) {
        assert.ok(pending);
        await act(async () => button(f.root, "丢弃草稿").props.onClick());
        assert.equal(pending, null); assert.equal(discards, 1);
      } else assert.equal(pending, null);
    });
  }
}

test("copy and discard events cannot start overlapping draft writes", async t => {
  const originalPersist = globalThis.workspaceMock.persistDraft, originalDiscard = globalThis.workspaceMock.discardDraft;
  t.after(() => { globalThis.workspaceMock.persistDraft = originalPersist; globalThis.workspaceMock.discardDraft = originalDiscard; });
  let release, copies = 0, discardAttempts = 0;
  const paused = new Promise(yes => { release = yes; });
  globalThis.workspaceMock.persistDraft = async (...args) => { copies++; await paused; return originalPersist(...args); };
  const f = await mount(); t.after(() => f.close());
  const copy = button(f.root, "复制").props.onClick;
  act(() => { copy(); copy(); });
  assert.equal(copies, 1); assert.equal(stages, 0);
  await act(async () => release());
  assert.equal(stages, 1); assert.equal(pending.document.instances.length, 2);
  let releaseDiscard;
  const pausedDiscard = new Promise(yes => { releaseDiscard = yes; });
  globalThis.workspaceMock.discardDraft = async (...args) => { discardAttempts++; await pausedDiscard; return originalDiscard(...args); };
  const discard = button(f.root, "丢弃草稿").props.onClick;
  act(() => { discard(); discard(); });
  assert.equal(discardAttempts, 1);
  await act(async () => releaseDiscard());
  assert.equal(discards, 1); assert.equal(pending, null); assert.equal(writes, 0);
  assert.deepEqual(saved, original);
});

test("a failed building request releases the operation lock so an explicit retry can stage a draft", async t => {
  const previous = globalThis.workspaceMock.generateBuilding;
  t.after(() => { globalThis.workspaceMock.generateBuilding = previous; });
  let calls = 0;
  globalThis.workspaceMock.generateBuilding = async (...args) => {
    if (++calls === 1) throw Error("QA building service unavailable");
    return previous(...args);
  };
  const f = await mount(); t.after(() => f.close());
  await generate(f);
  assert.match(text(f.root), /QA building service unavailable/);
  assert.equal(stages, 0); assert.equal(writes, 0);
  await generate(f);
  assert.equal(calls, 2); assert.equal(stages, 1); assert.equal(writes, 0);
  assert.ok(pending);
  assert.deepEqual(saved, original);
});

test("workspace navigation preserves an ungenerated building's name and location", async () => {
  const f = await mount();
  await act(async () => button(f.root, "制作 / 更新").props.onClick());
  act(() => authorInput(f, "建筑名称").props.onChange({ target: { value: "Retained new building" } }));
  act(() => authorInput(f, "经度").props.onChange({ target: { value: "-2.615" } }));
  await act(async () => button(f.root, "地形 / 地物").props.onClick());
  await act(async () => button(f.root, "空间分析").props.onClick());
  await act(async () => button(f.root, "制作 / 更新").props.onClick());
  assert.equal(authorInput(f, "建筑名称").props.value, "Retained new building");
  assert.equal(authorInput(f, "经度").props.value, -2.615);
  assert.equal(writes, 0); assert.equal(stages, 0);
  f.close();
});

test("returning to an existing building's editor preserves update mode and object identity", async () => {
  const f = await mount();
  act(() => globalThis.workspaceScene.onSelect("one"));
  await act(async () => button(f.root, "修改建筑").props.onClick());
  act(() => authorInput(f, "建筑名称").props.onChange({ target: { value: "Edited original" } }));
  await act(async () => button(f.root, "地形 / 地物").props.onClick());
  await act(async () => button(f.root, "制作 / 更新").props.onClick());
  assert.equal(authorInput(f, "建筑名称").props.value, "Edited original");
  assert.ok(button(f.root, "预览建筑修改"));
  await act(async () => f.root.findByProps({ className: "author-form" }).props.onSubmit({ preventDefault: noop }));
  assert.equal(pending.editor.mode, "update");
  assert.equal(pending.editor.instance_id, "one");
  assert.equal(pending.document.instances.length, 1);
  assert.equal(writes, 0);
  f.close();
});

test("workspace changes stop drawing tools while retaining the analysis route", async () => {
  const f = await mount();
  await drawAnalysis(f);
  const points = structuredClone(globalThis.workspaceScene.analysisPoints);
  await act(async () => button(f.root, "继续绘制").props.onClick());
  assert.equal(globalThis.workspaceScene.analysisDrawing, true);
  await act(async () => button(f.root, "制作 / 更新").props.onClick());
  assert.equal(globalThis.workspaceScene.analysisDrawing, false);
  await act(async () => button(f.root, "空间分析").props.onClick());
  assert.deepEqual(globalThis.workspaceScene.analysisPoints, points);
  assert.equal(globalThis.workspaceScene.analysisDrawing, false);
  assert.equal(writes, 0);
  f.close();
});
test("generate previews a separate durable draft, and only confirmation writes the city", async () => {
  const f = await mount();
  await generate(f);
  assert.equal(writes, 0);
  assert.equal(stages, 1);
  assert.equal(saved.instances.length, 1);
  assert.equal(globalThis.workspaceScene.city.instances.length, 2);
  assert.match(text(f.root.findByProps({ "aria-label": "当前场景数据统计" })), /草稿场景 · 2 栋建筑.*2 栋构件模型/);
  assert.match(text(f.root.findByProps({ "aria-label": "正式城市档案统计" })), /正式档案 · 未含草稿1 建筑实例/);
  assert.match(
    text(f.root.findByProps({ "aria-label": "未提交城市草稿" })),
    /正式城市尚未改变/,
  );
  await act(async () => button(f.root, "确认写入正式城市").props.onClick());
  assert.equal(writes, 1);
  assert.equal(discards, 0, "confirmation uses one server request without a separate cleanup");
  assert.equal(saved.instances.length, 2);
  assert.equal(pending, null);
  assert.match(text(f.root.findByProps({ "aria-label": "当前场景数据统计" })), /正式场景 · 2 栋建筑/);
  assert.match(text(f.root.findByProps({ "aria-label": "正式城市档案统计" })), /正式档案2 建筑实例/);
  f.close();
});
test("draft survives page remount; discarding restores the original scene without a city write", async () => {
  const first = await mount();
  await generate(first);
  first.close();
  const second = await mount(false);
  assert.equal(globalThis.workspaceScene.city.instances.length, 2);
  await act(async () => button(second.root, "丢弃草稿").props.onClick());
  assert.equal(globalThis.workspaceScene.city.instances.length, 1);
  assert.match(text(second.root.findByProps({ "aria-label": "当前场景数据统计" })), /正式场景 · 1 栋建筑/);
  assert.equal(writes, 0);
  assert.equal(pending, null);
  second.close();
});

test("restored preview statistics and project name describe the scene while archived counts stay formal", async t => {
  const first = await mount(); first.close();
  const previewCity = structuredClone(original);
  previewCity.name = "Restored scene";
  previewCity.assets.outline = { ...doc, parameters: { ...doc.parameters, kind: "footprint" } };
  previewCity.instances.push({ ...original.instances[0], id: "outline", asset: "outline" });
  previewCity.roads.push({ id: "test-road", name: "Draft road", coordinates: [[-2.603, 51.454], [-2.604, 51.455]] });
  pending = { document: previewCity, base_revision: revision, revision: "d".repeat(64), label: "Restored draft" };
  const f = await mount(false); t.after(() => f.close());
  assert.equal(text(f.root.findByType("h1")), "Restored scene");
  assert.match(text(f.root.findByProps({ "aria-label": "当前场景数据统计" })), /草稿场景 · 2 栋建筑.*1 栋构件模型.*1 条道路/);
  const archive = text(f.root.findByProps({ "aria-label": "正式城市档案统计" }));
  assert.match(archive, /正式档案 · 未含草稿1 建筑实例/);
  assert.match(archive, /0 道路要素/);
  assert.equal(writes, 0);
  await act(async () => button(f.root, "丢弃草稿").props.onClick());
  assert.equal(text(f.root.findByType("h1")), "Test city");
  assert.match(text(f.root.findByProps({ "aria-label": "当前场景数据统计" })), /正式场景 · 1 栋建筑.*1 栋构件模型.*0 条道路/);
  assert.equal(writes, 0);
});
test("reloaded building preview restores editor and regenerates the same instance", async () => {
  const first = await mount();
  await generate(first);
  const id = pending.editor.instance_id;
  pending.editor.parameters = {...pending.editor.parameters, kind: "warehouse", name: "Saved warehouse", floors: 4};
  first.close();
  const f = await mount(false);
  await act(async () => button(f.root, "制作 / 更新").props.onClick());
  assert.equal(f.root.findAllByType("input").find(n => n.props.maxLength === 80).props.value, "Saved warehouse");
  await act(async () => f.root.findByProps({className:"author-form"}).props.onSubmit({preventDefault:noop}));
  assert.equal(pending.editor.instance_id, id);
  assert.equal(pending.editor.parameters.kind, "warehouse");
  assert.equal(pending.document.instances.length, 2);
  assert.equal(writes, 0);
  f.close();
});
test("failed draft load permits reading the city but blocks both draft replacement and formal deletion until reload succeeds", async () => {
  const load = globalThis.workspaceMock.loadDraft;
  globalThis.workspaceMock.loadDraft = async () => { throw new Error("Invalid pending file"); };
  try {
    const f = await mount();
    assert.equal(globalThis.workspaceScene.city.name, "Test city");
    assert.match(text(f.root.findByProps({role:"alert"})), /正式城市已载入/);
    const remove = button(f.root, "删除");
    assert.equal(remove.props.disabled, true);
    assert.equal(button(f.root, "复制").props.disabled, true);
    assert.equal(button(f.root, "单栋导出").props.disabled, false);
    assert.equal(button(f.root, "查看实体与楼层").props.disabled, undefined);
    await act(async () => remove.props.onClick());
    assert.equal(writes, 0); assert.deepEqual(saved, original);
    await generate(f);
    assert.equal(stages, 0);
    globalThis.workspaceMock.loadDraft = load;
    await act(async () => button(f.root, "重新载入已保存项目").props.onClick());
    await act(async () => button(f.root, "城市项目").props.onClick());
    assert.equal(button(f.root, "删除").props.disabled, false);
    await act(async () => button(f.root, "删除").props.onClick());
    assert.equal(writes, 1); assert.equal(saved.instances.length, 0);
    f.close();
  } finally { globalThis.workspaceMock.loadDraft = load; }
});

test("a detached formal-delete handler cannot start a city write after leaving the workbench", async () => {
  const f = await mount();
  const remove = button(f.root, "删除").props.onClick;
  f.close();
  await act(async () => remove());
  assert.equal(writes, 0); assert.equal(stages, 0); assert.deepEqual(saved, original);
});
test("an unconfirmed commit failure retains the preview for retry", async () => {
  const f = await mount();
  await generate(f);
  const commit = globalThis.workspaceMock.commitDraft;
  globalThis.workspaceMock.commitDraft = async () => { throw new Error("Connection lost"); };
  try {
    await act(async () => button(f.root, "确认写入正式城市").props.onClick());
    assert.equal(writes, 0);
    assert.ok(pending);
    assert.equal(button(f.root, "确认写入正式城市").props.disabled, false);
  } finally { globalThis.workspaceMock.commitDraft = commit; }
  await act(async () => button(f.root, "确认写入正式城市").props.onClick());
  assert.equal(writes, 1);
  f.close();
});
test("changed authoring parameters require a new preview before confirmation", async () => {
  const f = await mount();
  await generate(f);
  const name = f.root
    .findAllByType("input")
    .find((n) => n.props.maxLength === 80);
  act(() => name.props.onChange({ target: { value: "Changed draft" } }));
  assert.equal(button(f.root, "确认写入正式城市").props.disabled, true);
  await act(async () => button(f.root, "确认写入正式城市").props.onClick());
  assert.equal(writes, 0);
  f.close();
});
test("historical recovery first previews and then restores on explicit confirmation", async () => {
  const f = await mount();
  await act(async () => button(f.root, "历史版本 / 恢复").props.onClick());
  await act(async () => button(f.root, "预览这个版本").props.onClick());
  assert.equal(writes, 0);
  assert.equal(saved.name, "Test city");
  assert.equal(globalThis.workspaceScene.city.name, "Historical city");
  await act(async () => button(f.root, "确认写入正式城市").props.onClick());
  assert.equal(saved.name, "Historical city");
  assert.equal(writes, 1);
  f.close();
});
test("a draft based on another saved revision cannot be confirmed", async () => {
  const first = await mount();
  await generate(first);
  first.close();
  revision = "c".repeat(64);
  const f = await mount(false);
  assert.equal(button(f.root, "确认写入正式城市").props.disabled, true);
  await act(async () => button(f.root, "确认写入正式城市").props.onClick());
  assert.equal(writes, 0);
  f.close();
});
test("block generation adds a batch to the preview while preserving the saved dataset", async () => {
  const f = await mount();
  await act(async () => button(f.root, "制作 / 更新").props.onClick());
  const select = f.root.findByProps({ "aria-label": "街区建筑数量" });
  act(() => select.props.onChange({ target: { value: "48" } }));
  const form = f.root
    .findByProps({ className: "block-form" })
    .findByType("form");
  await act(async () => form.props.onSubmit({ preventDefault: noop }));
  assert.equal(writes, 0);
  assert.equal(saved.instances.length, 1);
  assert.equal(globalThis.workspaceScene.city.instances.length, 49);
  f.close();
});
test("restoring only the built-in buildings preserves current terrain, features and roads", async () => {
  const first = await mount();
  first.close();
  saved = {
    ...saved,
    environment: {
      version: "1.0",
      features: [],
      feature_assets: {},
      drape_buildings: true,
      terrain: null,
    },
    roads: [
      {
        id: "road",
        name: "retained",
        width: 4,
        coordinates: [
          [-2.603, 51.454],
          [-2.602, 51.454],
        ],
      },
    ],
    instances: [...saved.instances, { ...saved.instances[0], id: "custom" }],
  };
  const f = await mount(false);
  await act(async () => button(f.root, "历史版本 / 恢复").props.onClick());
  await act(async () =>
    button(f.root, "仅恢复内置建筑（保留地形 / 地物）").props.onClick(),
  );
  assert.equal(writes, 0);
  assert.equal(globalThis.workspaceScene.city.instances.length, 1);
  assert.deepEqual(
    globalThis.workspaceScene.city.environment,
    saved.environment,
  );
  assert.deepEqual(globalThis.workspaceScene.city.roads, saved.roads);
  f.close();
});

const analysisRecords = () => JSON.parse(saved.metadata.gugis_path_analyses_v1 ?? '{"records":[]}').records;
async function waitForAnalysis() {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 110)));
}
async function drawAnalysis(f) {
  await act(async () => button(f.root, "空间分析").props.onClick());
  await act(async () => button(f.root, "开始绘制").props.onClick());
  assert.equal(globalThis.workspaceScene.analysisDrawing, true);
  act(() => globalThis.workspaceScene.onAnalysisPoint({ longitude: -2.603, latitude: 51.454, altitude: 0 }));
  act(() => globalThis.workspaceScene.onAnalysisPoint({ longitude: -2.6027, latitude: 51.4543, altitude: 4 }));
  await waitForAnalysis();
  assert.ok(globalThis.workspaceScene.analysisProfile.horizontalDistance > 30);
  await act(async () => button(f.root, "完成绘制").props.onClick());
  assert.equal(globalThis.workspaceScene.analysisDrawing, false);
}

test("path drawing and clearing are read-only previews, including without terrain", async () => {
  const f = await mount();
  const originalSaved = structuredClone(saved);
  await drawAnalysis(f);
  assert.equal(globalThis.workspaceScene.analysisPoints.length, 2);
  assert.equal(globalThis.workspaceScene.analysisProfile.coverage, 0);
  assert.equal(globalThis.workspaceScene.analysisProfile.surfaceDistance, null);
  assert.equal(writes, 0);
  assert.equal(stages, 0);
  assert.deepEqual(saved, originalSaved);
  await act(async () => button(f.root, "清空").props.onClick());
  assert.deepEqual(globalThis.workspaceScene.analysisPoints, []);
  assert.equal(globalThis.workspaceScene.analysisProfile, null);
  assert.equal(writes, 0);
  assert.deepEqual(saved, originalSaved);
  f.close();
});

test("requesting an export does not claim that the browser download already succeeded", async () => {
  const f = await mount();
  try {
    const download = f.root.findAllByType("a").find(node => node.props.href === "test-export");
    act(() => download.props.onClick());
    assert.match(text(f.root), /已请求导出正式城市，请确认浏览器下载完成/);
    assert.doesNotMatch(text(f.root), /整座城市已导出/);
    assert.equal(writes, 0);
    assert.equal(stages, 0);
  } finally { f.close(); }
});

test("a failed analysis can be retried without redrawing or writing the city", async () => {
  const originalWorker = globalThis.Worker;
  globalThis.Worker = class { constructor() { throw new Error("Analysis worker unavailable"); } };
  const f = await mount();
  try {
    const originalSaved = structuredClone(saved);
    await act(async () => button(f.root, "空间分析").props.onClick());
    await act(async () => button(f.root, "开始绘制").props.onClick());
    const route = [
      { longitude: -2.603, latitude: 51.454, altitude: 0 },
      { longitude: -2.6027, latitude: 51.4543, altitude: 4 },
    ];
    act(() => route.forEach(point => globalThis.workspaceScene.onAnalysisPoint(point)));
    await waitForAnalysis();
    assert.match(text(f.root), /Analysis worker unavailable/);
    assert.equal(globalThis.workspaceScene.analysisProfile, null);
    assert.equal(button(f.root, "重新计算剖面").props.disabled, false);
    delete globalThis.Worker; // The fallback now succeeds without altering the route.
    await act(async () => button(f.root, "重新计算剖面").props.onClick());
    await waitForAnalysis();
    assert.equal(button(f.root, "重新计算剖面"), undefined);
    assert.doesNotMatch(text(f.root), /Analysis worker unavailable/);
    assert.deepEqual(globalThis.workspaceScene.analysisPoints, route);
    assert.ok(globalThis.workspaceScene.analysisProfile.horizontalDistance > 30);
    assert.equal(writes, 0);
    assert.equal(stages, 0);
    assert.deepEqual(saved, originalSaved);
  } finally {
    f.close();
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("explicit analysis save survives remount, updates one record, and deletion can be undone", async () => {
  const first = await mount();
  await drawAnalysis(first);
  act(() => first.root.findByProps({ "aria-label": "分析名称" }).props.onChange({ target: { value: "码头步行路线" } }));
  await act(async () => button(first.root, "保存分析").props.onClick());
  assert.equal(writes, 1);
  assert.equal(revision, "b".repeat(64));
  assert.equal(pending, null);
  assert.equal(analysisRecords().length, 1);
  const id = analysisRecords()[0].id;
  const originalPoints = structuredClone(analysisRecords()[0].points);
  assert.equal(analysisRecords()[0].name, "码头步行路线");
  assert.equal(analysisRecords()[0].terrainFingerprint, "none");
  assert.equal(analysisRecords()[0].result.coverage, 0);
  assert.equal(analysisRecords()[0].coordinateSystem, "WGS84_DEGREES_LOCAL_HEIGHT_METERS");
  act(() => first.root.findByProps({ "aria-label": "分析名称" }).props.onChange({ target: { value: "更新后的码头路线" } }));
  await act(async () => button(first.root, "更新分析").props.onClick());
  assert.equal(writes, 2);
  assert.equal(analysisRecords().length, 1);
  assert.equal(analysisRecords()[0].id, id);
  assert.equal(analysisRecords()[0].name, "更新后的码头路线");
  first.close();

  const second = await mount(false);
  await act(async () => button(second.root, "空间分析").props.onClick());
  assert.equal(writes, 2);
  assert.match(text(second.root.findByProps({ className: "analysis-record" })), /更新后的码头路线/);
  await act(async () => second.root.findByProps({ className: "analysis-record" }).props.onClick());
  await waitForAnalysis();
  assert.deepEqual(globalThis.workspaceScene.analysisPoints, originalPoints);
  assert.equal(second.root.findByProps({ "aria-label": "分析名称" }).props.value, "更新后的码头路线");
  assert.equal(button(second.root, "更新分析").props.disabled, false);
  assert.equal(writes, 2, "reopening only recalculates the preview");
  await act(async () => second.root.findByProps({ "aria-label": "删除分析 更新后的码头路线" }).props.onClick());
  assert.equal(writes, 3);
  assert.equal(analysisRecords().length, 0);
  await act(async () => button(second.root, "撤销修改").props.onClick());
  assert.equal(writes, 4);
  assert.equal(analysisRecords().length, 1);
  assert.equal(analysisRecords()[0].id, id);
  assert.deepEqual(saved.instances, original.instances);
  second.close();
});

test("a pending building draft permits path preview but blocks analysis writes", async () => {
  const f = await mount();
  await generate(f);
  const pendingBefore = structuredClone(pending);
  const formalBefore = structuredClone(saved);
  await drawAnalysis(f);
  assert.equal(button(f.root, "保存分析").props.disabled, true);
  await act(async () => button(f.root, "保存分析").props.onClick());
  assert.equal(writes, 0);
  assert.deepEqual(saved, formalBefore);
  assert.deepEqual(pending, pendingBefore);
  assert.equal(analysisRecords().length, 0);
  await act(async () => button(f.root, "清空").props.onClick());
  assert.deepEqual(pending, pendingBefore);
  assert.equal(writes, 0);
  f.close();
});

test("unified city point query remains a preview and section width persists only on explicit save", async () => {
  const f = await mount();
  await drawAnalysis(f);
  await act(async () => button(f.root, "城市联合剖面").props.onClick());
  assert.equal(globalThis.workspaceScene.spatialPicking, false);
  await act(async () => button(f.root, "在场景中选点查询").props.onClick());
  assert.equal(globalThis.workspaceScene.spatialPicking, true);
  act(() => globalThis.workspaceScene.onSpatialPoint({ longitude: -2.603, latitude: 51.454, altitude: 0 }, "one/wall"));
  assert.equal(writes, 0);
  assert.ok(text(f.root.findByProps({ "aria-label": "城市联合分析面板" })).includes("邻近对象"));
  act(() => f.root.findByProps({ "aria-label": "剖面带宽" }).props.onChange({ target: { value: "40" } }));
  assert.equal(writes, 0);
  await act(async () => button(f.root, "保存路线与剖面带").props.onClick());
  assert.equal(writes, 1);
  assert.equal(analysisRecords()[0].sectionWidth, 40);
  const id = analysisRecords()[0].id;
  f.close();
  const restored = await mount(false);
  await act(async () => button(restored.root, "空间分析").props.onClick());
  await act(async () => restored.root.findByProps({ className: "analysis-record" }).props.onClick());
  await waitForAnalysis();
  await act(async () => button(restored.root, "城市联合剖面").props.onClick());
  assert.equal(restored.root.findByProps({ "aria-label": "剖面带宽" }).props.value, 40);
  assert.equal(analysisRecords()[0].id, id);
  assert.equal(writes, 1, "opening and recomputing may not write a new city revision");
  restored.close();
});
