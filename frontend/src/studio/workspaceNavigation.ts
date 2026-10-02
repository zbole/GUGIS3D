export type WorkspaceTab = "city" | "author" | "detail" | "environment" | "analysis";

const validTabs: readonly WorkspaceTab[] = ["city", "author", "detail", "environment", "analysis"];

export function workspaceTabFromSearch(search: string): WorkspaceTab {
  const value = new URLSearchParams(search).get("workspace");
  return validTabs.includes(value as WorkspaceTab) ? value as WorkspaceTab : "city";
}

export function workspaceHref(tab: WorkspaceTab): string {
  return tab === "city" ? "/" : `/?workspace=${tab}`;
}

// Retain unrelated URL options and anchors while changing workspaces.
export function workspaceUrl(href: string, tab: WorkspaceTab): string {
  const url = new URL(href);
  if (tab === "city") url.searchParams.delete("workspace");
  else url.searchParams.set("workspace", tab);
  if (tab !== "environment") url.searchParams.delete("view");
  return url.href;
}
