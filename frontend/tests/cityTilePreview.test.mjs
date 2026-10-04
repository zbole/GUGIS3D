import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import React from "react";
import { act, create } from "react-test-renderer";
import { Rectangle, ScreenSpaceEventType, Cartesian2, Cartesian3, Ellipsoid, Matrix4 } from "cesium";
import { componentBundle } from "./helpers/componentBundle.mjs";
import { viewState } from "./helpers/cesiumMock.mjs";

// Exercise the real loader and scene with real Cesium geometry, but no WebGL.
const Preview = await componentBundle("CityTilePreview", [{
  name: "tile-preview-gpu-free",
  setup(build) {
    build.onResolve({ filter: /^cesium$/ }, () => ({
      path: new URL("./helpers/cesiumMock.mjs", import.meta.url).href, external: true,
    }));
    build.onLoad({ filter: /\.css$/ }, () => ({ contents: "", loader: "js" }));
  },
}]);
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const encode = value => Buffer.from(JSON.stringify(value));
const revision = "a".repeat(64);
const workspaces = Object.fromEntries([
  ["bristol", "布里斯托", -2.603, 51.454],
  ["london", "伦敦", -0.1276, 51.5072],
  ["birmingham", "伯明翰", -1.9027, 52.4797],
].map(([id, name, lon, lat]) => [id, { id, name, status: "ready", coverage_kind: "sample-area",
  coverage_label: "目录覆盖说明", center_wgs84: [lon, lat] }]));

// Small portable wire fixtures: the manifest ETag and tile descriptors hash the
// exact response bytes rather than relying on JSON canonicalization conventions.
function renderPackage(cityId = "bristol", { tiles = 2, duplicate = false, sourceRevision = revision,
  warnings = [{ code: "source-height", message: "已有模型高度与源标签有差异，请核对源数据。" }] } = {}) {
  const [longitude, latitude] = workspaces[cityId].center_wgs84;
  const tileBytes = new Map();
  const descriptors = Array.from({ length: tiles }, (_, index) => {
    const tileId = `x${index}_y0`, lon = longitude + index * 0.004;
    const instances = [{ id: `${cityId}-building-${duplicate ? 0 : index}`, asset: "brick", name: "源建筑",
      longitude: duplicate ? longitude : lon, latitude, altitude: 0, heading: 17 }];
    const body = encode({ format: "gugis-render-tile-v1", city_id: cityId, revision: sourceRevision, tile_id: tileId,
      geometry_library: { cube: { kind: "box" } },
      assets: { brick: { quality: "full-fallback", kind: "georgian", primitives: [{
        id: "wall", node_id: "wall", template_id: "wall", category: "wall", geometry: "cube",
        color: "#aabbcc", size: [10, 12, 16], position: [0, 0, 8], rotation_z: 0,
      }] } }, instances });
    tileBytes.set(tileId, body);
    return { id: tileId, grid: [index, 0], cell_bounds_enu: [index * 250, 0, (index + 1) * 250, 250],
      bounds_enu: [index * 250, 0, 0, index * 250 + 10, 12, 16],
      bounds_wgs84: [lon - 0.0001, latitude - 0.0001, lon + 0.0001, latitude + 0.0001],
      building_count: 1, primitive_count: 1, byte_length: body.length, sha256: hash(body),
      url: `/cities/${cityId}/render/${sourceRevision}/tiles/${tileId}` };
  });
  const manifest = { format: "gugis-render-package-v1", city_id: cityId, name: `${cityId} source snapshot`,
    revision: sourceRevision, source_sha256: sourceRevision, source_byte_length: 10000, package_sha256: "b".repeat(64),
    bounds_enu: [0, 0, 0, 1000, 1000, 100],
    bounds_wgs84: [longitude - 0.01, latitude - 0.01, longitude + 0.02, latitude + 0.01],
    grid: { coordinate_system: "ECEF_ENU", origin_wgs84: [longitude, latitude, 0], tile_size_m: 250 },
    counts: { buildings: duplicate ? 1 : tiles, assets: 1, primitives: duplicate ? 1 : tiles, tiles, source_roads: 7 },
    limits: { max_buildings: 100, max_primitives: 1000, max_bytes: 1024 * 1024, max_tiles: 100 },
    layers: { buildings: "included", roads: "not-included", terrain: "not-included", features: "not-included", semantics: "not-included" },
    quality_warnings_source_revision: sourceRevision, quality_warnings: warnings,
    attribution: { source: "© OpenStreetMap contributors", license: "ODbL 1.0", license_url: "https://www.openstreetmap.org/copyright",
      metadata: { coverage_label: "来源修订的局部街区，并非全城", height_policy: '{"height-tag":1,"levels-derived":2,"assumed":3}',
        "精度说明": "高度标签未经独立测量核验" } },
    tiles: descriptors };
  return { manifest, tileBytes,
    manifestResponse(freshness, extraHeaders = {}) {
      const body = encode(manifest);
      return new Response(body, { headers: { etag: `"${hash(body)}"`, "content-length": String(body.length),
        ...(freshness ? { "X-Render-Freshness": freshness } : {}), ...extraHeaders } });
    },
    tileResponse(id) {
      const body = tileBytes.get(id);
      assert.ok(body, `fixture tile ${id} exists`);
      return new Response(body, { headers: { "content-length": String(body.length) } });
    },
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function until(condition, message) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.ok(condition(), message);
}
function fixture(t, cityId = "bristol", cameraNavigation, tileProfile) {
  const originalFetch = globalThis.fetch, requests = [], states = [], viewersBefore = viewState.viewers.length;
  let renderer, currentWorkspace = workspaces[cityId], mounted = true;
  const onWorkspaceState = (...state) => states.push(state);
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    // Ignore cancellation at transport level to independently test stale replies.
    requests.push({ ...pending, url, options });
    return pending.promise;
  };
  const element = () => React.createElement(Preview, { workspace: currentWorkspace, onWorkspaceState, cameraNavigation, tileProfile });
  act(() => { renderer = create(element(), { createNodeMock: () => ({}) }); });
  const f = {
    requests, states,
    get root() { return renderer.root; },
    get content() { return text(renderer.toJSON()); },
    get status() { return text(renderer.root.findByProps({ className: "tile-preview-status" })); },
    get viewers() { return viewState.viewers.slice(viewersBefore); },
    get viewer() { return f.viewers.at(-1); },
    profile(next) { tileProfile = next; act(() => renderer.update(element())); },
    navigate(next) { cameraNavigation = next; act(() => renderer.update(element())); },
    update(nextCity) { currentWorkspace = workspaces[nextCity]; act(() => renderer.update(element())); },
    mode(next) { act(() => renderer.update(next === "tiles" ? element() : React.createElement("div", null, "编辑模式"))); },
    click(label) {
      const button = renderer.root.findAllByType("button").find(node => text(node) === label);
      assert.ok(button, `button ${label}`);
      act(() => button.props.onClick());
    },
    async respond(request, response) {
      await act(async () => { request.resolve(response); await new Promise(resolve => setTimeout(resolve, 0)); });
    },
    async manifest(packageData, freshness, request = requests.at(-1)) {
      await f.respond(request, packageData.manifestResponse(freshness));
      await until(() => f.content.includes("来源 SHA-256"), "the verified manifest is rendered");
    },
    async tile(packageData, tileId, expectedBuildings) {
      const request = [...requests].reverse().find(r => r.url.endsWith(`/tiles/${tileId}`) && !r.replied);
      assert.ok(request, `tile ${tileId} was requested`); request.replied = true;
      await f.respond(request, packageData.tileResponse(tileId));
      await until(() => f.status.includes(`已加载 ${expectedBuildings} /`), "the tile geometry is projected");
      act(() => f.viewer.scene.postRender.raiseEvent());
    },
    unmount() { if (mounted) { act(() => renderer.unmount()); mounted = false; } },
    assertReadOnly() {
      for (const { url, options } of requests) {
        assert.match(url, /^\/api\/cities\/(bristol|london|birmingham)\/render\/(manifest|[a-f0-9]{64}\/tiles\/x-?\d+_y-?\d+)$/);
        assert.equal(options.method ?? "GET", "GET");
        assert.equal(options.body, undefined);
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.cache, url.endsWith("/manifest") ? "no-store" : "force-cache");
      }
      assert.ok(states.every(([, busy, draft]) => busy === false && draft === false), "read-only loading never locks navigation or creates drafts");
    },
  };
  t.after(() => { f.unmount(); globalThis.fetch = originalFetch; });
  return f;
}
function geometryIds(viewer) {
  return viewer.scene.primitives.values.flatMap(primitive => [...primitive.attributes.keys()]);
}

