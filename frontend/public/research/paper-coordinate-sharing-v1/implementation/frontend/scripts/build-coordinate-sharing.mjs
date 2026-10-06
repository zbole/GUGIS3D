// Re-encode an observed archive identically across all methods; never refit it.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {encodeCompactPrincipal,restoreCompactPrincipal} from '../src/compare/compactPrincipalBinary.ts';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const packed=value=>JSON.stringify(value)+'\n',output=path.resolve(process.argv[2]);
const protocolBytes=Buffer.from((await readFile(path.join(ROOT,'data-pipeline/compact_principal_protocol_v2.json'),'utf8')).replace(/\r\n/g,'\n'));
const protocol=JSON.parse(protocolBytes),inputBytes=await readFile(path.join(ROOT,protocol.input));
assert.equal(sha(inputBytes),protocol.input_sha256);
await mkdir(output);await writeFile(path.join(output,'protocol.json'),protocolBytes,{flag:'wx'});
const input=JSON.parse(inputBytes),result={schema:'gugis-paper-coordinate-sharing-v1',protocol_sha256:sha(protocolBytes),source_report_sha256:sha(inputBytes),defaults:input.defaults,cases:[],summary:{},native_files:{},stats:{original_bytes:0,compact_bytes:0,smaller:0,equal:0,larger:0,full_byte_roundtrips:0}};
result.implementation={codec_sha256:sha((await readFile(path.join(ROOT,'frontend/src/compare/compactPrincipalBinary.ts'),'utf8')).replace(/\r\n/g,'\n')),frozen_kernel_sha256:sha((await readFile(path.join(ROOT,'frontend/src/compare/principalRuledMath.ts'),'utf8')).replace(/\r\n/g,'\n')),producer_sha256:sha((await readFile(fileURLToPath(import.meta.url),'utf8')).replace(/\r\n/g,'\n'))};
for(const original of input.cases){
  assert.match(original.id,/^[a-z0-9-]+$/);
  const c=structuredClone(original);await mkdir(path.join(output,'native',c.id),{recursive:true});
  for(const [key,e] of Object.entries(c.models)){
    const prior=structuredClone(e);assert.match(e.binary_filename,/^[a-z0-9-]+\.bin$/);
    const relative=`${e.package}/${c.id}/${e.binary_filename}`,raw=await readFile(path.join(ROOT,'frontend/public/research',relative));
    assert.equal(raw.length,e.binary_bytes);assert.equal(sha(raw),e.binary_sha256);
    const compact=Buffer.from(encodeCompactPrincipal(raw)),restored=Buffer.from(restoreCompactPrincipal(compact));
    assert.deepEqual(restored,raw);assert.equal(sha(restored),e.binary_sha256);
    const filename=`${e.method}--${e.binary_filename.replace(/\.bin$/,'.gpc')}`,view=new DataView(compact.buffer,compact.byteOffset,compact.length);
    await writeFile(path.join(output,'native',c.id,filename),compact,{flag:'wx'});
    Object.assign(e,{package:'paper-coordinate-sharing-v1',previous:false,binary_filename:filename,binary_bytes:compact.length,binary_sha256:sha(compact),original:prior,encoding:'GPC1',xy_dictionary_entries:view.getUint32(8,true)});
    result.native_files[`${c.id}/${filename}`]={bytes:compact.length,sha256:sha(compact),original_path:relative,original_bytes:raw.length,original_sha256:sha(raw)};
    result.stats.original_bytes+=raw.length;result.stats.compact_bytes+=compact.length;
    result.stats[compact.length<raw.length?'smaller':compact.length===raw.length?'equal':'larger']++;result.stats.full_byte_roundtrips++;
  }
  const cost=k=>c.models[k].binary_bytes,error=k=>c.models[k].e2_m2;
  for(const method of protocol.methods){
    const keys=c.candidates[method];keys.sort((a,b)=>cost(a)-cost(b)||error(a)-error(b)||a.localeCompare(b));
    c.frontiers[method]=keys.filter(k=>!keys.some(q=>q!==k&&cost(q)<=cost(k)&&error(q)<=error(k)&&(cost(q)<cost(k)||error(q)<error(k))));
  }
  function choices(mode,threshold){
    const selected={};
    for(const method of protocol.methods){
      const eligible=c.candidates[method].filter(k=>mode==='bytes'?cost(k)<=threshold:error(k)<=threshold);
      eligible.sort((a,b)=>(mode==='bytes'?error(a)-error(b)||cost(a)-cost(b):cost(a)-cost(b)||error(a)-error(b))||c.models[a].binary_filename.localeCompare(c.models[b].binary_filename));
      selected[method]=eligible[0]??null;
    }
    return selected;
  }
  c.byte_rows=protocol.byte_ceilings.map(ceiling_bytes=>({ceiling_bytes,selected:choices('bytes',ceiling_bytes)}));
  c.error_rows=protocol.e2_targets_m2.map(target_e2_m2=>({target_e2_m2,selected:choices('error',target_e2_m2)}));
  result.cases.push(c);
}
for(const field of new Set(result.cases.map(c=>c.field.id))){
  const summary={};
  for(const [mode,column] of [['byte_rows','e2_m2'],['error_rows','binary_bytes']]){
    const counts={wins:0,ties:0,losses:0,only_fitted:0,only_adaptive:0,neither:0};
    for(const c of result.cases.filter(c=>c.field.id===field))for(const row of c[mode]){
      const f=row.selected.fitted,a=row.selected.adaptive_pt;
      const status=!f||!a?f?'only_fitted':a?'only_adaptive':'neither':c.models[f][column]<c.models[a][column]?'wins':c.models[f][column]===c.models[a][column]?'ties':'losses';counts[status]++;
    }
    summary[mode]=counts;
  }
  result.summary[field]=summary;
}
const csv=[['case_id','mode','threshold','method','status','compact_file','complete_bytes','E2_m2','original_file_bytes','original_N'].join(',')];
for(const c of result.cases)for(const [mode,threshold] of [['byte_rows','ceiling_bytes'],['error_rows','target_e2_m2']])for(const row of c[mode])for(const [method,key] of Object.entries(row.selected)){
  const e=c.models[key];csv.push([c.id,mode,row[threshold],method,e?'eligible':'no_archived_candidate',e?.binary_filename??'',e?.binary_bytes??'',e?.e2_m2??'',e?.original.binary_bytes??'',e?c.provenance[key].join(';'):''].join(','));
}
await writeFile(path.join(output,'results.json'),packed(result),{flag:'wx'});
await writeFile(path.join(output,'all-decisions.csv'),csv.join('\n')+'\n',{flag:'wx'});
console.log(JSON.stringify({cases:result.cases.length,stats:result.stats,summary:result.summary},null,2));
