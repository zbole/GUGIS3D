import { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleHelp,
  Database,
  ExternalLink,
  Layers3,
  Route,
  ScanLine,
} from "lucide-react";
import evidence from "../../../shared/compare-evidence.json" with { type: "json" };
import terrainSuite from "../../../shared/terrain-comparison-overview.json";
import { workspaceHref } from "../studio/workspaceNavigation";
import TerrainComparisonLoader from "./TerrainComparisonLoader";
import ComparisonOverview from "./ComparisonOverview";
import BristolTerrainBenchmark from "./BristolTerrainBenchmark";
import PaperTerrainResults, {RealTerrainResultSummary} from './PaperTerrainResults';
import CurvedRuledResults from './CurvedRuledResults';
const TerrainOrderControls = lazy(() => import('./TerrainOrderControls'));
const NativeQueryResults = lazy(() => import('./NativeQueryResults'));
const PrincipalDirectionResults = lazy(() => import('./PrincipalDirectionResults'));
const SourceFunctionResults = lazy(() => import('./SourceFunctionResults'));
const ResultFocusSummary = lazy(() => import('./ResultFocusSummary'));
const advantageSummary = <Suspense fallback={<p role="status" className="cr-scope">正在载入三条已核验结果主线…</p>}><ResultFocusSummary/></Suspense>;
const principalResults = <Suspense fallback={<p role="status" className="cr-scope">正在载入完整方向适配结果…</p>}><PrincipalDirectionResults/></Suspense>;
const sourceResults = <Suspense fallback={<p role="status" className="cr-scope">正在载入真实 DTM 同函数结果…</p>}><SourceFunctionResults/></Suspense>;
const nativeResults = <Suspense fallback={<p role="status" className="cr-scope">正在载入面带规模与原生查询结果…</p>}><NativeQueryResults/></Suspense>;
const orderControls = <Suspense fallback={<p role="status" className="cr-scope">正在载入同精度结构与高阶控制结果…</p>}><TerrainOrderControls/></Suspense>;
const functionControls = <EvidenceDisclosure group="functions" title="函数表示与高阶三角方法：完整控制实验" note="既有结果、高阶控制和失利样例均保留；按需展开"><CurvedRuledResults/>{orderControls}</EvidenceDisclosure>;
import {currentTerrainResultLink,rememberTerrainResult} from './terrainResultLink';
import EvidenceDisclosure from './EvidenceDisclosure';
import { useProjectFreshness, type ProjectFreshness } from "./useProjectFreshness";
import { cityWorkspaceHref, defaultCityWorkspace, type CityWorkspace } from "../studio/cityWorkspaces";
import type { CityApi } from "../studio/cityApi";
const ImplicitTerrainBenchmark = lazy(() => import('./ImplicitTerrainBenchmark'));
const HybridTerrainLab = lazy(() => import('./HybridTerrainLab'));
const researchSection = <><Suspense fallback={<p role="status">正在载入真实地形研究基准…</p>}><ImplicitTerrainBenchmark /></Suspense><Suspense fallback={<p role="status">正在载入混合逼近研究…</p>}><HybridTerrainLab /></Suspense></>;
import "./compare.css";

const sources = {
  multipatch: "https://www.esri.com/library/whitepapers/pdfs/shapefile.pdf",
  scene: "https://doc.arcgis.com/en/arcgis-online/get-started/view-scenes.htm",
  slice: "https://doc.arcgis.com/en/arcgis-online/get-started/slice-scene-content.htm",
  profile: "https://doc.arcgis.com/en/arcgis-online/get-started/scene-elevation-profile.htm",
  cga: "https://doc.arcgis.com/en/cityengine/latest/tutorials/essentials-rule-based-modeling.htm",
  interpolation: "https://pro.arcgis.com/en/pro-app/latest/tool-reference/spatial-analyst/interpolate-shape.htm",
  aspect: "https://doc.esri.com/en/arcgis-pro/latest/tool-reference/spatial-analyst/aspect.html",
};