test("streamed geometry uses render-only reads, preserves camera and selection, and discloses the absent layers", async t => {
  const f = fixture(t), pkg = renderPackage();
  assert.match(f.status, /正在读取有界渲染清单/);
  assert.equal(f.viewers.length, 0, "no scene exists before the manifest has been verified");
  await f.manifest(pkg);
  assert.equal(f.requests.length, 3);
  assert.match(f.status, /正在读取 · 已就绪 0 \/ 2 个目标瓦片/);
  assert.doesNotMatch(f.status, /当前读取目标已就绪/);
  assert.match(f.content, /新鲜度未知：可能已过期/);
  assert.match(f.content, /局部加载，并非完整覆盖/);
  assert.match(f.content, /道路、地形、功能要素和语义均未包含/);
  assert.match(f.content, /7 条道路不在此视图中/);
  assert.match(f.content, /已有模型高度与源标签有差异/);
  assert.match(f.content, /来源修订的局部街区，并非全城/);
  assert.match(f.content, /1 栋采用 OSM 高度标签 \/ 2 栋按楼层数 × 3.2 m 估算 \/ 3 栋假定 9.6 m/);
  assert.match(f.content, /高度标签未经独立测量核验/);
  assert.match(f.content, /非 GPU \/ JS 内存测量/);
  const link = f.root.findByType("a");
  assert.equal(link.props.href, "https://www.openstreetmap.org/copyright");
  assert.equal(link.props.rel, "noreferrer");
  const viewer = f.viewer, flights = viewer.camera.flights.length;
  assert.equal(viewer.entities.getById("city-ground-plane").show, false, "a missing terrain layer must not be replaced by visible synthetic ground");
  await f.tile(pkg, "x0_y0", 1);
  assert.match(f.status, /正在读取 · 已就绪 1 \/ 2 个目标瓦片/);
  assert.ok(geometryIds(viewer).includes("bristol-building-0/wall"));
  viewer.picked = { id: "bristol-building-0/wall" };
  act(() => viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK)({ position: {} }));
  assert.ok(f.content.includes("取消建筑选择"));
  await f.tile(pkg, "x1_y0", 2);
  assert.match(f.status, /当前读取目标已就绪/);
  assert.equal(f.viewer, viewer, "streaming retains the viewer");
  assert.equal(viewer.camera.flights.length, flights, "neither selection nor arriving geometry reframes the camera");
  assert.ok(f.content.includes("取消建筑选择"), "selection survives streamed geometry");
  assert.ok(geometryIds(viewer).includes("bristol-building-1/wall"));
  assert.doesNotMatch(f.status, /局部加载/);
  assert.equal(viewer.entities.getById("city-ground-plane").show, false);
  f.click("取消建筑选择");
  assert.equal(viewer.camera.flights.length, flights);
  f.click("已加载范围");
  assert.equal(viewer.camera.flights.length, flights + 1, "only an explicit reset reframes loaded geometry");
  f.assertReadOnly();
});

test("cross-tile duplicates count once and a manifest recheck cannot retain a current freshness claim", async t => {
  const f = fixture(t, "london"), pkg = renderPackage("london", { duplicate: true });
  await f.manifest(pkg, "current");
  assert.match(f.content, /已验证当前快照/);
  assert.doesNotMatch(f.content, /新鲜度未知/);
  await f.tile(pkg, "x0_y0", 1);
  await f.tile(pkg, "x1_y0", 1);
  await until(() => /已加载 1 \/ 1 栋（跨瓦片去重），2 \/ 2 瓦片/.test(f.status), "both duplicate-bearing tiles are loaded, not merely targeted");
  assert.match(f.status, /已加载 1 \/ 1 栋（跨瓦片去重），2 \/ 2 瓦片/);
  assert.equal(geometryIds(f.viewer).filter(id => id === "london-building-0/wall").length, 1);
  f.click("重新检查渲染包");
  assert.doesNotMatch(f.content, /已验证当前快照/);
  assert.match(f.status, /正在读取有界渲染清单/);
  await f.manifest(pkg, "unexpected-status");
  assert.match(f.content, /新鲜度未知/);
  assert.doesNotMatch(f.content, /已验证当前快照/);
  f.assertReadOnly();
});

for (const cityId of ["bristol", "london", "birmingham"]) {
  test(`${cityId} missing package offers an offline command and retry without loading or generating a full city`, async t => {
    const f = fixture(t, cityId), pkg = renderPackage(cityId, { tiles: 1 });
    await f.respond(f.requests[0], new Response("Not found", { status: 404 }));
    assert.match(f.content, /此城市尚无可用的离线渲染包/);
    assert.match(f.content, /不会自动生成、初始化或替换正式城市/);
    const source = cityId === "bristol" ? "backend/data/bristol.gugis.json" : `backend/data/cities/${cityId}.gugis.json`;
    assert.ok(f.content.includes(`python data-pipeline/build_render_tiles.py ${source} --city ${cityId}`));
    assert.match(f.content, /current\.gugis\.json/);
    assert.equal(f.requests.length, 1);
    assert.equal(f.viewers.length, 0);
    f.click("重试读取清单");
    assert.equal(f.requests[0].options.signal.aborted, true);
    assert.equal(f.requests.length, 2);
    await f.manifest(pkg, "current");
    await f.tile(pkg, "x0_y0", 1);
    assert.doesNotMatch(f.content, /尚无可用的离线渲染包/);
    assert.match(f.status, /已加载 1 \/ 1 栋/);
    f.assertReadOnly();
  });
}

