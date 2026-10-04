import { useId, useState } from "react";
import overview from "../../../shared/terrain-comparison-overview.json";
import { Download } from "lucide-react";
import { overviewExport, type OverviewMetric } from "./overviewExport";
import type { ComparisonResolutionProps } from "./comparisonModel";
import "./comparisonOverview.css";

type Variant = (typeof overview.variants)[number];
type MetricKey = OverviewMetric;
type Metric = {
  key: MetricKey;
  label: string;
  unit: string;
  description: string;
  value: (variant: Variant) => number;
  nativeValue: (variant: Variant) => number;
};

const metrics: Metric[] = [
  {
    key: "storage", label: "文件体积", unit: "MB",
    description: "未压缩实际文件大小；MultiPatch 为配套文件合计，MB = 1,000,000 bytes。",
    value: variant => variant.multipatchFilesBytes / 1e6,
    nativeValue: variant => variant.gugisTerrainBytes / 1e6,
  },
  {
    key: "height", label: "点高程 RMS", unit: "cm",
    description: "同一固定查询点的高程差 RMS；这是相对原生表面的差异，不是真实地形的绝对精度。",
    value: variant => variant.queries.sampledRmsHeightErrorMetres * 100,
    nativeValue: () => 0,
  },
  {
    key: "slope", label: "坡度 RMS", unit: "°",
    description: "统一原生局部 ENU 下的坡度差 RMS；剔除原生面片边界与网格三角形边界。",
    value: variant => variant.queries.derivatives.slope.rmsDegrees,
    nativeValue: () => 0,
  },
  {
    key: "aspect", label: "坡向 RMS", unit: "°",
    description: "下坡方向自局部北向顺时针计角，使用最短角差；剔除边界和近乎平坦的方向。",
    value: variant => variant.queries.derivatives.aspect.rmsDegrees,
    nativeValue: () => 0,
  },
];

const variants = [...overview.variants].sort((a, b) => a.ruledSubdivisions - b.ruledSubdivisions);
const format = (value: number) => value.toFixed(3);
const resolutionName = (variant: Variant) => `${variant.ruledSubdivisions}×${variant.ruledSubdivisions}`;

