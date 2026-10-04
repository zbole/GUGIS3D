export interface ComparisonResolutionProps {
  resolution?: number;
  onResolutionChange?: (resolution: number) => void;
  targetCentimetres?: number;
  onTargetChange?: (centimetres: number) => void;
}

export interface ComparisonSample {
  distance: number;
  height: number | null;
  multipatchHeight: number | null;
  errorMetres: number | null;
  patch: string | null;
  kind: string | null;
  slope: number | null;
  multipatchSlope: number | null;
  slopeErrorDegrees: number | null;
  aspect: number | null;
  multipatchAspect: number | null;
  aspectErrorDegrees: number | null;
  nativeOnEdge: boolean | null;
  multipatchOnEdge: boolean | null;
  derivativeInterior: boolean;
}
export interface QuerySummary {
  queryCount: number;
  matchedCount: number;
  nativeValidCount: number;
  multipatchValidCount: number;
  coverageMismatchCount: number;
  sampledMaxAbsHeightErrorMetres: number;
  sampledRmsHeightErrorMetres: number | null;
  derivatives: {
    slopeMatchedCount: number; boundaryExcludedCount: number;
    slope: { rmsDegrees: number | null; maxAbsDegrees: number | null };
    aspectMatchedCount: number; nearFlatExcludedCount: number;
    aspect: { rmsDegrees: number | null; maxAbsDegrees: number | null };
  };
}
export interface ComparisonVariant {
  ruledSubdivisions: number;
  nativePatches: number;
  multipatchFilesBytes: number;
  multipatchVertexEntries: number;
  multipatchTriangles: number;
  gugisTerrainBytes: number;
  maxRuledHeightErrorMetres: number;
  storageSavingPercent: number;
  datasetSha256: string;
  queries: QuerySummary;
  profiles: { id: string; name: string; summary: QuerySummary; samples: ComparisonSample[] }[];
}
export interface ComparisonSuite {
  bundleId: string;
  cityRevision: string;
  demonstration: boolean;
  verticalDatum: string;
  packageBytes: number;
  packageSha256: string;
  derivativeMethod: { frame: string; horizontalJacobianStepMetres: number; aspectMinimumSlopeDegrees: number };
  statistics: { points: number; indices: number; triangles: number };
  variants: ComparisonVariant[];
}
export interface ArcGISRun {
  schema: "gugis-arcgis-pro-run-v1";
  cityRevision: string;
  bundleId: string;
  repeats: number;
  measuredAtUtc: string;
  runtime: { product: string; version: string; python: string; os: string; processor: string };
  cachePolicy: string;
  operations: string[];
  results: { subdivisions: number; datasetSha256: string; featureCount: number; vertexCount: number;
    shapeType: string; hasZ: boolean; horizontalWkid: number;
    readMs: number[]; copyMs: number[]; copyOutputBytes: number[]; medianReadMs: number; medianCopyMs: number }[];
}

export function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.floor(ordered.length / 2)];
}

/** Cheapest actual measured file satisfying the analytic parameter-domain bound. */
export function precisionChoice(suite: ComparisonSuite, toleranceCm: number): ComparisonVariant | null {
  if (!Number.isFinite(toleranceCm) || toleranceCm <= 0) return null;
  return [...suite.variants].filter(v => v.maxRuledHeightErrorMetres * 100 <= toleranceCm)
    .sort((a, b) => a.multipatchFilesBytes - b.multipatchFilesBytes)[0] ?? null;
}

export function comparisonSelection(suite: ComparisonSuite, resolution: number, toleranceCm: number,
                                    profileId: string, station: number, arcgis: ArcGISRun | null) {
  const variant = suite.variants.find(v => v.ruledSubdivisions === resolution);
  const profile = variant?.profiles.find(p => p.id === profileId);
  if (!variant || !profile || !Number.isInteger(station) || station < 0 || station >= profile.samples.length
      || !Number.isFinite(toleranceCm) || toleranceCm <= 0) throw new Error("所选对比状态无效。");
  const report = { schema: "gugis-comparison-selection-v1", cityRevision: suite.cityRevision, bundleId: suite.bundleId,
    packageSha256: suite.packageSha256, demonstration: suite.demonstration,
    scope: "GUGIS 原生曲面 vs 本项目 ArcGIS 兼容 MultiPatch；参考插值读回，非 ArcGIS 软件精度实测",
    target: { parameterDomainMaxHeightDifferenceCm: toleranceCm,
      smallestTestedResolution: precisionChoice(suite, toleranceCm)?.ruledSubdivisions ?? null,
      selectedSatisfies: variant.maxRuledHeightErrorMetres * 100 <= toleranceCm },
    selected: variant, profile: { id: profile.id, name: profile.name, stationIndex: station, sample: profile.samples[station] },
    derivativeMethod: suite.derivativeMethod, verticalDatum: suite.verticalDatum,
    arcgisRuntime: arcgis ? { status: "user-imported-not-independently-verified", report: parseArcGISRun(JSON.stringify(arcgis), suite) }
      : { status: "not-measured", report: null } };
  return JSON.parse(JSON.stringify(report));
}

