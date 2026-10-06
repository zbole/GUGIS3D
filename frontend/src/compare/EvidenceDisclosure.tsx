import {useEffect,useState,type ReactNode} from 'react';

type EvidenceGroup='real'|'supplementary'|'functions';
export function evidenceGroupForHash(hash:string):EvidenceGroup|null{
  const anchor=hash.replace(/^#/,'');
  if(['validated-advantages','principal-direction-results','variable-curvature-results','variable-curvature-evidence','paper-projection-results','paper-projection-evidence','paper-adaptive-results','paper-adaptive-evidence','source-function-results','source-query-results','source-query-evidence','source-format-results','hybrid-source-results','hybrid-source-evidence','diagonal-hybrid-results','diagonal-hybrid-evidence','native-query-results','native-query-statistics','native-query-statistics-evidence','native-query-repeat','native-query-repeat-evidence'].includes(anchor))return null;
  if(['function-controls','gugis-function-results','order-structure-results'].includes(anchor))return 'functions';
  if(anchor==='bristol-arcgis-run')return null;
  if(anchor==='real-evidence'||anchor.startsWith('bristol-'))return 'real';
  if(!anchor||anchor==='paper-results'||anchor==='real-terrain-results')return null;
  if(['supplementary-evidence','comparison-overview','comparison','evidence','method','derivative-title','arcgis-run-title'].includes(anchor)
    ||/^(terrain-|implicit-|hybrid-|native-index-|offgrid-|research-|local-triangle-|raster-|strip-)/.test(anchor))return 'supplementary';
  return null;
}

export default function EvidenceDisclosure({group,title,note,children}:{group:EvidenceGroup;title:string;note:string;children:ReactNode}){
  const [open,setOpen]=useState(()=>typeof window!=='undefined'&&evidenceGroupForHash(window.location?.hash??'')===group);
  useEffect(()=>{
    if(typeof window==='undefined')return;
    const follow=()=>{if(evidenceGroupForHash(window.location?.hash??'')===group)setOpen(true);};
    const followClick=(event:MouseEvent)=>{
      const hash=(event.target as Element|null)?.closest?.('a[href^="#"]')?.getAttribute('href');
      if(hash&&evidenceGroupForHash(hash)===group)setOpen(true);
    };
    window.addEventListener('hashchange',follow);window.addEventListener('click',followClick);
    return()=>{window.removeEventListener('hashchange',follow);window.removeEventListener('click',followClick);};
  },[group]);
  useEffect(()=>{
    if(!open||typeof window==='undefined')return;
    const anchor=window.location?.hash?.slice(1);
    if(!anchor||evidenceGroupForHash(`#${anchor}`)!==group)return;
    const timer=window.setTimeout(()=>document.getElementById?.(anchor)?.scrollIntoView(),60);
    return()=>window.clearTimeout(timer);
  },[open,group]);
  return <details id={group==='real'?'real-evidence':group==='functions'?'function-controls':'supplementary-evidence'} className="cmp-evidence-disclosure" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{title}<small>{note}</small></summary>{open?children:null}</details>;
}