test("switching city aborts its manifest and suppresses both stale successes and stale errors", async t => {
  const f = fixture(t), bristol = renderPackage("bristol");
  const obsoleteSuccess = f.requests[0];
  f.update("london");
  const obsoleteError = f.requests[1];
  assert.equal(obsoleteSuccess.options.signal.aborted, true);
  f.update("birmingham");
  assert.equal(obsoleteError.options.signal.aborted, true);
  const current = renderPackage("birmingham", { tiles: 1 });
  await f.manifest(current, "current");
  await f.tile(current, "x0_y0", 1);
  const before = f.content, requestCount = f.requests.length;
  await f.respond(obsoleteSuccess, bristol.manifestResponse());
  await act(async () => { obsoleteError.reject(new Error("obsolete London failure")); });
  assert.equal(f.content, before);
  assert.equal(f.requests.length, requestCount, "stale manifests must not launch tile requests");
  assert.match(f.root.findByType("section").props["aria-label"], /伯明翰/);
  assert.ok(geometryIds(f.viewer).every(id => !id.includes("bristol") && !id.includes("london")));
  assert.deepEqual(f.states, [["bristol", false, false], ["london", false, false], ["birmingham", false, false]]);
  f.assertReadOnly();
});

test("switching city releases the viewer and aborts every pending tile without accepting old geometry", async t => {
  const f = fixture(t), old = renderPackage("bristol"), current = renderPackage("london", { tiles: 1 });
  await f.manifest(old);
  const oldViewer = f.viewer, oldTiles = f.requests.filter(request => request.url.includes("/tiles/"));
  f.update("london");
  assert.equal(oldViewer.isDestroyed(), true);
  assert.ok(oldTiles.every(request => request.options.signal.aborted));
  await f.manifest(current, "current");
  await f.tile(current, "x0_y0", 1);
  const before = f.content, requestCount = f.requests.length;
  for (const request of oldTiles) await f.respond(request, old.tileResponse(request.url.split("/").at(-1)));
  assert.equal(f.content, before);
  assert.equal(f.requests.length, requestCount);
  assert.notEqual(f.viewer, oldViewer);
  assert.deepEqual(geometryIds(f.viewer), ["london-building-0/wall"]);
  f.assertReadOnly();
});

for (const stage of ["manifest", "tiles"]) {
  test(`leaving tile mode aborts pending ${stage} and stale responses cannot revive the disposed preview`, async t => {
    const f = fixture(t), pkg = renderPackage();
    if (stage === "tiles") await f.manifest(pkg);
    const oldRequests = [...f.requests], oldViewer = f.viewer;
    f.mode("editor");
    assert.ok(oldRequests.every(request => request.options.signal.aborted));
    if (oldViewer) assert.equal(oldViewer.isDestroyed(), true);
    for (const request of oldRequests) await f.respond(request, request.url.endsWith("/manifest") ? pkg.manifestResponse() : pkg.tileResponse(request.url.split("/").at(-1)));
    assert.equal(f.content, "编辑模式");
    assert.equal(f.requests.length, oldRequests.length);
    f.mode("tiles");
    assert.equal(f.requests.at(-1).url, "/api/cities/bristol/render/manifest", "reentering performs a fresh manifest check");
    await f.manifest(pkg, "current");
    f.unmount();
    assert.ok(f.requests.every(request => request.options.signal.aborted));
    assert.ok(f.viewers.every(viewer => viewer.isDestroyed()));
    f.assertReadOnly();
  });
}

test("failed tiles expose a targeted retry that preserves successful geometry and the camera", async t => {
  const f = fixture(t), pkg = renderPackage();
  await f.manifest(pkg, "current");
  await f.tile(pkg, "x0_y0", 1);
  const failed = f.requests.find(request => request.url.endsWith("/tiles/x1_y0"));
  await f.respond(failed, new Response("Service unavailable", { status: 503 }));
  assert.match(f.content, /1 个瓦片未加载；画面仍不完整/);
  assert.match(f.content, /瓦片读取失败（503）/);
  assert.match(f.status, /读取未完成 · 1 个目标瓦片失败/);
  assert.doesNotMatch(f.status, /当前读取目标已就绪/);
  const viewer = f.viewer, flights = viewer.camera.flights.length;
  f.click("重试失败瓦片");
  assert.match(f.status, /正在读取 · 已就绪 1 \/ 2 个目标瓦片/);
  assert.equal(f.requests.length, 4);
  assert.equal(f.requests.at(-1).url, failed.url);
  await f.tile(pkg, "x1_y0", 2);
  assert.match(f.status, /当前读取目标已就绪/);
  assert.doesNotMatch(f.content, /瓦片未加载/);
  assert.equal(f.requests.filter(request => request.url.endsWith("/manifest")).length, 1);
  assert.equal(f.viewer, viewer);
  assert.equal(viewer.camera.flights.length, flights);
  f.assertReadOnly();
});

test("a camera viewport change cancels obsolete tiles and streams only intersecting geometry without reframing", async t => {
  const f = fixture(t), pkg = renderPackage("bristol", { tiles: 3 });
  await f.manifest(pkg);
  await f.tile(pkg, "x0_y0", 1);
  const viewer = f.viewer, flights = viewer.camera.flights.length;
  const obsolete = f.requests.filter(request => /tiles\/x[12]_y0$/.test(request.url));
  viewer.camera.computeViewRectangle = () => Rectangle.fromDegrees(-2.604, 51.453, -2.602, 51.455);
  act(() => viewer.camera.moveEnd.raiseEvent());
  await until(() => obsolete.every(request => request.options.signal.aborted), "the debounced viewport cancels unrelated work");
  for (const request of obsolete) await f.respond(request, pkg.tileResponse(request.url.split("/").at(-1)));
  assert.match(f.status, /已加载 1 \/ 3 栋/);
  assert.match(f.status, /当前视口目标 1 \/ 1 瓦片/);
  assert.deepEqual(geometryIds(viewer), ["bristol-building-0/wall"]);
  viewer.camera.computeViewRectangle = () => Rectangle.fromDegrees(-2.600, 51.453, -2.598, 51.455);
  act(() => viewer.camera.changed.raiseEvent());
  await until(() => f.requests.filter(request => request.url.endsWith("/tiles/x1_y0")).length === 2, "a newly visible tile is requested again");
  assert.match(f.status, /已加载 0 \/ 3 栋/);
  await f.tile(pkg, "x1_y0", 1);
  assert.deepEqual(geometryIds(viewer), ["bristol-building-1/wall"]);
  assert.equal(viewer.camera.flights.length, flights);
  f.assertReadOnly();
});

