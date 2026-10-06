import {lazy,Suspense,useEffect,useState} from 'react';
import './PaperProjectionResults.css';
const Results=lazy(()=>import('./PaperProjectionResults'));
export const projectionHash=(hash:string)=>['#paper-projection-results','#paper-projection-evidence'].includes(hash);
export default function PaperProjectionDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&projectionHash(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;const follow=()=>{if(projectionHash(window.location?.hash??''))setOpen(true);},click=(e:MouseEvent)=>{const hash=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(hash&&projectionHash(hash))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};},[]);
  return <details id="paper-projection-evidence" className="pf-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>核心升级：共享系数 L₂ 拟合与 Pₜ 强控制<small>原有126组全部保留；结构和字节数不变，拟合前后的精度、固定网格Pₜ与P2控制同屏比较。</small></summary>{open&&<Suspense fallback={<p role="status">正在加载全部共享拟合与论文许可算子控制…</p>}><Results/></Suspense>}</details>;
}
