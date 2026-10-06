"""Publish complete new-window evidence, separate from the immutable twenty sites."""
import argparse,csv,io,json,math,shutil,zipfile
from pathlib import Path
import numpy as np
from exeter_source_fit_benchmark import ROOT,pinned_inputs
from source_band_benchmark import sha,packed

DEST=ROOT/'frontend/public/research/exeter-source-fit-v1';VIEW=ROOT/'shared/exeter-source-fit-v1.json'
def checked(path,digest,length=None):
    raw=path.read_bytes()
    if sha(raw)!=digest or length is not None and len(raw)!=length:raise ValueError('Changed evidence: '+str(path))
    return raw
def compact(e):
    if e is None:return None
    return {k:e[k] for k in ['id','method','binary_filename','binary_bytes','binary_sha256','nx','ny','e2_m2','continuous_bound_m','continuous_maximum_m','ruled_cells','p1_triangles','stored_points','stored_patches']}|{'fit_status':e['solver']['status'],'original_e2_m2':e['original']['e2_m2'],'original_maximum_m':e['original']['continuous_maximum_m']}
def original(e):
    if e is None:return None
    o=e['original'];return compact(e)|{k:o[k] for k in ['binary_filename','binary_bytes','binary_sha256','e2_m2','continuous_maximum_m']}|{'id':e['id']+'-unfitted','method':e['method']+'-unfitted','continuous_bound_m':o['continuous_maximum_m']+e['float64_guard_m'],'fit_status':'unfitted'}
def unfitted_rows(c,p,name):
    result=[];budget=name=='byte_pairs';axis=p['byte_ceilings'] if budget else p['height_targets_m'];key='byte_ceiling' if budget else 'height_target_m'
    for limit in axis:
        row={key:limit}
        for m in p['methods']:
            pool=[e for e in c['candidates'] if e['method']==m and (e['binary_bytes'] if budget else e['original']['continuous_maximum_m']+e['float64_guard_m'])<=limit]
            order=(lambda e:(e['original']['e2_m2'],e['binary_bytes'],e['nx'],e['ny'])) if budget else (lambda e:(e['binary_bytes'],e['original']['e2_m2'],e['nx'],e['ny']))
            row[m+'-unfitted']=original(min(pool,key=order,default=None))
        result.append(row)
    return result
def verify_receipts(folder):
    p,pr=pinned_inputs();raw=(folder/'results.json').read_bytes();r=json.loads(raw)
    if (folder/'protocol.json').read_bytes()!=pr or r['protocol_sha256']!=sha(pr) or r['inputs']!=p['inputs'] or r['code']!=p['code']:raise ValueError('Frozen source identity changed')
    audits={name:json.loads((folder/name).read_bytes()) for name in ['native-audit.json','integral-audit.json','source-controls-audit.json']}
    if any(a['report_sha256']!=sha(raw) for a in audits.values()):raise ValueError('Audit bound to another result')
    native=audits['native-audit.json'];independent=audits['integral-audit.json'];controls=audits['source-controls-audit.json']
    if native['native_models']!=294 or native['queries']!=294*5249 or independent['fitted_models']!=294 or independent['unfitted_models']!=294 or independent['independent_decisions']!=96 or controls['native_models']!=6 or controls['source_grids']!=2 or controls['queries']!=6*8321:raise ValueError('Incomplete cohort audit')
    if [c['source_window'] for c in r['cases']]!=p['windows']:raise ValueError('Changed window selection')
    native_rows={(e['case_id'],e['filename']):e for e in native['models']};integral_rows={(e['case_id'],e['id']):e for e in independent['models']};control_rows={(e['case_id'],e['family']):e for e in controls['models']}
    if len(native_rows)!=294 or len(integral_rows)!=294 or len(control_rows)!=6:raise ValueError('Duplicate audit entries')
    for c in r['cases']:
        if len(c['candidates'])!=147:raise ValueError('Incomplete fitted grids')
        checked(folder/c['id']/'reference.json',c['reference_sha256']);checked(folder/c['id']/c['source_geotiff']['filename'],c['source_geotiff']['sha256'],c['source_geotiff']['bytes']);checked(folder/c['id']/c['regular_grid']['filename'],c['regular_grid']['sha256'],c['regular_grid']['bytes'])
        for e in c['candidates']:
            for entry in [e,e['original']]:checked(folder/c['id']/entry['filename'],entry['sha256'],entry['bytes']);checked(folder/c['id']/entry['binary_filename'],entry['binary_sha256'],entry['binary_bytes'])
            n=native_rows[(c['id'],e['filename'])];i=integral_rows[(c['id'],e['id'])];seams=7*((e['nx']-1)*e['ny']+(e['ny']-1)*e['nx'])
            if n['binary_sha256']!=e['binary_sha256'] or i['binary_sha256']!=e['binary_sha256'] or n['queries']!=5249 or n['seam_height_pairs']!=seams or not i['whole_domain_integral_verified'] or not i['unfitted_integral_verified'] or not n['maximum_witness_verified'] or not n['outside_rejected']:raise ValueError('Model audit incomplete')
            if any(not math.isfinite(n[k]) or not 0<=n[k]<1e-8 for k in ['independent_height_difference_m','independent_gradient_difference','frame_difference_m','seam_height_difference_m']):raise ValueError('Native discrepancy')
            if e['binary_bytes']!=e['original']['binary_bytes']:raise ValueError('Fitting grew a file')
        for e in c['controls']:
            checked(folder/c['id']/e['binary_filename'],e['binary_sha256'],e['binary_bytes']);a=control_rows[(c['id'],e['family'])]
            if a['binary_sha256']!=e['binary_sha256'] or any(not 0<=a[k]<1e-8 for k in ['independent_height_difference_m','independent_gradient_difference']):raise ValueError('Source control differs')
    for path,digest in p['code'].items():checked(folder/'implementation'/path,digest)
    return p,r,audits
