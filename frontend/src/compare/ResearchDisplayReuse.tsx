import report from '../../../shared/research-display-reuse.json';
import './ResearchDisplayReuse.css';

export default function ResearchDisplayReuse({caseId,target,archiveSha256,shared}:{caseId:string;target:number;archiveSha256:string;shared:boolean}){
  const record=report.records.find(r=>r.case_id===caseId&&r.target_m===target&&r.archive_sha256===archiveSha256);
  if(!record)return <p className="hybrid-live-note">显示复用实验核验了 84 份档案；当前档案没有匹配的固定测量记录。<a href="/research/hybrid-terrain/display-reuse-results.json" download>下载完整记录</a></p>;
  const before=record.expanded,after=record.shared;
  return <section className="display-reuse-audit" aria-label="显示顶点复用实测">
    <div className="display-reuse-audit__intro"><div><small>同一档案 · 同一三角几何 · CPU 缓冲实测</small><h4>显示缓冲数据减少 {record.buffer_saving_percent.toFixed(1)}%</h4></div>
      <span>当前使用{shared?'共享':'独立'}显示顶点</span></div>
    <div className="display-reuse-audit__bars">
      {[['独立显示',before],['共享显示',after]].map(([label,value])=>{
        const data=value as typeof before;
        return <div key={label as string}><span>{label as string}</span><div className="display-reuse-audit__track"><i style={{width:`${100*data.typed_array_bytes/before.typed_array_bytes}%`}}/></div><strong>{(data.typed_array_bytes/1e6).toFixed(3)} MB</strong></div>;
      })}
    </div>
    <p>{before.vertices.toLocaleString()} → {after.vertices.toLocaleString()} 个显示顶点；{after.triangles.toLocaleString()} 个三角面保持一致。按位置、估计光照法线和索引 TypedArray 的实际 byteLength 计量；不含线框与其他渲染缓存，不是显卡内存实测。</p>
    <p>本机 CPU 构面中位耗时：独立 {before.prepare_ms.toFixed(2)} ms / 共享 {after.prepare_ms.toFixed(2)} ms。三次交错测试，垃圾回收与几何哈希核验在计时之外；不是浏览器帧率或 ArcGIS 软件跑分。</p>
    <div className="hybrid-downloads"><a href="/research/hybrid-terrain/display-reuse-results.json" download>84 份同几何核验 · JSON</a><a href="/research/hybrid-terrain/display-reuse-results.csv" download>显示开销数据 · CSV</a>
      {caseId==='swiss-dem-crop'&&target===.1&&<><a href="/research/hybrid-terrain/display-reuse/swiss-10cm-display-reuse.png" download>瑞士 10 cm 科学图 · PNG</a><a href="/research/hybrid-terrain/display-reuse/swiss-10cm-display-reuse.svg" download>可编辑科学图 · SVG</a></>}
    </div>
  </section>;
}
