import {lazy,Suspense,useEffect,useState} from 'react';
import './NativeQueryRepeatResults.css';
const Results=lazy(()=>import('./NativeQueryRepeatResults'));
const matches=(hash:string)=>['#native-query-repeat','#native-query-repeat-evidence'].includes(hash);
export default function NativeQueryRepeatDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&matches(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;const follow=()=>{if(matches(window.location?.hash??''))setOpen(true);};const click=(e:MouseEvent)=>{const href=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(href&&matches(href))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};},[]);
  return <details className="nqr-disclosure" id="native-query-repeat-evidence" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>独立复测：三次新进程中的全部查询结果<small>相同源函数、相同计时正文，五个样例十五个中位数对比完整公开。</small></summary>{open&&<Suspense fallback={<p role="status">正在载入三次独立 CPU 复测结果…</p>}><Results/></Suspense>}</details>;
}
