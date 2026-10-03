import { useEffect, useState } from "react";
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
import { useProjectFreshness } from "./useProjectFreshness";
import { cityWorkspaceHref, defaultCityWorkspace, type CityWorkspace } from "../studio/cityWorkspaces";
import type { CityApi } from "../studio/cityApi";
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
    gugis: `${evidence.city.buildings} 栋建筑、${evidence.city.roads} 条道路、${evidence.city.terrainPatches} 个地形面片保存在布里斯托起始街区档案中。`,
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

function CityIllustration() {
  return (
    <div className="cmp-visual" aria-label="布里斯托城市结构概念示意图">
      <div className="cmp-visual-head"><span className="cmp-live" /> 布里斯托 / 城市结构模型 <span>北纬 51.45°</span></div>
      <svg viewBox="0 0 670 480" role="img" aria-label="建筑、地形、道路和数据连接组成的三维结构示意图">
        <defs>
          <linearGradient id="cmp-ground" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#153b5d"/><stop offset="1" stopColor="#09283e"/></linearGradient>
          <linearGradient id="cmp-roof" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#d8eef0"/><stop offset="1" stopColor="#87c5ce"/></linearGradient>
          <linearGradient id="cmp-face" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#739bab"/><stop offset="1" stopColor="#1e506a"/></linearGradient>
          <pattern id="cmp-grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="matrix(1 .5 -1 .5 0 0)"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#76c9d1" strokeOpacity=".13" strokeWidth="1"/></pattern>
          <filter id="cmp-glow"><feGaussianBlur stdDeviation="4"/></filter>
        </defs>
        <ellipse cx="350" cy="428" rx="258" ry="34" fill="#020f1b" opacity=".45" filter="url(#cmp-glow)" />
        <path d="M 60 262 L 318 96 L 638 261 L 377 429 Z" fill="url(#cmp-ground)" stroke="#76bdd0" strokeWidth="1.2" />
        <path d="M 60 262 L 318 96 L 638 261 L 377 429 Z" fill="url(#cmp-grid)" />
        <path d="M 60 262 L 377 429 L 377 446 L 60 279 Z" fill="#10273b" stroke="#325e73" />
        <path d="M 377 429 L 638 261 L 638 277 L 377 446 Z" fill="#0b2638" stroke="#325e73" />
        <path d="M 90 260 C 171 234 207 192 278 188 C 370 176 414 238 487 243 C 541 244 577 231 611 249" fill="none" stroke="#62d9dd" strokeWidth="18" strokeOpacity=".10" />
        <path d="M 90 260 C 171 234 207 192 278 188 C 370 176 414 238 487 243 C 541 244 577 231 611 249" fill="none" stroke="#9ce9e8" strokeWidth="2.2" strokeDasharray="9 6" />
        <path d="M 144 320 C 198 277 252 281 298 297 C 374 333 473 300 529 264" fill="none" stroke="#56a9bb" strokeWidth="2" strokeDasharray="5 6" />
        <path d="M 194 197 Q 239 162 300 170 M 175 210 Q 235 166 314 180 M 152 224 Q 222 179 332 193" fill="none" stroke="#76bfbd" strokeOpacity=".5" strokeWidth="2" />
        <g className="cmp-svg-building">
          <path d="M 210 268 L 270 232 L 316 253 L 256 289 Z" fill="url(#cmp-roof)" stroke="#e5f6f2"/>
          <path d="M 210 268 L 256 289 L 256 349 L 210 327 Z" fill="url(#cmp-face)" stroke="#8fc7cd"/>
          <path d="M 256 289 L 316 253 L 316 310 L 256 349 Z" fill="#32677d" stroke="#8fc7cd"/>
          <path d="M 225 288 L 246 298 M 225 307 L 246 317 M 271 299 L 303 279 M 271 318 L 303 298" stroke="#b8e2df" strokeWidth="3" strokeLinecap="round"/>
        </g>
        <g className="cmp-svg-building">
          <path d="M 388 274 L 458 232 L 514 262 L 444 305 Z" fill="url(#cmp-roof)" stroke="#e5f6f2"/>
          <path d="M 388 274 L 444 305 L 444 360 L 388 329 Z" fill="url(#cmp-face)" stroke="#8fc7cd"/>
          <path d="M 444 305 L 514 262 L 514 316 L 444 360 Z" fill="#32677d" stroke="#8fc7cd"/>
          <path d="M 403 292 L 431 307 M 403 312 L 431 327 M 456 315 L 498 290 M 456 335 L 498 310" stroke="#b8e2df" strokeWidth="3" strokeLinecap="round"/>
        </g>
        <g className="cmp-svg-tower">
          <path d="M 300 202 L 341 177 L 384 199 L 342 225 Z" fill="#eaf1e1" stroke="#e6f7ef" strokeWidth="1.5"/>
          <path d="M 300 202 L 342 225 L 342 354 L 300 331 Z" fill="#a6b9ad" stroke="#e0ece4" strokeWidth="1.5"/>
          <path d="M 342 225 L 384 199 L 384 329 L 342 354 Z" fill="#647f80" stroke="#d2e5df" strokeWidth="1.5"/>
          <path d="M 309 205 L 309 150 L 341 130 L 374 148 L 374 205 M 341 130 L 341 89" fill="none" stroke="#b3d1c3" strokeWidth="6" strokeLinejoin="round"/>
          <path d="M 311 151 L 341 134 L 371 150 M 311 177 L 341 158 L 371 175 M 309 230 L 334 245 M 309 253 L 334 268 M 309 278 L 334 292 M 351 240 L 376 225 M 351 264 L 376 249 M 351 288 L 376 273" fill="none" stroke="#e3f4e8" strokeWidth="3.5" strokeLinecap="round"/>
          <path d="M 316 185 L 328 192 M 352 191 L 365 184" stroke="#d0e4de" strokeWidth="5"/>
        </g>
        <path d="M 108 330 L 547 117 M 138 360 L 577 147" fill="none" stroke="#56d7d5" strokeOpacity=".32" strokeDasharray="3 8" />
        <g fill="#a3f0e9"><circle cx="90" cy="260" r="4"/><circle cx="278" cy="188" r="4"/><circle cx="487" cy="243" r="4"/><circle cx="611" cy="249" r="4"/><circle cx="342" cy="225" r="5"/></g>
        <g fill="none" stroke="#99e3df" strokeOpacity=".7"><circle cx="342" cy="225" r="13"/><circle cx="342" cy="225" r="24" strokeOpacity=".25"/></g>
      </svg>
      <div className="cmp-callout cmp-callout-top"><small>构件图谱</small><strong>{evidence.city.placedComponents.toLocaleString()}</strong><span>语义构件实例</span></div>
      <div className="cmp-callout cmp-callout-bottom"><small>地形系统</small><strong>{evidence.city.terrainPatches.toLocaleString()}</strong><span>原生地形面片</span></div>
      <p className="cmp-visual-caption">结构概念图 · 实际三维模型请进入城市工作台</p>
    </div>
  );
}

