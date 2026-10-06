import {useEffect,useId,useMemo,useState} from 'react';
import report from '../../../shared/principal-ruled-display-v1.json';
import {preparePrincipalQuery,type PrincipalModel} from './principalRuledMath';
import {loadPrincipalModel} from './loadPrincipalModel';
import {useComparisonAnchor} from './useComparisonAnchor';
import './PrincipalDirectionResults.css';
const base='/research/principal-ruled-v1/';
type Case=typeof report.cases[number];type Pair=Case['pairs'][number];
const percent=(a:number,b:number)=>{const v=100*(1-a/b);return Math.abs(v)<1e-8?0:v;},scientific=(v:number)=>v.toExponential(3);
function StructureDemo({item,pair}:{item:Case;pair:Pair}){
  const [showP2,setShowP2]=useState(false),[models,setModels]=useState<PrincipalModel[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[x,setX]=useState(13),[y,setY]=useState(-17),svgId=useId();
  const descriptors=[pair.p1,pair.principal,...(showP2?[item.p2_control]:[])];
  useEffect(()=>{const abort=new AbortController();setModels(null);setError('');
    Promise.all(descriptors.map(m=>loadPrincipalModel(`${base}${item.id}/${m.binary_filename}`,m.binary_bytes,m.binary_sha256,abort.signal))).then(v=>{if(!abort.signal.aborted)setModels(v);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'模型加载失败');});return()=>abort.abort();
  },[item.id,pair.budget,showP2,retry]);
  const functions=useMemo(()=>models?.map(preparePrincipalQuery)??null,[models]);
  if(error)return <p role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>重试方向模型</button></p>;
  if(!models||!functions)return <p role="status">正在核验完整 GPR3 文件、高程节点与覆盖矩形…</p>;
  const q=item.q_matrix,z=30+x*(q[0][0]*x+q[0][1]*y)+y*(q[1][0]*x+q[1][1]*y),map=(a:number,b:number)=>`${25+3.3*(a+50)},${355-3.3*(b+50)}`;
  return <div className="pr-demo">
    <div className="pr-query-controls">{(['X','Y'] as const).map((name,i)=><label key={name}>同点 {name} / m <input type="range" aria-label={`方向面带查询${name}`} min="-49.9" max="49.9" step=".1" value={i?y:x} onChange={e=>(i?setY:setX)(Number(e.target.value))}/><output>{(i?y:x).toFixed(1)}</output></label>)}<button aria-expanded={showP2} onClick={()=>setShowP2(v=>!v)}>{showP2?'收起 P2 高阶控制':'载入 P2 高阶控制'}</button></div>
    <div className={`pr-structures ${showP2?'pr-three':''}`}>{models.map((m,i)=>{
      let paths='';for(const p of m.patches)if(p.kind==='quadratic-ruled'){for(const ids of [p.left,p.right])paths+=ids.map((n,j)=>`${j?'L':'M'}${map(m.points[n][0],m.points[n][1])}`).join('');}else{const faces=p.kind==='lagrange-triangle'?[[p.indices[0],p.indices[3],p.indices[5]]]:Array.from({length:p.indices.length-2},(_,j)=>p.indices.slice(j,j+3));for(const ids of faces)paths+=ids.map((n,j)=>`${j?'L':'M'}${map(m.points[n][0],m.points[n][1])}`).join('')+'Z';}
      const result=functions[i].query(x,y),clip=`${svgId}-${i}`;return <article key={i}><h3>{['论文式 P1 三角带','主方向 GUGIS 面带','P2 高阶三角控制'][i]}</h3><p>{descriptors[i].binary_bytes.toLocaleString()} B · {m.points.length} 个共享点 · {functions[i].primitives} 个原生面</p>
        <svg viewBox="0 0 380 385" role="img" aria-label={['论文式P1实际三角结构水平投影','主曲率方向实际直纹面带水平投影','P2高阶控制实际三角结构水平投影'][i]}><defs><clipPath id={clip}><rect x="25" y="25" width="330" height="330"/></clipPath></defs><rect x="25" y="25" width="330" height="330" fill="#f6f9f5" stroke="#d6e3d8"/><path d={paths} clipPath={`url(#${clip})`} fill="none" stroke={['#628198','#238c76','#b79b68'][i]} strokeWidth={i===2?1.2:.45}/><circle cx={25+3.3*(x+50)} cy={355-3.3*(y+50)} r="4" fill="#d66b54" stroke="white" strokeWidth="1.5"/><text x="25" y="376">XY 投影 · 同一 100 × 100 m 覆盖域</text></svg>
        <p className="pr-point">{result?<>Z {result.height.toFixed(9)} m<br/>同点 Δz {Number((1000*(result.height-z)).toFixed(6)).toFixed(6)} mm<br/>坡度 {(Math.atan(Math.hypot(...result.gradient))*180/Math.PI).toFixed(6)}°</>:'未覆盖此查询点'}</p>
      </article>;
    })}</div><p>图中显示下载模型的全部水平结构，并裁剪到相同物理范围。二次边界的高程和坡度由完整文件的原生函数计算；旋转网格在范围之外的控制点也计入文件代价。论文式三角细化未增加 C₀ 闭合，公共边界取索引最小的命中面。</p>
  </div>;
}
export default function PrincipalDirectionResults(){
  useComparisonAnchor('principal-direction-results');
  const [angle,setAngle]=useState(30),[budget,setBudget]=useState(2048),[demo,setDemo]=useState(false),item=report.cases.find(c=>c.angle_degrees===angle)!,pair=item.pairs.find(p=>p.budget===budget)!,a=pair.p1,b=pair.principal;
  const all=report.cases.flatMap(c=>c.pairs),wins=all.filter(p=>p.principal.e2_m2<p.p1.e2_m2).length,improve=percent(b.e2_m2,a.e2_m2),saving=percent(b.binary_bytes,a.binary_bytes);
  return <section id="principal-direction-results" className="pr-results" aria-labelledby="pr-title">
    <div className="cr-heading"><div><span className="cr-eyebrow">曲率方向适配 / 同域 / 双重预算</span><h2 id="pr-title">让面带顺着地形曲率走。</h2><p>七个预先固定的旋转方向、九档预算，{wins} / {all.length} 组取得更低全域误差。新面带支持旋转的平行四边形投影，依据解析 Hessian 主方向组织二次边界。</p></div><div className="pr-selects"><label>曲率方向<select aria-label="主曲率方向角度" value={angle} onChange={e=>setAngle(Number(e.target.value))}>{report.angles_degrees.map(v=><option key={v} value={v}>{v}°</option>)}</select></label><label>论文式 P1 面数预算<select aria-label="方向对照面数预算" value={budget} onChange={e=>setBudget(Number(e.target.value))}>{report.budgets.map(v=><option key={v} value={v}>N = {v.toLocaleString()}</option>)}</select></label></div></div>
    <div className="pr-metrics"><article><span>相对论文式 P1 · E₂ 降低</span><strong>{improve.toFixed(2)}<small>%</small></strong><p>{scientific(b.e2_m2)} / {scientific(a.e2_m2)} m² · GUGIS / P1</p></article><article><span>完整同格式二进制文件减少</span><strong>{saving.toFixed(1)}<small>%</small></strong><p>{b.binary_bytes.toLocaleString()} / {a.binary_bytes.toLocaleString()} B · GUGIS / P1</p></article><article><span>相对固定坐标轴面带 · E₂ 降低</span><strong>{percent(b.e2_m2,pair.world.e2_m2).toFixed(2)}<small>%</small></strong><p>{b.patches.toLocaleString()} 个方向面带 · 同时满足 N 与文件预算</p></article></div>
    <div className="pr-control"><span>P2 高阶控制</span><p>相同二次地形可由 <strong>2 个 P2 三角面、9 个共享点、336 B</strong> 精确表示，全域 E₂ &lt; 10⁻⁸ m²。本节优势成立于论文式顶点 P1 基线；不声称优于通用 P2 三角函数。</p><a download href={`${base}${item.id}/${item.p2_control.binary_filename}`}>当前 P2 完整模型 ↓</a></div>
    <p className="pr-scope">固定严格凸解析二次曲面，曲率比 100:1；主方向来自精确的常数 Hessian。本节比较 P2×P1 函数面带与顶点 P1 插值，属于表示阶次与方向组织的改进，不是新的 P1 最优性定理、真实 DTM 通用优势、论文作者软件或 ArcGIS 实测。</p>
    <div className="cr-actions"><button aria-label="展开方向结构与同点查询" aria-expanded={demo} onClick={()=>setDemo(v=>!v)}>{demo?'收起方向结构与同点查询':'查看方向结构与同点查询'}</button><a download href={`${base}${item.id}/${b.binary_filename}`}>当前 GUGIS 方向模型 ↓</a><a download href={`${base}${item.id}/${a.binary_filename}`}>当前论文式 P1 模型 ↓</a><a download href={`${base}${report.package.filename}`}>完整七方向证据 ZIP ↓</a></div>
    {demo&&<StructureDemo item={item} pair={pair}/>}
    <details className="cr-details"><summary>七个固定方向在当前预算下的完整结果</summary><div className="cr-table"><table><caption>N = {budget.toLocaleString()} · 双方覆盖同一 10,000 m² · 纳入全部方向</caption><thead><tr><th>角度</th><th>GUGIS / P1 全域 E₂ m²</th><th>E₂ 降低</th><th>GUGIS / P1 完整文件 B</th><th>文件减少</th></tr></thead><tbody>{report.cases.map(c=>{const p=c.pairs.find(p=>p.budget===budget)!;return <tr key={c.id}><th>{c.angle_degrees}°</th><td>{scientific(p.principal.e2_m2)} / {scientific(p.p1.e2_m2)}</td><td>{percent(p.principal.e2_m2,p.p1.e2_m2).toFixed(2)}%</td><td>{p.principal.binary_bytes.toLocaleString()} / {p.p1.binary_bytes.toLocaleString()}</td><td>{percent(p.principal.binary_bytes,p.p1.binary_bytes).toFixed(1)}%</td></tr>;})}</tbody></table></div><p>预算很小时完整文件可能一样大；方向与坐标轴一致时，方向适配没有额外误差收益。两种情况都保留在表中。</p><img src={`${base}principal-direction-results.svg`} loading="lazy" width="1000" height="650" alt="全部七个旋转方向在N等于2048时的全域E2及完整文件比较，同时注明336字节的精确P2高阶控制"/></details>
    <details className="cr-details"><summary>全域积分、原生核验与复现实验条件</summary><p>每个方向检查 36 个固定候选：两个世界坐标轴方向和一个主曲率方向，每种采用 1–2,048 条面带的 12 档密度。主方向由 Q 的特征向量计算。选择同时满足 P1 完整文件字节数和 N 面数预算的最小全域 E₂ 候选；这是有限候选池，不是全局最优面带证明。</p><p>双方完整 GPR3 文件保留 Float64 XYZ 点池、12 B 原生面记录以及包含裁剪矩形的相同 48 B 头部。旋转网格超出方形的全部控制点也计入文件。面带与方形求交后逐片作完整多项式积分；发布时另用五阶求积复核，并重新积分已保存 P1 三角带。原生 TypeScript 对全部 174 个 JSON / 二进制模型执行 712,704 次内部高程与梯度查询，另核验四个覆盖角点、越界拒绝及面带最大误差见证点。</p><p>P1 采用论文式 L₂ 贪心与 L₁ 选边，未添加一致细化闭合。P2 控制由两个共享节点的 Lagrange 三角形表示全局二次函数。误差积分、系数界和数值余量均为 Float64 计算，不是区间算术证明。此试验没有测量查询耗时、GPU 帧率或运行内存。</p><div className="cr-actions"><a download href={`${base}pairs.csv`}>全部 63 组结果 CSV ↓</a><a download href={`${base}results.json`}>全部候选与对照记录 ↓</a><a download href={`${base}native-audit.json`}>全部原生函数审计 ↓</a><a download href={`${base}principal-direction-results.svg`}>科学图 SVG ↓</a></div><p className="cr-hash">完整记录 SHA-256：{report.report_sha256}<br/>证据 ZIP SHA-256：{report.package.sha256}</p></details>
  </section>;
}
