import {useId,useState} from 'react';
import type {CityWorkspace} from './cityWorkspaces';
import './CityPicker.css';

type CityChoice=Pick<CityWorkspace,'id'|'name'|'city_name'>&Partial<Pick<CityWorkspace,'status'>>;
const normal=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().trim();
export function filterCityChoices(cities:CityChoice[],query:string,filter:'all'|'terrain'|'selected',selected:string[],terrain:string[]){
  const terms=normal(query).split(/\s+/).filter(Boolean);
  return cities.filter(city=>(filter==='all'||filter==='terrain'&&terrain.includes(city.id)||filter==='selected'&&selected.includes(city.id))
    &&terms.every(term=>normal(`${city.name} ${city.city_name??''} ${city.id}`).includes(term)));
}

export default function CityPicker({cities,selected,onSelect,terrainCities=[],multiple=false,compact=false,disabled=false}:{cities:CityChoice[];selected:string[];onSelect:(id:string)=>void;terrainCities?:string[];multiple?:boolean;compact?:boolean;disabled?:boolean}){
  const [query,setQuery]=useState(''),[filter,setFilter]=useState<'all'|'terrain'|'selected'>('all'),listId=useId();
  const filters:{id:'all'|'terrain'|'selected';name:string;count:number}[]=[{id:'all',name:'全部',count:cities.length},{id:'terrain',name:'已核验 DTM',count:cities.filter(c=>terrainCities.includes(c.id)).length}];
  if(multiple)filters.push({id:'selected',name:'已选',count:selected.filter(id=>cities.some(c=>c.id===id)).length});
  const visible=filterCityChoices(cities,query,filter,selected,terrainCities),chosen=cities.filter(c=>selected.includes(c.id));
  return <section className={`city-picker${compact?' city-picker--compact':''}`} aria-label="搜索与筛选城市">
    <div className="city-picker-current"><span>{multiple?'已选城市':'当前城市'}</span>{multiple?<strong>{chosen.length} 座</strong>:<strong>{chosen[0]?.name??'尚未选择'}<small>{chosen[0]?.city_name}</small></strong>}<small>{cities.length} 座 · 局部样本</small></div>
    {multiple&&chosen.length>0&&<div className="city-picker-chips" aria-label="已选城市，筛选后仍保留">{chosen.map(city=><button key={city.id} type="button" disabled={disabled} onClick={()=>onSelect(city.id)} aria-label={`取消选择${city.name}`}>{city.name}<span aria-hidden="true">×</span></button>)}</div>}
    <div className="city-picker-search"><label><span className="sr-only">搜索城市，支持中文或英文</span><input type="search" placeholder="搜索城市 / Search" value={query} aria-controls={listId} disabled={disabled} onChange={e=>setQuery(e.target.value)}/></label>{query&&<button type="button" disabled={disabled} onClick={()=>setQuery('')} aria-label="清除城市搜索">×</button>}</div>
    <div className="city-picker-filters" role="group" aria-label="城市筛选">{filters.map(item=><button key={item.id} type="button" disabled={disabled} aria-pressed={filter===item.id} onClick={()=>setFilter(item.id)}>{item.name}<small>{item.count}</small></button>)}</div>
    <div className="city-picker-list" id={listId} aria-label="城市搜索结果">{visible.map(city=><button key={city.id} type="button" className="city-picker-option" aria-label={`选择${city.name}`} aria-pressed={selected.includes(city.id)} disabled={disabled||city.status==='invalid'} onClick={()=>onSelect(city.id)}><i aria-hidden="true">{selected.includes(city.id)?'✓':multiple?'+':'↗'}</i><span><strong>{city.name}</strong><small>{city.city_name??city.id}</small></span><em>{city.status==='invalid'?'数据异常':city.status==='pending'?'待导入':terrainCities.includes(city.id)?'DTM':'建筑'}</em></button>)}</div>
    <p className="city-picker-feedback" role="status">{visible.length?`显示 ${visible.length} / ${cities.length} 座城市${multiple?' · 搜索不会取消已选城市':''}`:'没有匹配城市，请调整搜索或筛选。'}</p>
    {!visible.length&&<button className="city-picker-reset" type="button" onClick={()=>{setQuery('');setFilter('all');}} disabled={disabled}>重置搜索与筛选</button>}
  </section>;
}
