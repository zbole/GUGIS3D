import TerrainEvidenceOverview from './TerrainEvidenceOverview';
import {useState,useEffect} from 'react';
import report from '../../../shared/paper-terrain-metrics.json';
import cityReport from '../../../shared/bristol-global-l2.json';
import BristolIntegralDecision from './BristolIntegralDecision';
import BristolArcGISRun from './BristolArcGISRun';
import MultiCityTerrainResults from './MultiCityTerrainResults';
import {currentTerrainResultLink,rememberTerrainResult,type TerrainResultScope} from './terrainResultLink';
import './PaperTerrainResults.css';
import {useComparisonAnchor} from './useComparisonAnchor';

type Metric = 'e2_m2'|'linf_m'|'rho_median';
const formats = {e2_m2:{name:'全局 E₂',unit:'m²'},linf_m:{name:'连续最大误差 E∞',unit:'m'},rho_median:{name:'形状 ρQ 中位数',unit:'无量纲'}};
const colors = ['#087f79','#bd7626','#71839a'];

function ErrorChart({caseData,metric,budget}:{caseData:typeof report.cases[number];metric:Metric;budget:number}){
  const rows=caseData.methods.flatMap(m=>m.rows),values=rows.map(r=>r[metric]);
  const low=Math.log10(Math.min(...values))-.15,high=Math.log10(Math.max(...values))+.15;
  const x=(n:number)=>64+Math.log2(n/8)/8*610;
  const y=(value:number)=>226-(Math.log10(value)-low)/(high-low)*182;
  const ticks=Array.from({length:5},(_,i)=>10**(low+(high-low)*i/4));
  return <svg className="paper-chart" viewBox="0 0 720 280" role="img" aria-label={`${caseData.name}，${formats[metric].name}与三角形数量 N 的双对数曲线；三种方法，越低越好`}>
    {ticks.map(v=><g key={v}><line x1="64" x2="674" y1={y(v)} y2={y(v)} stroke="#e5eae8"/><text x="56" y={y(v)+4} textAnchor="end">{v.toPrecision(2)}</text></g>)}
    {report.budgets.map(n=><g key={n}><text x={x(n)} y="247" textAnchor="middle">{n}</text></g>)}
    <line x1={x(budget)} x2={x(budget)} y1="38" y2="227" stroke="#b7c5c0" strokeDasharray="4 5"/>
    {caseData.methods.map((m,i)=><g key={m.id}><polyline points={m.rows.map(r=>`${x(r.triangles)},${y(r[metric])}`).join(' ')} fill="none" stroke={colors[i]} strokeWidth={i===2?1.6:2.6} strokeDasharray={i===2?'4 5':undefined}/>{m.rows.map(r=><circle key={r.triangles} cx={x(r.triangles)} cy={y(r[metric])} r={r.triangles===budget?5:3} fill={colors[i]}><title>{m.name} · N={r.triangles} · {r[metric].toPrecision(6)} {formats[metric].unit}</title></circle>)}</g>)}
    <text x="64" y="21">{formats[metric].name} / {formats[metric].unit} · 越低越好</text><text x="674" y="273" textAnchor="end">三角形数量 N · 对数轴</text>
  </svg>;
}