const cases = [
  {
    id: "scene",
    number: "01",
    title: "城市三维场景",
    icon: Layers3,
    gugis: `${evidence.city.buildings} 栋建筑、${evidence.city.roads} 条道路、${evidence.city.terrainPatches} 个地形面片保存在布里斯托扩展样本街区档案中。`,
    arcgis: "Scene Viewer 支持三维场景、图层、底图、测量和环境设置。",
    result: "双方具备三维场景；ArcGIS 的现成浏览工具更完整。",
    source: sources.scene,
    sourceLabel: "Scene Viewer 官方工具清单",
    demoHref: workspaceHref("city"),
    demoLabel: "打开城市三维场景",
  },
  {
    id: "procedural",
    number: "02",
    title: "函数化建筑与地物",
    icon: Database,
    gugis: `${evidence.city.modelDefinitions} 个模型定义、${evidence.city.geometryLibraryRecords.toLocaleString()} 条几何库记录、${evidence.city.placedComponents.toLocaleString()} 个放置构件；档案中另有 ${evidence.city.functionFeatures} 个函数地物实例。`,
    arcgis: "CityEngine 使用 CGA 规则从轮廓生成建筑，并支持楼层拆分、属性与函数。",
    result: "双方具备规则化建模；GUGIS 展示可恢复的城市档案工作流。",
    source: sources.cga,
    sourceLabel: "CityEngine CGA 官方教程",
    demoHref: workspaceHref("environment"),
    demoLabel: "查看函数地物与地形",
  },
  {
    id: "terrain",
    number: "03",
    title: "同源地形格式",
    icon: Layers3,
    gugis: `直纹面带 + 三角带，${evidence.terrainBenchmark.controlPoints.toLocaleString()} 个共享控制点。独立地形 JSON ${Math.round(evidence.terrainBenchmark.gugisTerrainBytes / 1000)} KB，保留原生曲面求值。`,
    arcgis: `同一控制网导出为 ArcGIS Pro 可读取的 MultiPatch Shapefile，全部 ${evidence.terrainBenchmark.multipatchParts.toLocaleString()} 个 Triangle Strip 部件；五个组件文件共 ${Math.round(evidence.terrainBenchmark.multipatchFilesBytes / 1000)} KB。`,
    result: `此格式对照中 GUGIS 文件小 ${evidence.terrainBenchmark.storageSavingPercent.toFixed(1)}%；不代表 ArcGIS Pro 内存或帧率优势。`,
    source: sources.multipatch,
    sourceLabel: "Esri Shapefile / MultiPatch 规范",
    demoHref: `${workspaceHref("environment")}&view=terrain`,
    demoLabel: "查看原生地形",
  },
  {
    id: "analysis",
    number: "04",
    title: "地形与剖切分析",
    icon: Route,
    gugis: `示例脚本在 ${evidence.analysis.routeMetres} 米路径上得到 ${(evidence.analysis.terrainCoverage * 100).toFixed(0)}% 地形覆盖；${evidence.analysis.corridorMetres} 米走廊选中 ${evidence.analysis.selectedObjects} 个对象，函数地物相交 ${evidence.analysis.modelIntersectionSegments} 个线段。`,
    arcgis: "Scene Viewer 官方提供高程剖面与 Slice 剖切工具。",
    result: "双方可做剖面和遮挡探索；已增加同源文件的采样剖面误差，软件分析耗时仍需同机对测。",
    source: sources.profile,
    secondSource: sources.slice,
    sourceLabel: "高程剖面",
    demoHref: workspaceHref("analysis"),
    demoLabel: "进入空间分析工作区",
  },
  {
    id: "query",
    number: "05",
    title: "同点与剖面精度",
    icon: ScanLine,
    gugis: `网站原生查询内核对 ${terrainSuite.variants[1].queries.queryCount.toLocaleString()} 个固定点求值，并导出街区路线与最大扭曲区段两条采样剖面。`,
    arcgis: `本项目读回 2×2 档 MultiPatch 后作参考三角插值，相同点位的高程 RMS 差 ${(terrainSuite.variants[1].queries.sampledRmsHeightErrorMetres * 100).toFixed(3)} cm；覆盖状态不一致 ${terrainSuite.variants[1].queries.coverageMismatchCount} 个。`,
    result: "原生曲面在较小文件中保留连续求值；三角带的离散差随细分减小。这里验证文件表达与数值，尚未运行 ArcGIS 查询工具。",
    source: sources.interpolation,
    sourceLabel: "ArcGIS 表面插值方法官方说明",
    demoHref: "/compare#terrain-lab",
    demoLabel: "查看逐档误差与剖面",
  },
  {
    id: "derivatives",
    number: "06",
    title: "坡度与坡向保真",
    icon: ScanLine,
    gugis: "网站从直纹区段的解析导数直接计算坡度与下降方向；不需要先生成稠密三角网。",
    arcgis: `本项目读回 2×2 档 MultiPatch 的面导数并统一到局部 ENU，坡度 RMS 差 ${terrainSuite.variants[1].queries.derivatives.slope.rmsDegrees?.toFixed(3)}°，坡向 RMS 差 ${terrainSuite.variants[1].queries.derivatives.aspect.rmsDegrees?.toFixed(3)}°。`,
    result: "同一曲面离散后，导数差与高程差均需检查。ArcGIS 官方亦有坡度／坡向分析；当前数据不是这些软件工具的实测结果。",
    source: sources.aspect,
    sourceLabel: "ArcGIS Aspect 官方方法说明",
    demoHref: "/compare#derivative-title",
    demoLabel: "查看四档坡度、坡向结果",
  },
] as const;

