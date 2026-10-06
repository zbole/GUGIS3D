import {lazy,Suspense,useEffect,useState} from 'react';
import './QueryStatisticsResults.css';
const Results=lazy(()=>import('./QueryStatisticsResults'));
const matches=(hash:string)=>['#native-query-statistics','#native-query-statistics-evidence'].includes(hash);
export default function QueryStatisticsDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&matches(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;const follow=()=>{if(matches(window.location?.hash??''))setOpen(true);};const click=(e:MouseEvent)=>{const href=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(href&&matches(href))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};},[]);
  return <details id="native-query-statistics-evidence" className="qs-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>继续核验：既有 CPU 重复试验的统计支持<small>全部五个样例、配对胜负、95% 探索性重采样区间与五项 Holm 校正。</small></summary>{open&&<Suspense fallback={<p role="status">正在载入五个固定 CPU 样例的统计诊断…</p>}><Results/></Suspense>}</details>;
}
