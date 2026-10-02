import { useCallback, useEffect, useState } from "react";
import { workspaceTabFromSearch, workspaceUrl, type WorkspaceTab } from "./workspaceNavigation";

export function useWorkspaceNavigation(): readonly [WorkspaceTab, (tab: WorkspaceTab) => void] {
  const [tab, setTab] = useState<WorkspaceTab>(() => workspaceTabFromSearch(
    typeof window === "undefined" ? "" : window.location?.search ?? "",
  ));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const restore = () => setTab(workspaceTabFromSearch(window.location?.search ?? ""));
    // Normalise an invalid entry link without adding a history entry.
    if (window.location?.href && window.history?.replaceState) {
      const initialTab = workspaceTabFromSearch(window.location.search);
      const href = workspaceUrl(window.location.href, initialTab);
      if (href !== window.location.href) window.history.replaceState(window.history.state, "", href);
    }
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);

  const navigate = useCallback((next: WorkspaceTab) => {
    if (typeof window !== "undefined" && window.location?.href && window.history?.pushState) {
      const href = workspaceUrl(window.location.href, next);
      if (href !== window.location.href) window.history.pushState(window.history.state, "", href);
    }
    setTab(next);
  }, []);
  return [tab, navigate] as const;
}