const mb = (bytes: number) => (bytes / 1e6).toFixed(2);
const kb = (bytes: number) => (bytes / 1000).toFixed(1);
const terrainPackageUrl = `${(import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/$/, "")}/city/terrain/benchmark.zip?snapshot=${evidence.revision}`;

export default function CompareShowcase({ workspace = defaultCityWorkspace, api }: { workspace?: CityWorkspace; api?: CityApi } = {}) {
  if (workspace.id !== "bristol") return <div className="compare-page"><div className="city-comparison-pending">
    <span>GUGIS3D × ArcGIS / {workspace.name}</span>
    <h1>论文指标与真实地形，<br />分别核验结果。</h1>
    <p>{workspace.coverage_label}。本城建筑存储、城市剖面与软件计时尚无同源报告。下方地形结果按已核验的固定样区独立选择，不代表本城建筑或全城精度；布里斯托城市快照指标仅对应其原样本。</p>
    <a href={cityWorkspaceHref(workspace.id)}>进入{workspace.name}三维工作区 →</a>
    <a href="/compare">查看布里斯托已核验的对比证据 →</a>
    <a href="#real-terrain-results">查看固定样区真实地形结果 →</a>
    <a href="/datasets">查看城市与裸地数据集 →</a>
  </div>{advantageSummary}{principalResults}{sourceResults}{nativeResults}<PaperTerrainResults/>{functionControls}<RealTerrainResultSummary/><EvidenceDisclosure group="supplementary" title="补充研究实验" note="跨城市公开地形数据与既有方法实验">{researchSection}</EvidenceDisclosure></div>;
  return <BristolComparison api={api} />;
}

