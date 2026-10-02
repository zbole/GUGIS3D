import { useEffect, useRef, useState } from "react";
import { analyzePath, type AnalysisPoint, type PathAnalysis } from "./terrainAnalysis";
import type { Terrain } from "./environment";

/** Reuse idle workers and terrain, but cancel superseded work instead of queuing it. */
export function usePathAnalysis(points: AnalysisPoint[], terrain?: Terrain, spacing = 5) {
  const worker = useRef<Worker | null>(null);
  const sentTerrain = useRef<Terrain | null | undefined>();
  const pending = useRef<number | null>(null);
  const serial = useRef(0);
  const [state, setState] = useState<{ result: PathAnalysis | null; busy: boolean; error: string }>({ result: null, busy: false, error: "" });
  function stopWorker() {
    worker.current?.terminate();
    worker.current = null;
    sentTerrain.current = undefined;
    pending.current = null;
  }
  useEffect(() => () => { stopWorker(); serial.current++; }, []);
  useEffect(() => {
    const id = ++serial.current;
    if (points.length < 2) { setState({ result: null, busy: false, error: "" }); return; }
    setState({ result: null, busy: true, error: "" });
    // Debounce rapid edits, while keeping map interactions independent of analysis.
    const timer = setTimeout(() => {
      try {
        if (typeof Worker === "undefined") {
          setState({ result: analyzePath(points, terrain, spacing), busy: false, error: "" });
          return;
        }
        if (!worker.current) {
          const activeWorker = new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" });
          worker.current = activeWorker;
          sentTerrain.current = null;
          activeWorker.onmessage = (event) => {
            if (worker.current !== activeWorker || event.data.id !== serial.current || event.data.id !== pending.current) return;
            pending.current = null;
            setState({ result: event.data.result ?? null, busy: false, error: event.data.error ?? "" });
          };
          activeWorker.onerror = () => {
            // A terminated worker can still have an already queued error event.
            if (worker.current !== activeWorker) return;
            const failedRequest = pending.current === serial.current;
            stopWorker();
            if (failedRequest) setState({ result: null, busy: false, error: "分析线程启动失败，请撤回一个点后重试。" });
          };
        }
        const request = { id, points, spacing, ...(sentTerrain.current !== terrain ? { terrain: terrain ?? null } : {}) };
        pending.current = id;
        worker.current.postMessage(request);
        sentTerrain.current = terrain;
      } catch (error) {
        stopWorker();
        setState({ result: null, busy: false, error: error instanceof Error ? error.message : "地形分析失败" });
      }
    }, 80);
    return () => {
      clearTimeout(timer);
      // analyzePath is synchronous inside the worker. Termination is the only
      // way to stop its CPU work immediately when the route is edited/cleared.
      if (pending.current === id) stopWorker();
    };
  }, [points, terrain, spacing]);
  return state;
}