test("unverified manifest bytes and unsafe source links never become trusted scene content", async t => {
  const f = fixture(t), pkg = renderPackage("bristol", { tiles: 1 });
  await f.respond(f.requests[0], pkg.manifestResponse("current", { etag: `W/"${"0".repeat(64)}"` }));
  await until(() => f.content.includes("ETag 不匹配"), "an invalid ETag is rejected");
  assert.equal(f.viewers.length, 0);
  assert.equal(f.requests.length, 1);
  assert.doesNotMatch(f.content, /已验证当前快照/);
  f.click("重试读取清单");
  pkg.manifest.attribution.license_url = "javascript:alert(1)";
  pkg.manifest.attribution.metadata.source_url = "https://name:secret@example.org/source";
  await f.manifest(pkg);
  assert.equal(f.root.findAllByType("a").length, 0);
  assert.match(f.content, /OpenStreetMap contributors/);
  f.assertReadOnly();
});

function pageVisibility(t, hidden = false) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document"), listeners = new Set();
  const doc = { hidden,
    addEventListener(name, callback) { if (name === "visibilitychange") listeners.add(callback); },
    removeEventListener(name, callback) { if (name === "visibilitychange") listeners.delete(callback); } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  t.after(() => { if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document; });
  return { listeners, set(value) { doc.hidden = value; act(() => { for (const callback of listeners) callback(); }); } };
}

test("manual pause keeps geometry and inspector available, then resumes from the latest camera", async t => {
  const f = fixture(t), pkg = renderPackage();
  await f.manifest(pkg); await f.tile(pkg, "x0_y0", 1);
  const viewer = f.viewer, outstanding = f.requests.find(request => request.url.endsWith("/tiles/x1_y0"));
  f.click("暂停瓦片读取");
  assert.equal(outstanding.options.signal.aborted, true);
  assert.match(f.status, /已暂停瓦片读取，保持已加载画面/);
  assert.match(f.content, /仅查询当前驻留瓦片中的 1 栋/);
  await f.respond(outstanding, pkg.tileResponse("x1_y0"));
  assert.match(f.status, /已加载 1 \/ 2 栋/);
  const requests = f.requests.length;
  viewer.camera.computeViewRectangle = () => Rectangle.fromDegrees(-2.600, 51.453, -2.598, 51.455);
  await act(async () => { viewer.camera.moveEnd.raiseEvent(); await new Promise(resolve => setTimeout(resolve, 230)); });
  assert.equal(f.requests.length, requests);
  assert.deepEqual(geometryIds(viewer), ["bristol-building-0/wall"]);
  f.click("恢复瓦片读取");
  await until(() => f.requests.length === requests + 1, "resume reads the newly visible tile");
  assert.ok(f.requests.at(-1).url.endsWith("/tiles/x1_y0"));
  await f.tile(pkg, "x1_y0", 1);
  assert.equal(f.viewer, viewer);
  assert.deepEqual(geometryIds(viewer), ["bristol-building-1/wall"]);
  assert.doesNotMatch(f.status, /已暂停|自动暂停/); f.assertReadOnly();
});

test("an initially hidden preview reads its manifest but defers all geometry until visible", async t => {
  const visibility = pageVisibility(t, true), f = fixture(t), pkg = renderPackage("bristol", { tiles: 1 });
  await f.manifest(pkg);
  assert.equal(f.requests.length, 1); assert.equal(visibility.listeners.size, 1);
  assert.match(f.status, /页面已隐藏，自动暂停瓦片读取/);
  visibility.set(false);
  await until(() => f.requests.length === 2, "visible page resumes tile acquisition");
  await f.tile(pkg, "x0_y0", 1);
  f.unmount(); assert.equal(visibility.listeners.size, 0); f.assertReadOnly();
});

test("visibility changes preserve manual pause and a new city resets only the manual choice", async t => {
  const visibility = pageVisibility(t), f = fixture(t), pkg = renderPackage("bristol", { tiles: 1 });
  await f.manifest(pkg); await f.tile(pkg, "x0_y0", 1);
  f.click("暂停瓦片读取"); visibility.set(true); visibility.set(false);
  assert.match(f.status, /已暂停瓦片读取/);
  assert.ok(f.root.findAllByType("button").some(button => text(button) === "恢复瓦片读取" && button.props["aria-pressed"]));
  visibility.set(true); f.click("恢复瓦片读取");
  assert.match(f.status, /页面已隐藏，自动暂停瓦片读取/);
  visibility.set(false); assert.doesNotMatch(f.status, /已暂停|自动暂停/);
  f.click("暂停瓦片读取"); f.update("london");
  const next = renderPackage("london", { tiles: 1 }); await f.manifest(next);
  assert.equal(visibility.listeners.size, 1);
  assert.doesNotMatch(f.status, /已暂停|自动暂停/);
  assert.ok(f.requests.at(-1).url.includes("/cities/london/render/") && f.requests.at(-1).url.includes("/tiles/"));
  f.assertReadOnly();
});

test("manifest recheck while manually paused cannot restart geometry reads", async t => {
  const f = fixture(t), pkg = renderPackage("bristol", { tiles: 1 });
  await f.manifest(pkg); await f.tile(pkg, "x0_y0", 1);
  f.click("暂停瓦片读取"); f.click("重新检查渲染包");
  const requests = f.requests.length; await f.manifest(pkg);
  assert.equal(f.requests.length, requests);
  assert.match(f.status, /已加载 0 \/ 1 栋/); assert.match(f.status, /已暂停瓦片读取/);
  f.click("恢复瓦片读取"); await until(() => f.requests.length === requests + 1, "explicit resume starts the new session");
  await f.tile(pkg, "x0_y0", 1); f.assertReadOnly();
});

