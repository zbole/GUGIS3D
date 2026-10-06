import {lazy,Suspense,useEffect,useState} from 'react';
import './HybridSourceResults.css';
const Results=lazy(()=>import('./HybridSourceResults'));
const matches=(hash:string)=>['#hybrid-source-results','#hybrid-source-evidence','#diagonal-hybrid-results','#diagonal-hybrid-evidence'].includes(hash);
export default function HybridSourceDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&matches(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;
    const follow=()=>{if(matches(window.location?.hash??''))setOpen(true);};const click=(e:MouseEvent)=>{const href=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(href&&matches(href))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};
  },[]);
  return <details id="hybrid-source-evidence" className="hs-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>继续验证：真实地形的面带 + 三角带混合表达<small>同一源函数，按局部误差选单元；共享边界连续，完整文件与误差目标分别对比。</small></summary>{open&&<Suspense fallback={<p role="status">正在载入二十个固定源样区的混合表达结果…</p>}><Results/></Suspense>}</details>;
}
