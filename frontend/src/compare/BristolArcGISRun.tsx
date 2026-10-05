import {useEffect,useRef,useState} from 'react';
import protocol from '../../../shared/bristol-arcgis-protocol.json';
import {ARCGIS_RESULT_LIMIT,validateBristolArcGISReceipt,sampleMedian,type ArcGISReceipt} from './bristolArcGISReceipt';

export default function BristolArcGISRun({target}:{target:number}){
  const [receipt,setReceipt]=useState<ArcGISReceipt|null>(null),[digest,setDigest]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const epoch=useRef(0);
  useEffect(()=>()=>{epoch.current++;},[]);
  const models=protocol.models.filter(m=>m.target_m===target);
  async function read(file:File){
    const current=++epoch.current;setReceipt(null);setDigest('');setBusy(true);setStatus('正在核对测试包、六组样区与原始重复记录…');
    try{
      if(file.size>ARCGIS_RESULT_LIMIT)throw new Error('结果文件超过 128 KiB，请导入脚本生成的 JSON。');
      const buffer=await file.arrayBuffer();
      if(buffer.byteLength>ARCGIS_RESULT_LIMIT)throw new Error('结果文件超过读取上限。');
      const decoded=new TextDecoder('utf-8',{fatal:true}).decode(buffer),checked=validateBristolArcGISReceipt(JSON.parse(decoded));
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');
      if(current!==epoch.current)return;
      setReceipt(checked);setDigest(sha);setStatus('六组结果已通过样本一致性与记录校验。以下数值由运行者提供，未独立复现其 ArcGIS 执行。');
    }catch(error){if(current===epoch.current)setStatus(error instanceof Error?error.message:'结果无法读取。');}
    finally{if(current===epoch.current)setBusy(false);}
  }
  return <article id="bristol-arcgis-run" className="paper-integral-decision paper-arcgis-run" aria-labelledby="bristol-arcgis-run-title">
    <div className="paper-heading"><div><span className="paper-eyebrow">同几何 · 格式结果与软件实测</span><h3 id="bristol-arcgis-run-title">把 ArcGIS 对照落实到同一份地形。</h3><p>本表只比较局部三角带的同一几何；上方混合模型的 E₂ 与文件成本保持独立。</p></div><span className="paper-run-state">{receipt?'已导入运行者结果':'软件耗时待测'}</span></div>
    <div className="paper-table-scroll"><table><caption>{target*100} cm 构建目标 · 同一组有向三角形，高程读回一致；实际误差沿用全域积分</caption><thead><tr><th>样区</th><th>GUGIS / kB</th><th>MultiPatch / kB</th><th>文件减少</th><th>全域 E₂ / m²</th><th>ArcGIS 读取 / ms</th><th>ArcGIS FGDB 复制 / ms</th></tr></thead><tbody>{models.map(m=>{
      const result=receipt?.results.find(r=>r.id===m.id);
      return <tr key={m.id}><th>{m.case_name}</th><td>{(m.native_bytes/1000).toFixed(2)}</td><td>{(m.multipatch_core_bytes/1000).toFixed(2)}</td><td>{(100*(1-m.native_bytes/m.multipatch_core_bytes)).toFixed(1)}%</td><td>{m.e2_m2.toFixed(5)}</td><td>{result?result.median_read_ms.toFixed(3):'— 待测'}</td><td>{result?result.median_copy_ms.toFixed(3):'— 待测'}</td></tr>;
    })}</tbody></table></div>
    <p className="paper-scope">五个未压缩组件 = SHP + SHX + DBF + PRJ + CPG。它们保留几何和投影，原生编号及完整元数据的恢复文件另计。文件百分比不代表内存或速度。读取 SHAPE@、复制 FGDB 与 GUGIS 原生高程查询是不同任务，不能用它们计算跨产品加速比。</p>
    <details className="paper-method"><summary>运行 ArcGIS 测试与导入结果</summary><ol><li>下载并解压当前测试包，在已授权的 ArcGIS Pro Python 环境执行下面的命令。</li><li>脚本检查六份模型及坐标；每项操作预热一次，再测五次，中位数之外保留所有原始记录。</li><li>导入生成的 JSON。结果只保留在本页面，刷新后清除。</li></ol><pre>python run_bristol_arcgis.py --directory . --output arcgis-result.json</pre>
      <div className="paper-downloads"><a href={`/research/bristol-arcgis/${protocol.download.filename}`} download>下载六组 ArcGIS 测试包 · {(protocol.download.bytes/1000).toFixed(1)} kB ↓</a><a href="/research/bristol-arcgis/manifest.json" download>数据清单与 SHA-256 ↓</a></div>
      <label className="paper-receipt-input">导入 ArcGIS 结果 JSON<input aria-label="导入布里斯托ArcGIS结果" type="file" accept=".json,application/json" disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void read(file);}}/></label>
      {(receipt||busy||status)&&<button type="button" className="paper-receipt-clear" onClick={()=>{epoch.current++;setReceipt(null);setDigest('');setStatus('已清除本页导入结果。');setBusy(false);}}>清除本页结果</button>}
      <p role="status" aria-live="polite">{status}</p>
      {receipt&&<><p>{receipt.runtime.product} {receipt.runtime.version} · {receipt.runtime.os} · Python {receipt.runtime.python}<br/>测量时间 {receipt.measured_at_utc} · CPU {receipt.runtime.processor||'未提供'}</p><div className="paper-table-scroll"><table><caption>运行者提供的全部六组原始记录；每列五次，预热不计</caption><thead><tr><th>样区 / 目标</th><th>读取 / ms</th><th>复制 / ms</th><th>FGDB 中位体积 / kB</th></tr></thead><tbody>{protocol.models.map(m=>{const r=receipt.results.find(r=>r.id===m.id)!;return <tr key={m.id}><th>{m.case_name} / {m.target_m*100} cm</th><td>{r.read_ms.map(v=>v.toFixed(3)).join(' / ')}</td><td>{r.copy_ms.map(v=>v.toFixed(3)).join(' / ')}</td><td>{(sampleMedian(r.copy_output_bytes)/1000).toFixed(2)}</td></tr>;})}</tbody></table></div><p className="paper-receipt-digest">本次导入文件 SHA-256 {digest}</p></>}
      <p>计时只包含几何游标读取和向新 FGDB 复制；完整性核对、FGDB 创建均在计时外。一个进程中的预热重复不保证冷缓存。FGDB 坐标多重集逐字节一致检查不能证明面片拓扑未变；尚未测量 FPS、GPU、内存或 ArcGIS 地形查询。</p>
    </details>
  </article>;
}