function ComparisonSnapshot({ freshness, recheck }: { freshness: ProjectFreshness; recheck: () => void }) {
  return <section className={`cmp-snapshot cmp-snapshot-top ${freshness}`} aria-label="城市实测快照校对">
    <span className="cmp-snapshot-icon"><Database size={16} aria-hidden="true" /></span>
    <div className="cmp-snapshot-copy" role="status" aria-live="polite" aria-atomic="true" aria-busy={freshness === "checking"}>
      <strong>{freshness === "current" ? "实测快照与当前项目一致" : freshness === "changed" ? "项目已改变：本页结果属于已保存快照" : freshness === "offline" ? "无法校对当前项目：展示已保存的实测快照" : freshness === "paused" ? "页面已暂停校对：展示已保存的实测快照" : "正在校对当前项目修订号"}</strong>
      <span className="cmp-snapshot-scope">布里斯托扩展样本街区 · {evidence.terrainBenchmark.demonstration ? "地形为合成演示" : "已保存地形快照"} · ArcGIS 软件运行值待测</span>
      <details className="cmp-snapshot-metadata"><summary>快照来源与测量环境</summary>
        <small>SHA-256 {evidence.revision} · {evidence.city.buildings} 栋 · Node {evidence.memory.runtime}</small>
        <span className="cmp-snapshot-note">返回页面时自动校对；重新校对只检查修订号，不会重新测量或修改项目。</span>
      </details>
    </div>
    <span className="cmp-snapshot-pill">{freshness === "current" ? "当前" : freshness === "changed" ? "历史" : freshness === "checking" ? "校对中" : "快照"}</span>
    <button type="button" className="cmp-snapshot-recheck" onClick={recheck} disabled={freshness === "checking" || freshness === "paused"}>
      {freshness === "checking" ? "正在校对…" : freshness === "offline" ? "重试校对" : "重新校对"}
    </button>
  </section>;
}

function HistoricalSnapshot({api}:{api?:CityApi}){
  const {freshness,recheck}=useProjectFreshness(evidence.revision,import.meta.env.VITE_API_BASE_URL??'/api',api?'/cities/bristol/city':'/city');
  return <ComparisonSnapshot freshness={freshness} recheck={recheck}/>;
}

