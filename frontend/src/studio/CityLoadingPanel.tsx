import type {ReadProgress} from './apiResponse';
import './cityLoading.css';
const titles={connecting:'连接本地城市服务',receiving:'读取城市文件',parsing:'解析城市数据',decoding:'整理共享几何'};
const mb=(n:number)=>(n/1_000_000).toFixed(1)+' MB';
export default function CityLoadingPanel({busy,progress,error,onStop,onRetry}:{busy:boolean;progress:ReadProgress|null;error:boolean;onStop:()=>void;onRetry:()=>void}){
  const known=progress?.total!==null&&progress?.total!==undefined&&progress.total>0,percent=known?Math.min(100,100*progress!.received/progress!.total!):undefined;
  return <div className="city-loading"><section className="city-load-card" aria-label="城市项目载入状态"><span className="city-load-eyebrow">CITY WORKSPACE</span><h2>{busy?(progress?titles[progress.phase]:'准备读取城市项目'):error?'城市载入未完成':'载入已停止'}</h2><p role="status">{busy?progress&&progress.received>0?`${mb(progress.received)}${known?` / ${mb(progress.total!)} · ${percent!.toFixed(0)}%`: ' 已接收'}`:'正在读取已保存的城市与独立草稿…':error?'请检查上方提示，再重新读取城市项目。':'可以重新读取，或在上方切换城市与浏览方式。'}</p>{busy&&<progress aria-label="城市文件接收进度" max="100" {...(percent===undefined?{}:{value:percent})}/>}<p className="city-load-note">大型项目按视域加载三维建筑；轻量分块浏览适合快速探索。</p>{busy?<button onClick={onStop}>停止本次读取</button>:<button onClick={onRetry}>重新读取城市项目</button>}</section></div>;
}
