import { lazy, Suspense, useEffect, useState } from 'react';
import report from '../../../shared/hybrid-terrain-research.json';
import './hybridTerrainLab.css';
import LocalTriangleComparison, {localTrianglePair,localTriangleOutcome} from './LocalTriangleComparison';
import StripCompactionComparison, {compactPair,compactOutcome} from './StripCompactionComparison';
import RasterTerrainComparison, {rasterPair,rasterOutcome} from './RasterTerrainComparison';
import RasterMultipatchComparison from './RasterMultipatchComparison';
const kb=(bytes:number)=>(bytes/1000).toFixed(2);
const cm=(m:number)=>(m*100).toFixed(3);
const median=(a:number[])=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const status=(value:string)=>({'target-met':'构建目标达标','source-resolution-limit':'源控制网分辨率限制','point-budget':'控制点预算限制','step-budget':'细分次数限制'}[value]??value);
const HybridTerrainViewer=lazy(()=>import('./HybridTerrainViewer'));
const TerrainTradeoff=lazy(()=>import('./TerrainTradeoff'));

export default function HybridTerrainLab(){
  const [caseId,setCaseId]=useState(()=>typeof window!=='undefined'&&['#raster-terrain-audit','#raster-multipatch-audit','#terrain-error-cost'].includes(window.location?.hash)?'swiss-dem-crop':'rotating-direction');
  const [target,setTarget]=useState(.1);
  const [live,setLive]=useState(false);
  const data=report.cases.find(c=>c.id===caseId)!;
  const pair=data.variants.find(v=>v.target_m===target)!;
  const a=pair.hybrid,b=pair.triangles;
  const local=localTrianglePair(caseId,target);
  const compact=compactPair(caseId,target);
  const raster=data.demonstration?undefined:rasterPair(target);
  useEffect(()=>{
    if(typeof window==='undefined')return;
    const id=window.location?.hash?.slice(1)??'';
    if(!['hybrid-terrain-lab','local-triangle-audit','strip-compaction-audit','raster-terrain-audit','raster-multipatch-audit','terrain-error-cost'].includes(id))return;
    const frame=window.requestAnimationFrame(()=>document.getElementById(id)?.scrollIntoView());
    return()=>window.cancelAnimationFrame(frame);
  },[]);
  return <section id="hybrid-terrain-lab" className="hybrid-lab" aria-labelledby="hybrid-lab-title">
    <div className="hybrid-lab-heading"><div><span className="hybrid-eyebrow">FINITE-SCALE HYBRID TERRAIN / RESEARCH LAB</span>
      <h2 id="hybrid-lab-title">直纹面，在什么时候值得用？</h2>
      <p>检查整段母线与边界曲线的误差，再决定细分或切换三角面。用优势样本、无优势样本和真实 DEM，在相同误差目标下比较完整表示成本。</p></div>
      <a href={report.paper} target="_blank" rel="noreferrer">阅读自适应三角剖分论文 ↗</a></div>
    <div className="hybrid-controls"><label>研究地形<select aria-label="混合研究地形" value={caseId} onChange={e=>setCaseId(e.target.value)}>
      {report.cases.map(c=><option value={c.id} key={c.id}>{c.name}{c.demonstration?' · 解析样本':' · 真实源数据'}</option>)}</select></label>
      <label>最大误差目标<select aria-label="混合研究误差目标" value={target} onChange={e=>setTarget(Number(e.target.value))}>
        {[.05,.1,.25,.5].map(v=><option key={v} value={v}>{v*100} cm</option>)}</select></label>
      <span>{a.continuous_bound_available?'解析样本 · 含逐单元误差界':'历史 DEM 档案 · 仅采样核验；新连续参考结果在下方'} · 相同全局相容网格候选族</span></div>
    <p className="hybrid-case-intent">{data.expectation}</p>
    {data.demonstration?<><p className="local-triangle-summary"><strong>更强局部三角基线：</strong>{localTriangleOutcome(caseId,target)} <a href="#local-triangle-audit">查看同误差的另一组结果 ↓</a></p>
    <p className="strip-compaction-summary"><strong>相同曲面 · 编码合并后：</strong>{compactOutcome(caseId,target)} <a href="#strip-compaction-audit">查看三种文件及保持情况 ↓</a></p></>:<p className="strip-compaction-summary"><strong>新构建 · 连续参考栅格核验：</strong>{rasterOutcome(target)} <a href="#raster-terrain-audit">查看区域误差界与新模型 ↓</a></p>}
    <div className="hybrid-downloads"><a href="#terrain-error-cost">按误差要求选择表示 · 查看精度—成本曲线 ↓</a>{!data.demonstration&&<a href="#raster-multipatch-audit">取走同几何 ArcGIS 对照文件 ↓</a>}</div>
    <div className="hybrid-kpis" aria-live="polite">
      <article><small>{data.demonstration?'全局网格 · 同误差比较':'历史档案 · 采样对照'}</small><strong>{pair.comparison_eligible?'可比较':'暂不可比较'}</strong><span>{pair.comparison_eligible?'双方构建与离网格抽查均通过':'至少一方未通过全部核验，排除节省结论'}</span></article>
      <article><small>混合表示控制点</small><strong>{a.points.toLocaleString()}</strong><span>纯三角面 {b.points.toLocaleString()} · 两者计入共享控制点</span></article>
      <article><small>完整原生 JSON</small><strong>{kb(a.bytes)}<em> kB</em></strong><span>纯三角面 {kb(b.bytes)} kB · 含结构和元数据</span></article>
      <article><small>相对同候选族的文件变化</small><strong>{pair.native_file_saving_percent===null?'—':`${Math.abs(pair.native_file_saving_percent).toFixed(1)}%`}</strong>
        <span>{pair.native_file_saving_percent===null?'未建立同误差可比结论':pair.native_file_saving_percent>=0?'文件减少；不是内存节省':'文件增加；本档不具文件优势'}</span></article>
    </div>
    <div className="hybrid-models">
      <figure><img loading="lazy" width={1050} height={630} src={`/research/hybrid-terrain/${data.id}-reference.png`} alt={`${data.name}的参考表面三维预览`}/><figcaption>参考形态 · 显示抽样，统计使用全部源网格</figcaption></figure>
      {(['hybrid','triangles'] as const).map(mode=><figure key={mode}><img loading="lazy" width={784} height={630} src={`/research/hybrid-terrain/${data.id}-${mode}-${target}m.png`} alt={`${data.name}在${target}米目标下${mode==='hybrid'?'混合':'纯三角'}表示的实际XY拓扑图`}/>
        <figcaption>{mode==='hybrid'?'混合表示':'纯三角面'} · 保存档案的 XY 拓扑与母线</figcaption></figure>)}
    </div>
    <div className="hybrid-legend"><span><i className="hybrid-ruled"/>直纹面</span><span><i className="hybrid-triangle"/>三角面</span><span>绿线为母线方向；两类面共享边界控制点，保持 C⁰ 相容。</span></div>
    <div className="hybrid-live-entry"><button aria-expanded={live} onClick={()=>setLive(v=>!v)}>{live?'关闭三维研究视图':'打开可旋转的原生三维模型'}</button><span>按需加载当前模型，不写入正式城市。</span></div>
    {live&&<Suspense fallback={<p role="status">正在准备三维研究视图…</p>}><HybridTerrainViewer key={`${caseId}/${target}`} caseId={caseId} target={target} hybrid={a} triangles={b} localTriangles={local?.local_triangles??raster?.local_triangles} compactHybrid={compact?.compact_hybrid??raster?.compact_hybrid} referenceHybrid={raster?.hybrid}/></Suspense>}
    <div className="hybrid-table-scroll"><table><caption>精度、结构与实际查询 · {data.name} · {target*100} cm 目标</caption>
      <thead><tr><th>核验项目</th><th>混合表示</th><th>纯三角面 · 同候选族</th></tr></thead><tbody>
        <tr><th>构建状态</th><td>{status(a.status)}</td><td>{status(b.status)}</td></tr>
        <tr><th>直纹 / 三角面片</th><td>{a.ruled_patches} / {a.triangle_patches}</td><td>{b.ruled_patches} / {b.triangle_patches}</td></tr>
        <tr><th>源网格 RMSE / 最大误差</th><td>{cm(a.rmse_m)} / {cm(a.max_sampled_error_m)} cm</td><td>{cm(b.rmse_m)} / {cm(b.max_sampled_error_m)} cm</td></tr>
        <tr><th>4,096 个离网格坐标 · RMSE / 最大误差</th><td>{cm(a.offgrid.rmse_m)} / {cm(a.offgrid.max_absolute_m)} cm</td><td>{cm(b.offgrid.rmse_m)} / {cm(b.offgrid.max_absolute_m)} cm</td></tr>
        <tr><th>离网格抽查达标</th><td>{a.offgrid.meets_sampled_target?'通过':'未通过'}</td><td>{b.offgrid.meets_sampled_target?'通过':'未通过'}</td></tr>
        <tr><th>构建与结构校验</th><td>{a.build_and_validate_ms.toFixed(2)} ms</td><td>{b.build_and_validate_ms.toFixed(2)} ms</td></tr>
        <tr><th>原生 4,096 次查询中位耗时 · Node</th><td>{median(a.offgrid.query_repetitions_ms).toFixed(2)} ms</td><td>{median(b.offgrid.query_repetitions_ms).toFixed(2)} ms</td></tr>
        <tr><th>索引构建 / 留存 V8 数据堆增量</th><td>{a.offgrid.index_ms.toFixed(2)} ms / {kb(a.offgrid.retained_index_heap_bytes)} kB</td><td>{b.offgrid.index_ms.toFixed(2)} ms / {kb(b.offgrid.retained_index_heap_bytes)} kB</td></tr>
        <tr><th>Python 读回 / 网站内核最大差</th><td>{a.offgrid.decoded_kernel_max_difference_m.toExponential(2)} m</td><td>{b.offgrid.decoded_kernel_max_difference_m.toExponential(2)} m</td></tr>
      </tbody></table></div>
    {!data.demonstration&&<p className="hybrid-limit">此数据为作者瑞士 DEM 的 64 × 64 m 局部，源像元间距 0.5 m，{data.source_shape[0]*data.source_shape[1]} 个源样本。离网格参考由源 DEM 双线性插值获得，属于参考栅格一致性核验，不是独立实测高程，也不代表英国城市地形。</p>}
    <div className="hybrid-table-scroll"><table><caption>全部误差档位 · 不隐藏无优势或未达标结果</caption>
      <thead><tr><th>目标</th><th>混合 / 三角控制点</th><th>混合 / 三角文件 kB</th><th>可比结果</th></tr></thead><tbody>
        {data.variants.map(v=><tr key={v.target_m}><th>{v.target_m*100} cm</th><td>{v.hybrid.points} / {v.triangles.points}</td><td>{kb(v.hybrid.bytes)} / {kb(v.triangles.bytes)}</td>
          <td>{v.native_file_saving_percent===null?'未通过全部核验，暂不比较':v.native_file_saving_percent===0?'无文件成本优势':`${v.native_file_saving_percent>=0?'减少':'增加'} ${Math.abs(v.native_file_saving_percent).toFixed(1)}%`}</td></tr>)}
      </tbody></table></div>
    <details className="hybrid-method"><summary>查看有限尺度选择依据与研究边界</summary>
      <p>单个点上的低曲率方向不保证长母线可用。构建器检查区域内全部源采样的母线线性残差，以及两条边界曲线的插值残差；两项和必须达到误差目标。解析样本另计明确的逐单元误差界；不达标时比较两个方向的细分收益，受控制点、细分次数和源分辨率约束。</p>
      <p>每个矩形同时检查两条三角形对角线。三角面已达标时优先选择编码较短的三角带，直纹面必须通过减少所需控制点体现价值。所有切分使用全局相容网格，计入完整控制点、面片索引、边界数组和元数据；边界共享而非免费省略。这里保持 C⁰ 高程连续，不保证 C¹ 坡度连续。</p>
      <p>论文证明的结论有明确的函数及剖分条件。本段混合构建是相容张量网格的工程原型，未证明混合成本近最优。下方另列局部二分与编码合并结果；本段对照仍使用相同候选划分族，不是最佳任意三角网或 ArcGIS 软件结果。</p>
      <p>网站查询采用实际保存档案，七类地形共 56 个模型、每模型 4,096 个相同坐标，独立 Python 读回互核。Node 留存堆为强制 GC 后的索引增量，不是浏览器或 GPU 内存；跨机器耗时会改变。</p>
      {a.diagnostic_examples.length>0&&<div className="hybrid-table-scroll"><table><caption>选定混合模型的示例区域 · 源采样残差</caption><thead><tr><th>面片 / 类型</th><th>母线方向 / 长度</th><th>母线 / 边界残差</th><th>选择误差界</th></tr></thead>
        <tbody>{a.diagnostic_examples.map(d=><tr key={d.patch}><td>{d.patch} · {d.kind==='ruled-strip'?'直纹面':'三角面'}</td><td>{d.mother_direction.toUpperCase()} / {d.mother_length_m.toFixed(2)} m</td><td>{cm(d.mother_error)} / {cm(d.boundary_error)} cm</td><td>{cm(d.error)} cm</td></tr>)}</tbody></table></div>}
    </details>
    <div className="hybrid-downloads"><a href={`/research/hybrid-terrain/${data.id}.zip`} download>下载此地形全部模型与核验数据 ↓</a><a href="/research/hybrid-terrain/results.json" download>完整结果 JSON ↓</a><a href="/research/hybrid-terrain/results.csv" download>56 个模型数值 CSV ↓</a></div>
    <p className="hybrid-attribution">真实 DEM 来源：ImplicitTerrain 作者公开示例 / swissALTI3D · Federal Office of Topography swisstopo。解析样本、图片、构建器与核验脚本由本项目生成；不包含作者权重或代码。</p>
    {data.demonstration?<><LocalTriangleComparison caseId={caseId} target={target}/><StripCompactionComparison caseId={caseId} target={target}/></>:<><RasterTerrainComparison target={target}/><RasterMultipatchComparison target={target}/></>}
    <Suspense fallback={<p role="status">正在载入精度—成本曲线…</p>}><TerrainTradeoff caseId={caseId} target={target}/></Suspense>
  </section>;
}
