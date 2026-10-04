"""Research reference: continuous piecewise-bilinear interpolation of a raster.

This is a reference-grid certificate, not a bound against unmeasured ground.
The extrema calculation is exact in real arithmetic; a floating-point guard is
added, without claiming machine-verified interval arithmetic.
"""
import numpy as np
from functools import lru_cache


class RasterReference:
    def __init__(self,x,y,height):
        self.x=np.asarray(x,dtype=float).copy();self.y=np.asarray(y,dtype=float).copy()
        self.height=np.asarray(height,dtype=float).copy()
        if (self.x.ndim!=1 or self.y.ndim!=1 or min(len(self.x),len(self.y))<2
            or len(self.x)*len(self.y)>1000000 or self.height.shape!=(len(self.y),len(self.x))
            or not all(np.isfinite(a).all() for a in (self.x,self.y,self.height))
            or np.any(np.diff(self.x)<=0) or np.any(np.diff(self.y)<=0)):
            raise ValueError('Invalid finite raster reference; NoData is not bridged')
        self.guard_m=1e-9+float(np.abs(self.height).max())*1e-12
        for a in (self.x,self.y,self.height):a.setflags(write=False)

    def __call__(self,x,y):
        x,y=np.broadcast_arrays(np.asarray(x,dtype=float),np.asarray(y,dtype=float))
        if (not np.isfinite(x).all() or not np.isfinite(y).all()
            or np.any(x<self.x[0]-1e-10) or np.any(x>self.x[-1]+1e-10)
            or np.any(y<self.y[0]-1e-10) or np.any(y>self.y[-1]+1e-10)):
            raise ValueError('Reference query outside raster domain')
        x=np.clip(x,self.x[0],self.x[-1]);y=np.clip(y,self.y[0],self.y[-1])
        ix=np.clip(np.searchsorted(self.x,x,side='right')-1,0,len(self.x)-2)
        iy=np.clip(np.searchsorted(self.y,y,side='right')-1,0,len(self.y)-2)
        u=(x-self.x[ix])/(self.x[ix+1]-self.x[ix]);v=(y-self.y[iy])/(self.y[iy+1]-self.y[iy])
        a=self.height[iy,ix];b=self.height[iy,ix+1];c=self.height[iy+1,ix];d=self.height[iy+1,ix+1]
        return (1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d

    def triangle_error(self,vertices):
        """Maximum error of the vertex interpolant over the whole triangle.

        On each source rectangle the residual is A+Bx+Cy+Dxy. Its Hessian
        is indefinite (or affine), so |residual| has a maximum on the clipped
        polygon boundary. Grid-aligned pieces are linear; triangle-edge pieces
        are quadratic. Raster vertices inside the triangle plus all edge
        crossing/end/stationary points therefore exhaust possible maxima.
        """
        p=np.asarray(vertices,dtype=float)
        if p.shape!=(3,2) or not np.isfinite(p).all():raise ValueError('Invalid triangle')
        matrix=np.column_stack((p[1]-p[0],p[2]-p[0]))
        determinant=np.linalg.det(matrix)
        if abs(determinant)<1e-12:raise ValueError('Degenerate reference triangle')
        controls=self(p[:,0],p[:,1]);inverse=np.linalg.inv(matrix)
        def plane(sites):
            uv=(sites-p[0])@inverse.T
            return controls[0]+uv[:,0]*(controls[1]-controls[0])+uv[:,1]*(controls[2]-controls[0])
        x0,y0=p.min(axis=0);x1,y1=p.max(axis=0)
        xs=self.x[(self.x>=x0-1e-10)&(self.x<=x1+1e-10)]
        ys=self.y[(self.y>=y0-1e-10)&(self.y<=y1+1e-10)]
        xx,yy=np.meshgrid(xs,ys);sites=np.column_stack((xx.ravel(),yy.ravel()))
        maximum=0.
        if len(sites):
            uv=(sites-p[0])@inverse.T
            sites=sites[(uv[:,0]>=-1e-10)&(uv[:,1]>=-1e-10)&(uv.sum(axis=1)<=1+1e-10)]
            if len(sites):maximum=float(np.abs(self(sites[:,0],sites[:,1])-plane(sites)).max())
        for a,b in zip(p,np.roll(p,-1,axis=0)):
            delta=b-a;parts=[np.asarray([0.,1.])]
            for axis,grid in enumerate((self.x,self.y)):
                if abs(delta[axis])>1e-14:
                    t=(grid-a[axis])/delta[axis];parts.append(t[(t>0)&(t<1)])
            t=np.unique(np.concatenate(parts));sites=a+t[:,None]*delta
            error=self(sites[:,0],sites[:,1])-plane(sites)
            maximum=max(maximum,float(np.abs(error).max()))
            middle=a+((t[:-1]+t[1:])/2)[:,None]*delta
            mid_error=self(middle[:,0],middle[:,1])-plane(middle)
            quadratic=2*(error[:-1]+error[1:]-2*mid_error)
            linear=error[1:]-error[:-1]-quadratic
            keep=np.abs(quadratic)>1e-15
            roots=np.zeros(len(quadratic));np.divide(-linear,2*quadratic,out=roots,where=keep)
            keep&=(roots>0)&(roots<1)
            if np.any(keep):
                values=error[:-1][keep]+linear[keep]*roots[keep]+quadratic[keep]*roots[keep]**2
                maximum=max(maximum,float(np.abs(values).max()))
        return maximum+self.guard_m

    def model_error(self,terrain):
        """Certify saved strips against this reference; aligned quads only."""
        points=np.asarray(terrain['points']);maximum=0.;triangles=0;quads=0
        for patch in terrain['patches']:
            if patch['kind']=='ruled-strip':
                for a,b,c,d in zip(patch['left'],patch['right'],patch['left'][1:],patch['right'][1:]):
                    corners=points[[a,b,c,d]];west,south=corners[:,:2].min(axis=0);east,north=corners[:,:2].max(axis=0)
                    lookup={(p[0],p[1]):p[2] for p in corners}
                    positions=[(west,south),(east,south),(west,north),(east,north)]
                    if any(pos not in lookup for pos in positions):raise ValueError('Reference certificate needs rectangular quads')
                    for axis,lo,hi in ((self.x,west,east),(self.y,south,north)):
                        if not np.any(axis==lo) or not np.any(axis==hi):raise ValueError('Ruled certificate requires boundaries on source grid lines')
                    xs=self.x[(self.x>=west)&(self.x<=east)];ys=self.y[(self.y>=south)&(self.y<=north)]
                    xx,yy=np.meshgrid(xs,ys);u=(xx-west)/(east-west);v=(yy-south)/(north-south)
                    a,b,c,d=[lookup[pos] for pos in positions]
                    values=(1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d
                    maximum=max(maximum,float(np.abs(values-self(xx,yy)).max())+self.guard_m);quads+=1
            elif patch['kind']=='triangle-strip':
                for i in range(len(patch['indices'])-2):
                    p=points[patch['indices'][i:i+3]]
                    rounding=float(np.abs(p[:,2]-self(p[:,0],p[:,1])).max())
                    maximum=max(maximum,self.triangle_error(p[:,:2])+rounding);triangles+=1
            else:raise ValueError('Only ruled and triangle strips are certified')
        return {'max_error_bound_m':maximum,'triangles_checked':triangles,'quads_checked':quads,
            'floating_guard_m':self.guard_m,'scope':'Continuous piecewise-bilinear reference raster, not unmeasured ground; real-arithmetic extrema plus floating guard, not interval-verified arithmetic.'}

    @lru_cache(maxsize=131072)
    def cell_certificate(self,x0,x1,y0,y1):
        """Vectorized rectangular certificate plus the two diagonal extrema."""
        c0,c1=np.searchsorted(self.x,[x0,x1]);r0,r1=np.searchsorted(self.y,[y0,y1])
        if c1>=len(self.x) or r1>=len(self.y) or c0>=c1 or r0>=r1 or not np.array_equal(self.x[[c0,c1]],[x0,x1]) or not np.array_equal(self.y[[r0,r1]],[y0,y1]):
            raise ValueError('Cell bounds must be source raster grid lines')
        block=self.height[r0:r1+1,c0:c1+1]
        u=((self.x[c0:c1+1]-x0)/(x1-x0))[None,:]
        v=((self.y[r0:r1+1]-y0)/(y1-y0))[:,None]
        a,b,c,d=block[0,0],block[0,-1],block[-1,0],block[-1,-1]
        ruled=float(np.abs(block-((1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*c+u*v*d)).max())
        diagonals=[np.where(u>=v,a+(b-a)*u+(d-b)*v,a+(d-c)*u+(c-a)*v),
                   np.where(u+v<=1,a+(b-a)*u+(c-a)*v,d+(c-d)*(1-u)+(b-d)*(1-v))]
        bounds=[float(np.abs(block-p).max()) for p in diagonals]
        for i,(start,end,za,zb) in enumerate([([x0,y0],[x1,y1],a,d),([x1,y0],[x0,y1],b,c)]):
            start=np.asarray(start);delta=np.asarray(end)-start
            t=np.unique(np.concatenate(([0.,1.],((self.x[c0:c1+1]-start[0])/delta[0]),((self.y[r0:r1+1]-start[1])/delta[1]))))
            sites=start+t[:,None]*delta;error=self(sites[:,0],sites[:,1])-((1-t)*za+t*zb)
            mid_t=(t[:-1]+t[1:])/2;sites=start+mid_t[:,None]*delta
            mid=self(sites[:,0],sites[:,1])-((1-mid_t)*za+mid_t*zb)
            quadratic=2*(error[:-1]+error[1:]-2*mid);linear=error[1:]-error[:-1]-quadratic
            keep=np.abs(quadratic)>1e-15;roots=np.zeros(len(quadratic));np.divide(-linear,2*quadratic,out=roots,where=keep)
            keep&=(roots>0)&(roots<1)
            bound=float(np.abs(error).max())
            if np.any(keep):bound=max(bound,float(np.abs(error[:-1][keep]+linear[keep]*roots[keep]+quadratic[keep]*roots[keep]**2).max()))
            bounds[i]=max(bounds[i],bound)+self.guard_m
        return {'ruled':ruled+self.guard_m,'triangles':bounds}
