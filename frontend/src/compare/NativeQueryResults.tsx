import {useEffect,useMemo,useState} from 'react';
import report from '../../../shared/native-query-performance-v1.json';
import {type OrderModel} from './terrainOrderMath';
import {prepareOrderQuery} from './preparedOrderQuery';
import {loadOrderModel} from './loadOrderModel';
import {useComparisonAnchor} from './useComparisonAnchor';
import './NativeQueryResults.css';
const base='/research/native-query-v1/';
type Case=typeof report.cases[number];
function NativeDemo({item}:{item:Case}){
  const [models,setModels]=useState<OrderModel[]|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[x,setX]=useState(13);
  useEffect(()=>{const abort=new AbortController();setModels(null);setError('');
    Promise.all(item.methods.map(m=>loadOrderModel(`${base}${item.id}/${m.binary_filename}`,m.binary_bytes,m.binary_sha256,abort.signal)))
      .then(v=>{if(!abort.signal.aborted)setModels(v);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'模型读取失败');});
    return()=>abort.abort();
  },[item.id,retry]);
  const functions=useMemo(()=>models?.map(prepareOrderQuery)??null,[models]);
  const profiles=useMemo(()=>functions?.map(f=>[-50,0,50].map(y=>Array.from({length:513},(_,j)=>f.query(-50+j*100/512,y)!.height)))??null,[functions]);
  if(error)return <p role="alert">{error} <button onClick={()=>setRetry(r=>r+1)}>重试面带模型</button></p>;
  if(!models||!functions||!profiles)return <p role="status">正在核验双方完整 GOC2 文件与 SHA-256…</p>;
  const zs=profiles.flat(2),low=Math.min(...zs),high=Math.max(...zs),scale=145/Math.max(high-low,1e-6);
  return <div className="nq-demo"><label>同点高程与梯度 · X / m <input aria-label="面带规模查询X" type="range" min="-49.9" max="49.9" step=".1" value={x} onChange={e=>setX(Number(e.target.value))}/><output>{x.toFixed(1)}</output></label>
    <div className="nq-models">{models.map((model,i)=>{const q=functions[i].query(x,-17);return <article key={i}>
      <h3>{i?`P${item.triangle_degree} 三角函数`:'GUGIS 直纹面带'} <span>{model.points.length} 个共享点 · {model.patches.length} 面片</span></h3>
      <svg viewBox="0 0 520 225" role="img" aria-label={i?'原生三角插值剖面':'原生直纹函数剖面'}>
        <path d="M30 25V185H500" fill="none" stroke="#c3d3cd"/>
        {[-50,0,50].map((y,k)=>{const path=profiles[i][k].map((z,j)=>`${j?'L':'M'}${30+j*470/512},${175-(z-low)*scale}`).join('');return <path key={y} d={path} stroke={['#afc7ba','#228570','#cc9959'][k]} strokeWidth="1.8" fill="none"/>;})}
        <text x="36" y="18">Z: {low.toFixed(4)} → {high.toFixed(4)} m · 双方共用坐标比例</text>
        <text x="30" y="211">X: −50 → 50 m · Y: −50 / 0 / 50 m · 垂直方向缩放展示</text>
      </svg>
      <p>{q?`Y = −17 m · Z ${q.height.toFixed(9)} m · ∂z/∂x ${q.gradient[0].toFixed(6)} · ∂z/∂y ${q.gradient[1].toFixed(6)}`:'未覆盖查询位置'}</p>
    </article>;})}</div>
    <p>曲线由下载模型的原生函数查询绘制。分段交界处高程连续，梯度取面片索引最小的命中面；CPU 测试使用内部点。双方共用高程范围，剖面绘图比例不改变计算高程。</p>
  </div>;
}
export default function NativeQueryResults(){
  useComparisonAnchor('native-query-results');
  const [id,setId]=useState('piecewise-128'),[demo,setDemo]=useState(false);
  const item=report.cases.find(c=>c.id===id)!,[a,b]=item.methods,ratio=item.ruled_vs_prepared_triangle_median_ratio;
  return <section id="native-query-results" className="nq-results" aria-labelledby="nq-title">
    <div className="cr-heading"><div><span className="cr-eyebrow">同函数 / 同精度 / 同机查询</span><h2 id="nq-title">结构更紧凑，原生查询也更快。</h2><p>从一条直纹面到 128 条连续面带，五组固定解析结构都保留同一函数。双方预计算系数并采用相同空间索引策略，再交替执行高程与梯度查询。</p></div>
      <label className="nq-choice">选择规模<select aria-label="原生查询对照规模" value={id} onChange={e=>setId(e.target.value)}>{report.cases.map(c=><option key={c.id} value={c.id}>{c.name} · P{c.triangle_degree}</option>)}</select></label></div>
    <div className="nq-metrics"><article><span>完整二进制文件减少</span><strong>{item.binary_saving_percent.toFixed(1)}<small>%</small></strong><p>{a.binary_bytes.toLocaleString()} / {b.binary_bytes.toLocaleString()} B · GUGIS / P{item.triangle_degree}</p></article>
      <article><span>本机查询中位数速度比</span><strong>{ratio.toFixed(2)}<small>×</small></strong><p>{a.prepared_ns_per_query.median.toFixed(1)} / {b.prepared_ns_per_query.median.toFixed(1)} ns · GUGIS / P{item.triangle_degree}</p></article>
      <article><span>同函数精度门槛</span><strong>E₂ <small>&lt; 10⁻⁸ m²</small></strong><p>{a.controls.toLocaleString()} / {b.controls.toLocaleString()} 个共享控制点 · 全域求积复核</p></article></div>
    <p className="nq-scope">这是五组预先固定的解析结构示例，其中多条面带为 C₀ 分段曲面，不是论文严格凸 C² 地形或真实城市。速度比 = 三角法中位数 / GUGIS 中位数，来自本机 Node CPU；文件大小不是运行内存，查询计时不是 ArcGIS 软件或 GPU 帧率。</p>
    <div className="cr-actions"><button aria-label="展开面带函数演示" aria-expanded={demo} onClick={()=>setDemo(v=>!v)}>{demo?'收起面带函数与同点查询':'查看面带函数与同点查询'}</button>
      <a download href={`${base}${item.id}/${a.binary_filename}`}>当前 GUGIS 函数模型 ↓</a><a download href={`${base}${item.id}/${b.binary_filename}`}>当前 P{item.triangle_degree} 模型 ↓</a><a download href={`${base}${report.package.filename}`}>全部五组证据 ZIP ↓</a></div>
    {demo&&<NativeDemo item={item}/>}
    <details className="cr-details"><summary>全部五组速度、波动范围与文件结果</summary><div className="cr-table"><table><caption>17 轮交替计时 · 中位数与观测 p10–p90 · 纳入全部固定结构</caption><thead><tr><th>结构 / 基线</th><th>完整文件减少</th><th>GUGIS ns/query</th><th>三角法 ns/query</th><th>配对速度比 p10–p90</th></tr></thead><tbody>{report.cases.map(c=><tr key={c.id}><th>{c.name} / P{c.triangle_degree}</th><td>{c.binary_saving_percent.toFixed(1)}%</td>{c.methods.map(m=><td key={m.family}>{m.prepared_ns_per_query.median.toFixed(1)}<small> [{m.prepared_ns_per_query.p10.toFixed(1)}, {m.prepared_ns_per_query.p90.toFixed(1)}]</small></td>)}<td>{c.paired_speed_ratio.p10.toFixed(2)}–{c.paired_speed_ratio.p90.toFixed(2)}×</td></tr>)}</tbody></table></div>
      <p>p10–p90 是这次试验的观测分位数，不是置信区间或跨设备保证。单轮未必更快；全部轮次、顺序、查询次数和校验和均提供下载。</p>
      <img src={`${base}native-query-results.png`} loading="lazy" width="1870" height="782" alt="五组同函数结构的完整二进制代价与本机查询中位数，误差棒为17次试验的观测p10至p90"/>
      <div className="cr-actions"><a download href={`${base}trials.csv`}>全部 220 条计时记录 CSV ↓</a><a download href={`${base}results.json`}>完整计时与校验 JSON ↓</a><a download href={`${base}native-query-results.svg`}>科学图 SVG ↓</a></div>
    </details>
    <details className="cr-details"><summary>复现实验条件、连续性和算法实现</summary>
      <p>固定 128 × 32 个内部坐标，覆盖最多 128 条面带。每个方法预热五批，共同查询一组坐标；每个结构进行 17 轮 GUGIS / 三角法交替计时。计时范围为点定位、高程、笛卡尔解析梯度和累加校验和，不含磁盘读取、解码及预计算。旧版查询另测五轮，仅用于实现优化回归，双方准备充分的查询才用于上方方法对照。</p>
      <p>双方 ≤ 8 个面片时顺序扫描，更多面片时使用同样的 32 × 32 包围盒索引。二次／三次三角形使用完整 Lagrange 节点并共享公共节点；直纹面带共享两条二次边界的端点。预计算多项式系数是执行缓存，未冒充新的存档大小或内存测量。</p>
      <p>多带解析函数在公共边界处 C₀ 连续，梯度可以跳变，不能套用严格凸 C² 论文定理。源函数和分段定义、实际 JSON / GOC2、源码、全部计时、全域误差记录均在证据 ZIP 中。稀疏多项式或全局公式编码可能更小，本对照只比较这些明确的通用节点表示。</p>
      <p>测试环境：{report.environment.cpu_model} · {report.environment.platform} {report.environment.architecture} · Node {report.environment.node} / V8 {report.environment.v8}。准备耗时仅单次记录，不用于延迟结论。</p>
      <p className="cr-hash">完整计时记录 SHA-256：{report.report_sha256}<br/>完整证据 ZIP SHA-256：{report.package.sha256}</p>
    </details>
  </section>;
}