// React's GPU-free renderer cannot calculate layout, so independently guard the
// direct-entry CSS chunk against a zero-height Cesium canvas or editor dependency.
test("direct tile entry owns scoped scene sizing without depending on editor CSS", async () => {
  const css = await readFile(new URL("../src/studio/CityTilePreview.css", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/studio/CityTilePreview.tsx", import.meta.url), "utf8");
  assert.match(source, /import ["']\.\/CityTilePreview\.css["']/);
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const declarations = selector => rules
    .filter(([, selectors]) => selectors.split(",").map(value => value.trim()).includes(selector))
    .map(([, , body]) => body).join(";");
  assert.match(declarations(".tile-preview-scene"), /position:\s*relative/);
  assert.match(declarations(".tile-preview-scene"), /min-height:\s*[1-9]\d*px/);
  for (const selector of [".tile-preview-scene .building-scene", ".tile-preview-scene .scene-canvas"]) {
    const body = declarations(selector);
    assert.match(body, /position:\s*absolute/, selector);
    assert.match(body, /inset:\s*0(?:;|\s|$)/, selector);
    assert.match(body, /width:\s*100%/, selector);
    assert.match(body, /height:\s*100%/, selector);
  }
  assert.equal(declarations(".building-scene"), "", "tile CSS must not change every editor scene");
  assert.equal(declarations(".scene-canvas"), "", "tile CSS must not change every editor canvas");
});

const cameraNavigation = (sequence = 1, city = "bristol", expectedRevision = revision, height = 1200) => ({ sequence,
  result: { kind: "valid", bookmark: { city, revision: expectedRevision, pose: [-2.599, 51.454, height, 18, -45, 0] } } });
const footprint = (viewer, index = 1) => { viewer.camera.computeViewRectangle = () => Rectangle.fromDegrees(
  -2.603 + index * .004 - .0002, 51.4538, -2.603 + index * .004 + .0002, 51.4542); };

test("an empty viewport explains its scope and can return to the sample repeatedly without recreating the viewer or manifest", async t => {
  const f = fixture(t), pkg = renderPackage("bristol", { tiles: 1 });
  await f.manifest(pkg); await f.tile(pkg, "x0_y0", 1);
  const viewer = f.viewer, frames = viewer.camera.frames.length;
  for (let attempt = 0; attempt < 2; attempt++) {
    viewer.camera.computeViewRectangle = () => Rectangle.fromDegrees(10, 10, 11, 11);
    act(() => viewer.camera.moveEnd.raiseEvent());
    await until(() => f.status.includes("当前视口未覆盖样本建筑"), "outside sample is explicit");
    assert.deepEqual(geometryIds(viewer), []);
    assert.match(f.content, /数据仍然保留；返回样本范围后/);
    assert.match(f.content, /此视口没有样本建筑，可用场景中的/);
    assert.ok(f.root.findAllByType("button").find(button => text(button) === "已加载范围").props.disabled);
    assert.doesNotMatch(f.status, /当前读取目标已就绪/);
    footprint(viewer, 0);
    f.click("定位样本范围");
    assert.match(f.status, /正在定位视角/);
    await until(() => f.status.includes("当前读取目标已就绪"), "explicit return accepts the new actual viewport");
    assert.equal(viewer.camera.frames.length, frames + attempt + 1);
    assert.deepEqual(geometryIds(viewer), ["bristol-building-0/wall"]);
    assert.equal(f.viewer, viewer);
  }
  assert.equal(f.requests.length, 2, "cached sample is reused; no extra manifest or tile requests");
  f.assertReadOnly();
});

test("an empty verified package is distinguished from an outside-sample viewport without offering a useless camera action", async t => {
  const f = fixture(t), pkg = renderPackage("bristol", { tiles: 0, warnings: [] });
  pkg.manifest.counts.assets = 0;
  await f.manifest(pkg);
  assert.match(f.status, /此渲染包没有建筑瓦片/);
  assert.doesNotMatch(f.status, /当前读取目标已就绪|当前视口未覆盖样本建筑/);
  assert.match(f.content, /清单已核验，但不包含可显示的建筑几何/);
  assert.match(f.content, /已核验的渲染包不含建筑瓦片/);
  assert.ok(!f.root.findAllByType("button").some(button => text(button) === "定位样本范围"));
  assert.equal(f.requests.length, 1);
  f.assertReadOnly();
});

test("initial bookmarked entry restores before the first tile request and uses the receiver viewport", async t => {
  const f = fixture(t, "bristol", cameraNavigation()), pkg = renderPackage("bristol", { tiles: 3 });
  await f.manifest(pkg);
  assert.equal(f.requests.length, 1, "only the current manifest is read before the actual viewport");
  assert.equal(f.viewer.camera.sets.length, 1);
  assert.equal(f.viewer.camera.flights.length, 0, "initial fit never overrides a restored camera");
  footprint(f.viewer);
  await until(() => f.requests.length === 2, "actual restored view begins streaming");
  assert.ok(f.requests[1].url.endsWith("/tiles/x1_y0"));
  await f.tile(pkg, "x1_y0", 1);
  assert.equal(f.viewer.camera.sets.length, 1);
  assert.equal(f.viewer.camera.flights.length, 0, "tile arrivals cannot reapply or reset the camera");
  assert.match(f.content, /不包含或分发城市数据/);
  assert.match(f.content, /localhost 地址仅指接收方自己的电脑/);
  f.assertReadOnly();
});

test("later camera navigation cancels stale viewport timers and keeps the existing viewer and manifest", async t => {
  const f = fixture(t, "bristol", cameraNavigation()), pkg = renderPackage("bristol", { tiles: 3 });
  await f.manifest(pkg); const viewer = f.viewer;
  footprint(viewer, 0); act(() => viewer.camera.changed.raiseEvent());
  f.navigate(cameraNavigation(2, "bristol", revision, 900));
  footprint(viewer, 2);
  await until(() => f.requests.length === 2, "only the latest camera viewport starts reads");
  assert.ok(f.requests[1].url.endsWith("/tiles/x2_y0"));
  assert.equal(f.viewer, viewer); assert.equal(viewer.camera.sets.length, 2);
  assert.equal(f.requests.filter(r => r.url.endsWith("/manifest")).length, 1);
  await f.tile(pkg, "x2_y0", 1);
  f.navigate(cameraNavigation(3, "bristol", revision, 700)); footprint(viewer, 1);
  await until(() => f.requests.length === 3, "another view streams only its target tile");
  assert.ok(f.requests[2].url.endsWith("/tiles/x1_y0"));
  assert.equal(f.viewer, viewer);
  f.assertReadOnly();
});

test("revision mismatch, invalid link and wrong city block tile reads until explicit current default", async t => {
  const f = fixture(t, "bristol", cameraNavigation(1, "bristol", "c".repeat(64))), pkg = renderPackage();
  await f.manifest(pkg);
  assert.match(f.content, /来源修订与当前渲染包不一致/);
  assert.match(f.content, /不提供按修订读取历史清单/);
  assert.equal(f.requests.length, 1); assert.equal(f.viewers.length, 0);
  f.navigate(cameraNavigation(2, "london"));
  assert.match(f.content, /视角链接无效或不属于当前城市/);
  assert.equal(f.requests.length, 1);
  f.navigate({ sequence: 3, result: { kind: "invalid", message: "invalid" } });
  assert.equal(f.requests.length, 1);
  f.click("使用当前默认视角"); footprint(f.viewer, 0);
  await until(() => f.requests.length === 2, "explicit default can start bounded tile reads");
  assert.ok(f.requests[1].url.endsWith("/tiles/x0_y0"));
  assert.equal(f.viewer.camera.frames.length, 1);
  f.assertReadOnly();
});

test("manifest retry revalidates the linked revision and ignores obsolete manifest replies", async t => {
  const f = fixture(t, "bristol", cameraNavigation()), pkg = renderPackage();
  const old = f.requests[0];
  f.click("重新检查渲染包");
  assert.equal(old.options.signal.aborted, true);
  const current = f.requests[1];
  f.navigate(cameraNavigation(2, "bristol", "c".repeat(64)));
  await f.manifest(pkg, "current", current);
  assert.match(f.content, /来源修订与当前渲染包不一致/);
  await f.respond(old, renderPackage("bristol", { sourceRevision: "c".repeat(64) }).manifestResponse());
  assert.equal(f.requests.length, 2); assert.equal(f.viewers.length, 0);
  f.click("重新检查渲染包");
  await f.manifest(renderPackage("bristol", { sourceRevision: "c".repeat(64) }));
  footprint(f.viewer, 0);
  await until(() => f.requests.length === 4, "matching refreshed manifest restores the pending link");
  assert.ok(f.requests[3].url.includes("/" + "c".repeat(64) + "/tiles/"));
  f.assertReadOnly();
});

test("manual and hidden pauses survive camera restoration and resume only the latest view", async t => {
  const visibility = pageVisibility(t, true);
  const f = fixture(t, "bristol", cameraNavigation()), pkg = renderPackage("bristol", { tiles: 3 });
  await f.manifest(pkg); footprint(f.viewer, 0);
  await until(() => !f.root.findAllByType("button").find(b => text(b) === "复制当前视角链接").props.disabled, "camera restored while hidden");
  assert.equal(f.requests.length, 1);
  f.click("暂停瓦片读取");
  f.navigate(cameraNavigation(2)); footprint(f.viewer, 2);
  await until(() => !f.root.findAllByType("button").find(b => text(b) === "复制当前视角链接").props.disabled, "new camera restored without resuming");
  visibility.set(false);
  assert.equal(f.requests.length, 1); assert.match(f.content, /已暂停瓦片读取/);
  f.click("恢复瓦片读取");
  assert.equal(f.requests.length, 2); assert.ok(f.requests[1].url.endsWith("/tiles/x2_y0"));
  f.assertReadOnly();
});

test("a restored view with no finite footprint remains blocked, while later horizon navigation keeps normal bounded streaming", async t => {
  const f = fixture(t, "bristol", cameraNavigation()), pkg = renderPackage();
  await f.manifest(pkg);
  await until(() => f.content.includes("此视角在当前窗口没有有限"), "missing footprint is explained");
  assert.equal(f.requests.length, 1);
  f.click("使用当前默认视角"); footprint(f.viewer, 0);
  await until(() => f.requests.length === 2, "default view accepted");
  const viewer = f.viewer;
  viewer.camera.computeViewRectangle = () => undefined;
  act(() => viewer.camera.changed.raiseEvent());
  await until(() => f.requests.length === 3, "later horizon view still uses the normal bounded planner");
  assert.equal(f.viewer, viewer); assert.doesNotMatch(f.content, /此视角在当前窗口没有有限/);
  f.assertReadOnly();
});

test("copy validates the current camera, sanitizes URLs, and exposes a selectable link on clipboard failure", async t => {
  const oldWindow = globalThis.window, oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let copied;
  globalThis.window = { location: new URL("http://localhost/app/?city=bristol&cities=bristol,london&source=/private&search=secret&pause=true&tile_profile=economy&activeBytes=2097152#unrelated") };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async value => { copied = value; throw new Error("denied"); } } } });
  t.after(() => { globalThis.window = oldWindow; if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete globalThis.navigator; });
  const f = fixture(t), pkg = renderPackage(); await f.manifest(pkg);
  const count = f.requests.length;
  f.click("复制当前视角链接"); assert.match(f.content, /没有有限的地球椭球视域/); assert.equal(copied, undefined);
  footprint(f.viewer, 0);
  f.click("复制当前视角链接");
  await until(() => f.content.includes("无法自动复制"), "clipboard failure offers manual copy");
  const field = f.root.findByProps({ "aria-label": "手动复制视角链接" });
  assert.equal(field.props.value, copied); assert.equal(field.props.readOnly, true);
  assert.equal(f.root.findByProps({ className: "tile-camera-share" }).findByType("input"), field);
  let selected = 0; const selectionEvent = { currentTarget: { select() { selected++; } } };
  field.props.onFocus(selectionEvent); field.props.onClick(selectionEvent); assert.equal(selected, 2);
  const link = new URL(copied);
  assert.deepEqual([...link.searchParams.keys()], ["city", "cities", "view_mode"]);
  assert.match(link.hash, /^#gugis-view=1&city=bristol&revision=a{64}&pose=/);
  assert.doesNotMatch(copied, /private|secret|pause|unrelated|tile_profile|activeBytes|economy/);
  assert.match(f.content, /接收方使用自己明确选择或默认的读取配置/);
  assert.equal(f.requests.length, count, "copying performs no data requests");
  act(() => f.root.findByProps({ "aria-label": "关闭视角分享提示" }).props.onClick());
  assert.equal(f.root.findAllByProps({ className: "tile-camera-share" }).length, 0);
  assert.equal(f.root.findAllByProps({ "aria-label": "手动复制视角链接" }).length, 0);
  navigator.clipboard.writeText = async value => { copied = value; };
  f.click("复制当前视角链接");
  await until(() => f.content.includes("视角链接已复制"), "clipboard success is reported");
  assert.equal(f.root.findAllByProps({ "aria-label": "手动复制视角链接" }).length, 0);
  act(() => f.root.findByProps({ "aria-label": "关闭视角分享提示" }).props.onClick());
  assert.doesNotMatch(f.content, /视角链接已复制/);
  assert.equal(f.requests.length, count, "dismissing the notice is local only");
  f.assertReadOnly();
});


test("camera navigation aborts previous tile reads, rejects late geometry and does not refresh the manifest", async t => {
  const f = fixture(t, "bristol", cameraNavigation()), pkg = renderPackage();
  await f.manifest(pkg); footprint(f.viewer, 0);
  await until(() => f.requests.length === 2, "first view reads its tile");
  const old = f.requests[1], viewer = f.viewer;
  f.navigate(cameraNavigation(2)); footprint(viewer, 1);
  assert.equal(old.options.signal.aborted, true, "navigation immediately cancels obsolete reads");
  await until(() => f.requests.length === 3, "latest viewport can use a remaining bounded slot");
  await f.respond(old, pkg.tileResponse("x0_y0"));
  assert.match(f.status, /已加载 0 \/ 2 栋/);
  await f.tile(pkg, "x1_y0", 1);
  assert.deepEqual(geometryIds(viewer), ["bristol-building-1/wall"]);
  assert.equal(f.viewer, viewer); assert.equal(f.requests.filter(r => r.url.endsWith("/manifest")).length, 1);
  f.assertReadOnly();
});

test("restoring another camera clears the local selection pin rather than serializing a selected building", async t => {
  const f = fixture(t, "bristol", cameraNavigation()), pkg = renderPackage();
  await f.manifest(pkg); footprint(f.viewer, 0);
  await until(() => f.requests.length === 2, "first view reads its tile");
  await f.tile(pkg, "x0_y0", 1);
  f.viewer.picked = { id: "bristol-building-0/wall" };
  act(() => viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK)({ position: {} }));
  assert.ok(f.content.includes("取消建筑选择"));
  f.navigate(cameraNavigation(2)); footprint(f.viewer, 1);
  assert.ok(!f.content.includes("取消建筑选择"));
  await until(() => f.requests.length === 3, "new view reads only its tile");
  await f.tile(pkg, "x1_y0", 1);
  assert.deepEqual(geometryIds(f.viewer), ["bristol-building-1/wall"]);
  assert.equal(f.requests.length, 3);
  f.assertReadOnly();
});


