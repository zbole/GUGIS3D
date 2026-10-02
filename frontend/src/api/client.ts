import fallbackData from "../data/sample_gugis_objects.json";
import type { GugisObject, Layer } from "../types/gugis";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

function normalizeFallbackObjects(): GugisObject[] {
  return ((fallbackData as unknown as { objects: GugisObject[] }).objects ?? []);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function buildFallbackLayers(objects: GugisObject[]): Layer[] {
  const labels: Record<string, string> = {
    buildings: "Buildings",
    roads: "Roads",
    parks: "Green Areas",
    templates: "Template Objects"
  };
  const grouped = objects.reduce<Record<string, number>>((acc, obj) => {
    acc[obj.layer_id] = (acc[obj.layer_id] ?? 0) + 1;
    return acc;
  }, {});

  return [
    ...Object.entries(grouped).map(([layer_id, object_count]) => ({
      layer_id,
      name: labels[layer_id] ?? layer_id,
      object_count,
      visible: true,
      opacity: 1,
      placeholder: false
    })),
    { layer_id: "terrain", name: "Terrain", object_count: 0, visible: true, opacity: 0.65, placeholder: true },
    { layer_id: "ai_results", name: "AI Results", object_count: 0, visible: true, opacity: 1, placeholder: true }
  ];
}

export async function getObjects(): Promise<GugisObject[]> {
  try {
    return await request<GugisObject[]>("/objects");
  } catch (error) {
    console.warn("Falling back to bundled sample objects", error);
    return normalizeFallbackObjects();
  }
}

export async function getLegacyScene(): Promise<{objects: GugisObject[]; layers: Layer[]; source: string}> {
  try {
    const [objects, layers] = await Promise.all([request<GugisObject[]>("/objects"), request<Layer[]>("/layers")]);
    return {objects, layers, source: "Local API connected"};
  } catch {
    const objects = normalizeFallbackObjects();
    return {objects, layers: buildFallbackLayers(objects), source: "Offline bundled sample"};
  }
}

export async function getLayers(): Promise<Layer[]> {
  try {
    return await request<Layer[]>("/layers");
  } catch (error) {
    console.warn("Falling back to bundled sample layers", error);
    return buildFallbackLayers(normalizeFallbackObjects());
  }
}

export async function queryHybridBox(center: [number, number, number], radius2d: number): Promise<GugisObject[]> {
  return request<GugisObject[]>("/analysis/hybrid-box-query", {
    method: "POST",
    body: JSON.stringify({ center, radius_2d: radius2d })
  });
}
