import { useMemo, useState } from "react";
import type { CityDocument } from "./cityModel";
import type { Terrain } from "./environment";
import type { AnalysisPoint, PathAnalysis } from "./terrainAnalysis";
import type { PointQuery, SectionObject, SectionResult, SpatialObject } from "./spatialAnalysis";
import { traceCityObject, type SectionTrace } from "./sectionTrace";
import "./spatial.css";

type Props = {
  city: CityDocument;
  points: AnalysisPoint[];
  terrain?: Terrain;
  query: PointQuery | null;
  section: SectionResult | null;
  profile: PathAnalysis | null;
  width: number;
  setWidth: (width: number) => void;
  picking: boolean;
  setPicking: (picking: boolean) => void;
  onFocus: (object: SpatialObject) => void;
  onSave: (name: string) => Promise<boolean>;
  canSave: boolean;
  busy: boolean;
  selectedName: string | null;
  hasSavedRecord: boolean;
  onEnvironment: () => void;
};
const metres = (v: number | null, digits = 1) => v === null || !Number.isFinite(v)
  ? "—" : `${v.toLocaleString("zh-CN", { maximumFractionDigits: digits })} m`;
const kindNames: Record<string, string> = {
  lamp: "路灯", "arched-door": "拱门", "curved-balcony": "弧形阳台", "round-plaza": "圆形广场",
  "ruled-strip": "直纹面带", "triangle-strip": "三角带", "triangle-fan": "三角扇",
};
function ObjectButton({ object, focus, extra }: { object: SpatialObject; focus: Props["onFocus"]; extra?: string }) {
  return <button className="spatial-object" onClick={() => focus(object)} title="在三维场景中定位对象">
    <span><b>{object.name}</b><small>{object.layer === "underground" ? "地下设计地物" : object.layer === "building" ? "建筑模型" : "地上函数地物"} · {kindNames[object.kind] ?? object.kind}</small></span>
    <span className="spatial-object-values">{extra ?? metres(object.distance)}{object.layer === "underground" && <small>覆土 {metres(object.burialDepth)}</small>}</span>
  </button>;
}
function ObjectSemantics({ city, object, component }: { city: CityDocument; object: SpatialObject; component?: string }) {
  if (object.layer === "building") {
    const placement = city.instances.find(item => item.id === object.id);
    const document = placement && city.assets[placement.asset];
    if (!document) return null;
    const part = document.nodes.find(node => node.id === component);
    const categories = [...new Set(document.nodes.map(node => node.category).filter(Boolean))];
    const hierarchy: string[] = [];
    const visited = new Set<string>();
    let ancestor = part;
    while (ancestor && !visited.has(ancestor.id)) {
      visited.add(ancestor.id);
      hierarchy.unshift(`${ancestor.name || ancestor.id} · ${ancestor.category}`);
      ancestor = document.nodes.find(node => node.id === ancestor?.parent);
    }
    return <div className="spatial-semantics" aria-label="对象结构详情"><h4>{object.name} · 建筑实例</h4>
      <code>{object.id} / {placement.asset}</code>
      <p>{document.parameters.floors} 层 · {object.components} 个实体构件 · {categories.slice(0, 8).join(" / ")}</p>
      {part ? <><p>命中构件：<strong>{part.name ?? part.id}</strong> · {part.category} · {part.template ? document.templates[part.template]?.kind : "组合节点"} · ID {part.id}</p>
        <p>层级路径：{hierarchy.join(" → ")}{part.floor !== undefined ? ` · 第 ${part.floor} 层` : ""}{part.unit !== undefined ? ` · 单元 ${part.unit}` : ""}</p></>
        : component?.startsWith("overview_") ? <p>当前选中概览模型 {component}。放大并启用精细结构后可追溯到具体楼层与构件。</p>
          : <p>从场景点击建筑构件，可追溯到节点 ID、类别和几何函数。</p>}
      <p>模型垂直包络：{metres(object.bottom, 2)} 至 {metres(object.top, 2)}，按当前地形基准实时计算。</p>
    </div>;
  }
  const placement = city.environment?.features.find(item => item.id === object.id);
  const asset = placement && city.environment?.feature_assets[placement.asset];
  if (!placement || !asset) return null;
  const part = asset.components.find(item => item.id === component);
  return <div className="spatial-semantics" aria-label="对象结构详情"><h4>{object.name} · 函数地物实例</h4>
    <code>{object.id} / {placement.asset}</code>
    <p>{object.layer === "underground" ? "地下设计对象" : "地上对象"} · {asset.components.length} 个函数构件 · 比例 {placement.scale}</p>
    {part ? <><p>命中构件：<strong>{part.category}</strong> · 函数 {part.function} · ID {part.id}</p>
      <dl>{Object.entries(part.parameters).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></>
      : <p>构成函数：{asset.components.map(item => `${item.category}=${item.function}`).join(" / ")}</p>}
    <p>模型垂直包络：{metres(object.bottom, 2)} 至 {metres(object.top, 2)}。地下覆土深度：{metres(object.burialDepth, 2)}。</p>
  </div>;
}
function SectionChart({ profile, section, trace, focus }: { profile: PathAnalysis; section: SectionResult;
  trace: SectionTrace | null; focus: Props["onFocus"] }) {
  const chart = useMemo(() => {
    const heights = profile.samples.flatMap(s => s.height === null ? [] : [s.height]);
    const relevant = section.objects.filter(o => o.bottom !== null && o.top !== null);
    for (const item of relevant) heights.push(item.bottom!, item.top!);
    for (const segment of trace?.segments ?? []) heights.push(segment.start[1], segment.end[1]);
    if (!heights.length) return null;
    const low = Math.min(...heights), high = Math.max(...heights);
    const pad = Math.max(2, (high - low) * .08), bottom = low - pad, top = high + pad;
    const x = (distance: number) => 40 + 280 * distance / Math.max(0.1, section.length);
    const y = (height: number) => 150 - 126 * (height - bottom) / (top - bottom);
    let d = "", continuous = false;
    for (const sample of profile.samples) {
      if (sample.height === null) { continuous = false; continue; }
      if (sample.gapBefore) continuous = false;
      d += `${continuous ? "L" : "M"}${x(sample.distance).toFixed(2)},${y(sample.height).toFixed(2)} `;
      continuous = true;
    }
    const cutPath = (trace?.segments ?? []).map(segment =>
      `M${x(segment.start[0]).toFixed(2)},${y(segment.start[1]).toFixed(2)} L${x(segment.end[0]).toFixed(2)},${y(segment.end[1]).toFixed(2)}`).join(" ");
    return { x, y, d, cutPath, bottom, top, relevant };
  }, [profile, section, trace]);
  if (!chart) return <p className="spatial-muted">当前路线没有有效地形高程，不能绘制垂直剖面。</p>;
  return <div className="spatial-section-chart"><svg viewBox="0 0 360 174" role="img" aria-label="原生地形与建筑、函数地物的纵向剖面带；矩形为模型包络估计">
    {[0, .5, 1].map(f => { const z = chart.bottom + (chart.top - chart.bottom) * f; return <g key={f} className="spatial-grid"><line x1="40" x2="320" y1={chart.y(z)} y2={chart.y(z)} /><text x="36" y={chart.y(z) + 3} textAnchor="end">{z.toFixed(0)}</text></g>; })}
    {chart.relevant.slice(0, 160).map(item => {
      const x0 = Math.max(40, chart.x(item.station - item.radius));
      const x1 = Math.min(320, chart.x(item.station + item.radius));
      return <g key={`${item.layer}:${item.id}`} role="button" tabIndex={0}
        className={`spatial-section-object ${item.layer}`}
        onClick={() => focus(item)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(item); } }}>
        <title>{item.name} · {kindNames[item.kind] ?? item.kind} · 里程 {metres(item.station)} · 模型包络 {metres(item.bottom)} 至 {metres(item.top)}</title>
        <rect x={x0} y={chart.y(item.top!)} width={Math.max(3, x1 - x0)} height={Math.max(2, chart.y(item.bottom!) - chart.y(item.top!))} />
      </g>;
    })}
    <path className="spatial-ground" d={chart.d} />
    {chart.cutPath && <path className="spatial-cutline" d={chart.cutPath} />}
    <text className="spatial-axis" x="40" y="168">0</text><text className="spatial-axis" x="320" y="168" textAnchor="end">{metres(section.length, 0)}</text>
  </svg><p className="spatial-chart-legend"><i className="building" />建筑 <i className="surface" />地上地物 <i className="underground" />地下设计地物 <i className="ground" />源地形 {trace?.segments.length ? <><i className="cutline" />所选模型交线</> : null}</p></div>;
}
export default function SpatialPanel({ city, points, terrain, query, section, profile, width, setWidth, picking, setPicking,
  onFocus, onSave, canSave, busy, selectedName, hasSavedRecord, onEnvironment }: Props) {
  const [name, setName] = useState("布里斯托 · 城市联合剖面");
  const [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const [chosen, setChosen] = useState<SpatialObject | null>(null);
  const focus = (object: SpatialObject) => { setChosen(object); onFocus(object); };
  const inspected = query?.inspected
    ? [...query.buildings, ...query.features].find(o => o.id === query.inspected?.id && o.layer === query.inspected?.layer) ?? null : null;
  const chosenFromQuery = [...(query?.buildings ?? []), ...(query?.features ?? [])]
    .find(o => o.id === chosen?.id && o.layer === chosen?.layer) ?? null;
  const effectiveName = hasSavedRecord ? selectedName ?? name : name;
  const canPersist = canSave && !!profile && profile.horizontalDistance > 0 && !busy && !saving;
  const underground = section?.underground ?? 0;
  const sectionChoice = section?.objects.find(o => o.id === chosen?.id && o.layer === chosen?.layer) ?? null;
  const trace = useMemo(() => sectionChoice && points.length >= 2
    ? traceCityObject(city, points, sectionChoice.id) : null,
    [city, points, sectionChoice?.id]);
  return <section className="spatial-panel" aria-label="城市联合分析面板">
    <header><small>UNIFIED CITY ANALYSIS</small><h2>地上 · 地形 · 地下</h2><p>同一剖面带查询原生地形与可追溯的建筑、函数地物实例。</p></header>
    <div className="spatial-card">
      <h3>点位联合查询</h3>
      <button className={picking ? "primary" : ""} onClick={() => setPicking(!picking)}>{picking ? "完成点位查询" : "在场景中选点查询"}</button>
      <p className="spatial-muted">{picking ? "单击场景查看地形和基点 100 米范围内的对象。点击对象模型时保留其标识。" : "点位结果随当前城市自动重算，不写入项目。"}</p>
      {query && <>
        <dl className="spatial-facts">
          <div><dt>地形源高程</dt><dd>{metres(query.terrain?.height ?? null, 2)}</dd></div>
          <div><dt>原生面片</dt><dd>{query.terrain ? `${kindNames[query.terrain.kind]} · ${query.terrain.patch}` : "无地形数据"}</dd></div>
          <div><dt>地表坡度</dt><dd>{query.terrain ? `${query.terrain.slope.toFixed(1)}°` : "—"}</dd></div>
          <div><dt>最近道路</dt><dd>{query.nearestRoad ? `${query.nearestRoad.name} · ${metres(query.nearestRoad.distance)}` : "查询范围内无道路"}</dd></div>
        </dl>
        <p className="spatial-coordinates">{query.position.longitude.toFixed(6)}° E / {query.position.latitude.toFixed(6)}° N · {query.terrain?.height === undefined ? "源高程缺测" : (terrain?.vertical_datum ?? "unknown")}</p>
        <h4>邻近对象 · {query.radius} m</h4>
        {[...query.buildings, ...query.features].sort((a, b) => a.distance - b.distance).slice(0, 12).map(o =>
          <ObjectButton key={`${o.layer}:${o.id}`} object={o} focus={focus} />)}
        {!query.buildings.length && !query.features.length && <p className="spatial-muted">该点附近没有已建模对象。</p>}
        {(inspected ?? chosenFromQuery) && <ObjectSemantics city={city} object={(inspected ?? chosenFromQuery)!} component={inspected?.id === query.inspected?.id ? query.inspected?.component : undefined} />}
      </>}
    </div>
    <div className="spatial-card">
      <h3>路线垂直剖面带</h3>
      <p className="spatial-muted">在“路线剖面”绘制至少两点；此处按路线、带宽与模型外包范围匹配城市对象。</p>
      <label className="spatial-width">剖面带宽 <strong>{width} m</strong>
        <input aria-label="剖面带宽" type="range" min="2" max="200" step="2" value={width} onChange={e => setWidth(Number(e.target.value))} />
      </label>
      {section && profile ? <>
        <p className="spatial-totals">{section.buildings} 栋建筑 · {section.surface} 个地上地物 · {underground} 个地下地物</p>
        {underground > 0 && <details className="spatial-clearances"><summary>地下模型间距初筛 · {section.clearances?.length ?? 0} 组包络接近</summary>
          {(section.clearances ?? []).slice(0, 20).map(item => <p key={`${item.undergroundId}/${item.otherLayer}/${item.otherId}`}>
            <strong>{section.objects.find(o => o.id === item.undergroundId && o.layer === "underground")?.name ?? item.undergroundId}</strong>
            {" ↔ "}{item.otherName}：{item.verticalGap > 0 ? `竖向包络间距至少 ${metres(item.verticalGap, 2)}`
              : item.verticalOverlap > 0 ? `垂直包络重叠 ${metres(item.verticalOverlap, 2)}，需复核` : "包络接触，需复核"}
            {` · 水平中心距 ${metres(item.horizontalDistance, 1)}`}
          </p>)}
          {!(section.clearances ?? []).length && <p>当前剖面带内未发现水平包络相交的地下与邻近模型。</p>}
          {(section.clearances?.length ?? 0) > 20 && <p>仅显示前 20 组；请缩小剖面带宽度查看局部。</p>}
        </details>}
        <SectionChart profile={profile} section={section} trace={trace} focus={focus} />
        {sectionChoice && trace && <p className="spatial-trace-status" role="status">
          {trace.unavailable === "no-terrain" ? "未加载源地形，无法建立同一高程基准的模型交线。"
            : trace.unavailable === "no-source-height" ? "对象位置缺少源高程，无法绘制可靠的模型交线。"
            : trace.unavailable === "object-missing" ? "所选模型已不存在，请重新选择。"
            : trace.segments.length ? `所选模型与剖切平面相交：${trace.segments.length} 段模型交线${trace.truncated ? "（已达到显示上限）" : ""}。`
            : "对象进入剖面带，但中心剖切平面未与模型相交。"}
        </p>}
        {section.objects.slice(0, 60).map(o => <ObjectButton key={`${o.layer}:${o.id}`} object={o} focus={focus} extra={`里程 ${metres(o.station)} · 偏离 ${metres(o.offset)}`} />)}
        {sectionChoice && <ObjectSemantics city={city} object={sectionChoice} />}
        {section.objects.length > 60 && <p className="spatial-muted">列表只显示前 60 个对象，图表显示前 160 个；总数仍包含全部相交对象。</p>}
        {!section.objects.length && <p className="spatial-muted">当前带宽内没有已建模对象。可调整宽度或路线。</p>}
      </> : <p className="spatial-muted">尚无可用路线剖面。</p>}
      {!hasSavedRecord && <label className="spatial-name">剖面名称<input aria-label="联合剖面名称" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>}
      <button className="primary" disabled={!canPersist || !effectiveName.trim()} onClick={async () => {
        setSaving(true); setMessage("");
        try { const ok = await onSave(effectiveName.trim()); setMessage(ok ? "路线及剖面带宽已保存到 GUGIS 项目。" : "保存未完成，请检查页面提示。"); }
        catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
        finally { setSaving(false); }
      }}>{hasSavedRecord ? "更新剖面带" : "保存路线与剖面带"}</button>
      {message && <p role="status" className="spatial-muted">{message}</p>}
      <p className="spatial-muted">项目保存路线与带宽。对象数量和高程每次按当前城市重算，因此建筑、地物或地形修改后不会沿用旧统计。</p>
    </div>
    <div className="spatial-card spatial-source">
      <h3>数值边界</h3><p>高程取原生地形，基准：{terrain?.vertical_datum ?? "未声明"}。矩形是模型局部几何的垂直包络与平面半径，用于快速筛选和概览；覆土深度按地物模型最高点到地表计算，只有模型整体位于地表下方时为正，缺测时不估算。</p>
      <p>选中对象后的红色线段是中心剖切平面与存储模型三角面的交线；函数曲面按当前显示网格离散，不能用作施工净距。三维视图未执行实体裁剪。</p>
      <p>地下间距初筛以对象水平包围圆与垂直包络计算。正间距是保守的竖向界限；包络重叠只表示需要复核，不能直接判定实体碰撞。</p>
      <p>地下地物为项目中的设计对象，来源 DEM 需另行核验。当前地形：{terrain?.name ?? "未载入"}。</p>
      {!underground && <button onClick={onEnvironment}>前往地形 / 地物添加地下设计对象</button>}
    </div>
  </section>;
}