test("share-copy controls own their spacing, responsive field width and keyboard focus styles", async () => {
  const css = await readFile(new URL("../src/studio/CityTilePreview.css", import.meta.url), "utf8");
  assert.match(css, /\.city-tile-preview \.tile-camera-share \{[^}]*padding:\s*[1-9]\d*px/);
  assert.match(css, /\.city-tile-preview \.tile-camera-share input \{[^}]*width: 100%;[^}]*max-width: 72rem/);
  assert.match(css, /\.city-tile-preview \.tile-camera-share input:focus-visible \{[^}]*outline: 3px solid/);
});

test("explicit default after failed-footprint navigation remains guarded and never retains a previous selection pin", async t => {
  const f = fixture(t, "bristol", cameraNavigation()), pkg = renderPackage();
  await f.manifest(pkg); footprint(f.viewer, 0);
  await until(() => f.requests.length === 2, "initial view tile requested");
  await f.tile(pkg, "x0_y0", 1);
  f.viewer.picked = { id: "bristol-building-0/wall" };
  act(() => viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK)({ position: {} }));
  assert.ok(f.content.includes("取消建筑选择"));
  f.navigate(cameraNavigation(2));
  f.viewer.camera.computeViewRectangle = () => undefined;
  await until(() => f.content.includes("此视角在当前窗口没有有限"), "failed navigation blocked");
  assert.ok(!f.content.includes("取消建筑选择"));
  f.click("使用当前默认视角");
  await until(() => f.content.includes("此视角在当前窗口没有有限"), "default also needs a finite footprint");
  assert.equal(f.requests.length, 2, "an invalid default cannot read tiles from a stale view");
  f.click("使用当前默认视角"); footprint(f.viewer, 1);
  await until(() => f.requests.length === 3, "valid explicit default uses its actual footprint");
  await f.tile(pkg, "x1_y0", 1);
  assert.deepEqual(geometryIds(f.viewer), ["bristol-building-1/wall"]);
  assert.ok(!f.content.includes("取消建筑选择"));
  f.assertReadOnly();
});


