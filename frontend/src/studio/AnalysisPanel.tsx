import { useEffect, useMemo, useState } from "react";
import { Download, MousePointer2, PencilRuler, Save, Trash2, Undo2 } from "lucide-react";
import type { Terrain } from "./environment";
import type { AnalysisPoint, PathAnalysis } from "./terrainAnalysis";
import type { SavedAnalysis } from "./analysisStore";
import "./analysis.css";

type Props = {
  points: AnalysisPoint[];
  result: PathAnalysis | null;
  terrain?: Terrain;
  drawing: boolean;
  busy: boolean;
  canSave: boolean;
  records: SavedAnalysis[];
  selectedId: string | null;
  fingerprint: string;
  onDrawing: (drawing: boolean) => void;
  onUndo: () => void;
  onClear: () => void;
  onHover: (distance: number | null) => void;
  onSave: (name: string) => Promise<boolean>;
  onOpen: (record: SavedAnalysis) => void;
  onDelete: (id: string) => void;
};

const number = (value: number | null, digits = 1) =>
  value !== null && Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const length = (value: number | null) =>
  value === null ? "—" : value >= 1000 ? `${number(value / 1000, 2)} km` : `${number(value)} m`;
const datums: Record<string, string> = {
  ODN: "ODN 英国正高",
  ellipsoidal: "椭球高",
  local: "局部高程基准",
  unknown: "未声明高程基准",
};
const surfaceKinds: Record<string, string> = { "ruled-strip": "直纹面带", "triangle-strip": "三角带", "triangle-fan": "三角扇" };

