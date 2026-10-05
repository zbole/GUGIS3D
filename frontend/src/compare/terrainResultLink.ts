export type TerrainResultScope='bristol'|'multicity'|'oxford'|'cambridge'|'liverpool'|'sheffield'|'leeds'|'nottingham';
export type TerrainResultSelection={scope:TerrainResultScope;target:number;site:string|null};
const sites:Record<TerrainResultScope,string[]>={
  bristol:[],multicity:['manchester-centre','manchester-north-quarter','york-centre','york-north-quarter','bath-centre','bath-north-quarter'],
  oxford:['oxford-centre','oxford-north-quarter'],cambridge:['cambridge-centre','cambridge-north-quarter'],liverpool:['liverpool-centre','liverpool-north-quarter'],
  sheffield:['sheffield-centre','sheffield-north-quarter'],
  leeds:['leeds-centre','leeds-north-quarter'],
  nottingham:['nottingham-centre','nottingham-north-quarter'],
};
const validScope=(value:string|null):value is TerrainResultScope=>value!==null&&Object.prototype.hasOwnProperty.call(sites,value);
const validTarget=(value:number)=>[.1,.25,.5].includes(value);
export function readTerrainResultLink(location:{search?:string;hash?:string}):TerrainResultSelection{
  const params=new URLSearchParams(location.search??'');
  const hash=/^#(bristol|multicity|oxford|cambridge|liverpool|sheffield|leeds|nottingham)-terrain-results$/.exec(location.hash??'')?.[1]??null;
  const query=params.get('terrain_scope');
  const scope=validScope(hash)?hash:validScope(query)?query:'bristol';
  const target=Number(params.get('terrain_target')),site=params.get('terrain_site');
  return {scope,target:validTarget(target)?target:.1,site:site&&sites[scope].includes(site)?site:null};
}
export function terrainResultUrl(href:string,selection:TerrainResultSelection){
  const url=new URL(href);
  if(!validScope(selection.scope)||!validTarget(selection.target))throw new Error('Unsupported terrain result selection');
  if(selection.site!==null&&!sites[selection.scope].includes(selection.site))throw new Error('Site belongs to a different experiment');
  url.searchParams.set('terrain_scope',selection.scope);
  url.searchParams.set('terrain_target',String(selection.target));
  if(selection.site)url.searchParams.set('terrain_site',selection.site);else url.searchParams.delete('terrain_site');
  url.hash=selection.scope+'-terrain-results';
  return url.href;
}
export function currentTerrainResultLink(){
  return readTerrainResultLink(typeof window==='undefined'?{}:window.location??{});
}
export function rememberTerrainResult(selection:TerrainResultSelection){
  if(typeof window==='undefined'||!window.location?.href||!window.history?.replaceState)return;
  window.history.replaceState(window.history.state,'',terrainResultUrl(window.location.href,selection));
}