test("economy preview requests one tile at a time, keeps two active and preserves selection and pause semantics", async t => {
  const visibility = pageVisibility(t), f = fixture(t, "bristol", undefined, "economy"), pkg = renderPackage("bristol", { tiles: 4 });
  await f.manifest(pkg);
  assert.equal(f.requests.length, 2, "only one tile starts after the manifest");
  assert.match(f.status, /低资源（Economy）.*驻留 ≤ 2 瓦片/);
  assert.match(f.status, /2.00 MiB.*缓存 0 \/ 4 瓦片.*4.00 MiB.*最多 1 个并发请求/);
  await f.tile(pkg, "x0_y0", 1); assert.equal(f.requests.length, 3);
  await f.tile(pkg, "x1_y0", 2); assert.equal(f.requests.length, 3);
  assert.match(f.status, /预算暂缓 2 瓦片/);
  const viewer = f.viewer;
  viewer.picked = { id: "bristol-building-0/wall" };
  act(() => viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK)({ position: {} }));
  f.click("暂停瓦片读取"); footprint(viewer, 3);
  await act(async () => { viewer.camera.moveEnd.raiseEvent(); await new Promise(resolve => setTimeout(resolve, 230)); });
  assert.equal(f.requests.length, 3);
  assert.deepEqual(geometryIds(viewer).sort(), ["bristol-building-0/wall", "bristol-building-1/wall"]);
  visibility.set(true); visibility.set(false);
  assert.equal(f.requests.length, 3); assert.match(f.status, /已暂停瓦片读取/);
  f.click("恢复瓦片读取");
  await until(() => f.requests.length === 4, "resume reads only the newest viewport tile alongside the pin");
  assert.ok(f.requests.at(-1).url.endsWith("/tiles/x3_y0"));
  await f.tile(pkg, "x3_y0", 2);
  assert.deepEqual(geometryIds(viewer).sort(), ["bristol-building-0/wall", "bristol-building-3/wall"]);
  assert.ok(f.content.includes("取消建筑选择"));
  assert.match(f.status, /2 \/ 4 瓦片/); assert.equal(f.viewer, viewer); f.assertReadOnly();
});

test("changing profile creates an independent session, aborts old requests and ignores old scene callbacks", async t => {
  const f = fixture(t), pkg = renderPackage("bristol", { tiles: 4 });
  await f.manifest(pkg); await f.tile(pkg, "x0_y0", 1);
  const oldViewer = f.viewer, oldRequests = f.requests.filter(r => r.url.includes("/tiles/") && !r.replied);
  const oldScene = f.root.find(node => node.props.renderOnly === true && typeof node.props.onViewBounds === "function").props;
  const oldCopy = f.root.findAllByType("button").find(button => text(button) === "复制当前视角链接").props.onClick;
  f.click("暂停瓦片读取"); f.profile("economy");
  assert.ok(oldViewer.isDestroyed());
  assert.ok(oldRequests.every(request => request.options.signal.aborted));
  assert.equal(f.requests.at(-1).url, "/api/cities/bristol/render/manifest");
  await f.manifest(pkg);
  const count = f.requests.length, before = f.content;
  act(() => { oldScene.onViewBounds({ bounds: null, center: { longitude: 0, latitude: 0 } }); oldScene.onSelect("bristol-building-0"); oldCopy(); });
  for (const request of oldRequests) await f.respond(request, pkg.tileResponse(request.url.split("/").at(-1)));
  assert.equal(f.requests.length, count); assert.equal(f.content, before);
  assert.doesNotMatch(f.status, /已暂停瓦片读取/);
  assert.match(f.status, /低资源（Economy）/);
  assert.notEqual(f.viewer, oldViewer);
  assert.equal(f.viewers.filter(viewer => !viewer.isDestroyed()).length, 1);
  await f.tile(pkg, "x0_y0", 1); await f.tile(pkg, "x1_y0", 2);
  assert.equal(f.requests.length, count + 1, "economy has only one further queued tile");
  f.assertReadOnly();
});

test("profile changes discard stale manifest success and error, preserve hidden pause, and reset the manual session choice", async t => {
  const visibility = pageVisibility(t, true), f = fixture(t), pkg = renderPackage();
  const old = f.requests[0]; f.profile("economy"); const obsolete = f.requests[1];
  f.profile("balanced"); const current = f.requests[2];
  assert.ok(old.options.signal.aborted && obsolete.options.signal.aborted);
  await f.manifest(pkg, "current", current);
  await f.respond(old, pkg.manifestResponse());
  await act(async () => obsolete.reject(new Error("obsolete economy manifest")));
  assert.equal(f.requests.length, 3); assert.match(f.status, /页面已隐藏，自动暂停瓦片读取/);
  assert.doesNotMatch(f.content, /obsolete economy/);
  assert.equal(visibility.listeners.size, 1);
  f.click("暂停瓦片读取"); f.profile("economy"); await f.manifest(pkg);
  assert.match(f.status, /页面已隐藏，自动暂停瓦片读取/);
  assert.equal(visibility.listeners.size, 1);
  const count = f.requests.length; visibility.set(false);
  await until(() => f.requests.length === count + 1, "new session resets manual pause but waits for visibility");
  assert.match(f.status, /低资源（Economy）/); f.assertReadOnly();
});

