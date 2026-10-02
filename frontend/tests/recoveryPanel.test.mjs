import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { act, create } from "react-test-renderer";
import { componentBundle } from "./helpers/componentBundle.mjs";

const Panel = await componentBundle("RecoveryPanel", [{
  name: "recovery-api-double",
  setup(build) {
    build.onResolve({ filter: /^\.\/cityApi$/ }, () => ({ path: "cityApi", namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
      contents: "export const listVersions = offset => globalThis.recoveryApiMock(offset);",
    }));
  },
}]);
const text = node => typeof node === "string" ? node : (node?.children ?? []).map(text).join("");
const button = (root, label) => root.findAllByType("button").find(node => text(node) === label);
const rows = root => root.findByProps({ className: "version-list" }).findAllByType("strong");
const previews = root => root.findAllByType("button").filter(node => text(node) === "预览这个版本");
const version = (revision, current = false) => ({
  revision, current, modified_at: "2026-10-02T10:00:00Z", bytes: 1048576,
});

function fixture(overrides = {}) {
  const previous = globalThis.recoveryApiMock;
  const requests = [], calls = [];
  globalThis.recoveryApiMock = offset => new Promise((resolve, reject) => {
    requests.push({ offset, resolve, reject });
  });
  let renderer, closed = false;
  let props = { busy: false, onPreview: (...args) => calls.push(args), ...overrides };
  act(() => { renderer = create(React.createElement(Panel, props)); });
  return {
    requests, calls,
    get root() { return renderer.root; },
    get output() { return renderer.toJSON(); },
    update(next) {
      props = { ...props, ...next };
      act(() => renderer.update(React.createElement(Panel, props)));
    },
    async succeed(index, versions = [], hasMore = false) {
      await act(async () => requests[index].resolve({ versions, has_more: hasMore }));
    },
    async fail(index, message = "Network unavailable") {
      await act(async () => requests[index].reject(new Error(message)));
    },
    close() {
      if (closed) return;
      closed = true;
      act(() => renderer.unmount());
      if (previous === undefined) delete globalThis.recoveryApiMock;
      else globalThis.recoveryApiMock = previous;
    },
  };
}

test("first-request failure offers a guarded retry without reporting an empty history", async t => {
  const f = fixture();
  t.after(f.close);
  assert.deepEqual(f.requests.map(request => request.offset), [0]);
  assert.match(text(f.root.findByProps({ role: "status" })), /读取版本列表/);
  assert.equal(f.root.findByProps({ className: "version-list" }).props["aria-busy"], true);
  assert.equal(f.root.findAllByType("button").every(node => node.props.disabled), true);
  assert.doesNotMatch(text(f.root), /尚无历史版本/);

  await f.fail(0);
  assert.match(text(f.root.findByProps({ role: "alert" })), /版本列表读取失败.*Network unavailable/);
  assert.equal(f.root.findAllByProps({ role: "status" }).length, 0);
  assert.doesNotMatch(text(f.root), /尚无历史版本/);
  const retry = button(f.root, "重试读取版本列表");
  assert.equal(retry.props.disabled, false);
  act(() => { retry.props.onClick(); retry.props.onClick(); });
  assert.deepEqual(f.requests.map(request => request.offset), [0, 0]);
  assert.equal(f.root.findAllByProps({ role: "alert" }).length, 0);
  assert.equal(button(f.root, "刷新版本列表").props.disabled, true);
  await f.succeed(1, [version("recovered-version")]);
  assert.equal(rows(f.root).length, 1);
  assert.equal(previews(f.root)[0].props.disabled, false);
  assert.equal(f.root.findAllByProps({ role: "alert" }).length, 0);
  assert.deepEqual(f.calls, [], "loading and retrying never start a restoration");
});

test("failed pagination hides old rows and retries the requested page without stale preview callbacks", async t => {
  const f = fixture();
  t.after(f.close);
  await f.succeed(0, [version("first-page-version")], true);
  const oldPreview = previews(f.root)[0].props.onClick;
  const next = button(f.root, "下一页").props.onClick;
  act(() => { next(); next(); oldPreview(); });
  assert.deepEqual(f.requests.map(request => request.offset), [0, 20]);
  assert.equal(rows(f.root).length, 0);
  assert.equal(previews(f.root).length, 0);
  assert.deepEqual(f.calls, []);
  assert.equal(text(f.root.findByProps({ "aria-label": "版本列表页码" })), "第 2 页");
  assert.equal(button(f.root, "上一页").props.disabled, true);

  await f.fail(1, "Page two failed");
  assert.equal(rows(f.root).length, 0);
  assert.doesNotMatch(text(f.root), /尚无历史版本|本页暂无历史版本/);
  assert.equal(button(f.root, "上一页").props.disabled, false);
  assert.equal(button(f.root, "下一页").props.disabled, true);
  act(() => button(f.root, "重试读取版本列表").props.onClick());
  assert.deepEqual(f.requests.map(request => request.offset), [0, 20, 20]);
  await f.succeed(2, [version("second-page-version")]);
  act(() => oldPreview());
  assert.deepEqual(f.calls, [], "a callback from the previous page remains invalid after retry succeeds");
  act(() => previews(f.root)[0].props.onClick());
  assert.deepEqual(f.calls, [["second-page-version", "恢复历史版本 second-p"]]);
  assert.equal(button(f.root, "下一页").props.disabled, true);
});

