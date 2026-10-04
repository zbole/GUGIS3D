import type overview from "../../../shared/terrain-comparison-overview.json";

export type OverviewMetric = "storage" | "height" | "slope" | "aspect";
export interface OverviewView { metric: OverviewMetric; resolution: number; targetCentimetres?: number }
export type OverviewReport = typeof overview;

/** Export saved evidence at its original precision, independently of chart rounding. */
export function overviewExport(report: OverviewReport, view: OverviewView, format: "csv" | "json") {
  if (!report.variants.some(variant => variant.ruledSubdivisions === view.resolution))
    throw new Error("所选离散档位不在已测报告中。");
  const target = view.targetCentimetres ?? 1;
  if (!Number.isFinite(target) || target <= 0) throw new Error("高程差目标必须为正的有限厘米值。");
  const scope = {
    city: "bristol", coverage: "布里斯托扩展样本街区；非全城覆盖",
    terrain: report.demonstration ? "合成演示地形；非实测 DTM" : "已保存地形快照",
    comparison: "GUGIS 原生曲面 vs 本项目导出的 ArcGIS 兼容 MultiPatch 参考读回",
    arcgisRuntime: "not-measured", targetCentimetres: target,
    targetPolicy: "参数域最大高程差界限；不是 RMS 或真实地形绝对精度",
    bytePolicy: "未压缩文件体积；MultiPatch 配套五文件合计",
  };
  const name = `GUGIS-bristol-terrain-overview-${report.reportSha256.slice(0, 12)}`;
  if (format === "json") return {
    filename: `${name}.json`, mime: "application/json;charset=utf-8",
    content: JSON.stringify({ schema: "gugis-comparison-overview-export-v1", scope, view, sourceReport: report }, null, 2),
  };
  const header = ["城市", "覆盖范围", "地形来源", "离散档位", "GUGIS原生文件(bytes)", "MultiPatch五文件(bytes)",
    "存储节省(%)", "最大高程差界限(m)", "采样高程RMS差(m)", "坡度RMS差(deg)", "坡向RMS差(deg)",
    "查询总点数", "高程有效匹配点数", "坡度有效匹配点数", "坡向有效匹配点数", "覆盖状态不一致点数",
    `满足${target}cm参数域界限`, "当前选择档位", "当前图表指标", "来源城市SHA256", "报告SHA256", "对照范围", "ArcGIS软件运行实测"];
  const rows = [...report.variants].sort((a, b) => a.ruledSubdivisions - b.ruledSubdivisions).map(variant => [
    scope.city, scope.coverage, scope.terrain, `${variant.ruledSubdivisions}×${variant.ruledSubdivisions}`,
    variant.gugisTerrainBytes, variant.multipatchFilesBytes, variant.storageSavingPercent,
    variant.maxRuledHeightErrorMetres, variant.queries.sampledRmsHeightErrorMetres,
    variant.queries.derivatives.slope.rmsDegrees, variant.queries.derivatives.aspect.rmsDegrees,
    variant.queries.queryCount, variant.queries.matchedCount, variant.queries.derivatives.slopeMatchedCount,
    variant.queries.derivatives.aspectMatchedCount, variant.queries.coverageMismatchCount,
    variant.maxRuledHeightErrorMetres * 100 <= scope.targetCentimetres ? "是" : "否",
    variant.ruledSubdivisions === view.resolution ? "是" : "否", view.metric,
    report.cityRevision, report.reportSha256, scope.comparison, "未测量",
  ]);
  const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return { filename: `${name}.csv`, mime: "text/csv;charset=utf-8", content: `\uFEFF${csv}\r\n` };
}