test("a source tile above the economy byte limit stays unrequested with an honest profile/offline hint", async t => {
  const f = fixture(t, "bristol", undefined, "economy"), pkg = renderPackage("bristol", { tiles: 1 });
  pkg.manifest.limits.max_bytes = 8 * 1024 * 1024;
  pkg.manifest.tiles[0].byte_length = 2 * 1024 * 1024 + 1;
  await f.manifest(pkg);
  assert.equal(f.requests.length, 1); assert.match(f.status, /已加载 0 \/ 1/);
  assert.match(f.content, /1 个源瓦片超过当前 2.00 MiB 单瓦片预算，不会请求或截断其几何/);
  assert.match(f.content, /返回城市选择页，选择均衡配置，或离线生成更小瓦片/);
  assert.match(f.status, /当前视口瓦片超出读取预算/);
  assert.doesNotMatch(f.status, /当前读取目标已就绪/);
  f.click("暂停瓦片读取"); f.click("恢复瓦片读取");
  assert.equal(f.requests.length, 1, "pause/resume never raises the selected budget");
  f.profile("balanced"); await f.manifest(pkg);
  assert.equal(f.requests.length, 3, "an explicit independent balanced session may request the larger tile");
  assert.doesNotMatch(f.content, /1 个源瓦片超过当前/); f.assertReadOnly();
});

test("unknown caller profiles use balanced ceilings and never accept custom numeric budgets", async t => {
  const f = fixture(t, "bristol", undefined, { activeBytes: 999999999, activeTiles: 999, concurrency: 99 }), pkg = renderPackage("bristol", { tiles: 10 });
  await f.manifest(pkg);
  assert.equal(f.requests.length, 4, "balanced allows three requests only");
  assert.match(f.status, /均衡（Balanced）.*驻留 ≤ 8 瓦片/);
  assert.match(f.status, /8.00 MiB.*16.00 MiB.*最多 3 个并发请求/);
  const viewer = f.viewer; f.profile("__proto__");
  assert.equal(f.viewer, viewer, "equivalent normalized defaults retain the same independent session");
  assert.equal(f.requests.length, 4); f.assertReadOnly();
});

// These regressions use the actual retained manifests and Cesium's real Camera
// maths. No hand-written viewport rectangle can conceal off-target framing.
const retainedPackages = Object.fromEntries(await Promise.all(["bristol", "london", "birmingham"].map(async city => {
  const bytes = await readFile(new URL(`./fixtures/render-manifests/${city}.json`, import.meta.url));
  return [city, { manifest: JSON.parse(bytes), manifestResponse() {
    return new Response(bytes, { headers: { etag: `"${hash(bytes)}"`, "content-length": String(bytes.length) } });
  } }];
})));
function enableRealCamera(t, dimensions) {
  const previous = viewState.realCameraDimensions;
  viewState.realCameraDimensions = dimensions;
  t.after(() => { viewState.realCameraDimensions = previous; });
}
function assertSampleTarget(f, pkg, dimensions, profile) {
  const [width, height] = dimensions, [west, south, east, north] = pkg.manifest.bounds_wgs84;
  const point = f.viewer.camera.pickEllipsoid(new Cartesian2(width / 2, height / 2), Ellipsoid.WGS84);
  assert.ok(point, "real camera center intersects the ellipsoid");
  assert.ok(Cartesian3.distance(point, Cartesian3.fromDegrees((west + east) / 2, (south + north) / 2)) < .01,
    "camera is aimed at the actual retained sample");
  assert.ok(Matrix4.equals(f.viewer.camera.transform, Matrix4.IDENTITY));
  const footprint = f.viewer.camera.computeViewRectangle(Ellipsoid.WGS84);
  assert.ok(footprint, "default has a real finite footprint");
  const count = Number(/当前视口目标 (\d+)/.exec(f.status)?.[1]);
  assert.ok(count > 0 && count <= (profile === "economy" ? 2 : 8));
  assert.equal(f.viewer.camera.frames.length, 1);
  assert.equal(f.viewer.camera.sets.length, 0, "default uses target framing, never an arbitrary position above it");
  assert.equal(f.viewer.camera.flights.length, 0, "initial fit cannot overwrite target restoration");
}
for (const city of ["bristol", "london", "birmingham"]) for (const profile of ["balanced", "economy"]) {
  for (const dimensions of [[1040, 500], [800, 500], [1400, 400], [390, 700]]) {
    test(`${city} ${profile} ${dimensions.join("x")} ordinary entry and explicit current default stream the real sample`, async t => {
      enableRealCamera(t, dimensions);
      const f = fixture(t, city, { sequence: 1, result: { kind: "none" } }, profile), pkg = retainedPackages[city];
      await f.manifest(pkg);
      assert.equal(f.requests.length, 1, "normal UI entry waits for target-centered viewport reporting");
      await until(() => f.requests.length > 1, "real camera footprint triggers sample tile reads");
      assertSampleTarget(f, pkg, dimensions, profile);
      const oldTiles = f.requests.filter(request => request.url.includes("/tiles/"));
      assert.ok(oldTiles.length <= (profile === "economy" ? 1 : 3));
      const firstViewer = f.viewer;
      f.navigate(cameraNavigation(2, city, "0".repeat(64)));
      assert.match(f.content, /来源修订与当前渲染包不一致/);
      assert.equal(firstViewer.isDestroyed(), true);
      assert.ok(oldTiles.every(request => request.options.signal.aborted));
      for (const request of oldTiles) await f.respond(request, new Response("cancelled old view", { status: 503 }));
      const beforeDefault = f.requests.length;
      f.click("使用当前默认视角");
      assert.equal(f.requests.length, beforeDefault, "default choice also waits for the actual new viewport");
      await until(() => f.requests.length > beforeDefault, "current default resumes on-target reads");
      assertSampleTarget(f, pkg, dimensions, profile);
      assert.equal(f.requests.filter(request => request.url.endsWith("/manifest")).length, 1);
      f.assertReadOnly();
    });
  }
}
for (const profile of ["balanced", "economy"]) for (const dimensions of [[1040, 500], [390, 700]]) {
  test(`${profile} ${dimensions.join("x")} city switching frames each actual sample and releases prior camera sessions`, async t => {
    enableRealCamera(t, dimensions);
    const f = fixture(t, "bristol", { sequence: 1, result: { kind: "none" } }, profile);
    for (const [index, city] of ["bristol", "london", "birmingham"].entries()) {
      if (index) {
        const oldViewer = f.viewer, oldRequests = [...f.requests];
        f.update(city); f.navigate({ sequence: index + 1, result: { kind: "none" } });
        assert.equal(oldViewer.isDestroyed(), true);
        assert.ok(oldRequests.every(request => request.options.signal.aborted));
      }
      const pkg = retainedPackages[city];
      await f.manifest(pkg);
      const before = f.requests.length;
      await until(() => f.requests.length > before, `${city} actual viewport starts tile reads`);
      assertSampleTarget(f, pkg, dimensions, profile);
      assert.ok(f.requests.at(-1).url.startsWith(`/api/cities/${city}/render/${pkg.manifest.revision}/tiles/`));
    }
    assert.equal(f.viewers.length, 3);
    f.assertReadOnly();
  });
}
