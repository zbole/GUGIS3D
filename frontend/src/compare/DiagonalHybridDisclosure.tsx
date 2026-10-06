import {lazy,Suspense,useEffect,useState} from 'react';
import './DiagonalHybridResults.css';
const Results=lazy(()=>import('./DiagonalHybridResults'));
export const diagonalHybridHash=(hash:string)=>['#diagonal-hybrid-results','#diagonal-hybrid-evidence'].includes(hash);
export default function DiagonalHybridDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&diagonalHybridHash(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;const follow=()=>{if(diagonalHybridHash(window.location?.hash??''))setOpen(true);},click=(e:MouseEvent)=>{const hash=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(hash&&diagonalHybridHash(hash))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};},[]);
  return <details id="diagonal-hybrid-evidence" className="ds-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>更强基线：可转向三角带 vs 三类混合单元<small>两种对角线均参与选择，分组成本逐字节计入；原始二十个样区、全部预算和未获优势的结果完整保留。</small></summary>{open&&<Suspense fallback={<p role="status">正在加载两对角线强基线的全部实测结果…</p>}><Results/></Suspense>}</details>;
}
