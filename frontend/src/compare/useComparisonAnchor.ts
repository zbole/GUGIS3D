import {useEffect} from 'react';

// The catalogue and research modules mount asynchronously; the browser's
// initial fragment jump can precede the target section. Follow it once mounted.
export function useComparisonAnchor(anchor:string){
  useEffect(()=>{
    if(typeof window==='undefined'||typeof document==='undefined'||window.location?.hash!==`#${anchor}`)return;
    document.getElementById?.(anchor)?.scrollIntoView?.({block:'start'});
  },[anchor]);
}
