import {lazy,Suspense,useEffect,useState} from 'react';
import './PaperFrontierResults.css';
const Results=lazy(()=>import('./PaperCoordinateResults'));
const matches=(hash:string)=>['#paper-coordinate-results','#paper-coordinate-evidence'].includes(hash);
export default function PaperCoordinateDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&matches(window.location?.hash??''));
  useEffect(()=>{
    if(typeof window==='undefined')return;
    const follow=()=>{if(matches(window.location?.hash??''))setOpen(true);};
    const click=(e:MouseEvent)=>{const hash=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(hash&&matches(hash))setOpen(true);};
    window.addEventListener('hashchange',follow);window.addEventListener('click',click);
    return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};
  },[]);
  return <details id="paper-coordinate-evidence" className="frontier-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>更严格的论文对照：双方共享坐标后，达到同一误差需要多少空间？<small>统一无损编码、独立逐字节还原、全部方向和失利；点击实际新文件进行同步查询。</small></summary>{open&&<Suspense fallback={<p role="status">正在读取统一编码后的完整结果…</p>}><Results/></Suspense>}</details>;
}
