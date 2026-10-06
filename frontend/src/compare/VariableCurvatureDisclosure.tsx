import {lazy,Suspense,useEffect,useState} from 'react';
import './VariableCurvatureResults.css';
const Results=lazy(()=>import('./VariableCurvatureResults'));
const matches=(hash:string)=>['#variable-curvature-results','#variable-curvature-evidence','#paper-projection-results','#paper-projection-evidence','#paper-adaptive-results','#paper-adaptive-evidence'].includes(hash);
export default function VariableCurvatureDisclosure(){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&matches(window.location?.hash??''));
  useEffect(()=>{if(typeof window==='undefined')return;
    const follow=()=>{if(matches(window.location?.hash??''))setOpen(true);};
    const click=(e:MouseEvent)=>{const href=(e.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');if(href&&matches(href))setOpen(true);};
    window.addEventListener('hashchange',follow);window.addEventListener('click',click);return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',click);};
  },[]);
  return <details id="variable-curvature-evidence" className="vc-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>继续验证：变曲率地形与 P2 高阶控制<small>强方向性曲面 63 / 63 组优于论文式 P1；另组 31 / 63，全部结果可复算。</small></summary>{open&&<Suspense fallback={<p role="status">正在载入完整变曲率对标结果…</p>}><Results/></Suspense>}</details>;
}
