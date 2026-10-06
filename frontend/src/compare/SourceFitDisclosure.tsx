import {lazy,Suspense,useEffect,useState} from 'react';
import './SourceFitResults.css';
const Results=lazy(()=>import('./SourceFitResults'));
export const sourceFitHash=(hash:string)=>['#source-fit-results','#source-fit-evidence'].includes(hash);
export default function SourceFitDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&sourceFitHash(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;const follow=()=>{if(sourceFitHash(window.location.hash))setOpen(true);},click=(e:MouseEvent)=>{const hash=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(hash&&sourceFitHash(hash))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};},[]);
  return <details id="source-fit-evidence" className="sfit-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>真实地形共享拟合：给三角带同等优化条件<small>二十个原始样区、三种方法、2,940 个固定结构模型；实际文件不增大，最大误差增长与三角带胜出的情况也保留。</small></summary>{open&&<Suspense fallback={<p role="status">正在读取共享拟合与同等三角带控制的完整结果…</p>}><Results/></Suspense>}</details>;
}
