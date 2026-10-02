import { useCallback, useEffect, useRef, useState } from "react";

export type ProjectFreshness = "checking" | "current" | "changed" | "offline" | "paused";

const revisionPattern = /^[a-f0-9]{64}$/;

/** Read-only comparison against saved evidence; never reload or change that evidence. */
export function useProjectFreshness(snapshotRevision: string, apiBase = "/api") {
  const [freshness, setFreshness] = useState<ProjectFreshness>("checking");
  const checkRef = useRef<(() => void) | null>(null);
  const recheck = useCallback(() => { checkRef.current?.(); }, []);

  useEffect(() => {
    let disposed = false;
    let lostFocus = false;
    let active: { controller: AbortController; timer: number } | null = null;

    const cancel = () => {
      const previous = active;
      active = null;
      if (previous) {
        window.clearTimeout(previous.timer);
        previous.controller.abort();
      }
    };

    const check = async () => {
      if (disposed) return;
      cancel();
      if (document.visibilityState === "hidden") {
        setFreshness("paused");
        return;
      }
      const request = { controller: new AbortController(), timer: 0 };
      active = request;
      lostFocus = false;
      setFreshness("checking");
      request.timer = window.setTimeout(() => {
        if (active !== request || disposed) return;
        cancel();
        setFreshness("offline");
      }, 7000);
      try {
        const response = await fetch(`${apiBase.replace(/\/$/, "")}/city/revision`, {
          method: "GET", cache: "no-store", signal: request.controller.signal,
        });
        if (!response.ok) throw new Error("Revision unavailable");
        const result: unknown = await response.json();
        if (active !== request || disposed) return;
        if (!result || typeof result !== "object" || !("revision" in result)
          || typeof result.revision !== "string" || !revisionPattern.test(result.revision)
          || !revisionPattern.test(snapshotRevision)) {
          throw new Error("Invalid revision");
        }
        setFreshness(result.revision === snapshotRevision ? "current" : "changed");
      } catch {
        // Aborted/superseded requests must not overwrite a newer check's result.
        if (active === request && !disposed) setFreshness("offline");
      } finally {
        if (active === request) {
          window.clearTimeout(request.timer);
          active = null;
        }
      }
    };

    const onFocus = () => {
      // Returning to a tab often fires visibilitychange and focus together.
      // Reuse that active check, unless focus left again after it started.
      if (document.visibilityState !== "hidden" && (!active || lostFocus)) void check();
    };
    const onBlur = () => { lostFocus = true; };
    const onVisibilityChange = () => { void check(); };
    checkRef.current = check;
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);
    void check();
    return () => {
      disposed = true;
      checkRef.current = null;
      cancel();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [snapshotRevision, apiBase]);

  return { freshness, recheck };
}
