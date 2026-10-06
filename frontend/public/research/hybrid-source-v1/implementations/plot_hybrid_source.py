"""Scientific real-source results figure with all twenty fixed windows."""
import math
from reportlab.graphics.shapes import Drawing,Rect,String,Line,Circle
from reportlab.graphics import renderSVG
from reportlab.lib.colors import HexColor
def plot(report,path):
    d=Drawing(1100,915);d.add(Rect(0,0,1100,915,fillColor=HexColor('#ffffff'),strokeColor=None))
    def text(x,y,s,size=10,color='#426351',bold=False,anchor='start'):d.add(String(x,y,s,fontName='Helvetica-Bold' if bold else 'Helvetica',fontSize=size,fillColor=HexColor(color),textAnchor=anchor))
    text(25,884,'Real 1m DTM: C0 ruled / P1 triangle mixtures on fixed tensor grids',18,bold=True)
    text(25,861,'20 fixed source windows; whole-domain E2 and continuous maximum error; actual shared-XYZ GPR4 file bytes.',11)
    text(35,827,'A / 8192-byte ceiling: selected whole-domain E2 relative to selected P1',12,bold=True)
    text(627,827,'B / 0.10 m guarded source-error target: complete file cost',12,bold=True)
    text(627,808,'Compared with 135.528 kB full-resolution source ruled bands.',9)
    for x in [245,625]:d.add(Line(x,167,x,787,strokeColor=HexColor('#d6e2d9'),strokeWidth=.8))
    d.add(Line(245,167,550,167,strokeColor=HexColor('#8a9f90')))
    ratios=[p[family]['e2_m2']/p['p1']['e2_m2'] for c in report['cases'] for p in c['byte_pairs'] if p['byte_ceiling']==8192 for family in ['ruled','hybrid']];axismax=max(1.5,math.ceil(max(ratios)*2)/2)
    for value in [axismax*j/3 for j in range(4)]:
        x=245+305*value/axismax;d.add(Line(x,167,x,785,strokeColor=HexColor('#edf1ed'),strokeWidth=.5));text(x,150,f'{value:.2f}',9,anchor='middle')
    for i,c in enumerate(report['cases']):
        y=778-i*29.5;p=next(p for p in c['byte_pairs'] if p['byte_ceiling']==8192);target=next(p for p in c['target_pairs'] if p['height_target_m']==.1);label=c['id'].replace('-north-quarter',' / north').replace('-centre',' / centre');text(25,y-2,label,9)
        for j,(family,color) in enumerate([('ruled','#bd9860'),('hybrid','#208872')]):
            ratio=p[family]['e2_m2']/p['p1']['e2_m2'];x=245+305*ratio/axismax;d.add(Circle(x,y+(3 if j==0 else -3),3,fillColor=HexColor(color),strokeColor=None))
        for j,(family,color) in enumerate([('p1','#517b92'),('ruled','#bd9860'),('hybrid','#208872')]):
            e=target[family];yy=y+7-7*j
            if e:
                width=e['binary_bytes']/135528*295;d.add(Rect(627,yy,width,5,fillColor=HexColor(color),strokeColor=None));text(929,yy-1,f'{e["binary_bytes"]/1000:.3f} kB',7)
            else:text(929,yy-1,'No qualifying candidate',7,color='#a96851')
    for i,(label,color) in enumerate([('P1 triangles','#517b92'),('Ruled bands','#bd9860'),('Local C0 mixture','#208872')]):
        x=25+i*225;d.add(Rect(x,119,14,5,fillColor=HexColor(color),strokeColor=None));text(x+21,117,label,9)
    text(25,91,'All 2940 candidates retained. Mixtures minimize local E2 at each grid; split-run metadata counts and can increase complete file cost.',9)
    text(25,70,'Source-relative continuous bilinear reference, not surveyed ground. Maximum bounds include source-cell corner and triangle-diagonal extrema.',9)
    text(25,49,'Common tensor edge functions ensure C0, not C1. Fixed finite grids, not paper-style adaptive P1, globally optimal encoding or ArcGIS software.',9)
    text(25,28,'Independent saved-function integration and native height/gradient/edge checks. Lossy maximum-target simplification is distinct from exact source preservation.',9)
    renderSVG.drawToFile(d,str(path))
