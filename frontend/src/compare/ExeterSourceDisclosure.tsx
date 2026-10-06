import {lazy,Suspense,useEffect,useState} from 'react';
import './SourceFitResults.css';
const Results=lazy(()=>import('./ExeterSourceResults'));
export const exeterSourceHash=(hash:string)=>['#exeter-source-results','#exeter-source-evidence'].includes(hash);
export default function ExeterSourceDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&exeterSourceHash(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;const follow=()=>{if(exeterSourceHash(window.location?.hash??''))setOpen(true);},click=(e:MouseEvent)=>{const hash=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(hash&&exeterSourceHash(hash))setOpen(true);};window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};},[]);
  return <details id="exeter-source-evidence" className="sfit-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>新城市验证：冻结方法用于 Exeter 真实源地形<small>两个新增样区、全部 294 个拟合模型及未拟合对照单列；原二十样区结论保持原样。</small></summary>{open&&<Suspense fallback={<p role="status">正在读取新增城市验证结果…</p>}><Results/></Suspense>}</details>;
}