test("refresh replaces the current page, and a failed later page can return to the previous one", async t => {
  const f = fixture();
  t.after(f.close);
  await f.succeed(0, [version("first-page-version")], true);
  act(() => button(f.root, "下一页").props.onClick());
  await f.succeed(1, [version("second-page-old")]);
  const oldPreview = previews(f.root)[0].props.onClick;
  act(() => button(f.root, "刷新版本列表").props.onClick());
  assert.equal(rows(f.root).length, 0);
  assert.deepEqual(f.requests.map(request => request.offset), [0, 20, 20]);
  await f.fail(2);
  act(() => { oldPreview(); button(f.root, "上一页").props.onClick(); });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.requests.map(request => request.offset), [0, 20, 20, 0]);
  await f.succeed(3, [version("updated-first-page")], true);
  assert.equal(rows(f.root).length, 1);
  assert.match(text(f.root), /updated-/);
  assert.doesNotMatch(text(f.root), /second-p/);
  assert.equal(button(f.root, "上一页").props.disabled, true);
  assert.equal(button(f.root, "下一页").props.disabled, false);
});

test("successful empty pages have accurate first-page and later-page guidance", async t => {
  const f = fixture();
  t.after(f.close);
  await f.succeed(0);
  assert.match(text(f.root), /尚无历史版本/);
  assert.equal(f.root.findAllByProps({ role: "alert" }).length, 0);
  assert.equal(button(f.root, "下一页").props.disabled, true);
  act(() => button(f.root, "刷新版本列表").props.onClick());
  assert.doesNotMatch(text(f.root), /尚无历史版本/);
  await f.succeed(1, [version("new-version")], true);
  act(() => button(f.root, "下一页").props.onClick());
  await f.succeed(2);
  assert.match(text(f.root), /本页暂无历史版本，请返回上一页或刷新列表/);
  assert.doesNotMatch(text(f.root), /尚无历史版本/);
  assert.equal(button(f.root, "上一页").props.disabled, false);
});

test("busy mutation guards every action and previews preserve baseline and current-version semantics", async t => {
  const f = fixture();
  t.after(f.close);
  await f.succeed(0, [version("historic-version"), version("current-version", true)], true);
  assert.equal(previews(f.root)[1].props.disabled, true);
  act(() => previews(f.root)[1].props.onClick());
  assert.deepEqual(f.calls, []);
  f.update({ busy: true });
  assert.equal(f.root.findAllByType("button").every(node => node.props.disabled), true);
  act(() => { for (const node of f.root.findAllByType("button")) node.props.onClick(); });
  assert.deepEqual(f.calls, []);
  assert.equal(f.requests.length, 1);
  f.update({ busy: false });
  act(() => {
    button(f.root, "仅恢复内置建筑（保留地形 / 地物）").props.onClick();
    button(f.root, "预览内置初始城市").props.onClick();
    previews(f.root)[0].props.onClick();
  });
  assert.deepEqual(f.calls, [
    ["baseline", "仅恢复内置建筑，保留当前道路、地形与函数地物", true],
    ["baseline", "恢复内置初始城市（615 栋，不含后加地形）"],
    ["historic-version", "恢复历史版本 historic"],
  ]);
  f.update({ busy: true });
  assert.equal(f.requests.length, 1, "mutation status changes do not reload the list implicitly");
});

for (const outcome of ["success", "failure"]) {
  test(`late ${outcome} from an unmounted request cannot replace a newer panel`, async t => {
    const f = fixture();
    t.after(f.close);
    f.update({ key: "replacement-panel" });
    assert.equal(f.requests.length, 2);
    await f.succeed(1, [version("new-panel-version")]);
    const before = JSON.stringify(f.output);
    if (outcome === "success") await f.succeed(0, [version("stale-version")], true);
    else await f.fail(0, "Stale request failed");
    assert.equal(JSON.stringify(f.output), before);
    assert.equal(button(f.root, "下一页").props.disabled, true);
    assert.deepEqual(f.calls, []);
    act(() => button(f.root, "刷新版本列表").props.onClick());
    f.close();
    if (outcome === "success") await f.succeed(2, [version("after-unmount")]);
    else await f.fail(2, "Request failed after unmount");
    assert.equal(f.output, null);
  });
}
