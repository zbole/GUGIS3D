export type ReadProgress={phase:'connecting'|'receiving'|'parsing'|'decoding';received:number;total:number|null};
type Options = { writes?: boolean; conflictMessage?: string;onProgress?:(progress:ReadProgress)=>void };
const statuses: Record<number, string> = {
  400: "文件或参数无效", 401: "请求未获授权", 403: "当前操作不可用", 404: "请求的数据或接口不存在",
  413: "文件过大，请减小输入", 422: "文件校验未通过", 429: "请求过于频繁，请稍后重试",
  500: "本地服务处理失败", 502: "本地服务暂不可用", 503: "本地服务暂不可用", 504: "服务处理超时",
};
function errorMessage(status: number, payload: unknown, options: Options) {
  const detail = payload && typeof payload === "object" && "detail" in payload ? payload.detail : undefined;
  if (status === 409 && options.conflictMessage) {
    if (detail && typeof detail === "object" && "code" in detail && detail.code === "snapshot_integrity" &&
      "message" in detail && typeof detail.message === "string") return detail.message.slice(0, 1000);
    return options.conflictMessage;
  }
  if (typeof detail === "string" && detail.trim()) return `${status}：${detail.slice(0, 1000)}`;
  if (Array.isArray(detail)) {
    const fields = detail.slice(0, 3).flatMap(item => {
      if (!item || typeof item !== "object" || typeof item.msg !== "string") return [];
      const location = Array.isArray(item.loc) ? item.loc.map(String).join(".") : "输入";
      return [`${location}：${item.msg === "Field required" ? "缺少必需字段" : item.msg.slice(0, 250)}`];
    });
    if (fields.length) return `${status}：文件校验未通过。${fields.join("；")}`;
  }
  return `${status}：${statuses[status] ?? "请求未完成，请重试或检查本地服务"}`;
}
function transportMessage(error: unknown, writes: boolean) {
  const name = error && typeof error === "object" && "name" in error ? error.name : "";
  const reason = name === "TimeoutError" ? "请求超时" : name === "AbortError" ? "请求已中断" : "无法连接本地服务";
  return writes ? `${reason}，操作结果未确认。请重新载入核对；不要据此判断数据已写入或未写入。`
    : `${reason}。请确认本地服务正在运行，稍后重试。`;
}

/** One request only. Uncertain writes must never be automatically replayed. */
export async function fetchApiJson<T>(url: string, init: RequestInit, options: Options = {}): Promise<T> {
  const progress=options.writes?undefined:options.onProgress;
  progress?.({phase:'connecting',received:0,total:null});
  let response: Response;
  try { response = await fetch(url, init); }
  catch (error) { throw new Error(transportMessage(error, !!options.writes)); }
  let payload: unknown;
  try {
    if(progress&&response.ok&&response.body){
      const encoded=response.headers?.get('Content-Encoding'),length=Number(response.headers?.get('Content-Length')??NaN),total=(!encoded||encoded==='identity')&&Number.isSafeInteger(length)&&length>0?length:null;
      const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),parts:string[]=[];let received=0,last=0;
      const decode=(value?:Uint8Array,stream=false)=>{try{return decoder.decode(value,{stream});}catch{throw new SyntaxError('Invalid UTF-8 JSON');}};
      try{
        progress({phase:'receiving',received,total});
        for(;;){if(init.signal?.aborted)throw init.signal.reason;const {value,done}=await reader.read();if(done)break;received+=value.byteLength;parts.push(decode(value,true));const now=performance.now();if(now-last>=150){progress({phase:'receiving',received,total});last=now;}}
        parts.push(decode());progress({phase:'parsing',received,total});if(init.signal?.aborted)throw init.signal.reason;payload=JSON.parse(parts.join(''));
      }finally{reader.releaseLock();}
    }else payload = await response.json();
  }
  catch (error) {
    if (!response.ok) throw new Error(errorMessage(response.status, null, options) +
      (options.writes && response.status >= 500 ? "。操作结果未确认，请重新载入核对。" : ""));
    const name = error && typeof error === "object" && "name" in error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError" || name === "TypeError")
      throw new Error(transportMessage(error, !!options.writes));
    throw new Error(options.writes
      ? `服务返回内容无法解析（HTTP ${response.status}），操作结果未确认。请重新载入核对。`
      : `服务返回内容无法解析（HTTP ${response.status}）。请重试或检查本地服务。`);
  }
  if (!response.ok) throw new Error(errorMessage(response.status, payload, options) +
    (options.writes && response.status >= 500 ? "。操作结果未确认，请重新载入核对。" : ""));
  return payload as T;
}