export default function ComparisonOverview({ resolution: linkedResolution, onResolutionChange, targetCentimetres = 1 }: ComparisonResolutionProps = {}) {
  const centimetreTarget = Number.isFinite(targetCentimetres) && targetCentimetres > 0 ? targetCentimetres : 1;
  const targetVariant = [...variants].filter(v => v.maxRuledHeightErrorMetres * 100 <= centimetreTarget)
    .sort((a, b) => a.multipatchFilesBytes - b.multipatchFilesBytes)[0];
  const instance = useId();
  const titleId = `${instance}-overview-title`;
  const chartTitleId = `${instance}-chart-title`;
  const chartDescriptionId = `${instance}-chart-description`;
  const [metricKey, setMetricKey] = useState<MetricKey>("storage");
  const defaultResolution = targetVariant?.ruledSubdivisions ?? variants[0].ruledSubdivisions;
  const [localResolution, setLocalResolution] = useState(defaultResolution);
  const candidate = linkedResolution ?? localResolution;
  const resolution = variants.some(v => v.ruledSubdivisions === candidate) ? candidate : defaultResolution;
  const setResolution = (next: number) => { setLocalResolution(next); onResolutionChange?.(next); setDownloadMessage(""); };
  const [downloadMessage, setDownloadMessage] = useState("");
  const metric = metrics.find(item => item.key === metricKey) ?? metrics[0];
  const selected = variants.find(item => item.ruledSubdivisions === resolution) ?? variants[0];
  const maximum = Math.max(...variants.flatMap(variant => [metric.value(variant), metric.nativeValue(variant)])) * 1.2 || 1;
  const chart = { left: 66, right: 672, top: 42, bottom: 254, width: 606, height: 212 };
  const y = (value: number) => chart.bottom - value / maximum * chart.height;
  const nativeY = y(metric.nativeValue(selected));
  const meetsTarget = selected.maxRuledHeightErrorMetres * 100 <= centimetreTarget;
  const sampleCount = metricKey === "aspect" ? selected.queries.derivatives.aspectMatchedCount
    : metricKey === "slope" ? selected.queries.derivatives.slopeMatchedCount : selected.queries.matchedCount;
  function download(format: "csv" | "json") {
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      const file = overviewExport(overview, { metric: metricKey, resolution, targetCentimetres: centimetreTarget }, format);
      url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
      anchor = document.createElement("a"); anchor.href = url; anchor.download = file.filename;
      document.body.appendChild(anchor); anchor.click();
      setDownloadMessage(`已发起 ${format.toUpperCase()} 下载，包含四档结果与来源标识。`);
    } catch { setDownloadMessage("无法生成下载文件，请重试或检查浏览器下载设置。"); }
    finally { anchor?.remove(); if (url) { const releasedUrl = url; setTimeout(() => URL.revokeObjectURL(releasedUrl), 1000); } }
  }

  return <section className="comparison-overview" id="comparison-overview" aria-labelledby={titleId}>
    <div className="co-heading">
      <div><p className="co-eyebrow"><span/> MEASURED COMPARISON / 对比总览</p><h2 id={titleId}>原生表面保留，<br/><span>精度与体积一起看。</span></h2></div>
      <p>同一份地形，四档真实 MultiPatch 导出。切换指标，查看文件体积与表面差异怎样随离散精度变化。</p>
    </div>

    <div className="co-evidence-banner"><span className="co-evidence-dot"/><strong>本项目已测结果</strong><span>GUGIS 原生 vs 本项目 ArcGIS 兼容 MultiPatch 参考读回</span><span className="co-evidence-status">非 ArcGIS 软件跑分</span></div>

    <div className="co-highlights">
      <article className="co-highlight co-highlight-native"><span className="co-card-label">GUGIS 原生文件 / 四档一致</span><strong>{format(selected.gugisTerrainBytes / 1e6)}<small> MB</small></strong><p>保留直纹曲面表达与原生求值</p><div className="co-native-line"><span/><span/><span/><span/></div></article>
      <article className="co-highlight"><span className="co-card-label">{centimetreTarget} cm 目标 / 已测最小满足档位</span><strong>{targetVariant ? resolutionName(targetVariant) : "未达到"}</strong><p>按参数域最大高程差界限选择</p><span className="co-highlight-note">{targetVariant ? `MultiPatch ${format(targetVariant.multipatchFilesBytes / 1e6)} MB` : "四档均未满足目标"}</span></article>
      <article className="co-highlight"><span className="co-card-label">同一 {centimetreTarget} cm 目标 / 文件体积减少</span><strong>{targetVariant ? targetVariant.storageSavingPercent.toFixed(1) : "—"}<small>{targetVariant ? "%" : ""}</small></strong><p>原生文件相对该档 MultiPatch</p><span className="co-highlight-note">{targetVariant ? `MultiPatch 体积约为原生的 ${(targetVariant.multipatchFilesBytes / targetVariant.gugisTerrainBytes).toFixed(1)} 倍` : "不推算未测档位"}</span></article>
    </div>

    <div className="co-dashboard">
      <div className="co-dashboard-head"><div><span className="co-card-label">四档实际数据 / 线性刻度</span><h3>细分越密，表面差异越小。</h3></div><span className="co-query-count">{overview.variants[0].queries.queryCount.toLocaleString()} 个固定查询点</span></div>
      <div className="co-download-toolbar"><p>保存四档实测结果，保留原始精度与来源。</p><div role="group" aria-label="下载四档对比结果">
        <button type="button" onClick={() => download("csv")}><Download size={14} aria-hidden="true" />下载 CSV</button>
        <button type="button" onClick={() => download("json")}>下载 JSON</button>
      </div></div>
      {downloadMessage && <p className="co-download-message" role="status">{downloadMessage}</p>}
      <div className="co-metric-tabs" role="group" aria-label="对比总览指标">{metrics.map(item => <button type="button" key={item.key} aria-pressed={metricKey === item.key} onClick={() => setMetricKey(item.key)}>{item.label}<span>{item.unit}</span></button>)}</div>
      <div className="co-chart-layout">
        <div className="co-chart-panel">
          <div className="co-chart-legend"><span><i className="co-native-key"/>{metricKey === "storage" ? "GUGIS 原生文件" : "GUGIS 原生 / 差异基准 0"}</span><span><i className="co-mesh-key"/>MultiPatch {metricKey === "storage" ? "文件" : "参考读回差异"}</span></div>
          <svg className="co-chart" viewBox="0 0 710 314" role="img" aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}>
            <title id={chartTitleId}>{metric.label}：四档 MultiPatch 与 GUGIS 原生对比</title>
            <desc id={chartDescriptionId}>线性纵轴，单位 {metric.unit}。{variants.map(variant => `${resolutionName(variant)} 为 ${format(metric.value(variant))} ${metric.unit}`).join("；")}。GUGIS {metricKey === "storage" ? `文件为 ${format(metric.nativeValue(selected))} MB` : "是差异基准 0，并不表示原生坡度或坡向为零"}。可通过图下档位按钮切换详情。</desc>
            <text className="co-chart-axis-title" x={chart.left} y="20">{metric.label} / {metric.unit}</text>
            {[0, .25, .5, .75, 1].map(tick => <g key={tick}><line className="co-chart-grid" x1={chart.left} x2={chart.right} y1={y(maximum * tick)} y2={y(maximum * tick)}/><text className="co-chart-tick" x={chart.left - 12} y={y(maximum * tick) + 4} textAnchor="end">{tick === 0 ? "0" : (maximum * tick).toFixed(metricKey === "storage" ? 1 : 2)}</text></g>)}
            {variants.map((variant, index) => {
              const x = chart.left + chart.width / variants.length * (index + .5);
              const value = metric.value(variant);
              return <g className={`co-chart-column${resolution === variant.ruledSubdivisions ? " is-selected" : ""}`} key={variant.ruledSubdivisions} onClick={() => setResolution(variant.ruledSubdivisions)}>
                <rect className="co-chart-hit" x={x - 62} y={chart.top - 12} width="124" height={chart.height + 56} rx="8"/>
                <rect className="co-chart-bar" x={x - 27} y={y(value)} width="54" height={chart.bottom - y(value)} rx="4"/>
                <text className="co-chart-value" x={x} y={y(value) - 12} textAnchor="middle">{format(value)}</text>
                <text className="co-chart-resolution" x={x} y="284" textAnchor="middle">{resolutionName(variant)}</text>
              </g>;
            })}
            <line className="co-chart-native" x1={chart.left} x2={chart.right} y1={nativeY} y2={nativeY}/>
            <circle className="co-chart-native-dot" cx={chart.left} cy={nativeY} r="4"/>
            <text className="co-chart-baseline" x={chart.right} y="308" textAnchor="end">GUGIS {format(metric.nativeValue(selected))} {metric.unit}{metricKey === "storage" ? " / 保持一致" : " / 相对差异基准"}</text>
          </svg>
          <div className="co-resolution-controls" role="group" aria-label="查看离散档位">{variants.map(variant => <button type="button" key={variant.ruledSubdivisions} aria-pressed={resolution === variant.ruledSubdivisions} onClick={() => setResolution(variant.ruledSubdivisions)}><strong>{resolutionName(variant)}</strong><span>{variant.maxRuledHeightErrorMetres * 100 <= centimetreTarget ? "满足" : "未满足"} {centimetreTarget} cm 界限</span></button>)}</div>
          <p className="co-chart-explanation">{metric.description}</p>
        </div>

        <aside className="co-readout" aria-label="当前档位的测量结果" aria-live="polite" aria-atomic="true">
          <div className="co-readout-head"><span>当前档位</span><strong>{resolutionName(selected)}</strong></div>
          <div className="co-selected-value"><span>{metric.label}{metricKey === "storage" ? " / MultiPatch" : " / 相对原生"}</span><strong>{format(metric.value(selected))}<small> {metric.unit}</small></strong><p>{metricKey === "storage" ? `原生 ${format(metric.nativeValue(selected))} MB · 节省 ${selected.storageSavingPercent.toFixed(1)}%` : `${sampleCount.toLocaleString()} 个有效${metricKey === "aspect" ? "方向" : "查询点"}参与 RMS`}</p></div>
          <dl className="co-detail-list"><div><dt>MultiPatch 文件</dt><dd>{format(selected.multipatchFilesBytes / 1e6)} MB</dd></div><div><dt>点高程 RMS 差</dt><dd>{format(selected.queries.sampledRmsHeightErrorMetres * 100)} cm</dd></div><div><dt>坡度 RMS 差</dt><dd>{format(selected.queries.derivatives.slope.rmsDegrees)}°</dd></div><div><dt>坡向 RMS 差</dt><dd>{format(selected.queries.derivatives.aspect.rmsDegrees)}°</dd></div></dl>
          <div className={`co-target-status${meetsTarget ? " is-met" : ""}`}><span>{meetsTarget ? "✓" : "○"}</span><div><strong>{meetsTarget ? "满足" : "未满足"} {centimetreTarget} cm 参数域界限</strong><p>最大高程差界限 {format(selected.maxRuledHeightErrorMetres * 100)} cm</p></div></div>
          <a className="co-lab-link" href="#terrain-lab">查看剖面、样本与复现实验 <span aria-hidden="true">↗</span></a>
        </aside>
      </div>
    </div>

    <details className="co-results-table"><summary>查看四档数值表 · 文件、高程、坡度与坡向</summary>
      <div className="co-table-scroll" role="region" aria-label="四档对比结果表，可横向滚动" tabIndex={0}>
        <table><caption>同一地形快照的四档 MultiPatch 参考读回结果</caption><thead><tr>
          <th scope="col">离散档位</th><th scope="col">GUGIS 文件 MB</th><th scope="col">MultiPatch MB</th><th scope="col">文件减少 %</th>
          <th scope="col">高程 RMS cm</th><th scope="col">最大高程差界限 cm</th><th scope="col">坡度 RMS °</th><th scope="col">坡向 RMS °</th><th scope="col">{centimetreTarget} cm 界限</th>
        </tr></thead><tbody>{variants.map(variant => <tr key={variant.ruledSubdivisions} aria-current={resolution === variant.ruledSubdivisions ? "true" : undefined}>
          <th scope="row">{resolutionName(variant)}{resolution === variant.ruledSubdivisions ? " · 当前" : ""}</th>
          <td>{format(variant.gugisTerrainBytes / 1e6)}</td><td>{format(variant.multipatchFilesBytes / 1e6)}</td><td>{variant.storageSavingPercent.toFixed(1)}</td>
          <td>{format(variant.queries.sampledRmsHeightErrorMetres * 100)}</td><td>{format(variant.maxRuledHeightErrorMetres * 100)}</td>
          <td>{format(variant.queries.derivatives.slope.rmsDegrees)}</td><td>{format(variant.queries.derivatives.aspect.rmsDegrees)}</td>
          <td>{variant.maxRuledHeightErrorMetres * 100 <= centimetreTarget ? "满足" : "未满足"}</td>
        </tr>)}</tbody></table>
      </div><p>表内数值为显示舍入值；下载文件保留原始数值。高程与方向的差异均相对 GUGIS 原生表面。</p>
    </details>

    <div className="co-method-note"><span className="co-method-symbol" aria-hidden="true">i</span><div><strong>目标看最大差异，RMS 看采样分布。</strong><p>{targetVariant ? `${centimetreTarget} cm 目标使用参数域最大高程差界限，已测档位中 ${resolutionName(targetVariant)} 首次满足。` : `${centimetreTarget} cm 目标使用参数域最大高程差界限，已测档位尚未满足。`}4×4 的界限为 {format((variants.find(variant => variant.ruledSubdivisions === 4)?.maxRuledHeightErrorMetres ?? 0) * 100)} cm，即使点高程 RMS 更小，也不能据此判定达到该目标。</p></div></div>
    <p className="co-scope-note">{overview.demonstration ? "本实验使用合成地形，验证格式与查询链路。" : "本实验使用当前打包地形。"}数值来自真实导出文件及本项目参考求值读回；未运行 ArcGIS Slope / Aspect 工具，也不代表 ArcGIS 的速度、内存或全部地形表达能力。坡向统计剔除任一坡度 &lt; {overview.derivativeMethod.aspectMinimumSlopeDegrees}° 的方向。报告版本 <code>{overview.reportSha256.slice(0, 12)}</code>。</p>
  </section>;
}