/** A user file is evidence supplied by the user, not proof of independent execution. */
export function parseArcGISRun(text: string, suite: ComparisonSuite): ArcGISRun {
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error("实测报告不得超过 1 MiB。");
  let raw: any;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, "")); } catch { throw new Error("实测报告不是有效的 JSON。"); }
  if (!raw || raw.schema !== "gugis-arcgis-pro-run-v1") throw new Error("请选择实验包脚本生成的 ArcGIS Pro 实测报告。");
  if (raw.cityRevision !== suite.cityRevision || raw.bundleId !== suite.bundleId) throw new Error("报告来自另一份城市或实验包，不能与本页结果合并。");
  if (raw.repeats !== 3 || raw.cachePolicy !== "one-process-repeated-no-cold-cache-guarantee"
    || !Array.isArray(raw.operations) || raw.operations.length !== 2
    || !raw.operations.includes("SearchCursor-SHAPE@-and-PATCH_ID") || !raw.operations.includes("CopyFeatures-to-new-FGDB"))
    throw new Error("报告的重复次数、缓存条件或测量任务不匹配。");
  const string = (value: unknown, label: string, allowEmpty = false) => {
    if (typeof value !== "string" || value.length > 160 || (!allowEmpty && !value.trim())) throw new Error(`${label}缺失或无效。`);
    return value;
  };
  const runtime = { product: string(raw.runtime?.product, "ArcGIS 产品"), version: string(raw.runtime?.version, "ArcGIS 版本"),
    python: string(raw.runtime?.python, "Python 版本"), os: string(raw.runtime?.os, "操作系统"), processor: string(raw.runtime?.processor, "处理器", true) };
  if (runtime.product.replace(/\s/g, "").toLowerCase() !== "arcgispro") throw new Error("报告需要来自 ArcGIS Pro Python 环境。");
  const measuredAtUtc = string(raw.measuredAtUtc, "测量时间");
  if (!Number.isFinite(Date.parse(measuredAtUtc))) throw new Error("测量时间无效。");
  if (!Array.isArray(raw.results) || raw.results.length !== suite.variants.length) throw new Error("报告必须包含全部四档分辨率。");
  const results = suite.variants.map(variant => {
    const matches = raw.results.filter((row: any) => row?.subdivisions === variant.ruledSubdivisions);
    if (matches.length !== 1) throw new Error("报告分辨率重复或缺失。");
    const row = matches[0];
    if (row.datasetSha256 !== variant.datasetSha256 || row.featureCount !== variant.nativePatches
      || row.shapeType !== "MultiPatch" || row.hasZ !== true || row.horizontalWkid !== 27700)
      throw new Error("ArcGIS 读回的文件校验、要素数量或坐标系不匹配。");
    if (!Number.isSafeInteger(row.vertexCount) || row.vertexCount < 3) throw new Error("ArcGIS 顶点数量无效。");
    const values = (value: unknown, integer = false): number[] => {
      if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && (!integer || Number.isSafeInteger(n))))
        throw new Error("报告需要三次有效且非负的测量，不能用缺失值代替零。");
      return [...value];
    };
    const readMs = values(row.readMs), copyMs = values(row.copyMs), copyOutputBytes = values(row.copyOutputBytes, true);
    return { subdivisions: variant.ruledSubdivisions, datasetSha256: variant.datasetSha256,
      featureCount: row.featureCount, vertexCount: row.vertexCount, shapeType: "MultiPatch", hasZ: true,
      horizontalWkid: 27700, readMs, copyMs, copyOutputBytes, medianReadMs: median(readMs), medianCopyMs: median(copyMs) };
  });
  return { schema: "gugis-arcgis-pro-run-v1", cityRevision: suite.cityRevision, bundleId: suite.bundleId,
    repeats: 3, measuredAtUtc, runtime, cachePolicy: raw.cachePolicy, operations: [...raw.operations], results };
}

export function profilePath(samples: ComparisonSample[], key: "height" | "multipatchHeight" | "errorMetres" | "slope" | "multipatchSlope" | "slopeErrorDegrees",
                            width: number, height: number, min: number, max: number): string {
  const total = samples[samples.length - 1]?.distance ?? 0;
  let connected = false;
  return samples.map(sample => {
    const value = sample[key];
    if (value === null || !Number.isFinite(value)) { connected = false; return ""; }
    const x = total ? sample.distance / total * width : 0;
    const y = height - (value - min) / (max - min || 1) * height;
    const command = `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    connected = true;
    return command;
  }).filter(Boolean).join(" ");
}
