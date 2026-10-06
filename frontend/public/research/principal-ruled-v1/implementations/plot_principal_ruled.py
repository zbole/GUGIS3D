"""Complete seven-angle scientific comparison with an explicit P2 control."""
import math
from reportlab.graphics.shapes import Drawing,Rect,String,Line,PolyLine,Circle
from reportlab.graphics import renderSVG
from reportlab.lib.colors import HexColor
COLORS={'p1':'#517b92','world':'#bd9860','principal':'#208872'}
def plot(report,path):
    d=Drawing(1000,650);d.add(Rect(0,0,1000,650,fillColor=HexColor('#ffffff'),strokeColor=None))
    def text(x,y,s,size=10,color='#426351',bold=False,anchor='start'):d.add(String(x,y,s,fontName='Helvetica-Bold' if bold else 'Helvetica',fontSize=size,fillColor=HexColor(color),textAnchor=anchor))
    text(25,620,'Principal-axis ruled strips: seven fixed rotation angles',18,bold=True)
    text(25,598,'Same 100 x 100 m square; N = 2048 P1 triangles; ruled models fit both N and complete binary-byte ceilings.',10)
    x0,y0,width,height=75,190,445,320
    for exponent in range(-4,1):
        y=y0+(exponent+4)/4*height;d.add(Line(x0,y,x0+width,y,strokeColor=HexColor('#dce6df'),strokeWidth=.6));text(x0-10,y-3,f'1e{exponent}',10,anchor='end')
    for angle in report['angles_degrees']:text(x0+width*angle/90,y0-20,str(angle),10,anchor='middle')
    d.add(Line(x0,y0,x0,y0+height,strokeColor=HexColor('#7d9487')));text(x0,535,'Whole-square E2 / m2 (log scale)',12,bold=True);text(x0+width/2,y0-43,'Hessian principal direction / degrees',10,anchor='middle')
    for family,label in [('p1','Paper-style P1'),('world','World-axis ruled'),('principal','Principal-axis ruled')]:
        points=[]
        for c in report['cases']:
            p=c['pairs'][-1];e=p[family];x=x0+width*c['angle_degrees']/90;y=y0+(math.log10(e['e2_m2'])+4)/4*height;points.extend([x,y]);d.add(Circle(x,y,3,fillColor=HexColor(COLORS[family]),strokeColor=None))
        d.add(PolyLine(points,strokeColor=HexColor(COLORS[family]),strokeWidth=2,fillColor=None))
    for i,(family,label) in enumerate([('p1','Paper-style P1'),('world','World-axis ruled'),('principal','Principal-axis ruled')]):
        x=75+i*166;d.add(Line(x,563,x+20,563,strokeColor=HexColor(COLORS[family]),strokeWidth=2));text(x+26,560,label,10)
    text(610,535,'Complete GPR3 files / decimal kB',12,bold=True)
    for i,c in enumerate(report['cases']):
        p=c['pairs'][-1];y=483-i*41;text(593,y+6,str(c['angle_degrees'])+' deg',10,anchor='end')
        for j,f in enumerate(['p1','principal']):
            size=p[f]['binary_bytes']/1000;bar_y=y+4-j*14;d.add(Rect(610,bar_y,size*5,10,fillColor=HexColor(COLORS[f]),strokeColor=None));text(617+size*5,bar_y+1,f'{size:.3f}',9)
    text(610,179,'All overhanging controls and clip metadata included.',9)
    text(25,116,'Higher-order control: 2 P2 triangles / 9 shared nodes / 336 bytes; whole-domain E2 < 1e-8 m2 for all seven fields.',10,bold=True)
    text(25,95,'P2 represents these global quadratics exactly in real arithmetic. No advantage over general P2 triangles is claimed.',10)
    text(25,64,'Finite analytic SPD-quadratic study (curvature ratio 100:1), not real DTM, author-original software or ArcGIS timing.',9)
    text(25,45,'Principal frame comes from the constant exact Hessian. Saved functions integrated after clipping; Float64, not interval proof.',9)
    text(25,26,'Full seven-angle / nine-budget records, native models and independent query checks accompany this figure.',9)
    renderSVG.drawToFile(d,str(path))
