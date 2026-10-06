import type { ReadProgress } from './apiResponse';
export type CityReadOptions={signal?:AbortSignal;onProgress?:(progress:ReadProgress)=>void};
type Subscriber<T>={resolve:(value:T)=>void;reject:(error:unknown)=>void;progress?:CityReadOptions['onProgress'];cleanup:()=>void};
/** Share only an unfinished read. Settled values are never cached or reused after edits. */
export function createSharedCityRead<T>(read:(signal:AbortSignal,report:(progress:ReadProgress)=>void)=>Promise<T>){
  type Job={controller:AbortController;clients:Set<Subscriber<T>>;last?:ReadProgress;settled:boolean};
  let current:Job|null=null;
  const deliver=(client:Subscriber<T>,progress:ReadProgress)=>{try{client.progress?.({...progress});}catch{/* A UI observer must not invalidate the data read. */}};
  return (options:CityReadOptions={}):Promise<T>=>{
    if(options.signal?.aborted)return Promise.reject(new DOMException('取消读取','AbortError'));
    if(!current){
      const job:Job={controller:new AbortController(),clients:new Set(),settled:false};current=job;
      // StrictMode may detach and reattach in the same turn: join before deciding to stop.
      queueMicrotask(()=>{
        if(!job.clients.size){if(current===job)current=null;job.settled=true;return;}
        const report=(progress:ReadProgress)=>{if(job.settled||job.controller.signal.aborted)return;job.last=progress;for(const client of [...job.clients])deliver(client,progress);};
        const settle=(ok:boolean,payload:unknown)=>{job.settled=true;if(current===job)current=null;const clients=[...job.clients];job.clients.clear();for(const client of clients){client.cleanup();if(ok)client.resolve(payload as T);else client.reject(payload);}};
        Promise.resolve().then(()=>read(job.controller.signal,report)).then(value=>settle(true,value),error=>settle(false,error));
      });
    }
    const job=current!;
    return new Promise<T>((resolve,reject)=>{
      const signal=options.signal;
      const abort=()=>{if(!job.clients.delete(client))return;client.cleanup();reject(new DOMException('取消读取','AbortError'));queueMicrotask(()=>{if(!job.clients.size&&!job.settled){job.controller.abort();if(current===job)current=null;}});};
      const client:Subscriber<T>={resolve,reject,progress:options.onProgress,cleanup:()=>signal?.removeEventListener('abort',abort)};
      job.clients.add(client);signal?.addEventListener('abort',abort,{once:true});if(job.last)deliver(client,job.last);
    });
  };
}
