import { useEffect, useState } from "react";

const pageIsHidden = () => typeof document !== "undefined" && document.hidden === true;

/** Manual pause survives visibility changes, but is local to one preview session. */
export function useTileLoadingControl() {
  const [manualPaused, setManualPaused] = useState(false);
  const [pageHidden, setPageHidden] = useState(pageIsHidden);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const target = document;
    const update = () => setPageHidden(target.hidden === true);
    update();
    target.addEventListener("visibilitychange", update);
    return () => target.removeEventListener("visibilitychange", update);
  }, []);
  return { manualPaused, pageHidden, paused: manualPaused || pageHidden, setManualPaused };
}
