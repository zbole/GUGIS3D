"""Continuous source-relative errors for C0 tensor-grid ruled/P1 mixtures."""
import math
import numpy as np
from source_band_benchmark import surface,binary,packed
T,W=np.polynomial.legendre.leggauss(3);T=(T+1)/2;W=W/2
U,V=np.meshgrid(T,T,indexing='ij');WU,WV=np.meshgrid(W,W,indexing='ij')
B=U.ravel();C=((1-U)*V).ravel();A=1-B-C;TW=(WU*WV*(1-U)).ravel()
def masses(residual):
    a,b,c,d=residual[:-1,:-1],residual[:-1,1:],residual[1:,:-1],residual[1:,1:]
    result=(a*a+b*b+c*c+d*d+a*b+a*c+b*d+c*d)/9+(a*d+b*c)/18
    if np.min(result)<-1e-12:raise ValueError('Squared residual mass became negative')
    return np.maximum(0,result)
def diagonal_clip(polygon,width,height,lower):
    out=[];sign=-1 if lower else 1
    for i,b in enumerate(polygon):
        a=polygon[i-1];va=a[0]/width+a[1]/height-1;vb=b[0]/width+b[1]/height-1;ai=sign*va>=0;bi=sign*vb>=0
        if ai!=bi:out.append(a+va/(va-vb)*(b-a))
        if bi:out.append(b)
    return out
def bilinear(z,x,y):
    a,b,c,d=z[0,0],z[0,1],z[1,0],z[1,1]
    return a+(b-a)*x+(c-a)*y+(a-b-c+d)*x*y
def block_metrics(source,x0,x1,y0,y1):
    z=np.asarray(source[y0:y1+1,x0:x1+1],float);height,width=z.shape[0]-1,z.shape[1]-1
    x,y=np.meshgrid(np.arange(width+1),np.arange(height+1));u=x/width;v=y/height;a,b,c,d=z[0,0],z[0,-1],z[-1,0],z[-1,-1]
    ruled=a+(b-a)*u+(c-a)*v+(a-b-c+d)*u*v;rr=z-ruled
    low=a+(b-a)*u+(c-a)*v;high=d+(c-d)*(1-u)+(b-d)*(1-v);rl=z-low;rh=z-high
    base=(u+v)[:-1,:-1];step=1/width+1/height;below=base+step<=1;above=base>=1;cross=~(below|above)
    ml,mh=masses(rl),masses(rh);squared=np.where(below,ml,mh)
    residual=np.where(u+v<=1,rl,rh);j,i=np.unravel_index(np.argmax(abs(residual)),residual.shape)
    maximum=float(abs(residual[j,i]));witness=[x0+int(i)-32,y0+int(j)-32]
    for j,i in zip(*np.where(cross)):
        corners=[np.array(p,float) for p in [(i,j),(i+1,j),(i+1,j+1),(i,j+1)]];values=z[j:j+2,i:i+2];pieces=[]
        def delta(xy,lower):
            xy=np.asarray(xy);u=xy[...,0]/width;v=xy[...,1]/height;plane=a+(b-a)*u+(c-a)*v if lower else d+(c-d)*(1-u)+(b-d)*(1-v)
            return bilinear(values,xy[...,0]-i,xy[...,1]-j)-plane
        for lower in (True,False):
            polygon=diagonal_clip(corners,width,height,lower)
            for k in range(1,len(polygon)-1):
                pa,pb,pc=polygon[0],polygon[k],polygon[k+1];det=abs(float(np.linalg.det(np.column_stack((pb-pa,pc-pa)))));xy=A[:,None]*pa+B[:,None]*pb+C[:,None]*pc;pieces.append(float(np.dot(TW,delta(xy,lower)**2))*det)
        squared[j,i]=math.fsum(pieces)
        # Interior stationary points are saddles for a bilinear source minus a plane.
        # Axis-aligned edges are linear; only the oblique shared diagonal adds extrema.
        ends=[]
        for p in diagonal_clip(corners,width,height,True):
            if abs(p[0]/width+p[1]/height-1)<1e-12 and not any(np.linalg.norm(p-q)<1e-10 for q in ends):ends.append(p)
        if len(ends)>=2:
            pa,pb=max(((a,b) for a in ends for b in ends),key=lambda pair:np.linalg.norm(pair[0]-pair[1]));e0,em,e1=map(float,delta(np.array([pa,(pa+pb)/2,pb]),True));alpha=2*(e1-2*em+e0);beta=e1-e0-alpha
            for t in [0.,1.]+([-beta/(2*alpha)] if abs(alpha)>1e-15 and 0<-beta/(2*alpha)<1 else []):
                point=pa+t*(pb-pa);error=abs(float(delta(point,True)))
                if error>maximum:maximum=error;witness=[float(x0+point[0]-32),float(y0+point[1]-32)]
    j,i=np.unravel_index(np.argmax(abs(rr)),rr.shape)
    return {'ruled':{'l2_squared':float(np.sum(masses(rr))),'maximum_m':float(abs(rr[j,i])),'witness_xy':[x0+int(i)-32,y0+int(j)-32]},
            'p1':{'l2_squared':float(np.sum(squared)),'maximum_m':maximum,'witness_xy':witness}}
