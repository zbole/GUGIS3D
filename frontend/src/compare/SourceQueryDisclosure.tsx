import {lazy,Suspense,useEffect,useState} from 'react';
const Results=lazy(()=>import('./SourceQueryResults'));
const matches=(hash:string)=>['#source-query-results','#source-query-evidence'].includes(hash);
export default function SourceQueryDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&matches(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;const follow=()=>{if(matches(window.location?.hash??''))setOpen(true);};const click=(e:MouseEvent)=>{const href=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(href&&matches(href))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};},[]);
  return <details className="cr-details" id="source-query-evidence" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>真实地形查询性能：20 个窗口、三轮独立进程、四种方法<small>同源高度与梯度 · 全部 5,760 条记录 · 保留更快的规则栅格控制</small></summary>{open&&<Suspense fallback={<p role="status">正在载入完整真实地形 CPU 结果…</p>}><Results/></Suspense>}</details>;
}
