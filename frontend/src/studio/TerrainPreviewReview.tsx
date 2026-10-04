import { useMemo } from "react";
import type { Terrain } from "./environment";
import { terrainStatistics } from "./terrainMath";

const datums: Record<string, string> = { ODN: "ODN 英国正高", ellipsoidal: "椭球高", local: "局部相对高程", unknown: "未声明基准" };
const numeric = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
function terrainSummary(terrain?: Terrain | null) {
  if (!terrain) return null;
  let minimum = Infinity, maximum = -Infinity;
  // A high-resolution import can contain 300,000 points; avoid argument spreading.
  for (const point of terrain.points) {
    if (!Number.isFinite(point[2])) continue;
    minimum = Math.min(minimum, point[2]); maximum = Math.max(maximum, point[2]);
  }
  return { terrain, count: terrainStatistics(terrain).count,
    range: minimum === Infinity ? "无有效控制点" : `${numeric(minimum)} 至 ${numeric(maximum)} m` };
}

export default function TerrainPreviewReview({ before, after }: { before?: Terrain | null; after?: Terrain | null }) {
  const original = useMemo(() => terrainSummary(before), [before]);
  const preview = useMemo(() => terrainSummary(after), [after]);
  if ((!before && !after) || before === after) return null;
  const changedDatum = !!before && !!after && before.vertical_datum !== after.vertical_datum;
  const missingRecord = before?.source["NoData处理"] || after?.source["NoData处理"];
  const describe = (summary: ReturnType<typeof terrainSummary>, row: string) => {
    if (!summary) return "无地形";
    const { terrain, count } = summary;
    if (row === "来源标注") return terrain.demonstration ? "合成演示 · 非实测" : "待核验地形 · 实测属性未独立核验";
    if (row === "高程基准") return datums[terrain.vertical_datum] ?? terrain.vertical_datum;
    if (row === "控制点高程范围") return summary.range;
    if (row === "显示参考高程") return `${numeric(terrain.reference_height)} m`;
    if (row === "缺测检查记录") {
      if (!terrain.source["NoData处理"]) return "旧档案未记录源像元缺测检查";
      const counts = ["裁剪源像元", "无效源像元", "剔除采样控制点"].map(key => terrain.source[key]);
      if (counts.some(value => !value || value.length > 8 || !/^(0|[1-9]\d*)$/.test(value)) ||
        Number(counts[0]) < 4 || Number(counts[1]) > Number(counts[0]) || Number(counts[0]) > 50000000 ||
        Number(counts[2]) > Math.min(300000, Number(counts[0])))
        return "缺测检查记录不完整，无法显示数量";
      return `导入记录：${numeric(Number(counts[0]))} 源像元 / ${numeric(Number(counts[1]))} 无效源像元 / ${numeric(Number(counts[2]))} 剔除控制点`;
    }
    return `${numeric(count["ruled-strip"])} 直纹面带 / ${numeric(count["triangle-strip"])} 三角带${count["triangle-fan"] ? ` / ${numeric(count["triangle-fan"])} 旧三角扇` : ""}`;
  };
  return <details className="terrain-preview-review" open={changedDatum || after?.vertical_datum === "unknown"}>
    <summary>地形预览核对 · 基准、控制网与原生面带{changedDatum ? " · 高程基准已改变" : after?.vertical_datum === "unknown" ? " · 未声明高程基准" : after?.demonstration ? " · 非实测演示" : ""}</summary>
    <div className="terrain-preview-review-scroll" role="region" aria-label="地形草稿前后信息，可横向滚动" tabIndex={0}>
      <table><caption>正式地形与草稿地形；高程单位为米</caption><thead><tr><th scope="col">核对项目</th><th scope="col">正式项目</th><th scope="col">当前草稿</th></tr></thead>
        <tbody><tr><th scope="row">地形名称</th><td>{before?.name ?? "无地形"}</td><td>{after?.name ?? "无地形"}</td></tr>
          {["来源标注", "高程基准", "控制点高程范围", "显示参考高程", "原生面带", ...(missingRecord ? ["缺测检查记录"] : [])].map(row => <tr key={row}><th scope="row">{row}</th><td>{describe(original, row)}</td><td>{describe(preview, row)}</td></tr>)}
        </tbody></table>
    </div>
    {changedDatum && <p className="terrain-preview-caution">高程基准已改变；系统不会自动进行 ODN、椭球高或局部基准转换。核对源数据后再确认写入。</p>}
    {after?.vertical_datum === "unknown" && <p className="terrain-preview-caution">草稿未声明高程基准；不能据此与其他高程直接比较。</p>}
    {missingRecord && <p className="terrain-preview-caution">缺测检查针对导入裁剪范围；降采样会保守扩大缺测边缘。记录数量不代表全城覆盖率或实测精度。</p>}
    <p>这里统计控制点的源高程，不代表实测精度、完整地形极值或 NoData 覆盖率。场景显示使用源高程减去显示参考高程，保存保留源值。</p>
    {after && <p>地形替换后，已保存的剖面记录仍保留；打开时依据当前地形重新计算，保存后才更新记录。</p>}
  </details>;
}
