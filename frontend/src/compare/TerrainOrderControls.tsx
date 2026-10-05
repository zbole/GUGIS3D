import {useEffect,useMemo,useState} from 'react';
import report from '../../../shared/terrain-order-control-v1.json';
import {type OrderModel} from './terrainOrderMath';
import {prepareOrderQuery} from './preparedOrderQuery';
import {loadOrderModel} from './loadOrderModel';
import {useComparisonAnchor} from './useComparisonAnchor';
import './TerrainOrderControls.css';
const root='/research/order-controls-v1/';
type Fixture=typeof report.structure_fixtures[number];
function Nodes({model,label}:{model:OrderModel;label:string}){
  const xy=(p:number[])=>[35+(p[0]+50)*2.4,275-(p[1]+50)*2.4];
  return <svg viewBox="0 0 310 310" className="oc-node-diagram" role="img" aria-label={label}>
    <path d="M35 35H275V275H35Z" fill="#f7faf6" stroke="#d2dfd4"/>
    {model.patches[0].kind==='lagrange-triangle'&&<path d="M35 275L275 35" stroke="#c0ced1"/>}
    {model.points.map((p,i)=><g key={i}><circle cx={xy(p)[0]} cy={xy(p)[1]} r="5" fill={model.patches[0].kind==='quadratic-ruled'?'#128979':'#8a97a5'}/><text x={xy(p)[0]+8} y={xy(p)[1]-7}>{i+1}</text></g>)}
    <text x="35" y="300">控制点水平投影 · 100 × 100 m</text>
  </svg>;
}
function StructureDemo({fixture}:{fixture:Fixture}){
  const [models,setModels]=useState<OrderModel[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[x,setX]=useState(13),[y,setY]=useState(-17);
  useEffect(()=>{const controller=new AbortController();setModels(null);setError('');
    Promise.all([fixture.ruled,fixture.triangles].map(e=>loadOrderModel(`${root}${fixture.id}/${e.binary_filename}`,e.binary_bytes,e.binary_sha256,controller.signal)))
      .then(models=>{if(!controller.signal.aborted)setModels(models);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'函数模型读取失败');});
    return()=>controller.abort();
  },[fixture.id,retry]);
  const prepared=useMemo(()=>models?.map(prepareOrderQuery)??null,[models]);
  if(error)return <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>重试结构模型</button></p>;
  if(!models)return <p role="status">正在读取完整二进制文件并核验 SHA-256…</p>;
  const reference=fixture.id==='extruded-quadratic'?30+.002*x*x+.03*y:30+.00002*x*x*(y+60)+.01*y;
  return <div className="oc-demo"><div className="cr-probe-controls"><label>X / m <input type="range" min="-50" max="50" step=".1" aria-label="结构对照查询X" value={x} onChange={e=>setX(Number(e.target.value))}/><output>{x.toFixed(1)}</output></label>
    <label>Y / m <input type="range" min="-50" max="50" step=".1" aria-label="结构对照查询Y" value={y} onChange={e=>setY(Number(e.target.value))}/><output>{y.toFixed(1)}</output></label></div>
    <p className="cr-scope">同点解析参考高程 {reference.toFixed(6)} m · 实际二进制解码后的函数直接求值</p>
    <div className="oc-demo-grid">{models.map((model,i)=>{const q=prepared![i].query(x,y);return <article key={i}><h4>{i?`P${fixture.triangle_degree} 三角插值 · ${model.points.length} 个节点`:'GUGIS 二次直纹面 · 6 个控制点'}</h4>
      <Nodes model={model} label={i?'通用高阶三角插值节点':'两条二次边界的六个控制点'}/>
      <p>{q?`高程 ${q.height.toFixed(9)} m · 高程差 ${Math.abs(q.height-reference).toExponential(2)} m`:'未覆盖查询点'}</p>
      <p>{q?`∂z/∂x ${q.gradient[0].toFixed(6)} · ∂z/∂y ${q.gradient[1].toFixed(6)}`:''}</p></article>;})}</div>
    <p className="cr-scope">Bézier 中间点是形状控制点，Lagrange 节点是源高程插值点；两者含义不同。显示水平布局，实际查询保留所有高度、函数阶数和连接关系。</p>
  </div>;
}
export default function TerrainOrderControls(){
  useComparisonAnchor('order-structure-results');
  const [id,setId]=useState('modulated-quadratic'),[demo,setDemo]=useState(false),[caseId,setCaseId]=useState('anisotropic');
  const fixture=report.structure_fixtures.find(f=>f.id===id)!,c=report.cases.find(c=>c.id===caseId)!;
  const p2Wins=report.cases.flatMap(c=>c.pairs).filter(p=>p.e2_verdict==='p2-lower').length;
  return <section id="order-structure-results" className="oc-results" aria-labelledby="oc-title">
    <div className="cr-heading"><div><span className="cr-eyebrow">结构收益 / 高阶三角方法控制</span><h2 id="oc-title">同一精度门槛，结构本身也能省数据。</h2>
      <p>通用高阶三角函数也保留曲率。对具有直纹结构的两个解析曲面，双方 E₂ 均低于 10⁻⁸ m²；GUGIS 用两条边界曲线保留相同函数，减少当前编码中的控制点和开销。</p></div></div>
    <div className="oc-cards">{report.structure_fixtures.map(f=><button key={f.id} aria-pressed={id===f.id} onClick={()=>setId(f.id)}>
      <span>{f.name} · 对 P{f.triangle_degree} 三角函数</span><strong>{f.binary_saving_percent.toFixed(1)}%<small> 完整二进制文件减少</small></strong>
      <div><b>{f.ruled.binary_bytes} B</b> / {f.triangles.binary_bytes} B · 6 / {f.triangles.controls} 个点</div>
      <span>实际 JSON 小 {f.json_saving_percent.toFixed(1)}% · 数值零误差门槛下对照</span></button>)}</div>
    <p className="oc-boundary">这是预先定义的直纹结构示例，独立于前三个严格凸曲面。在原三曲面的文件预算对照中，P₂ 三角插值在 {p2Wins}/27 组全域 E₂ 更低。GUGIS 的 98.3% 结果对应线性 P₁ 基线，不能推广为优于所有高阶方法。</p>
    <div className="cr-actions"><button aria-expanded={demo} onClick={()=>setDemo(d=>!d)}>{demo?'收起结构与函数对照':'查看控制点结构与同点函数查询'}</button>
      <a download href={`${root}${fixture.id}/${fixture.ruled.binary_filename}`}>GUGIS 二进制模型 ↓</a><a download href={`${root}${fixture.id}/${fixture.triangles.binary_filename}`}>P{fixture.triangle_degree} 二进制模型 ↓</a><a download href={`${root}${fixture.id}.zip`}>所选结构完整证据 ZIP ↓</a></div>
    {demo&&<StructureDemo fixture={fixture}/>}
    <details className="cr-details"><summary>核验阶数影响 · 完整 27 组 P₂ 控制与科学曲线</summary>
      <p>在完全相同的冻结 P₁ 网格上，改用三顶点和三边中点的 P₂ Lagrange 插值；只改变近似阶数，没有重新优化 P₂ 选区／选边。与原 GUGIS 有限候选池按完整 JSON 文件预算对照。这是本项目的阶数敏感性控制，不是论文作者的高阶原始跑分。</p>
      <label className="oc-control">控制曲面<select aria-label="高阶控制测试曲面" value={caseId} onChange={e=>setCaseId(e.target.value)}>{report.cases.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <div className="cr-table"><table><caption>{c.name} · P₂ 模型决定完整 JSON 上限 · 全部九档</caption><thead><tr><th>原网格 N</th><th>P₂ 文件 / B</th><th>GUGIS 文件 / B</th><th>P₂ E₂ / m²</th><th>GUGIS E₂ / m²</th><th>误差结论</th></tr></thead>
        <tbody>{c.pairs.map(p=>{const b=c.p2_models.find(e=>e.filename===p.p2_model)!,a=c.ruled_references.find(e=>e.filename===p.ruled_model)!;return <tr key={p.budget_n}><th>{p.budget_n}</th><td>{b.bytes.toLocaleString()}</td><td>{a.bytes.toLocaleString()}</td><td>{b.e2_m2<1e-8?'数值零误差':b.e2_m2.toFixed(6)}</td><td>{a.e2_m2.toFixed(6)}</td><td>{p.e2_verdict==='p2-lower'?'P₂ 更低':p.e2_verdict==='ruled-lower'?'GUGIS 更低':'数值相当'}</td></tr>;})}</tbody></table></div>
      <img className="oc-science" src={`${root}order-sensitivity.png`} loading="lazy" width="2040" height="680" alt="三个固定曲面的高阶敏感性控制；数值零误差仅在科学图上按 E₂ 等于 10 的负八次方的显示下限绘制"/>
      <a download href={`${root}order-pairs.csv`}>全部高阶控制 CSV ↓</a>
    </details>
    <details className="cr-details"><summary>同精度结构收益的实现与完整文件定义</summary>
      <p>示例一 f(x,y)=30+0.002x²+0.03y，二次三角空间 P₂ 与二次边界直纹面均可表达。示例二 f(x,y)=30+0.00002x²(y+60)+0.01y，总次数为三；使用完整三次三角空间 P₃ 控制，避免把三次源函数与二次三角空间的阶数差误作结构收益。两个示例不属于严格凸曲面的论文定理范围。</p>
      <p>两条二次边界各三个控制点，共六个。覆盖同一方域的两个 P₂ 三角面共享节点后为九个；两个 P₃ 三角面为十六个。所有坐标为 Float64；三分点经规范有理构造再转换，重复节点共享，不能人为复制顶点抬高基线成本。</p>
      <p>GOC2 为明确的研究编码：16 B 公共头、完整 Float64 XYZ 数组，每面片 12 B 类型／阶数／节点数头及 Uint32 索引。196 / 304 / 504 B 均为实际下载文件总长度，包括这些开销；不是内存估算，也不是 ArcGIS 软件测量。</p>
      <p>保存的模型用足阶全域求积复核。86 组 JSON／二进制模型在 352,256 个固定模型—查询点组合上检查，解码后两种编码查询完全一致；两种结构示例的解析导数也与源函数一致。抽查最大差没有冒充连续误差界。新编码限研究用途，正式城市档案未替换。</p>
      <img className="oc-science" src={`${root}structure-cost.png`} loading="lazy" width="1700" height="714" alt="两个数值零误差结构示例的完整 GOC2 文件字节，GUGIS 为 196 B，二次及三次三角分别为 304 和 504 B"/>
      <div className="cr-actions"><a download href={`${root}results.json`}>完整定义与误差记录 ↓</a><a download href={`${root}native-audit.json`}>JSON／二进制查询核验 ↓</a><a download href={`${root}structure-cost.svg`}>结构收益科学图 SVG ↓</a><a download href={`${root}${c.id}.zip`}>所选高阶控制完整 ZIP ↓</a></div>
      <p className="cr-hash">所选 GUGIS 二进制 SHA-256：{fixture.ruled.binary_sha256}<br/>完整研究记录 SHA-256：{report.parent_report_sha256}</p>
    </details>
  </section>;
}
