import {useEffect,useMemo,useState} from 'react';
import report from '../../../shared/curved-ruled-comparison-v1.json';
import {bezierPoint,curveQuery,curvedRuledPoint,triangleFaces,type CurveModel,type CurvePoint} from './curvedRuledMath';
import {loadCurvedRuledModel} from './loadCurvedRuledModel';
import {useComparisonAnchor} from './useComparisonAnchor';
import './CurvedRuledResults.css';

type Case=typeof report.cases[number];
type Entry=Case['baselines'][number]|Case['candidates'][number];
const methods={paper_l2_l1:'论文式 L₂ / L₁ 三角网',greedy_euclidean:'最长边贪心三角网',uniform_euclidean:'均匀最长边三角网'};
const root='/research/curved-ruled-v1/';
const size=(n:number)=>`${(n/1000).toFixed(2)} kB`;
const pct=(n:number)=>Math.abs(n).toFixed(1)+'%';
export function functionPair(c:Case,method:string,n:number){
  const pair=c.pairs.find(p=>p.method===method&&p.budget_n===n)!;
  return {pair,baseline:c.baselines.find(b=>b.filename===pair.baseline)!,candidate:c.candidates.find(b=>b.filename===pair.candidate)!};
}
function Plot({model,point,title}:{model:CurveModel;point:CurvePoint|null;title:string}){
  const project=(p:CurvePoint)=>[230+(p[0]-p[1])*1.8,245-(p[0]+p[1])*.62-(p[2]-30)*6];
  const path=(points:CurvePoint[])=>points.map((p,i)=>`${i?'L':'M'}${project(p).map(x=>x.toFixed(2)).join(',')}`).join(' ');
  const paths=useMemo(()=>model.patches.map(p=>{
    if(p.kind==='triangle-strip')return triangleFaces(p).map(f=>path([...f,f[0]].map(i=>model.points[i]))).join(' ');
    const a=p.left.map(i=>model.points[i]),b=p.right.map(i=>model.points[i]);
    const boundaries=[a,b].map(c=>path(Array.from({length:17},(_,i)=>bezierPoint(c,i/16))));
    const rulings=[0,.25,.5,.75,1].map(u=>path([curvedRuledPoint(model,p,u,0),curvedRuledPoint(model,p,u,1)]));
    return [...boundaries,...rulings].join(' ');
  }).join(' '),[model]);
  return <svg className="cr-model-plot" viewBox="0 0 460 340" role="img" aria-label={title}>
    <path d={paths} fill="none" stroke={model.patches[0].kind==='quadratic-ruled'?'#108d80':'#718590'} strokeWidth=".65" opacity=".65"/>
    {point&&<circle cx={project(point)[0]} cy={project(point)[1]} r="5" fill="#d36631" stroke="#fff" strokeWidth="2"/>}
    <text x="20" y="323">100 × 100 m · 原生模型的等轴投影</text>
  </svg>;
}
function ModelPreview({c,baseline,candidate}:{c:Case;baseline:Entry;candidate:Entry}){
  const [models,setModels]=useState<CurveModel[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const [x,setX]=useState(13),[y,setY]=useState(-17);
  useEffect(()=>{
    const controller=new AbortController();setModels(null);setError('');
    Promise.all([baseline,candidate].map(e=>loadCurvedRuledModel(`${root}${c.id}/${e.filename}`,e.bytes,e.sha256,controller.signal)))
      .then(models=>{if(!controller.signal.aborted)setModels(models);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'模型载入失败');});
    return ()=>controller.abort();
  },[c.id,baseline.filename,candidate.filename,retry]);
  if(error)return <div role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>重试模型</button></div>;
  if(!models)return <p role="status">正在核验两份原生模型的字节数与 SHA-256…</p>;
  const hits=models.map(m=>curveQuery(m,x,y));
  const q=c.q_matrix;
  const reference=c.polynomial?30+.0001*(x*x+y*y)+5e-7*x**4+8e-8*y**4:30+q![0][0]*x*x+(q![0][1]+q![1][0])*x*y+q![1][1]*y*y;
  return <div className="cr-preview">
    <div className="cr-probe-controls"><label>X / m <input aria-label="函数模型查询X" type="range" min="-50" max="50" step=".1" value={x} onChange={e=>setX(Number(e.target.value))}/><output>{x.toFixed(1)}</output></label>
      <label>Y / m <input aria-label="函数模型查询Y" type="range" min="-50" max="50" step=".1" value={y} onChange={e=>setY(Number(e.target.value))}/><output>{y.toFixed(1)}</output></label></div>
    <p className="cr-probe-reference">相同查询点的解析参考高程：{reference.toFixed(6)} m</p>
    <div className="cr-preview-grid">{models.map((model,i)=>{const h=hits[i];return <article key={i}>
      <h4>{i?'GUGIS · 二次边界直纹面带':'基线 · 线性三角带'}</h4>
      <Plot model={model} point={h?[x,y,h.height]:null} title={i?'GUGIS 原生二次直纹曲面':'基线原生三角网'}/>
      <p>{h?`高程 ${h.height.toFixed(6)} m · ∂z/∂x ${h.gradient[0].toFixed(6)} · ∂z/∂y ${h.gradient[1].toFixed(6)}`:'查询点不在模型中'}</p>
      {h&&<p>当前点绝对高程差：{(Math.abs(h.height-reference)*1000).toFixed(6)} mm</p>}
    </article>;})}</div>
    <p className="cr-scope">查询直接求值已核验的原生函数与三角带。图上二次边界用 16 段折线显示；显示离散不参与 E₂ 测量。每份模型核查 4,096 个独立内点，136 份模型全部覆盖；此处为研究原型。</p>
  </div>;
}
export default function CurvedRuledResults(){
  useComparisonAnchor('gugis-function-results');
  const [caseId,setCaseId]=useState('anisotropic'),[method,setMethod]=useState('paper_l2_l1'),[n,setN]=useState(2048),[preview,setPreview]=useState(false);
  const c=report.cases.find(c=>c.id===caseId)!;
  const {pair,baseline,candidate}=functionPair(c,method,n);
  const paperPairs=report.cases.flatMap(c=>c.pairs.filter(p=>p.method==='paper_l2_l1'));
  const wins=paperPairs.filter(p=>p.e2_reduction_percent!>0).length;
  return <section className="cr-results" id="gugis-function-results" aria-labelledby="cr-title">
    <div className="cr-heading"><div><span className="cr-eyebrow">GUGIS / 原生函数表达 · 新结果</span><h2 id="cr-title">保留曲率，用更少数据降低误差。</h2>
      <p>二次边界曲线之间排列直纹面。与论文式线性三角网对照：同一曲面、同一完整文件预算，直接核算全域误差。</p></div><a href={report.paper} target="_blank" rel="noreferrer">论文与方法定义 ↗</a></div>
    <div className="cr-case-cards">{report.cases.map(item=>{const p=functionPair(item,'paper_l2_l1',2048);return <button key={item.id} aria-pressed={caseId===item.id} onClick={()=>{setCaseId(item.id);setN(2048);setMethod('paper_l2_l1');}}>
      <span>{item.name}</span><strong>{pct(p.pair.e2_reduction_percent!)}<small> E₂ 降低</small></strong><span>实际文件小 {pct(p.pair.file_saving_percent!)} · 基线 N = 2,048</span></button>;})}</div>
    <div className="cr-controls"><label>测试曲面<select aria-label="函数对照测试曲面" value={caseId} onChange={e=>setCaseId(e.target.value)}>{report.cases.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>对照方法<select aria-label="函数对照基线" value={method} onChange={e=>setMethod(e.target.value)}>{Object.entries(methods).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      <label>基线三角形数 · 决定文件上限<select aria-label="函数对照基线三角形数" value={n} onChange={e=>setN(Number(e.target.value))}>{report.budgets.map(n=><option key={n} value={n}>{n.toLocaleString()}</option>)}</select></label></div>
    <div className="cr-main"><article className={`cr-finding ${pair.e2_reduction_percent!<0?'cr-adverse':''}`}>
      <span>GUGIS 相比所选基线 / 全域 E₂</span><strong>{pct(pair.e2_reduction_percent!)}</strong><h3>{pair.e2_reduction_percent!>=0?'误差降低':'误差增加 · 此预算不占优'}</h3>
      <p>{size(candidate.bytes)} / {size(baseline.bytes)}<br/>实际文件小 {pct(pair.file_saving_percent!)}</p>
      <small>P₂×P₁ 二次直纹函数对 P₁ 线性插值。优势来自保留曲率；这不是对论文渐近最优定理的反证。</small></article>
      <div className="cr-measures"><div className="cr-metric-row"><span></span><b>GUGIS 函数面带</b><b>{methods[method as keyof typeof methods]}</b></div>
        <div className="cr-metric-row"><span>全域 E₂ / m²</span><strong>{candidate.e2_m2.toFixed(6)}</strong><strong>{baseline.e2_m2.toFixed(6)}</strong></div>
        <div className="cr-metric-row"><span>积分 RMS / mm</span><strong>{(candidate.rms_m*1000).toFixed(4)}</strong><strong>{(baseline.rms_m*1000).toFixed(4)}</strong></div>
        <div className="cr-metric-row"><span>完整原生文件 / B</span><strong>{candidate.bytes.toLocaleString()}</strong><strong>{baseline.bytes.toLocaleString()}</strong></div>
        <div className="cr-metric-row"><span>共享控制点</span><span>{candidate.controls.toLocaleString()}</span><span>{baseline.controls.toLocaleString()}</span></div>
        <div className="cr-metric-row"><span>原生面片</span><span>{candidate.curved_ruled_patches} 段二次直纹面</span><span>{baseline.native_triangles.toLocaleString()} 个三角形</span></div>
        <p className="cr-scope">100 × 100 m 连续曲面 · E₂ = √∫(f − f̂)² dA · RMS = E₂ / 100。两种模型均共享点，三角基线也压成三角带；费用包括完整 JSON 包装与实际坐标。</p>
      </div></div>
    <div className="cr-actions"><button onClick={()=>setPreview(p=>!p)} aria-expanded={preview}>{preview?'收起原生模型':'打开原生模型与函数查询'}</button>
      <a download href={`${root}${c.id}/${candidate.filename}`}>GUGIS 模型 ↓</a><a download href={`${root}${c.id}/${baseline.filename}`}>基线模型 ↓</a><a download href={`${root}pairs.csv`}>全部 81 组对照 CSV ↓</a></div>
    {preview&&<ModelPreview c={c} baseline={baseline} candidate={candidate}/>}
    <details className="cr-details"><summary>完整曲线与九档结果 · 对论文式方法 {wins}/27 组误差更低，{27-wins} 组不占优</summary>
      <img loading="lazy" width="1500" height="840" src={`${root}${c.id}-cost-error.png`} alt={`${c.name}：全部二次直纹候选与三类线性三角网的文件代价—全域误差曲线`}/>
      <div className="cr-table"><table><caption>{c.name} · {methods[method as keyof typeof methods]} · 预算内已拟合候选中的最低 E₂</caption><thead><tr><th>基线 N</th><th>基线文件</th><th>GUGIS 文件</th><th>基线 E₂</th><th>GUGIS E₂</th><th>E₂ 变化</th></tr></thead>
        <tbody>{report.budgets.map(budget=>{const p=functionPair(c,method,budget);return <tr key={budget} className={p.pair.e2_reduction_percent!<0?'cr-negative-row':budget===n?'cr-selected-row':''}>
          <th>{budget}</th><td>{size(p.baseline.bytes)}</td><td>{size(p.candidate.bytes)}</td><td>{p.baseline.e2_m2.toFixed(6)}</td><td>{p.candidate.e2_m2.toFixed(6)}</td><td>{p.pair.e2_reduction_percent!<0?'增加':'降低'} {pct(p.pair.e2_reduction_percent!)}</td></tr>;})}</tbody></table></div>
    </details>
    <details className="cr-details"><summary>实现、拟合成本与证据下载</summary>
      <p>R(u,v) = (1 − v)B₀(u) + vB₁(u)，B₀、B₁ 为二次 Bézier 边界。每条边界从端点与中点高程插值求三个控制点，中间控制点本身不一定在源曲面上。采用连续矩形网格，相邻面片高程 C⁰ 连续，导数可跳变。</p>
      <p>论文式基线采用逐片线性插值，保持已有 L₂ 选区 / L₁ 选边实现与原误差，不补齐悬挂节点；边界处首个命中面的值可能不同。对照使用解析严格凸曲面，不是论文作者原始数值，也不是真实 DEM 的独立精度验证。</p>
      <p>固定规则搜索两个边界方向，再按单位新增文件字节的平方误差收益加密。当前曲面评估 {c.search.candidate_evaluations} 个候选，搜索记录 {c.search.elapsed_seconds.toFixed(3)} s；保留 {c.candidates.length} 个文件。所选模型需要 {candidate.fit_samples} 个不同拟合点；这不包含候选搜索和积分评估点，不能据此宣称拟合速度或采样总成本更低。基线本档生成记录 {baseline.fit_seconds.toFixed(3)} s，成本口径不同，不作速度胜负结论。</p>
      <p>全域积分针对已保存的模型，采用足阶 Gauss 求积；二次直纹面还给出 Bernstein 系数参考界（Float64，含舍入余量，非区间算术严格认证）。有限搜索不保证全局最优。下方单列高阶三角控制和同精度结构结果；本组曲面仍不是真实地形精度验证。</p>
      <div className="cr-actions"><a download href={`${root}${c.id}.zip`}>当前曲面完整模型 ZIP ↓</a><a download href={`${root}results.json`}>完整研究记录 ↓</a><a download href={`${root}native-audit.json`}>原生查询核验记录 ↓</a><a download href={`${root}${c.id}-cost-error.svg`}>可出版曲线 SVG ↓</a></div>
      <p className="cr-hash">所选 GUGIS 文件 SHA-256：{candidate.sha256}<br/>研究记录 SHA-256：{report.parent_report_sha256}<br/>查询核验 SHA-256：{report.native_audit_sha256}</p>
    </details>
  </section>;
}
