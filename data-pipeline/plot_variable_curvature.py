"""Whole-budget scientific figure, including every loss and the P2 control."""
import math
from reportlab.graphics.shapes import Drawing,Rect,String,Line,PolyLine,Circle
from reportlab.graphics import renderSVG
from reportlab.lib.colors import HexColor
COLORS={'p1':'#517b92','world':'#bd9860','mean_hessian':'#208872','p2':'#8a65a4'}
def plot(report,path):
    d=Drawing(1100,770);d.add(Rect(0,0,1100,770,fillColor=HexColor('#ffffff'),strokeColor=None))
    def text(x,y,s,size=10,color='#426351',bold=False,anchor='start'):d.add(String(x,y,s,fontName='Helvetica-Bold' if bold else 'Helvetica',fontSize=size,fillColor=HexColor(color),textAnchor=anchor))
    text(25,739,'Nonconstant curvature: fixed budgets, rotations and higher-order controls',18,bold=True)
    text(25,716,'Same 100 x 100 m physical square; complete native file-byte and primitive ceilings; all losses retained.',11)
    for i,(key,label) in enumerate([('p1','Paper-style P1'),('world','World-axis ruled'),('mean_hessian','Mean-Hessian ruled'),('p2','P2 on fixed hierarchy')]):
        x=25+265*i;d.add(Line(x,688,x+21,688,strokeColor=HexColor(COLORS[key]),strokeWidth=2));text(x+28,685,label,10)
    fields=['published-quartic','anisotropic-quartic']
    for col,field in enumerate(fields):
        x0=75+535*col;y0=359;w=445;h=255
        text(x0,644,['Published quartic field / source-frame angle 30 deg','Anisotropic quartic field / source-frame angle 30 deg'][col],12,bold=True)
        case=next(c for c in report['cases'] if c['field']['id']==field and c['angle_degrees']==30)
        low=-2;high=3
        for exponent in range(low,high+1):
            y=y0+(exponent-low)/(high-low)*h;d.add(Line(x0,y,x0+w,y,strokeColor=HexColor('#dce6df'),strokeWidth=.6));text(x0-9,y-3,'1e'+str(exponent),9,anchor='end')
        for j,p in enumerate(case['pairs']):text(x0+w*j/8,y0-18,str(p['budget']),9,anchor='middle')
        for key in COLORS:
            coords=[]
            for j,p in enumerate(case['pairs']):
                e=p[key];x=x0+w*j/8;y=y0+(math.log10(e['e2_m2'])-low)/(high-low)*h;coords.extend([x,y]);d.add(Circle(x,y,2.5,fillColor=HexColor(COLORS[key]),strokeColor=None))
            d.add(PolyLine(coords,strokeColor=HexColor(COLORS[key]),strokeWidth=1.8,fillColor=None))
        text(x0+w/2,y0-40,'P1 primitive budget N / log2 steps',10,anchor='middle')
        text(x0,625,'Whole-domain E2 / m2 (log scale)',10)
        allpairs=[p for c in report['cases'] if c['field']['id']==field for p in c['pairs']]
        wins=sum(p['mean_hessian']['e2_m2']<p['p1']['e2_m2'] for p in allpairs)
        text(x0,283,'All 7 rotations x 9 budgets: mean-Hessian ruled beats P1 in '+str(wins)+' / 63 pairs.',11,bold=True)
        text(x0,263,'P2 is selected under the same joint ceiling, from the fixed P1 hierarchy.',9)
        cellw=w/9;cellh=13
        for row,c in enumerate(c for c in report['cases'] if c['field']['id']==field):
            y=231-row*cellh;text(x0-8,y+2,str(c['angle_degrees'])+' deg',8,anchor='end')
            for j,p in enumerate(c['pairs']):
                b=p['mean_hessian']['e2_m2'];a=p['p1']['e2_m2'];color='#208872' if b<a else '#b26d51' if b>a else '#9da79e'
                d.add(Rect(x0+j*cellw,y,cellw-2,cellh-2,fillColor=HexColor(color),strokeColor=None))
        for j,p in enumerate(case['pairs']):text(x0+(j+.5)*cellw,132,str(p['budget']),8,anchor='middle')
    text(25,91,'Matrix: green = mean-Hessian ruled lower E2 than P1; copper = higher E2; grey = exact tie.',10)
    text(25,69,'The mean Hessian is analytic; local directions vary. There is no universal advantage over P2 triangles or real DTM.',10)
    text(25,47,'Fixed finite candidate grids, not global optimization. P1 follows L2 greedy region priority / L1 bisection-edge choice; no C0 closure.',9)
    text(25,25,'Independent seven-node whole-domain integrals and saved native polynomial query checks; not ArcGIS/author-original execution, timing or RAM.',9)
    renderSVG.drawToFile(d,str(path))