function csvCell(value: string | number | null) {
  let text = value === null ? "" : String(value);
  // Spreadsheet applications must not interpret an imported source name as a formula.
  if (typeof value === "string" && /^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadProfile(name: string, result: PathAnalysis, terrain?: Terrain) {
  const rows: (string | number | null)[][] = [
    ["GUGIS 地形剖面", name],
    ["地形来源", terrain?.name ?? result.terrainName ?? "未载入地形"],
    ["来源说明", terrain ? Object.entries(terrain.source).map(([key, value]) => `${key}: ${value}`).join("; ") : ""],
    ["高程基准", result.verticalDatum ?? "unknown"],
    ["高程含义", "源数据高程，单位米；空值为无地形数据，不插值跨越"],
    ["基础采样间距_m", result.sampleSpacing],
    ["有效覆盖率", result.coverage],
    ["水平长度_m", result.horizontalDistance],
    ["选点三维折线_m", result.spatialDistance],
    ["采样地表长度_m", result.surfaceDistance],
    ["累计上升_m", result.ascent],
    ["累计下降_m", result.descent],
    [],
    ["沿线距离_m", "源高程_m", "地表坡度_度", "原生面片ID", "原生面片类型", "此前是否有无数据间断"],
    ...result.samples.map((sample) => [sample.distance, sample.height, sample.slope, sample.patch, sample.kind, sample.gapBefore ? "是" : "否"]),
  ];
  const blob = new Blob(["\uFEFF", rows.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(name.trim() || "GUGIS地形剖面").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ProfileChart({ result, onHover }: { result: PathAnalysis; onHover: Props["onHover"] }) {
  const [cursor, setCursor] = useState<number | null>(null);
  useEffect(() => { setCursor(null); }, [result]);
  const chart = useMemo(() => {
    const heights = result.samples.flatMap((s) => s.height === null ? [] : [s.height]);
    if (!heights.length) return null;
    const min = Math.min(...heights), max = Math.max(...heights);
    const padding = Math.max((max - min) * 0.12, 0.5);
    const lower = min - padding, upper = max + padding;
    const total = result.samples[result.samples.length - 1]?.distance ?? result.horizontalDistance;
    const x = (d: number) => 42 + 264 * d / Math.max(total, 0.001);
    const y = (h: number) => 126 - (h - lower) * 102 / (upper - lower);
    let segments = "", continuing = false;
    for (const sample of result.samples) {
      if (sample.height === null) { continuing = false; continue; }
      if (sample.gapBefore) continuing = false;
      segments += `${continuing ? "L" : "M"}${x(sample.distance).toFixed(2)},${y(sample.height).toFixed(2)} `;
      continuing = true;
    }
    return { lower, upper, total, x, y, segments };
  }, [result]);
  if (!chart) return <p className="analysis-empty">路线尚未覆盖有效地形。请在地形范围内选点；无数据区域不会推测补全。</p>;
  const sample = cursor === null ? null : result.samples[cursor];
  function select(index: number | null) {
    setCursor(index);
    onHover(index === null ? null : result.samples[index].distance);
  }
  return <div className="analysis-profile">
    <svg viewBox="0 0 324 155" role="img" tabIndex={0}
      aria-label="地形高程剖面。移动指针或使用左右方向键查看沿线采样点；空缺处表示无数据。"
      onPointerMove={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const distance = Math.max(0, Math.min(1, ((event.clientX - box.left) * 324 / box.width - 42) / 264)) * chart.total;
        let index = 0;
        result.samples.forEach((s, i) => { if (Math.abs(s.distance - distance) < Math.abs(result.samples[index].distance - distance)) index = i; });
        select(index);
      }}
      onPointerLeave={() => select(null)}
      onBlur={() => select(null)}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "Escape") { select(null); return; }
        const index = event.key === "Home" ? 0 : event.key === "End" ? result.samples.length - 1
          : Math.max(0, Math.min(result.samples.length - 1, (cursor ?? (event.key === "ArrowRight" ? -1 : result.samples.length)) + (event.key === "ArrowRight" ? 1 : -1)));
        select(index);
      }}>
      <title>地形高程剖面（源数据高程，米）</title>
      {[0, 0.5, 1].map((fraction) => {
        const value = chart.lower + fraction * (chart.upper - chart.lower);
        return <g key={fraction} className="analysis-chart-grid">
          <line x1="42" x2="306" y1={chart.y(value)} y2={chart.y(value)} />
          <text x="36" y={chart.y(value) + 3} textAnchor="end">{number(value)}</text>
        </g>;
      })}
      <text x="42" y="14" className="analysis-chart-unit">高程 / m</text>
      <text x="42" y="145" className="analysis-chart-unit">0</text>
      <text x="306" y="145" textAnchor="end" className="analysis-chart-unit">{length(chart.total)}</text>
      <path className="analysis-chart-line" d={chart.segments} fill="none" />
      {sample && <g className="analysis-chart-cursor">
        <line x1={chart.x(sample.distance)} x2={chart.x(sample.distance)} y1="22" y2="128" />
        {sample.height !== null && <circle cx={chart.x(sample.distance)} cy={chart.y(sample.height)} r="4" />}
      </g>}
    </svg>
    <div className="analysis-chart-readout" aria-live="polite">
      {sample ? <><span>距离 {length(sample.distance)}</span><span>高程 {sample.height === null ? "无数据" : `${number(sample.height, 2)} m`}</span><span>地表坡度 {sample.slope === null ? "—" : `${number(sample.slope, 2)}°`}</span>{sample.patch && <span className="analysis-patch">{surfaceKinds[sample.kind ?? ""] ?? "面片"} {sample.patch}</span>}</>
        : <span>悬停剖面可定位场景；方向键逐点查看</span>}
    </div>
  </div>;
}

export default function AnalysisPanel(props: Props) {
  const { points, result, terrain, drawing, busy, canSave, records, selectedId, fingerprint, onDrawing, onUndo, onClear, onHover, onSave, onOpen, onDelete } = props;
  const [name, setName] = useState("布里斯托地形剖面");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const selectedName = records.find((record) => record.id === selectedId)?.name;
  useEffect(() => {
    if (selectedName) setName(selectedName);
    setMessage("");
  }, [selectedId, selectedName, points]);
  const disabled = busy || saving;
  const source = terrain ? Object.entries(terrain.source) : [];
  const datum = result?.verticalDatum ?? terrain?.vertical_datum ?? "unknown";
  const available = !!result && points.length >= 2 && result.horizontalDistance > 0;
  async function save() {
    if (disabled || !canSave || !available || !name.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const saved = await onSave(name.trim());
      setMessage(saved ? "分析已保存到 GUGIS 城市数据。" : "保存未完成，请查看页面提示后重试。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally { setSaving(false); }
  }
  return <section className="analysis-panel" aria-label="空间分析面板">
    <header><span className="analysis-eyebrow">NATIVE GUGIS ANALYSIS</span><h2><PencilRuler size={19} /> 路径与地形剖面</h2><p>沿原生直纹面带与三角带查询高程；旧三角扇档案仍可读取。</p></header>
    <section className="analysis-section">
      <div className="analysis-section-heading"><h3>1. 在场景中画路线</h3><span>{points.length} 个选点</span></div>
      <div className="analysis-actions">
        <button className="primary" disabled={disabled} onClick={() => onDrawing(!drawing)}><MousePointer2 size={14} />{drawing ? "完成绘制" : points.length ? "继续绘制" : "开始绘制"}</button>
        <button disabled={disabled || !points.length} onClick={onUndo} title="撤回最后一个选点"><Undo2 size={14} />撤回一点</button>
        <button disabled={disabled || !points.length} onClick={onClear}>清空</button>
      </div>
      <p className={`analysis-hint${drawing ? " active" : ""}`}>{drawing ? "单击地面添加选点，拖动和滚轮仍可浏览。完成后点击“完成绘制”或按 Esc。" : points.length ? "可继续添加选点，或保存当前分析。" : "点击“开始绘制”，在场景地面选取至少两点。"}</p>
    </section>
    <section className="analysis-section" aria-label="路径测量结果">
      <div className="analysis-section-heading"><h3>2. 测量与原生剖面</h3>{result && <span>{result.samples.length} 个采样点</span>}</div>
      <dl className="analysis-metrics">
        <div><dt>水平长度</dt><dd>{length(result?.horizontalDistance ?? null)}</dd></div>
        <div><dt>选点三维折线</dt><dd>{length(result?.spatialDistance ?? null)}</dd></div>
        <div><dt>采样地表长度</dt><dd>{length(result?.surfaceDistance ?? null)}</dd></div>
        <div><dt>首末选点高差</dt><dd>{result ? `${number(result.elevationChange)} m` : "—"}</dd></div>
        <div><dt>累计上升 / 下降</dt><dd className="analysis-small-value">{length(result?.ascent ?? null)} / {length(result?.descent ?? null)}</dd></div>
        <div><dt>有效地形覆盖</dt><dd>{result ? `${number(result.coverage * 100)}%` : "—"}</dd></div>
      </dl>
      {result && <ProfileChart result={result} onHover={onHover} />}
      {!result && <p className="analysis-empty">选点后自动计算距离；载入地形后可生成高程剖面。</p>}
      {result && result.surfaceDistance === null && <p className="analysis-caution">路线含无数据区域。剖面留空；完整地表长度及累计升降不估算。</p>}
      <details className="analysis-method"><summary>数据来源与计算口径</summary><p><strong>{terrain?.name ?? result?.terrainName ?? "尚未载入地形"}</strong></p>{source.map(([key, value]) => <p key={key}>{value}</p>)}<p>高程：{datums[datum] ?? datum}，单位米。剖面使用源数据高程；场景显示可能减去参考高程。</p><p>水平长度与选点三维折线在本地 ENU 坐标系计算；地表长度和累计升降是沿线采样近似值，不是精确曲面积分。覆盖率按具有有效地形的路线长度计算。</p>{result && <p>基础采样间距约 {length(result.sampleSpacing)}，另保留路线拐点；合计最多 501 个采样点。面片查询直接使用 GUGIS 原生结构。</p>}<p>模型是否真实取决于源数据。示例或合成 DEM 仅用于演示，不代表实测成果。</p></details>
    </section>
    <section className="analysis-section">
      <div className="analysis-section-heading"><h3>3. 保存与复现</h3></div>
      <label className="analysis-name">分析名称<input aria-label="分析名称" value={name} maxLength={80} disabled={disabled} onChange={(event) => { setName(event.target.value); setMessage(""); }} /></label>
      <div className="analysis-actions"><button className="primary" disabled={disabled || !canSave || !available || !name.trim()} onClick={() => void save()}><Save size={14} />{saving ? "正在保存…" : selectedId ? "更新分析" : "保存分析"}</button><button disabled={disabled || !available} onClick={() => result && downloadProfile(name, result, terrain)}><Download size={14} />导出 CSV</button></div>
      <p className="analysis-hint">绘制和清空只影响当前预览。点击保存后，路线、结果与地形指纹写入 GUGIS，随城市导出。</p>
      {!canSave && <p className="analysis-caution">当前状态暂不可保存；如有建筑草稿，请先确认或丢弃草稿。</p>}
      {message && <p className="analysis-hint" role="status">{message}</p>}
      <div className="analysis-section-heading analysis-saved-heading"><h3>已保存分析</h3><span>{records.length} 条</span></div>
      {records.length ? <ul className="analysis-saved-list">{records.map((record) => <li key={record.id} className={record.id === selectedId ? "selected" : ""}>
        <button className="analysis-record" disabled={disabled} onClick={() => onOpen(record)} aria-pressed={record.id === selectedId}><strong>{record.name}</strong><span>{length(record.result.horizontalDistance)} · {new Date(record.createdAt).toLocaleDateString("zh-CN")}</span>{record.terrainFingerprint !== fingerprint && <small>地形已变更 · 打开重新计算</small>}</button>
        <button className="analysis-delete" disabled={disabled || !canSave} onClick={() => onDelete(record.id)} aria-label={`删除分析 ${record.name}`} title="删除这条已保存分析"><Trash2 size={14} /></button>
      </li>)}</ul> : <p className="analysis-empty">暂无已保存分析</p>}
    </section>
  </section>;
}