def aggregation(r):
    candidates=[e for c in r['cases'] for e in c['candidates']];fixed=[next(row for row in c['byte_pairs'] if row['byte_ceiling']==8192) for c in r['cases']];allrows=[row for c in r['cases'] for row in c['byte_pairs']]
    def counts(rows,other):
        out=dict(wins=0,ties=0,losses=0,missing=0)
        for row in rows:
            h,a=row['hybrid-fit'],row[other];key='missing' if not h or not a else 'wins' if h['e2_m2']<a['e2_m2'] else 'losses' if h['e2_m2']>a['e2_m2'] else 'ties';out[key]+=1
        return out
    return {'default_budget_bytes':8192,'hybrid_vs_p1':counts(fixed,'p1-fit'),'hybrid_vs_ruled':counts(fixed,'ruled-fit'),'all_budgets_vs_p1':counts(allrows,'p1-fit'),'all_budgets_vs_ruled':counts(allrows,'ruled-fit'),'fitting':{'models':len(candidates),'fallbacks':sum(e['solver']['status']=='fallback_original' for e in candidates),'identities':sum(e['solver']['status']=='exact_source_space_identity' for e in candidates),'strict_e2_improvements':sum(e['e2_m2']<e['original']['e2_m2'] for e in candidates),'maximum_increases':sum(e['continuous_maximum_m']>e['original']['continuous_maximum_m']+e['float64_guard_m'] for e in candidates)}}
def plot(folder,r):
    import matplotlib;matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    colors={'p1-fit':'#537fb0','ruled-fit':'#aaa66b','hybrid-fit':'#19896e'};labels={'p1-fit':'Two-diagonal P1','ruled-fit':'Pure ruled bands','hybrid-fit':'Hybrid'}
    fig,axes=plt.subplots(1,2,figsize=(12,4.9),layout='constrained')
    for ax,c in zip(axes,r['cases']):
        for m,color in colors.items():
            es=[e for e in c['candidates'] if e['method']==m]
            ax.scatter([e['binary_bytes'] for e in es],[max(e['original']['e2_m2'],1e-12) for e in es],s=17,marker='o',facecolors='none',edgecolors=color,alpha=.4,label=labels[m]+' unfitted')
            ax.scatter([e['binary_bytes'] for e in es],[max(e['e2_m2'],1e-12) for e in es],s=19,color=color,alpha=.85,label=labels[m]+' shared fit')
            e=next(row for row in c['byte_pairs'] if row['byte_ceiling']==8192)[m];ax.scatter(e['binary_bytes'],max(e['e2_m2'],1e-12),s=55,marker='D',facecolors='none',edgecolors='#233e34',linewidths=1.1)
        ax.set(xscale='log',yscale='log',title=c['id'],xlabel='Complete native file / bytes',ylabel='Whole-domain source-relative E2 / m2');ax.axvline(8192,color='#a5b6aa',linestyle='--',linewidth=.8);ax.grid(alpha=.15);ax.tick_params(labelsize=9)
    fig.legend(*axes[0].get_legend_handles_labels(),loc='outside lower center',ncols=3,fontsize=8)
    fig.suptitle('New Exeter windows / 49 frozen grids / equal shared-C0 fitting',fontsize=13)
    fig.supxlabel('All 294 fitted + 294 unfitted candidates. Diamonds: 8192 B minima. Zero identities drawn at 1e-12 for log display only.',fontsize=8)
    fig.savefig(folder/'exeter-source-fit-results.svg');fig.savefig(folder/'exeter-source-fit-results.png',dpi=150);plt.close(fig)
