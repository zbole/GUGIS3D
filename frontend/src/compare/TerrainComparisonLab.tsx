import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpRight, Check, Download, FileCheck2, FlaskConical, Upload } from "lucide-react";
import { comparisonSelection, parseArcGISRun, precisionChoice, profilePath, type ArcGISRun, type ComparisonSuite, type ComparisonResolutionProps } from "./comparisonModel";

const base = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "");
const cm = (metres: number | null) => metres === null ? "—" : (metres * 100).toFixed(3);
const mb = (bytes: number) => (bytes / 1e6).toFixed(3);
const degrees = (value: number | null) => value === null ? "—" : `${value.toFixed(3)}°`;
const range = (values: number[]) => `${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)} ms`;

type LabProps = { suite: ComparisonSuite } & ComparisonResolutionProps;
export default function TerrainComparisonLab(props: LabProps) {
  return <TerrainComparisonSession key={`${props.suite.cityRevision}:${props.suite.bundleId}`} {...props}/>;
}

function TerrainComparisonSession({ suite, resolution: linkedResolution, onResolutionChange, targetCentimetres, onTargetChange }: LabProps) {
  const packageUrl = `${base}/city/terrain/benchmark-suite.zip?snapshot=${suite.cityRevision}&bundle=${suite.bundleId}`;
  const cacheKey = `gugis:arcgis-run:${suite.bundleId}`;
  const defaultResolution = precisionChoice(suite, 1)?.ruledSubdivisions ?? suite.variants[0].ruledSubdivisions;
  const [localResolution, setLocalResolution] = useState(defaultResolution);
  const candidate = linkedResolution ?? localResolution;
  const resolution = suite.variants.some(v => v.ruledSubdivisions === candidate) ? candidate : defaultResolution;
  const setResolution = (next: number) => { setLocalResolution(next); onResolutionChange?.(next); };
  const [localTolerance, setLocalTolerance] = useState(1);
  const tolerance = targetCentimetres !== undefined && [.1, .5, 1, 5, 20].includes(targetCentimetres) ? targetCentimetres : localTolerance;
  const setTolerance = (next: number) => { setLocalTolerance(next); onTargetChange?.(next); };
  const [profileId, setProfileId] = useState(suite.variants[0].profiles.some(p => p.id === "cell") ? "cell" : "city");
  const [station, setStation] = useState(20);
  const [metric, setMetric] = useState<"height" | "slope">("height");
  const [arcgis, setArcgis] = useState<ArcGISRun | null>(null);
  const [importError, setImportError] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [importing, setImporting] = useState(false);
  const importAttempt = useRef(0);
  const active = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    importAttempt.current++;
    setArcgis(null); setImportError(""); setImportMessage(""); setImporting(false);
    try {
      const saved = localStorage.getItem(cacheKey);
      if (saved) setArcgis(parseArcGISRun(saved, suite));
    } catch { setImportError("本浏览器保留的报告无法校验；可重新导入脚本输出。"); }
    return () => { active.current = false; importAttempt.current++; };
  }, [cacheKey, suite]);
  const variant = suite.variants.find(v => v.ruledSubdivisions === resolution) ?? suite.variants[0];
  const profile = variant.profiles.find(p => p.id === profileId) ?? variant.profiles[0];
  const selectedStation = Math.min(station, profile.samples.length - 1);
  const sample = profile.samples[selectedStation];
  const choice = precisionChoice(suite, tolerance);
  const nativeKey = metric, meshKey = metric === "height" ? "multipatchHeight" : "multipatchSlope";
  const errorKey = metric === "height" ? "errorMetres" : "slopeErrorDegrees";
  const heights = suite.variants.flatMap(v => v.profiles.find(p => p.id === profile.id)?.samples ?? [])
    .flatMap(p => [p[nativeKey], p[meshKey]]).filter((v): v is number => v !== null);
  const low = heights.length ? Math.min(...heights) : 0, high = heights.length ? Math.max(...heights) : 1;
  const padding = Math.max((high - low) * .12, .025);
  const allErrors = suite.variants.flatMap(v => v.profiles.find(p => p.id === profile.id)?.samples ?? [])
    .map(p => p[errorKey]).filter((v): v is number => v !== null);
  const errorRange = Math.max(Math.max(0, ...allErrors.map(Math.abs)) * 1.12, .001);
  const errorScale = metric === "height" ? 100 : 1;
  const nativePath = profilePath(profile.samples, nativeKey, 700, 155, low - padding, high + padding);
  const meshPath = profilePath(profile.samples, meshKey, 700, 155, low - padding, high + padding);
  const errorPath = profilePath(profile.samples, errorKey, 700, 76, -errorRange, errorRange);
  const totalDistance = profile.samples[profile.samples.length - 1]?.distance ?? 0;
  const markerX = totalDistance && sample ? sample.distance / totalDistance * 700 : 0;
  const outsideCount = variant.queries.queryCount - variant.queries.nativeValidCount;
  const derivatives = variant.queries.derivatives;
  function exportSelection() {
    const result = comparisonSelection(suite, resolution, tolerance, profile.id, selectedStation, arcgis);
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = `GUGIS-comparison-n${resolution}-${suite.bundleId.slice(0, 12)}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importRun(input: HTMLInputElement) {
    const chosen = input.files?.[0];
    if (!chosen) return;
    // Release the picker immediately so the same file can be selected again.
    // A pending older read must never clear a newer selection or replace its result.
    input.value = "";
    const attempt = ++importAttempt.current;
    const isCurrent = () => active.current && attempt === importAttempt.current;
    setImportError(""); setImportMessage(""); setImporting(true);
    try {
      if (chosen.size > 1024 * 1024) throw new Error("实测报告不得超过 1 MiB。");
      const raw = await chosen.text();
      if (!isCurrent()) return;
      const run = parseArcGISRun(raw, suite);
      setArcgis(run);
      try { localStorage.setItem(cacheKey, JSON.stringify(run)); setImportMessage("报告已校验并保留在本浏览器；属于用户导入，未独立复核软件运行。"); }
      catch { setImportError("报告已展示，但浏览器未允许持久保留。"); }
    } catch (error) {
      if (isCurrent()) setImportError(`${error instanceof Error ? error.message : "报告导入失败。"} 本次未替换已有报告。`);
    } finally { if (isCurrent()) setImporting(false); }
  }
  function clearRun() {
    importAttempt.current++; setImporting(false); setArcgis(null); setImportError("");
    try { localStorage.removeItem(cacheKey); setImportMessage("已清除本浏览器展示与保留的报告。"); }
    catch { setImportMessage(""); setImportError("已清除当前展示，但浏览器未允许删除保留的报告；刷新后可能恢复。"); }
  }
  return <section className="cmp-section cmp-lab" id="terrain-lab" aria-labelledby="terrain-lab-title">
    <div className="cmp-section-heading"><div><p className="cmp-kicker"><FlaskConical size={14}/> 同源精度实验室</p><h2 id="terrain-lab-title">精度提升时，<br/>数据如何增长？</h2></div><p>四份实际生成并读回的 MultiPatch 三角带文件，与同一 GUGIS 原生控制网对照。切换精度，查看文件体积、相同点位与采样剖面的高程差。</p></div>
    <div className="cmp-lab-controls">
      <div className="cmp-resolution-buttons" role="group" aria-label="三角带离散精度">{suite.variants.map(v => <button key={v.ruledSubdivisions} aria-pressed={resolution === v.ruledSubdivisions} onClick={() => setResolution(v.ruledSubdivisions)}><strong>{v.ruledSubdivisions} × {v.ruledSubdivisions}</strong><span>每个直纹区段</span></button>)}</div>
      <label>参数域最大高程差目标<select aria-label="高程差目标" value={tolerance} onChange={event => {
        const target = Number(event.target.value); setTolerance(target);
        const match = precisionChoice(suite, target);
        if (match) setResolution(match.ruledSubdivisions);
      }}>{[.1, .5, 1, 5, 20].map(value => <option key={value} value={value}>{value} cm</option>)}</select></label>
      <span className={variant.maxRuledHeightErrorMetres * 100 <= tolerance ? "cmp-target-met" : "cmp-target-missed"}>{variant.maxRuledHeightErrorMetres * 100 <= tolerance ? <Check size={15}/> : null}本档{variant.maxRuledHeightErrorMetres * 100 <= tolerance ? "满足" : "超出"}目标</span>
    </div>
    <div className="cmp-budget-verdict" aria-live="polite"><div><small>在已测四档中 / 按相同高程差目标选文件</small>{choice ? <p><strong>{tolerance} cm</strong> 目标下，体积最小的达标三角带是 <strong>{choice.ruledSubdivisions}×{choice.ruledSubdivisions}</strong>，需要 <strong>{mb(choice.multipatchFilesBytes)} MB</strong>；GUGIS 原生曲面仍为 <strong>{mb(choice.gugisTerrainBytes)} MB</strong>。</p> : <p>已测四档均未达到 <strong>{tolerance} cm</strong> 目标；不推算未生成文件的体积或误差。</p>}<span>目标针对原生曲面的参数域解析差，非真实 DTM 的绝对精度；上方可手动探索其他档位。</span></div><button onClick={exportSelection}><Download size={15}/>导出当前对比结果</button></div>
    <div className="cmp-lab-score-grid" aria-live="polite">
      <article className="cmp-lab-native"><small>GUGIS · 保留原生曲面</small><strong>{mb(variant.gugisTerrainBytes)}<span> MB</span></strong><p>{suite.statistics.points.toLocaleString()} 个共享控制点 · 各档不变</p></article>
      <article><small>MultiPatch · {resolution}×{resolution} 离散</small><strong>{mb(variant.multipatchFilesBytes)}<span> MB</span></strong><p>五文件未压缩合计 · 是 GUGIS 的 {(variant.multipatchFilesBytes / variant.gugisTerrainBytes).toFixed(1)} 倍</p></article>
      <article><small>相同原生曲面的表达体积</small><strong>{variant.storageSavingPercent.toFixed(1)}<span>%</span></strong><p>GUGIS 文件体积减少 · 此快照结果</p></article>
      <article><small>三角带参数域最大高程差</small><strong>{cm(variant.maxRuledHeightErrorMetres)}<span> cm</span></strong><p>相对原生直纹曲面 · 解析值</p></article>
    </div>
    <div className="cmp-lab-table-wrap"><table className="cmp-lab-table"><caption>四档三角带精度、真实文件体积与读回查询误差</caption><thead><tr><th scope="col">离散档位</th><th scope="col">MultiPatch 文件</th><th scope="col">顶点条目</th><th scope="col">三角形</th><th scope="col">参数域最大差</th><th scope="col">点查询 RMS</th></tr></thead><tbody>{suite.variants.map(v => <tr key={v.ruledSubdivisions} className={resolution === v.ruledSubdivisions ? "selected" : ""}><th scope="row">{v.ruledSubdivisions}×{v.ruledSubdivisions}{resolution === v.ruledSubdivisions ? " · 当前" : ""}</th><td>{mb(v.multipatchFilesBytes)} MB</td><td>{v.multipatchVertexEntries.toLocaleString()}</td><td>{v.multipatchTriangles.toLocaleString()}</td><td>{cm(v.maxRuledHeightErrorMetres)} cm</td><td>{cm(v.queries.sampledRmsHeightErrorMetres)} cm</td></tr>)}</tbody></table></div>
    <div className="cmp-query-summary"><div><FileCheck2 size={19}/><span>同位置高程查询</span><strong>{variant.queries.queryCount.toLocaleString()} 个点</strong></div><p>{variant.queries.matchedCount.toLocaleString()} 个点双方有值；{outsideCount} 个原生 NoData 点；覆盖状态不一致 {variant.queries.coverageMismatchCount} 个。三角带读回高程的采样最大差 <strong>{cm(variant.queries.sampledMaxAbsHeightErrorMetres)} cm</strong>。</p></div>
    <article className="cmp-derivative-card" aria-labelledby="derivative-title"><div className="cmp-profile-head"><div><small>分析精度 / 高程之外</small><h3 id="derivative-title">坡度和朝向，是否也被保留？</h3></div><span className="cmp-derivative-badge">统一局部 ENU · 参考计算</span></div><p>原生区段内的解析导数与读回三角面的平面导数对照。对城市排水、地形选址等用途，高程差与导数差应一起查看。</p><div className="cmp-derivative-stats"><div><small>当前坡度 RMS 差</small><strong>{degrees(derivatives.slope.rmsDegrees)}</strong><span>{derivatives.slopeMatchedCount.toLocaleString()} 个有效内部点</span></div><div><small>当前坡向 RMS 差</small><strong>{degrees(derivatives.aspect.rmsDegrees)}</strong><span>{derivatives.aspectMatchedCount.toLocaleString()} 个有效方向</span></div><div><small>最大坡向差</small><strong>{degrees(derivatives.aspect.maxAbsDegrees)}</strong><span>顺时针下降方向 · 最短角差</span></div></div><div className="cmp-lab-table-wrap"><table className="cmp-lab-table"><caption>同位置查询的坡度、坡向差与有效统计点数</caption><thead><tr><th scope="col">离散档位</th><th scope="col">坡度 RMS / 最大差</th><th scope="col">有效内部点</th><th scope="col">坡向 RMS / 最大差</th><th scope="col">有效方向</th></tr></thead><tbody>{suite.variants.map(v => <tr key={v.ruledSubdivisions} className={resolution === v.ruledSubdivisions ? "selected" : ""}><th scope="row">{v.ruledSubdivisions}×{v.ruledSubdivisions}</th><td>{degrees(v.queries.derivatives.slope.rmsDegrees)} / {degrees(v.queries.derivatives.slope.maxAbsDegrees)}</td><td>{v.queries.derivatives.slopeMatchedCount.toLocaleString()}</td><td>{degrees(v.queries.derivatives.aspect.rmsDegrees)} / {degrees(v.queries.derivatives.aspect.maxAbsDegrees)}</td><td>{v.queries.derivatives.aspectMatchedCount.toLocaleString()}</td></tr>)}</tbody></table></div><p className="cmp-profile-note">当前剔除面片边界 {derivatives.boundaryExcludedCount} 点；坡向另剔除近乎平坦或无方向 {derivatives.nearFlatExcludedCount} 点（任一坡度 &lt; {suite.derivativeMethod.aspectMinimumSlopeDegrees}°）。BNG 导数经 {suite.derivativeMethod.horizontalJacobianStepMetres} m 中央差分水平雅可比转换到原生 ENU，避免把网格北与局部北的差当作离散误差。未调用 ArcGIS Slope / Aspect 工具。<a href="https://doc.esri.com/en/arcgis-pro/latest/tool-reference/spatial-analyst/aspect.html" target="_blank" rel="noreferrer">ArcGIS 坡向方法说明</a></p></article>
    <article className="cmp-profile-card">
      <div className="cmp-profile-head"><div><small>相同站点 / 两条高程曲线</small><h3>把差异放进剖面。</h3></div><div role="group" aria-label="采样剖面路线">{variant.profiles.map(p => <button key={p.id} aria-pressed={profile.id === p.id} onClick={() => { setProfileId(p.id); setStation(Math.floor(p.samples.length / 2)); }}>{p.name}</button>)}</div></div>
      <div className="cmp-profile-metric" role="group" aria-label="剖面指标">{(["height", "slope"] as const).map(m => <button key={m} aria-pressed={metric === m} onClick={() => setMetric(m)}>{m === "height" ? "高程" : "坡度"}</button>)}</div>
      <div className="cmp-profile-legend"><span><i/>GUGIS 原生曲面{metric === "height" ? "高程" : "坡度"}</span><span><i/>MultiPatch 读回三角带{metric === "height" ? "高程" : "坡度"}</span><small>{profile.samples.length} 个站点 · {totalDistance.toFixed(1)} m</small></div>
      <svg className="cmp-profile-chart" viewBox="0 0 805 325" role="img" aria-label={`${profile.name}${metric === "height" ? "高程" : "坡度"}与差值图，当前 ${resolution}×${resolution} 档；差值单位${metric === "height" ? "厘米" : "度"}，四档共用刻度`}>
        <text x="5" y="22">{metric === "height" ? "源高程 / m" : "坡度 / °"}</text><text x="5" y="201">差值 / {metric === "height" ? "cm" : "°"}</text>
        <g transform="translate(70,30)">
          {[0, .5, 1].map(t => <g key={t}><line x1="0" x2="700" y1={t * 155} y2={t * 155} className="cmp-chart-grid"/><text x="-10" y={t * 155 + 4} textAnchor="end">{(high + padding - t * (high - low + 2 * padding)).toFixed(2)}</text></g>)}
          <path d={nativePath} className="cmp-native-profile"/><path d={meshPath} className="cmp-mesh-profile"/>
          <line x1={markerX} x2={markerX} y1="0" y2="155" className="cmp-profile-marker"/>
        </g>
        <g transform="translate(70,215)">
          <line x1="0" x2="700" y1="38" y2="38" className="cmp-chart-grid"/>
          <text x="-10" y="4" textAnchor="end">{(errorRange * errorScale).toFixed(2)}</text><text x="-10" y="42" textAnchor="end">0</text><text x="-10" y="78" textAnchor="end">{(-errorRange * errorScale).toFixed(2)}</text>
          <path d={errorPath} className="cmp-error-profile"/><line x1={markerX} x2={markerX} y1="0" y2="76" className="cmp-profile-marker"/>
          <text x="0" y="103">0 m</text><text x="700" y="103" textAnchor="end">{totalDistance.toFixed(1)} m</text>
        </g>
      </svg>
      <label className="cmp-station-control">移动查看站点<input aria-label="剖面对比站点" type="range" min="0" max={profile.samples.length - 1} value={selectedStation} onChange={e => setStation(Number(e.target.value))} aria-valuetext={`第 ${selectedStation + 1} 站，${sample?.distance.toFixed(2)} 米`}/><span>{selectedStation + 1} / {profile.samples.length}</span></label>
      <div className="cmp-profile-readout" aria-live="polite"><div><small>距离</small><strong>{sample?.distance.toFixed(2)} m</strong></div><div><small>GUGIS 源高程</small><strong>{sample?.height === null ? "NoData" : `${sample?.height.toFixed(4)} m`}</strong></div><div><small>三角带源高程</small><strong>{sample?.multipatchHeight === null ? "NoData" : `${sample?.multipatchHeight.toFixed(4)} m`}</strong></div><div><small>三角带 − GUGIS</small><strong>{sample?.errorMetres === null ? "不可比" : `${cm(sample?.errorMetres ?? null)} cm`}</strong></div></div>
      <div className="cmp-profile-readout cmp-profile-derivatives" aria-live="polite"><div><small>坡度 · 原生 / 三角带</small><strong>{degrees(sample?.slope ?? null)} / {degrees(sample?.multipatchSlope ?? null)}</strong></div><div><small>坡度差</small><strong>{degrees(sample?.slopeErrorDegrees ?? null)}</strong></div><div><small>坡向 · 原生 / 三角带</small><strong>{degrees(sample?.aspect ?? null)} / {degrees(sample?.multipatchAspect ?? null)}</strong></div><div><small>最短坡向差</small><strong>{degrees(sample?.aspectErrorDegrees ?? null)}</strong></div></div>
      <p className="cmp-profile-note">面片 {sample?.patch ?? "NoData"} · 高程基准 {suite.verticalDatum}。两条曲线连接离散站点，空值处断开；没有估计连续路线的覆盖率。差值来自实际文件读回后的参考插值，包含水平投影影响。</p>
      <p className="cmp-profile-note">当前站点：{sample?.height === null || sample?.multipatchHeight === null ? "NoData，导数不可比" : sample?.nativeOnEdge || sample?.multipatchOnEdge ? "面片边界，展示先命中面的一侧坡度；不进入导数汇总" : "面片内部"}。剖面保留单侧导数供观察；曲线只连接采样值，并不定位全部三角面边界或重建连续导数。</p>
    </article>
    <div className="cmp-lab-package"><div><small>可复核 / 可在 ArcGIS Pro 打开</small><h3>带走整个对比实验。</h3><p>四档 Shapefile、GUGIS 原生地形、点查询与剖面 CSV、逐文件校验值、ArcGIS Pro 测量脚本。</p><code>快照 {suite.cityRevision.slice(0, 16)}…</code></div><a className="cmp-case-demo" href={packageUrl}>下载同源实验包 · {mb(suite.packageBytes)} MB <ArrowDown size={16}/></a></div>
    <article className="cmp-arcgis-run" aria-labelledby="arcgis-run-title"><div className="cmp-profile-head"><div><small>ARCGIS PRO / 软件实测接入</small><h3 id="arcgis-run-title">用真实软件结果补齐对比。</h3></div><button onClick={() => file.current?.click()}><Upload size={16}/>导入 ArcGIS Pro 实测 JSON</button><input ref={file} type="file" accept=".json,application/json" aria-label="ArcGIS Pro 实测报告文件" hidden onChange={event => importRun(event.currentTarget)}/></div>
      <p>解压实验包，在 ArcGIS Pro 的 Python Command Prompt 中运行 <code>python run_arcgis_pro.py</code>，再导入输出。脚本核对全部文件，并重复测量全几何读取与导入独立临时 FGDB 各 3 次。</p>
      {importError && <p role="alert" className="cmp-import-error">{importError}</p>}
      <p className="cmp-profile-note" role="status" aria-live="polite">{importing ? "正在读取与校验报告；已有报告暂时保留，可重新选择文件。" : importMessage}</p>
      {arcgis ? <><div className="cmp-imported-run"><strong>用户导入 · 本机未独立复核</strong><span>{arcgis.runtime.product} {arcgis.runtime.version} · {arcgis.runtime.os} · {new Date(arcgis.measuredAtUtc).toLocaleString("zh-CN")}</span><button onClick={clearRun}>清除本浏览器展示</button></div><div className="cmp-lab-table-wrap"><table className="cmp-lab-table"><caption>用户导入的 ArcPy 重复实测：三次中位数与范围</caption><thead><tr><th>档位</th><th>全几何读取中位数</th><th>三次范围</th><th>FGDB 导入中位数</th><th>三次范围</th></tr></thead><tbody>{arcgis.results.map(row => <tr key={row.subdivisions}><th>{row.subdivisions}×{row.subdivisions}</th><td>{row.medianReadMs.toFixed(1)} ms</td><td>{range(row.readMs)}</td><td>{row.medianCopyMs.toFixed(1)} ms</td><td>{range(row.copyMs)}</td></tr>)}</tbody></table></div><details><summary>原始耗时与几何数量</summary><pre>{JSON.stringify(arcgis.results, null, 2)}</pre></details></> : <div className="cmp-run-empty"><FileCheck2 size={22}/><div><strong>ArcGIS Pro 运行值待导入</strong><span>当前精度与体积结果已经测量；软件耗时暂留空。</span></div></div>}
      <p className="cmp-profile-note">导入文件只在本浏览器保留。软件任务为 ArcPy 数据读写、同进程重复运行，不能当作场景加载时间或帧率。<a href="https://pro.arcgis.com/en/pro-app/latest/tool-reference/data-management/copy-features.htm" target="_blank" rel="noreferrer">Copy Features 官方说明 <ArrowUpRight size={12}/></a></p>
    </article>
    <p className="cmp-terrain-disclaimer">本页比较 GUGIS 原生表达与本项目导出的 ArcGIS 兼容三角带；ArcGIS 另有 raster、TIN、terrain dataset 等表达，亦支持栅格双线性插值。实验{suite.demonstration ? "使用合成地形，仅验证表达与查询方法" : "使用当前导入地形"}；差值相对原生曲面，未评价真实地形精度。实验包与展示快照绑定。</p>
  </section>;
}