export default function PaperTerrainResults(){
  useComparisonAnchor('paper-results');
  const [caseId,setCaseId]=useState('anisotropic'),[budget,setBudget]=useState(2048),[metric,setMetric]=useState<Metric>('e2_m2');
  const caseData=report.cases.find(c=>c.id===caseId)!;
  const selected=caseData.methods.map(m=>({method:m,row:m.rows.find(r=>r.triangles===budget)!}));
  const reduction=100*(1-selected[0].row.e2_m2/selected[1].row.e2_m2);
  const better=reduction>1e-8;
  const selectionReduction=100*(1-selected[1].row.e2_m2/selected[2].row.e2_m2);
  const variable=caseId==='variable_curvature';
  return <section className="paper-results" id="paper-results" aria-labelledby="paper-results-title">
    <div className="paper-heading"><div><span className="paper-eyebrow">论文方法复现 / 线性三角网内部对照</span><h2 id="paper-results-title">论文选边的收益，单独核验。</h2><p>固定曲面、相同三角形预算。把选边规则的影响，从文件格式和城市功能中分离出来。</p></div><a href={report.paper} target="_blank" rel="noreferrer">Mirebeau & Cohen · 原论文 ↗</a></div>
    <div className="paper-controls"><label>测试曲面<select aria-label="论文指标测试曲面" value={caseId} onChange={e=>setCaseId(e.target.value)}>{report.cases.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>相同三角形预算 N<select aria-label="论文指标三角形预算" value={budget} onChange={e=>setBudget(Number(e.target.value))}>{report.budgets.map(n=><option key={n} value={n}>{n.toLocaleString()}</option>)}</select></label><label>曲线指标<select aria-label="论文指标曲线" value={metric} onChange={e=>setMetric(e.target.value as Metric)}>{Object.entries(formats).map(([key,v])=><option key={key} value={key}>{v.name}</option>)}</select></label></div>
    <div className="paper-main"><article className="paper-finding" aria-live="polite"><span>同 N · 论文式选边 vs 欧氏最长边</span><strong>{better?`${reduction.toFixed(1)}%`:'无误差收益'}</strong><p>{better?'全局 E₂ 降低':'此曲面下两种方法的 E₂ 相同。'}{better&&<><br/>RMS 高程误差 <b>{(selected[0].row.rms_m*1000).toFixed(3)} mm</b> / <b>{(selected[1].row.rms_m*1000).toFixed(3)} mm</b></>}{variable&&<><br/>仅改变细分选区：{selectionReduction>1e-8?`E₂ 降低 ${selectionReduction.toFixed(1)}%`:'无 E₂ 收益'}<br/>欧氏选边保持一致，对照均匀细分</>}</p><small>本项目新运行的解析曲面实验；不是论文原始跑分，也不是 ArcGIS 软件性能。</small></article><div className="paper-curve"><ErrorChart caseData={caseData} metric={metric} budget={budget}/><div className="paper-legend">{caseData.methods.map((m,i)=><span key={m.id}><i style={{background:colors[i]}}/>{m.name}</span>)}</div></div></div>
    <div className="paper-table-scroll"><table><caption>{caseData.name} · N = {budget.toLocaleString()} · 所有方法与结果</caption><thead><tr><th>方法</th><th>E₁ / m³</th><th>E₂ / m²</th><th>E∞ / m</th><th>ρQ 中位数</th><th>σQ 中位数</th><th>观测 E₂ 斜率</th></tr></thead><tbody>{selected.map(({method,row},i)=><tr key={method.id} className={i===0?'paper-primary-row':''}><th scope="row">{method.name}</th><td>{row.e1_m3.toPrecision(5)}</td><td>{row.e2_m2.toPrecision(5)}</td><td>{row.linf_m.toPrecision(5)}</td><td>{row.rho_median.toFixed(3)}</td><td>{row.sigma_median.toFixed(3)}</td><td>{method.observed_e2_slope.toFixed(3)}</td></tr>)}</tbody></table></div>
    <p className="paper-scope">N 是实际三角形数，不是控制点或三角带记录数。E₂ 是全域积分范数；RMS = E₂ / √面积。末四档（256–2,048）斜率为有限实验观测，不能证明渐近最优。ρQ / σQ 为 Hessian 度量下的形状指标，越小越好；不是欧氏长宽比。{variable?'变曲率曲面的形状采用三角形重心处 Q = Hessian / 2，不能视为全三角形的恒定曲率。':'此常曲率实验在所列预算下，两种欧氏方法结果重合。'}</p>
    <details className="paper-method"><summary>实验定义、实际网格与完整指标</summary><p>域为 100 × 100 m。前两类 f(x) = 30 + xᵀQx，Q 严格正定；变曲率曲面 f = 30 + 0.0001(x²+y²) + 5×10⁻⁷x⁴ + 8×10⁻⁸y⁴，全域严格凸。顶点线性插值；L₂ 局部误差选待细分三角形，L₁ 子三角插值误差决定边（论文式方法）。欧氏方法只替换选边；均匀方法先选最大面积，再二分欧氏最长边。二分不强制相容闭合，工程城市模型的 C0 接缝处理是另一项约束。</p><p>二次曲面用闭式积分，四次曲面用满足多项式次数的 5 × 5 Gauss / Duffy 积分；极值检查内部驻点与全部边界驻点，float64 计算。未用稀疏抽样替代 E∞。完整 CSV 含局部 L₂ 误差变异系数、ρQ P95、σQ 最大值和 N·E₂。此实验覆盖三类严格凸解析曲面，真实 DTM 未沿用理论假设。</p><img src={`/research/paper-metrics/${caseId}-meshes.png`} loading="lazy" alt={`${caseData.name}三种方法实际生成的2,048个三角形网格，论文式方法适应曲率方向`}/><div className="paper-downloads">{caseData.methods.map(m=><a key={m.id} href={`/research/paper-metrics/${m.mesh_filename}`} download>{m.name}网格 JSON</a>)}</div></details>
    <div className="paper-downloads"><a href="/research/paper-metrics/results.csv" download>全部 81 组结果 CSV ↓</a><a href="/research/paper-metrics/results.json" download>定义与校验 JSON ↓</a><a href={`/research/paper-metrics/${caseId}-curves.svg`} download>科学曲线 SVG ↓</a></div>
  </section>;
}

const realNames={global_compact:'原全局紧凑混合',local_triangles:'局部三角带',local_compact:'新局部紧凑混合'};

export function RealTerrainResultSummary({target:externalTarget,onTargetChange}:{target?:number;onTargetChange?:(target:number)=>void}={}){
  const [localTarget,setLocalTarget]=useState(()=>currentTerrainResultLink().target);
  const [scope,setScope]=useState<TerrainResultScope>(()=>currentTerrainResultLink().scope);
  const [restoration,setRestoration]=useState(0);
  const target=externalTarget??localTarget,setTarget=onTargetChange??setLocalTarget;
  useEffect(()=>{
    if(typeof window==='undefined')return;
    const update=()=>{const next=currentTerrainResultLink();setScope(next.scope);setTarget(next.target);setRestoration(n=>n+1);};
    window.addEventListener?.('hashchange',update);window.addEventListener?.('popstate',update);
    return()=>{window.removeEventListener?.('hashchange',update);window.removeEventListener?.('popstate',update);};
  },[setTarget]);
  const changeTarget=(next:number)=>{setTarget(next);const link=currentTerrainResultLink();rememberTerrainResult({scope,target:next,site:link.scope===scope?link.site:null});};
  const changeScope=(next:TerrainResultScope)=>{setScope(next);rememberTerrainResult({scope:next,target,site:null});};
  useEffect(()=>{if(scope!=='bristol'&&typeof document!=='undefined'&&window.location?.hash===`#${scope}-terrain-results`)document.getElementById(`${scope}-terrain-results`)?.scrollIntoView({block:'start'});},[scope]);
  const rows=cityReport.models.filter(m=>m.target_m===target);
  const cases=rows.filter(m=>m.family==='local_compact').map(mixed=>({mixed,tri:rows.find(m=>m.case_id===mixed.case_id&&m.family==='local_triangles')!}));
  return <section className="paper-city" id="real-terrain-results" aria-label="真实地形对比结果">
    <TerrainEvidenceOverview target={target} onSelect={changeScope}/>
    <div className="multicity-tabs" role="group" aria-label="真实地形对标范围"><button type="button" aria-pressed={scope==='bristol'} onClick={()=>changeScope('bristol')}>布里斯托原始样区</button><button type="button" aria-pressed={scope==='multicity'} onClick={()=>changeScope('multicity')}>新增跨城 · 6 个样区</button><button type="button" aria-pressed={scope==='oxford'} onClick={()=>changeScope('oxford')}>牛津 · 2 个样区</button><button type="button" aria-pressed={scope==='cambridge'} onClick={()=>changeScope('cambridge')}>剑桥 · 2 个样区</button><button type="button" aria-pressed={scope==='liverpool'} onClick={()=>changeScope('liverpool')}>利物浦 · 2 个样区</button><button type="button" aria-pressed={scope==='sheffield'} onClick={()=>changeScope('sheffield')}>谢菲尔德 · 2 个样区</button><button type="button" aria-pressed={scope==='leeds'} onClick={()=>changeScope('leeds')}>利兹 · 2 个样区</button><button type="button" aria-pressed={scope==='nottingham'} onClick={()=>changeScope('nottingham')}>诺丁汉 · 2 个样区</button><button type="button" aria-pressed={scope==='newcastle'} onClick={()=>changeScope('newcastle')}>纽卡斯尔 · 2 个样区</button></div>
    {scope!=='bristol'?<MultiCityTerrainResults key={`${scope}-${restoration}`} dataset={scope} target={target} onTargetChange={changeTarget}/>:<div id="bristol-terrain-results">
    <div className="paper-heading"><div><span className="paper-eyebrow">02 / 真实城市 · 全域积分与表示代价</span><h2 id="real-terrain-results-title">优势随地形而变。</h2><p>布里斯托 1 m 源 DTM，两个预先固定的 64 × 64 m 样区。全域 E₂ 与最大参考界一起核对。</p></div><a href="#bristol-terrain-benchmark">展开完整实测与三维对照 ↓</a></div>
    <div className="paper-controls"><label>同一最大参考误差目标<select aria-label="真实地形结果误差目标" value={target} onChange={e=>changeTarget(Number(e.target.value))}>{[.1,.25,.5].map(t=><option key={t} value={t}>{t*100} cm</option>)}</select></label><span className="paper-scope">积分覆盖每个样区的全部 4,096 m²；不以抽查 RMSE 代替。</span></div>
    <div className="paper-city-grid">{cases.map(({mixed,tri})=>{const gain=100*(1-mixed.bytes/tri.bytes);return <article key={mixed.case_id} className={gain<0?'paper-city-negative':''}><span>{mixed.case_name} · 局部紧凑混合 vs 局部三角带</span><strong>{gain>0?`小 ${gain.toFixed(1)}%`:`大 ${(-gain).toFixed(1)}%`}</strong><p>{(mixed.bytes/1000).toFixed(2)} kB / {(tri.bytes/1000).toFixed(2)} kB<br/>全域 E₂ <b>{mixed.e2_m2.toFixed(4)} / {tri.e2_m2.toFixed(4)} m²</b><br/>全域 RMS {(mixed.rms_integral_m*100).toFixed(3)} / {(tri.rms_integral_m*100).toFixed(3)} cm</p><small>{gain>0?'混合面带在此样区减少文件体积。':'局部三角带在此样区更省，应保留为候选。'}</small></article>;})}</div>
    <div className="paper-table-scroll"><table><caption>同一目标 {target*100} cm · 三类实际档案与完整域积分</caption><thead><tr><th>样区 / 表示</th><th>文件 / kB</th><th>实际三角形</th><th>直纹四边形</th><th>全域 E₂ / m²</th><th>最大参考界 / cm</th></tr></thead><tbody>{rows.map(m=><tr key={`${m.case_id}/${m.family}`}><th scope="row">{m.case_name} / {realNames[m.family as keyof typeof realNames]}</th><td>{(m.bytes/1000).toFixed(2)}</td><td>{m.native_triangles.toLocaleString()}</td><td>{m.ruled_quads.toLocaleString()}</td><td>{m.e2_m2.toFixed(5)}</td><td>{(m.continuous_bound_m*100).toFixed(3)}</td></tr>)}</tbody></table></div>
    <p className="paper-scope">两类模型均达同一最大参考界目标，但几何与 RMSE 不完全相同；这是工程表示选择结果。混合模型含直纹四边形，不能把面片总数冒充论文的三角形 N。ArcGIS 兼容 MultiPatch 的同几何格式结果在下方展开，ArcGIS 软件实测仍待完成。</p>
    <BristolIntegralDecision/>
    <BristolArcGISRun target={target}/>
    <details className="paper-method"><summary>全域 E₂ 的计算依据与精度—体积曲线</summary><p>每个原生三角形或直纹区段与所跨越的源栅格单元求交，比较模型与源双线性参考面。残差平方在每个交域是至多四次多项式；3 × 3 Gauss / Duffy 积分计算全域平方误差（float64）。包括实际保存的高程舍入，未把混合面先离散再测。源 DTM 参考面不是独立真实地面精度。</p><img src="/research/bristol-global-l2/error-cost.png" loading="lazy" alt="两个布里斯托样区的全域E2与未压缩文件体积曲线，包含三种表示和三个误差目标，显示不同样区的收益与代价"/></details>
    <div className="paper-downloads"><a href="/research/bristol-global-l2/results.csv" download>真实地形 18 组全域指标 CSV ↓</a><a href="/research/bristol-global-l2/results.json" download>模型指纹与积分回执 JSON ↓</a><a href="/research/bristol-global-l2/error-cost.svg" download>全域误差—体积科学图 SVG ↓</a></div>
    </div>}
  </section>;
}