def make_model(reference,nx,ny,families):
    if 64%nx or 64%ny or len(families)!=nx*ny:raise ValueError('Fixed integer tensor grid required')
    z=np.asarray(reference['height']);xs=np.arange(nx+1)*64//nx;ys=np.arange(ny+1)*64//ny
    points=[[float(x-32),float(y-32),float(z[y,x])] for y in ys for x in xs];patches=[]
    for j in range(ny):
        start=0
        while start<nx:
            family=families[j*nx+start];end=start+1
            while end<nx and families[j*nx+end]==family:end+=1
            left=[j*(nx+1)+i for i in range(start,end+1)];right=[(j+1)*(nx+1)+i for i in range(start,end+1)]
            if family=='ruled':patches.append({'kind':'ruled-strip','left':left,'right':right})
            elif family=='p1':patches.append({'kind':'triangle-strip','indices':[n for pair in zip(left,right) for n in pair]})
            else:raise ValueError('Unknown tensor cell family')
            start=end
    return surface(reference,points,patches)
def grid(reference,nx,ny,cache):
    z=np.asarray(reference['height']);xs=np.arange(nx+1)*64//nx;ys=np.arange(ny+1)*64//ny;metrics=[]
    for j in range(ny):
        for i in range(nx):
            key=(int(xs[i]),int(xs[i+1]),int(ys[j]),int(ys[j+1]))
            if key not in cache:cache[key]=block_metrics(z,*key)
            metrics.append(cache[key])
    result={};guard=1e-9+float(np.abs(z).max())*1e-12
    for method in ['ruled','p1','hybrid']:
        families=[min(['ruled','p1'],key=lambda k:(m[k]['l2_squared'],0 if k=='ruled' else 1)) if method=='hybrid' else method for m in metrics]
        chosen=[m[family] for m,family in zip(metrics,families)];maximum=max(chosen,key=lambda m:m['maximum_m']);model=make_model(reference,nx,ny,families);raw=binary(model);e2=math.sqrt(math.fsum(m['l2_squared'] for m in chosen))
        result[method]=(model,{'nx':nx,'ny':ny,'method':method,'e2_m2':e2,'rms_integral_m':e2/64,'continuous_maximum_m':maximum['maximum_m'],'maximum_witness_xy':maximum['witness_xy'],'continuous_bound_m':maximum['maximum_m']+guard,'float64_guard_m':guard,'integrated_area_m2':4096,'binary_bytes':len(raw),'stored_points':len(model['points']),'stored_patches':len(model['patches']),'ruled_cells':families.count('ruled'),'p1_triangles':2*families.count('p1'),'native_primitives':families.count('ruled')+2*families.count('p1'),'families':families})
    return result
