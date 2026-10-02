"""Four distinct design assemblies, not claims of surveyed Bristol landmarks."""
import math
from .british_generator import Assembly, STONE, BRICK, TRIM, IRON

def generate_extra(p):
    h=p.floor_height
    height=p.floors*h
    b=Assembly(p,height)
    b.nodes[0]['attributes'].update({'数据来源':'英式建筑类型设计模型（非实测）','原生表达':'参数盒体与封闭网格组件；未将整栋编码为解析函数'})
    for unit in range(1,p.units+1):
        b.unit=unit
        base=(unit-(p.units+1)/2)*75
        b.offset=(base,0)
        if p.kind in {'tudor','warehouse'}:
            w,d=(9,12) if p.kind=='tudor' else (20,24)
            bays=3 if p.kind=='tudor' else 5
            for level in range(p.floors):
                z=level*h
                for angle in (0,math.pi):
                    b.angle=angle
                    b.facade(w,d,z,h,bays,STONE if p.kind=='tudor' else BRICK,False)
                for angle in (math.pi/2,3*math.pi/2):
                    b.angle=angle
                    b.facade(d,w,z,h,max(3,int(d/4)),BRICK,False)
                b.angle=0
                b.box('承重楼板',(w,d,.25),(0,0,z+.125),TRIM,'slab')
                for step in range(12):
                    b.box('内部楼梯',(1.2,.3,.16),(w/2-1,-2+step*.3,z+(step+1)*h/12),TRIM,'stair')
                if p.kind=='tudor':
                    for face in (-1,1):
                        yy=face*(d/2+.4)
                        for xx in (-w/2,0,w/2):
                            b.box('外露竖向木构',(.2,.22,h),(xx,yy,z+h/2),IRON,'column')
                        b.box('水平木梁',(w,.24,.2),(0,yy,z+h),IRON,'ornament')
                        for xx in (-w/2,0):
                            b.profile('斜撑木构',[(0,0),(.18,0),(w/2,h),(w/2-.18,h)],.2,(xx,yy,z),IRON,'ornament',True)
                else:
                    for xx in (-6,0,6):
                        for yy in (-8,0,8):
                            b.octagon('仓库内部柱',.22,h,(xx,yy,z),IRON,'column')
                        b.box('跨间楼层梁',(.24,d,.35),(xx,0,z+h-.2),IRON,'ornament')
            if p.kind=='tudor':
                b.roof(0,0,height,w+.6,d+.6,3.4)
                b.profile('前后尖山墙',[(-w/2,0),(w/2,0),(0,3.4)],.3,(0,-d/2,height),TRIM,'wall',True)
                b.box('高烟囱',(.9,1.3,4),(3,2,height+2),BRICK,'ornament')
                b.window(0,-d/2-.35,height+.4,1.1,1.5,False)
            else:
                for yy in (-8,0,8): b.roof(0,yy,height,w+.5,8,2.5)
                b.box('装卸吊梁',(.3,5,.3),(0,-d/2-2,height+1),IRON,'ornament')
                b.box('装卸垂直拉杆',(.15,.15,height*.65),(0,-d/2-4,height*.68),IRON,'ornament')
            b.box('入口双扇门',(2,.2,2.4),(0,-d/2-.6,1.2),IRON,'door')
        elif p.kind=='chapel':
            b.hall(base,0,14,28,height,5)
            b.tower(base-10,-10,6,height*1.25,max(2,min(5,p.floors)))
            b.offset=(base,0)
            b.box('中轴入口门',(2,.3,3),(0,-14.4,1.5),IRON,'door')
            for i in range(8):
                for xx in (-3,3): b.box('成排长椅',(4,.55,.9),(xx,-9+i*2.4,.45),TRIM,'ornament')
        else:
            b.hall(base-15,0,12,24,height,4)
            b.hall(base+15,0,12,24,height,4)
            b.tower(base,0,9,height*1.6,max(2,min(5,p.floors)))
            b.offset=(base,0)
            b.box('门廊横梁',(14,3,.5),(0,-8,4.2),TRIM,'ornament')
            for xx in (-6,-3,3,6): b.octagon('入口柱廊',.3,4,(xx,-8,0),TRIM,'column')
            outline=[(1.5*math.cos(i*math.pi/12),1.5*math.sin(i*math.pi/12)) for i in range(24)]
            b.profile('钟面圆盘',outline,.15,(0,-4.85,height*1.2),TRIM,'ornament',True)
            b.box('钟面时针',(.12,.18,1.1),(0,-5.05,height*1.2+.45),IRON,'railing')
            b.box('钟面分针',(1.25,.18,.1),(.5,-5.05,height*1.2),IRON,'railing')
    return b.finish()
