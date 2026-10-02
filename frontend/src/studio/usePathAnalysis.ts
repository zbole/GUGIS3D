import { useEffect, useRef, useState } from "react";
import { analyzePath, type AnalysisPoint, type PathAnalysis } from "./terrainAnalysis";
import type { Terrain } from "./environment";

/** One worker per workspace; discard stale responses and send the terrain only when changed. */
export function usePathAnalysis(points: AnalysisPoint[], terrain?: Terrain, spacing = 5) {
  const worker = useRef<Worker | null>(null);
  const sentTerrain = useRef<Terrain | null | undefined>();
  const serial = useRef(0);
  const [state, setState] = useState<{ result: PathAnalysis | null; busy: boolean; error: string }>({ result: null, busy: false, error: "" });
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; serial.current++; }, []);
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
          worker.current = new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" });
          sentTerrain.current = null;
          worker.current.onmessage = (event) => {
            if (event.data.id !== serial.current) return;
            setState({ result: event.data.result ?? null, busy: false, error: event.data.error ?? "" });
          };
          worker.current.onerror = () => {
            worker.current?.terminate(); worker.current = null;
            setState({ result: null, busy: false, error: "分析线程启动失败，请撤回一个点后重试。" });
          };
        }
        const request = { id, points, spacing, ...(sentTerrain.current !== terrain ? { terrain: terrain ?? null } : {}) };
        worker.current.postMessage(request);
        sentTerrain.current = terrain;
      } catch (error) {
        setState({ result: null, busy: false, error: error instanceof Error ? error.message : "地形分析失败" });
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [points, terrain, spacing]);
  return state;
}
