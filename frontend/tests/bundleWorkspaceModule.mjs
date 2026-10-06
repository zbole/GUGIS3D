// Resolve only authorized repository files without probing protected parent directories.
import {build} from 'esbuild';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
export async function bundleWorkspaceModule(entry,outfile,{define,plugins=[]}={}){
  const within=p=>{const rel=path.relative(root,p);if(rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Test import leaves repository');return p;};
  return build({entryPoints:['workspace-entry'],outfile,bundle:true,format:'esm',platform:'node',jsx:'automatic',tsconfigRaw:{compilerOptions:{}},define,plugins:[...plugins,{
    name:'explicit-workspace-files',setup(builder){
      builder.onResolve({filter:/^workspace-entry$/},()=>({path:within(entry),namespace:'workspace-source'}));
      builder.onResolve({filter:/.*/,namespace:'workspace-source'},async args=>{
        if(!args.path.startsWith('.'))return {path:args.path,external:true};
        const absolute=within(path.resolve(path.dirname(args.importer),args.path));
        for(const suffix of ['', '.ts','.tsx','.js','.mjs','.json']){const p=within(absolute+suffix);try{if((await stat(p)).isFile())return {path:p,namespace:'workspace-source'};}catch(e){if(e.code!=='ENOENT')throw e;}}
        throw new Error('Missing test module '+absolute);
      });
      builder.onLoad({filter:/.*/,namespace:'workspace-source'},async args=>{
        const extension=path.extname(args.path);return extension==='.css'?{contents:'',loader:'js'}:{contents:await readFile(within(args.path),'utf8'),loader:{'.ts':'ts','.tsx':'tsx','.json':'json'}[extension]??'js'};
      });
    }
  }]});
}
