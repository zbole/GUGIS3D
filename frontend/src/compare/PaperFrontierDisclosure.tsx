import {lazy,Suspense,useEffect,useState} from 'react';
import './PaperFrontierResults.css';
const Results=lazy(()=>import('./PaperFrontierResults'));
export const paperFrontierHash=(hash:string)=>['#paper-frontier-results','#paper-frontier-evidence'].includes(hash);
export default function PaperFrontierDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&paperFrontierHash(window.location?.hash??''));
  useEffect(()=>{
    if(typeof window==='undefined')return;
    const follow=()=>{if(paperFrontierHash(window.location?.hash??''))setOpen(true);};
    const click=(e:MouseEvent)=>{const hash=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(hash&&paperFrontierHash(hash))setOpen(true);};
    window.addEventListener('hashchange',follow);window.addEventListener('click',click);
    return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};
  },[]);
  return <details id="paper-frontier-evidence" className="frontier-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>论文对比新结果：达到同一误差门槛，需要多少空间？<small>完整文件、同预算误差、六方法有限前沿与原生模型；保留 P₂ 强控制和未达标结果。</small></summary>{open&&<Suspense fallback={<p role="status">正在读取文件与误差决策表…</p>}><Results/></Suspense>}</details>;
}
