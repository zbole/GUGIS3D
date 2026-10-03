import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import React from "react";
import { act, create } from "react-test-renderer";
import { Rectangle, ScreenSpaceEventType } from "cesium";
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
function fixture(t, cityId = "bristol") {
  const originalFetch = globalThis.fetch, requests = [], states = [], viewersBefore = viewState.viewers.length;
  let renderer, currentWorkspace = workspaces[cityId], mounted = true;
  const onWorkspaceState = (...state) => states.push(state);
  globalThis.fetch = (url, options = {}) => {
    const pending = deferred();
    // Ignore cancellation at transport level to independently test stale replies.
    requests.push({ ...pending, url, options });
    return pending.promise;
  };
  const element = () => React.createElement(Preview, { workspace: currentWorkspace, onWorkspaceState });
  act(() => { renderer = create(element(), { createNodeMock: () => ({}) }); });
  const f = {
    requests, states,
    get root() { return renderer.root; },
    get content() { return text(renderer.toJSON()); },
    get status() { return text(renderer.root.findByProps({ className: "tile-preview-status" })); },
    get viewers() { return viewState.viewers.slice(viewersBefore); },
    get viewer() { return f.viewers.at(-1); },
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
  assert.ok(geometryIds(viewer).includes("bristol-building-0/wall"));
  viewer.picked = { id: "bristol-building-0/wall" };
  act(() => viewState.handlers.at(-1).actions.get(ScreenSpaceEventType.LEFT_CLICK)({ position: {} }));
  assert.ok(f.content.includes("取消建筑选择"));
  await f.tile(pkg, "x1_y0", 2);
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
  const viewer = f.viewer, flights = viewer.camera.flights.length;
  f.click("重试失败瓦片");
  assert.equal(f.requests.length, 4);
  assert.equal(f.requests.at(-1).url, failed.url);
  await f.tile(pkg, "x1_y0", 2);
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
