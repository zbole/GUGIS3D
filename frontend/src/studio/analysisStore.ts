import type { CityDocument } from "./cityModel";
import type { Terrain } from "./environment";
import type { AnalysisPoint, PathAnalysis } from "./terrainAnalysis";

export const analysisKey = "gugis_path_analyses_v1";
export const analysisAlgorithm = "native-profile/1";
export interface SavedAnalysis {
  id: string;
  name: string;
  createdAt: string;
  points: AnalysisPoint[];
  spacing: number;
  terrainFingerprint: string;
  result: PathAnalysis;
  algorithm: string;
  coordinateSystem: "WGS84_DEGREES_LOCAL_HEIGHT_METERS";
  source: Record<string, string>;
  referenceHeight: number | null;
  /** Width of the vertical city section corridor in metres. */
  sectionWidth?: number;
}

// A deterministic change detector, not a cryptographic identity or accuracy claim.
export function terrainFingerprint(terrain?: Terrain): string {
  if (!terrain) return "none";
  const text = JSON.stringify([
    terrain.version, terrain.name, terrain.longitude, terrain.latitude,
    terrain.vertical_datum, terrain.reference_height, terrain.demonstration,
    Object.entries(terrain.source).sort(([a], [b]) => a.localeCompare(b)),
    terrain.points, terrain.patches.map(p => [p.id, p.kind, p.left, p.right, p.indices, p.hub, p.ring]),
  ]);
  let a = 2166136261, b = 5381;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ text.charCodeAt(i);
  }
  return `terrain-v1:${text.length}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
}

const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const nullableNumber = (x: unknown) => x === null || finite(x);
const nullableText = (x: unknown) => x === null || typeof x === "string";
export function readAnalyses(city: CityDocument): SavedAnalysis[] {
  const text = city.metadata[analysisKey];
  if (!text) return [];
  try {
    if (text.length > 12_000_000) throw new Error();
    const envelope = JSON.parse(text);
    if (envelope.version !== 1 || !Array.isArray(envelope.records) || envelope.records.length > 100) throw new Error();
    const ids = new Set<string>();
    for (const r of envelope.records) {
      if (!r || typeof r.id !== "string" || !r.id || ids.has(r.id) ||
        typeof r.name !== "string" || !r.name.trim() || r.name.length > 80 ||
        typeof r.createdAt !== "string" || !Number.isFinite(Date.parse(r.createdAt)) ||
        r.algorithm !== analysisAlgorithm || r.coordinateSystem !== "WGS84_DEGREES_LOCAL_HEIGHT_METERS" ||
        typeof r.terrainFingerprint !== "string" || !finite(r.spacing) || r.spacing <= 0 ||
        (r.sectionWidth !== undefined && (!finite(r.sectionWidth) || r.sectionWidth < 2 || r.sectionWidth > 200)) ||
        !nullableNumber(r.referenceHeight) || !r.source || typeof r.source !== "object" || Array.isArray(r.source) ||
        !Object.values(r.source).every(v => typeof v === "string") ||
        !Array.isArray(r.points) || r.points.length < 2 || r.points.length > 64 ||
        !r.points.every((p: AnalysisPoint) => p && finite(p.longitude) && Math.abs(p.longitude) <= 180 &&
          finite(p.latitude) && Math.abs(p.latitude) <= 85 && finite(p.altitude))) throw new Error();
      const result = r.result;
      if (!result || !finite(result.horizontalDistance) || result.horizontalDistance <= 0 ||
        !finite(result.spatialDistance) || result.spatialDistance < 0 || !finite(result.elevationChange) ||
        !finite(result.coverage) || result.coverage < 0 || result.coverage > 1 ||
        !finite(result.sampleSpacing) || result.sampleSpacing <= 0 ||
        ![result.surfaceDistance, result.ascent, result.descent].every(nullableNumber) ||
        [result.surfaceDistance, result.ascent, result.descent].some(v => v !== null && v < 0) ||
        !nullableText(result.terrainName) || !nullableText(result.verticalDatum) ||
        !Array.isArray(result.samples) || result.samples.length < 2 || result.samples.length > 501 ||
        Math.abs(result.samples[0]?.distance) > 1e-6 ||
        Math.abs(result.samples[result.samples.length - 1]?.distance - result.horizontalDistance) > 1e-6) throw new Error();
      let previous = -1;
      for (const s of result.samples) {
        if (!s || !finite(s.distance) || s.distance < 0 || s.distance <= previous || s.distance > result.horizontalDistance + 1e-6 ||
          !nullableNumber(s.height) || !nullableNumber(s.slope) || !nullableText(s.patch) || !nullableText(s.kind) ||
          (s.slope !== null && (s.slope < 0 || s.slope > 90)) ||
          (s.kind !== null && !["ruled-strip", "triangle-strip", "triangle-fan"].includes(s.kind)) ||
          (s.gapBefore !== undefined && typeof s.gapBefore !== "boolean")) throw new Error();
        previous = s.distance;
      }
      ids.add(r.id);
    }
    return envelope.records;
  } catch {
    throw new Error("项目中的分析记录格式无效或版本不支持；已保留原始数据，暂不覆盖。请先导出项目备份。");
  }
}

export function writeAnalyses(city: CityDocument, records: SavedAnalysis[]): CityDocument {
  // Reject invalid existing metadata rather than silently replacing imported data.
  readAnalyses(city);
  const metadata = { ...city.metadata, [analysisKey]: JSON.stringify({ version: 1, records }, (_key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("分析记录含无效数值，未写入项目。");
    return value;
  }) };
  if (Object.keys(metadata).length > 30) throw new Error("城市元数据已满，无法添加分析记录。");
  const next = { ...city, metadata };
  readAnalyses(next);
  return next;
}
