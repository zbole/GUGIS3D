import { analyzePath, type AnalysisPoint } from "./terrainAnalysis";
import type { Terrain } from "./environment";

let terrain: Terrain | null = null;
self.onmessage = (event: MessageEvent<{ id: number; points: AnalysisPoint[]; spacing: number; terrain?: Terrain | null }>) => {
  const request = event.data;
  if ("terrain" in request) terrain = request.terrain ?? null;
  try {
    self.postMessage({ id: request.id, result: analyzePath(request.points, terrain, request.spacing) });
  } catch (error) {
    self.postMessage({ id: request.id, error: error instanceof Error ? error.message : "地形分析失败" });
  }
};