def publish(folder):
    p,r,audits=verify_receipts(folder)
    if DEST.exists() or VIEW.exists():raise FileExistsError('Immutable new-window release already exists')
    agg=aggregation(r);buffer=io.StringIO(newline='');writer=csv.writer(buffer);writer.writerow(['case_id','condition','threshold','method','candidate','complete_bytes','E2_m2','continuous_bound_m'])
    cases=[]
    for c in r['cases']:
        ui={k:c[k] for k in ['id','city_id','name','source_window','origin_bng','reference_sha256','source_geotiff','regular_grid','controls']};ui['models']={e['id']:compact(e) for e in c['candidates']}
        for name,key in [('byte_pairs','byte_ceiling'),('target_pairs','height_target_m')]:
            ui[name]=[]
            for row,old in zip(c[name],unfitted_rows(c,p,name)):
                a={key:row[key]}
                for method in p['methods']:
                    e=row[method];a[method]=e['id'] if e else None;o=old[method+'-unfitted'];a[method+'-unfitted']=o['id'] if o else None
                    if o:ui['models'][o['id']]=o
                    for label,model in [(method,compact(e)),(method+'-unfitted',o)]:writer.writerow([c['id'],key,row[key],label,*([model['id'],model['binary_bytes'],model['e2_m2'],model['continuous_bound_m']] if model else ['NO_FEASIBLE_MODEL','','',''])])
                ui[name].append(a)
        cases.append(ui)
    (folder/'selections.csv').write_bytes(buffer.getvalue().encode());(folder/'aggregate.json').write_bytes(packed(agg));plot(folder,r)
    # Copy only measured evidence and frozen source implementations, not temporary bundled audit runners.
    DEST.mkdir(parents=True)
    for path in folder.rglob('*'):
        if path.is_file() and path.name not in ['audit-native-kernel.mjs','audit-source-controls-kernel.mjs']:
            dest=DEST/path.relative_to(folder);dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(path,dest)
    extra=['data-pipeline/publish_exeter_source_fit.py','frontend/scripts/audit-exeter-source-controls.mjs']
    for path in extra:
        dest=DEST/'implementation'/path;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((ROOT/path).read_bytes().replace(b'\r\n',b'\n'))
    name='exeter-source-fit-evidence.zip'
    with zipfile.ZipFile(DEST/name,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for path in sorted(DEST.rglob('*')):
            if path.is_file() and path.name!=name:archive.write(path,path.relative_to(DEST).as_posix())
    package=(DEST/name).read_bytes();source=next(s for s in json.loads((ROOT/'shared/public-terrain-sources-v9.json').read_bytes())['sources'] if s['city_id']=='exeter')
    view={'schema':'gugis-exeter-source-fit-display-v1','scope':p['scope'],'report_sha256':sha((DEST/'results.json').read_bytes()),'protocol_sha256':r['protocol_sha256'],'source':source,'cases':cases,'aggregate':agg,'native_queries':audits['native-audit.json']['queries'],'seam_height_pairs':audits['native-audit.json']['seam_height_pairs'],'source_control_queries':audits['source-controls-audit.json']['queries'],'independent_decisions':96,'package':{'filename':name,'bytes':len(package),'sha256':sha(package)}}
    blob=packed(view);VIEW.write_bytes(blob);(DEST/'publication.json').write_bytes(blob);index={'schema':'gugis-exeter-source-fit-index-v1','files':{path.relative_to(DEST).as_posix():{'bytes':path.stat().st_size,'sha256':sha(path.read_bytes())} for path in sorted(DEST.rglob('*')) if path.is_file()}}
    (DEST/'index.json').write_bytes(packed(index));print(json.dumps({'aggregate':agg,'view_bytes':len(blob),'public_files':len(index['files']),'package':view['package'],'report_sha256':view['report_sha256']},indent=2));return view
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('folder',type=Path);publish(parser.parse_args().folder)
