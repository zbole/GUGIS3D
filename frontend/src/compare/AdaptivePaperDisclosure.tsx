import {lazy,Suspense,useEffect,useState} from 'react';
import './PaperProjectionResults.css';
const Results=lazy(()=>import('./AdaptivePaperResults'));
export const adaptivePaperHash=(hash:string)=>['#paper-adaptive-results','#paper-adaptive-evidence'].includes(hash);
export default function AdaptivePaperDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&adaptivePaperHash(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;const follow=()=>{if(adaptivePaperHash(window.location?.hash??''))setOpen(true);},click=(e:MouseEvent)=>{const href=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(href&&adaptivePaperHash(href))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};},[]);
  return <details id="paper-adaptive-evidence" className="pf-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>最新强对照：完整 Pₜ 区域贪心与论文插值 L₁ 选边<small>重新生成全部自适应三角网格，126 组原 GUGIS 模型不重新择优。</small></summary>{open&&<Suspense fallback={<p role="status">正在载入完整自适应 Pₜ 对照…</p>}><Results/></Suspense>}</details>;
}