export default function CompareShowcase({ workspace = defaultCityWorkspace, api }: { workspace?: CityWorkspace; api?: CityApi } = {}) {
  if (workspace.id !== "bristol") return <div className="city-comparison-pending">
    <span>GUGIS3D × ArcGIS / {workspace.name}</span>
    <h1>{workspace.status === "pending" ? "城市数据待导入，" : "已导入城市数据，"}<br />对比实验待建立。</h1>
    <p>{workspace.coverage_label}。当前未生成此城市的同源基准报告；布里斯托的存储节省、查询精度及剖面结果只对应布里斯托样本。</p>
    <a href={cityWorkspaceHref(workspace.id)}>进入{workspace.name}三维工作区 →</a>
    <a href="/compare">查看布里斯托已核验的对比证据 →</a>
  </div>;
  return <BristolComparison api={api} />;
}

function BristolComparison({ api }: { api?: CityApi }) {
  const terrainDownload = api ? `${api.terrainMultipatchUrl}?snapshot=${evidence.revision}` : terrainPackageUrl;
  const [selected, setSelected] = useState<(typeof cases)[number]["id"]>("scene");
  const { freshness, recheck } = useProjectFreshness(evidence.revision, import.meta.env.VITE_API_BASE_URL ?? "/api", api ? "/cities/bristol/city" : "/city");
  useEffect(() => {
    document.title = "GUGIS3D × ArcGIS · 证据对比";
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
        <nav aria-label="对比展示导航"><a href="#comparison-overview">结果总览</a><a href="#terrain-benchmark">地形结构</a><a href="#terrain-lab">精度与查询</a><a href="#derivative-title">坡度分析</a><a href="#evidence">城市实测</a><a href="#comparison">功能对照</a><a href="#method">实验边界</a></nav>
        <a href="/" className="cmp-header-action">进入三维工作台 <ArrowUpRight size={16}/></a>
      </header>
      <main>
        <section className="cmp-hero" aria-labelledby="cmp-title">
          <div className="cmp-hero-copy">
            <div className="cmp-issue"><span className="cmp-issue-dot"/> GUGIS3D / 对比证据 <span>2026</span></div>
            <p className="cmp-hero-overline">GUGIS3D <span>×</span> ArcGIS / 布里斯托试点</p>
            <h1 id="cmp-title">让城市模型<br/><span>看得见，</span><br/>也算得清。</h1>
            <p className="cmp-hero-description">以布里斯托起始街区为样本，把 GUGIS3D 的结构化建模与 ArcGIS 官方产品能力放在同一张证据板上。功能逐项对照，数值公开边界，结果可以复核。</p>
            <div className="cmp-hero-actions"><a href="#comparison-overview" className="cmp-btn cmp-btn-dark">查看对比结果 <ArrowRight size={18}/></a><a href="#evidence" className="cmp-btn cmp-btn-light">查看城市数据 <ArrowDown size={18}/></a></div>
            <div className="cmp-proofline"><span><Check size={15}/> 已保存项目快照</span><span><Check size={15}/> 官方 ArcGIS 文档</span><span><Check size={15}/> 可复现实验脚本</span></div>
          </div>
          <CityIllustration/>
        </section>

        <section className="cmp-statstrip" aria-label="已保存城市快照关键数据">
          <div><strong>{evidence.city.buildings}</strong><span>栋建筑</span><small>布里斯托起始街区</small></div>
          <div><strong>{(evidence.city.placedComponents / 1000).toFixed(1)}<i>K</i></strong><span>构件实例</span><small>来自共享模型定义</small></div>
          <div><strong>{evidence.city.terrainPatches.toLocaleString()}</strong><span>地形面片</span><small>原生地形表达</small></div>
          <div className="cmp-stat-feature"><strong>{(terrainSuite.variants[0].gugisTerrainBytes / 1e6).toFixed(3)}<i> MB</i></strong><span>原生地形文件</span><small>四档对照使用同一份 GUGIS 数据</small></div>
        </section>

        <ComparisonOverview />

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

        <TerrainComparisonLoader />

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
          <div className={`cmp-snapshot ${freshness}`}>
            <span className="cmp-snapshot-icon"><Database size={16}/></span>
            <div className="cmp-snapshot-copy" role="status" aria-live="polite" aria-atomic="true" aria-busy={freshness === "checking"}>
              <strong>{freshness === "current" ? "实测快照与当前项目一致" : freshness === "changed" ? "项目已改变：本页结果属于已保存快照" : freshness === "offline" ? "无法校对当前项目：展示已保存的实测快照" : freshness === "paused" ? "页面已暂停校对：展示已保存的实测快照" : "正在校对当前项目修订号"}</strong>
              <small>SHA-256 {evidence.revision.slice(0, 16)}… · {evidence.city.buildings} 栋 · Node {evidence.memory.runtime}</small>
              <span className="cmp-snapshot-note">返回页面时自动校对；重新校对只检查修订号，不会重新测量或修改项目。</span>
            </div>
            <span className="cmp-snapshot-pill">{freshness === "current" ? "当前" : freshness === "changed" ? "历史" : freshness === "checking" ? "校对中" : "快照"}</span>
            <button type="button" className="cmp-snapshot-recheck" onClick={recheck} disabled={freshness === "checking" || freshness === "paused"}>
              {freshness === "checking" ? "正在校对…" : freshness === "offline" ? "重试校对" : "重新校对"}
            </button>
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

        <section className="cmp-end"><span>GUGIS3D / 布里斯托试点</span><h2>从可视化，走向<br/>可演算的城市。</h2><a href="/" className="cmp-btn cmp-btn-dark">进入城市工作台 <ArrowUpRight size={18}/></a></section>
      </main>
      <footer className="cmp-footer"><div><strong>GUGIS3D</strong><span>城市结构表达研究原型 · 布里斯托起始街区</span></div><p>地标与部分建筑为参考／推演模型；当前地形由解析函数生成，非实测 DTM。</p><div className="cmp-footer-links"><a href={sources.scene} target="_blank" rel="noreferrer">Scene Viewer</a><a href={sources.cga} target="_blank" rel="noreferrer">CityEngine</a><a href="/">工作台</a></div></footer>
    </div>
  );
}