function BristolComparison({ api }: { api?: CityApi }) {
  const terrainDownload = api ? `${api.terrainMultipatchUrl}?snapshot=${evidence.revision}` : terrainPackageUrl;
  const [selected, setSelected] = useState<(typeof cases)[number]["id"]>("scene");
  const [targetCentimetres, setTargetCentimetres] = useState(1);
  const [realTarget,setRealTarget]=useState(()=>currentTerrainResultLink().target);
  const changeDetailTarget=(next:number)=>{setRealTarget(next);rememberTerrainResult({...currentTerrainResultLink(),target:next});};
  const [resolution, setResolution] = useState(() => [...terrainSuite.variants]
    .filter(v => v.maxRuledHeightErrorMetres * 100 <= 1)
    .sort((a, b) => a.multipatchFilesBytes - b.multipatchFilesBytes)[0]?.ruledSubdivisions
    ?? terrainSuite.variants[0].ruledSubdivisions);
  useEffect(() => {
    document.title = "GUGIS3D · 地形对比结果与论文指标";
  }, []);
  const active = cases.find(item => item.id === selected) ?? cases[0];
  const ActiveIcon = active.icon;
  const bars = [
    { title: "GUGIS · 共享几何与实例", bytes: evidence.memory.sharedBytes, className: "shared" },
    { title: "独立点 + 线", bytes: evidence.memory.independentWireBytes, className: "wire" },
    { title: "独立点 + 三角面", bytes: evidence.memory.independentMeshBytes, className: "mesh" },
  ];
  return (
    <div className="compare-page">
      <header className="cmp-header">
        <a href="/" className="cmp-logo" aria-label="返回 GUGIS3D 城市工作台"><span className="cmp-logo-mark">G<span>3</span></span><span>GUGIS<em>3D</em></span></a>
        <nav aria-label="对比展示导航"><a href="#validated-advantages">核心结果</a><a href="#source-fit-results">真实地形</a><a href="#source-query-results">查询效率</a><a href="#paper-adaptive-results">论文对照</a><a href="/datasets">数据集</a><a href="#supplementary-evidence">完整证据</a></nav>
        <a href="/" className="cmp-header-action">进入三维工作台 <ArrowUpRight size={16}/></a>
      </header>
      <main>
        <section className="cmp-results-hero" aria-labelledby="cmp-title"><span className="paper-eyebrow">GUGIS3D / TERRAIN RESEARCH RESULTS</span><h1 id="cmp-title">顺着地形表达，<br/>用结果证明收益。</h1><p>三条已核验主线：与论文完整自适应 Pₜ 方法对照曲面精度；与同等共享拟合的双对角线三角带对照真实地形；从保存的面带直接查询高程与梯度。每条结论都对应完整模型、全部结果和适用范围。</p></section>
        {advantageSummary}
        {principalResults}
        {sourceResults}
        {nativeResults}
        <PaperTerrainResults />
        {functionControls}
        <RealTerrainResultSummary target={realTarget} onTargetChange={setRealTarget}/>
        <EvidenceDisclosure group="real" title="真实地形完整证据与三维演示" note="六组精度目标、负面结果、模型下载与 MultiPatch 格式核验"><BristolTerrainBenchmark target={realTarget} onTargetChange={changeDetailTarget}/></EvidenceDisclosure>
        <EvidenceDisclosure group="supplementary" title="补充实验、城市数据与 ArcGIS 能力对照" note="既有实验保留；ArcGIS 软件性能待同机测量">
        <HistoricalSnapshot api={api}/>
        <ComparisonOverview resolution={resolution} onResolutionChange={setResolution} targetCentimetres={targetCentimetres}/>
        {researchSection}

        <section className="cmp-section cmp-terrain-benchmark" id="terrain-benchmark">
          <div className="cmp-section-heading"><div><p className="cmp-kicker">01 / 结构与固定档位示例</p><h2>同一控制网，<br/>两种地形表达。</h2></div><p>以下固定展示 <strong>2×2 三角带离散示例</strong>，与上方 1 cm 目标的 8×8 档位分开。文件使用 ArcGIS 兼容 MultiPatch Shapefile；所有面片写成 Triangle Strip，并保留面片编号。</p></div>
          <div className="cmp-terrain-grid">
            <article className="cmp-terrain-score">
              <span className="cmp-terrain-eyebrow">FIXED EXAMPLE / 每区段 2×2</span>
              <div className="cmp-terrain-saving"><strong>2<i>×2</i></strong><span>固定离散档位<br/>原生文件小 {evidence.terrainBenchmark.storageSavingPercent.toFixed(1)}%</span></div>
              <div className="cmp-terrain-size"><div><span>GUGIS 原生地形 JSON</span><strong>{kb(evidence.terrainBenchmark.gugisTerrainBytes)} KB</strong></div><div className="cmp-terrain-track"><i style={{ width: `${evidence.terrainBenchmark.gugisTerrainBytes / evidence.terrainBenchmark.multipatchFilesBytes * 100}%` }}/></div></div>
              <div className="cmp-terrain-size baseline"><div><span>MultiPatch Shapefile 五文件合计</span><strong>{kb(evidence.terrainBenchmark.multipatchFilesBytes)} KB</strong></div><div className="cmp-terrain-track"><i /></div></div>
              <p>同一批高程控制点；MultiPatch 使用每区段 2×2 三角带离散。GUGIS 文件包含共享控制点、面片 ID、曲面类型和来源元数据。</p>
            </article>
            <article className="cmp-terrain-detail">
              <div className="cmp-terrain-detail-head"><span>保留曲面，还是先离散？</span><strong>{evidence.terrainBenchmark.demonstration ? "方法演示 · 非实测 DTM" : "用户导入 DTM"}</strong></div>
              <svg className="cmp-terrain-sketch" viewBox="0 0 560 158" role="img" aria-label="左侧直纹面带保留两侧边界和生成线，右侧 MultiPatch 将同一地形离散为三角带的结构示意">
                <defs><linearGradient id="band-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#2ab7a2" stopOpacity=".55"/><stop offset="1" stopColor="#8cddd1" stopOpacity=".1"/></linearGradient></defs>
                <path d="M24 107 Q90 11 228 57 L250 119 Q100 75 24 107Z" fill="url(#band-fill)" stroke="#2aa997" strokeWidth="2"/>
                <path d="M24 107 41 60 M84 83 93 37 M146 72 151 32 M202 93 211 47 M250 119 228 57" fill="none" stroke="#87dccb" strokeWidth="2"/>
                <text x="25" y="143">GUGIS / 连续直纹面带</text>
                <path d="M307 107 328 60 382 84 391 37 445 73 450 33 504 92 510 48 537 119 307 107" fill="#e8eeeb" stroke="#7c9d9e" strokeWidth="2"/>
                <path d="M307 107 382 84 328 60 391 37 382 84 445 73 391 37 450 33 445 73 504 92 450 33 510 48 504 92 537 119" fill="none" stroke="#8faeb0" strokeWidth="1.4"/>
                <text x="307" y="143">MultiPatch / 离散三角带</text>
              </svg>
              <div className="cmp-terrain-metrics"><div><strong>{evidence.terrainBenchmark.controlPoints.toLocaleString()}</strong><span>共享控制点</span></div><div><strong>{evidence.terrainBenchmark.ruledPatches.toLocaleString()} + {evidence.terrainBenchmark.triangleStrips.toLocaleString()}</strong><span>直纹面带 + 三角带</span></div><div><strong>{(evidence.terrainBenchmark.maxRuledHeightErrorMetres * 100).toFixed(2)} cm</strong><span>三角带离散最大高程差</span></div></div>
              <div className="cmp-terrain-actions"><a href={terrainDownload} className="cmp-case-demo">下载 2×2 对照文件 <ArrowDown size={15}/></a><a href={sources.multipatch} target="_blank" rel="noreferrer">查看 Esri 格式规范 <ExternalLink size={14}/></a></div>
            </article>
          </div>
          <p className="cmp-terrain-disclaimer">本次地形是合成演示数据，非真实 Bristol DTM。{evidence.terrainBenchmark.storageSavingPercent.toFixed(1)}% 仅指此快照的未压缩文件体积；最大高程差是相对 GUGIS 原生直纹曲面的离散误差，不能理解为实测地形误差。尚未在 ArcGIS Pro 内实测加载、内存、帧率或查询速度。</p>
        </section>

        <TerrainComparisonLoader resolution={resolution} onResolutionChange={setResolution} targetCentimetres={targetCentimetres} onTargetChange={setTargetCentimetres}/>

        <section className="cmp-section cmp-evidence" id="evidence">
          <div className="cmp-section-heading"><div><p className="cmp-kicker">02 / 城市数据实测</p><h2>再看街区结构。</h2></div><p>以下数字来自已保存的 GUGIS 起始街区快照。柱状图的参照对象是相同几何展开后的独立点线／实体网格，<strong>不是 ArcGIS 软件的内存用量</strong>。</p></div>
          <div className="cmp-evidence-grid">
            <article className="cmp-memory-card">
              <div className="cmp-card-top"><span><BarChart3 size={17}/> 保留数据堆</span><span className="cmp-measured"><span/> 3 次独立进程 · 中位数</span></div>
              <div className="cmp-memory-lead"><strong>{evidence.memory.wireSavingPercent.toFixed(2)}%</strong><div><span>更少的数据堆占用</span><small>GUGIS 共享表示 vs 独立点线</small></div></div>
              <div className="cmp-bars">{bars.map(bar => <div className="cmp-bar-row" key={bar.className}><div className="cmp-bar-label"><span>{bar.title}</span><strong>{mb(bar.bytes)} MB</strong></div><div className="cmp-bar-track"><div className={`cmp-bar-fill ${bar.className}`} style={{ width: `${bar.bytes / evidence.memory.independentMeshBytes * 100}%` }}/></div></div>)}</div>
              <p className="cmp-card-foot">保留城市几何与语义数据；不含 Cesium、浏览器界面或显存。独立点线基线不包含实体表面。</p>
            </article>
            <article className="cmp-analysis-card">
              <div className="cmp-card-top"><span><ScanLine size={17}/> 空间查询试验</span><span className="cmp-measured"><span/> 同一快照脚本</span></div>
              <div className="cmp-analysis-route"><span>路线长度</span><strong>{evidence.analysis.routeMetres}<small> m</small></strong><div className="cmp-route-line"><i/><i/><i/></div></div>
              <div className="cmp-mini-grid"><div><strong>{(evidence.analysis.terrainCoverage * 100).toFixed(0)}%</strong><span>地形剖面覆盖</span></div><div><strong>{evidence.analysis.selectedObjects}</strong><span>走廊选中地物</span></div><div><strong>{evidence.analysis.modelIntersectionSegments}</strong><span>函数地物相交线段</span></div></div>
              <p className="cmp-card-foot">这是 GUGIS 功能运行结果；ArcGIS 尚未用相同数据、硬件和任务实测。</p>
            </article>
          </div>
        </section>

        <section className="cmp-section cmp-compare" id="comparison">
          <div className="cmp-section-heading"><div><p className="cmp-kicker">03 / 产品能力对照</p><h2>与 ArcGIS，逐项对照。</h2></div><p>对照范围：<strong>ArcGIS Pro MultiPatch</strong>、浏览器端 <strong>Scene Viewer</strong> 与规则建模产品 <strong>CityEngine</strong>。已测量的是同源地形格式，不是 ArcGIS 软件性能。</p></div>
          <div className="cmp-result-table-wrap"><table className="cmp-result-table"><caption>GUGIS3D 与 ArcGIS 功能及实测结果总览</caption><thead><tr><th scope="col">对比任务</th><th scope="col">GUGIS3D · 本项目</th><th scope="col">ArcGIS · 官方能力 / 对照文件</th><th scope="col">当前结论</th></tr></thead><tbody><tr><th scope="row">同源地形文件（2×2）</th><td>{kb(evidence.terrainBenchmark.gugisTerrainBytes)} KB 原生地形 JSON</td><td>{kb(evidence.terrainBenchmark.multipatchFilesBytes)} KB MultiPatch Shapefile</td><td><span className="cmp-result-both">文件小 {evidence.terrainBenchmark.storageSavingPercent.toFixed(1)}%</span></td></tr><tr><th scope="row">城市三维场景</th><td>{evidence.city.buildings} 栋 + {evidence.city.terrainPatches.toLocaleString()} 个地形面片</td><td>Scene Viewer：三维场景与图层</td><td><span className="cmp-result-both">双方具备</span></td></tr><tr><th scope="row">规则化建模</th><td>{evidence.city.modelDefinitions} 个模型定义 + 函数地物</td><td>CityEngine：CGA 规则</td><td><span className="cmp-result-both">双方具备</span></td></tr><tr><th scope="row">剖面与剖切</th><td>{evidence.analysis.routeMetres} m 路线，地形覆盖 {(evidence.analysis.terrainCoverage * 100).toFixed(0)}%</td><td>Scene Viewer：高程剖面 + Slice</td><td><span className="cmp-result-both">双方具备</span></td></tr><tr><th scope="row">同机性能</th><td>{mb(evidence.memory.sharedBytes)} MB 数据堆（GUGIS）</td><td>同数据集结果未取得</td><td><span className="cmp-result-pending">待测</span></td></tr></tbody></table></div>
          <div className="cmp-comparison-grid">
            <div className="cmp-case-list" role="group" aria-label="对比主题">{cases.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} className={selected === item.id ? "active" : ""} onClick={() => setSelected(item.id)}><span>{item.number}</span><strong>{item.title}</strong><ArrowUpRight size={18}/></button>)}<div className="cmp-case-pending"><CircleHelp size={18}/><span>ArcGIS 同机性能跑分</span><strong>待测</strong></div></div>
            <article className="cmp-case-detail" role="tabpanel"><div className="cmp-case-title"><span className="cmp-case-icon"><ActiveIcon size={24}/></span><div><small>对比主题 / {active.number}</small><h3>{active.title}</h3></div></div><div className="cmp-two-col"><div className="cmp-gugis-column"><span>GUGIS3D <i>本项目实证</i></span><p>{active.gugis}</p></div><div className="cmp-arcgis-column"><span>ArcGIS <i>{active.id === "terrain" ? "本项目导出" : active.id === "query" || active.id === "derivatives" ? "文件读回" : "官方文档"}</i></span><p>{active.arcgis}</p></div></div><div className="cmp-verdict"><span>对比结果</span><strong>{active.result}</strong></div><div className="cmp-case-actions"><a className="cmp-case-demo" href={active.demoHref}>{active.demoLabel} <ArrowUpRight size={15}/></a>{active.id === "procedural" && <a className="cmp-case-demo-secondary" href={workspaceHref("author")}>打开建筑制作</a>}</div><div className="cmp-source-links"><a href={active.source} target="_blank" rel="noreferrer">{active.sourceLabel} <ExternalLink size={14}/></a>{"secondSource" in active && <a href={active.secondSource} target="_blank" rel="noreferrer">Scene Viewer 剖切 <ExternalLink size={14}/></a>}</div></article>
          </div>
        </section>

        <section className="cmp-section cmp-method" id="method">
          <div className="cmp-method-intro"><p className="cmp-kicker">04 / 公平实验</p><h2>哪些优势，<br/><span>已经得到验证？</span></h2><p>当前可复核的是：相同控制网下，GUGIS 原生地形文件比本项目导出的 MultiPatch 三角带文件更小，并可直接计算直纹曲面。城市共享几何相对独立点线基线也减少了数据堆占用。这些不等同于 ArcGIS Pro 的运行性能。</p><a href="/" className="cmp-btn cmp-btn-light">打开真实三维场景 <ArrowUpRight size={18}/></a></div>
          <div className="cmp-rigor-card"><div className="cmp-rigor-head"><span>ArcGIS 同机对标</span><strong>待同机复测</strong></div><div className="cmp-rigor-row"><span>01 / 数据</span><p>同一布里斯托街区、同一建筑细节与地形分辨率</p></div><div className="cmp-rigor-row"><span>02 / 环境</span><p>同一计算机、浏览器／显卡设置与冷启动条件</p></div><div className="cmp-rigor-row"><span>03 / 指标</span><p>加载时间、交互帧率、内存／显存、查询与剖切耗时</p></div><div className="cmp-rigor-result"><span>ArcGIS 实测值</span><strong>— 待测</strong></div></div>
        </section>

        </EvidenceDisclosure>
        <section className="cmp-end"><span>GUGIS3D / 布里斯托试点</span><h2>从可视化，走向<br/>可演算的城市。</h2><a href="/" className="cmp-btn cmp-btn-dark">进入城市工作台 <ArrowUpRight size={18}/></a></section>
      </main>
      <footer className="cmp-footer"><div><strong>GUGIS3D</strong><span>城市结构表达研究原型 · 布里斯托扩展样本街区</span></div><p>解析方法实验、环境署真实样区与历史合成演示各自标注来源；覆盖范围均有限。</p><div className="cmp-footer-links"><a href={sources.scene} target="_blank" rel="noreferrer">Scene Viewer</a><a href={sources.cga} target="_blank" rel="noreferrer">CityEngine</a><a href="/">工作台</a></div></footer>
    </div>
  );
}
