import assert from "node:assert/strict";
import test from "node:test";
import { workspaceHref, workspaceTabFromSearch, workspaceUrl } from "../src/studio/workspaceNavigation.ts";

test("comparison demos open the intended workspace", () => {
  for (const tab of ["city", "author", "environment", "analysis", "detail"]) {
    const href = workspaceHref(tab);
    assert.equal(workspaceTabFromSearch(new URL(href, "http://localhost").search), tab);
  }
});

test("unknown or malformed workspace links safely return to the city", () => {
  assert.equal(workspaceTabFromSearch("?workspace=unknown"), "city");
  assert.equal(workspaceTabFromSearch("?workspace=analysis&workspace=author"), "analysis");
  assert.equal(workspaceTabFromSearch(""), "city");
});

test("workspace URLs retain unrelated options and anchors and scope the terrain view", () => {
  const href = "http://localhost/?workspace=environment&view=terrain&source=demo#result";
  assert.equal(workspaceUrl(href, "environment"), href);
  assert.equal(workspaceUrl(href, "analysis"), "http://localhost/?workspace=analysis&source=demo#result");
  assert.equal(workspaceUrl(href, "city"), "http://localhost/?source=demo#result");
});
