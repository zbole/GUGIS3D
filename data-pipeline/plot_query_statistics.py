"""All five CPU fixtures, all paired ratios, and conditional resampling intervals."""
import math
from reportlab.graphics.shapes import Drawing,Rect,String,Line,Circle
from reportlab.graphics import renderSVG
from reportlab.lib.colors import HexColor
def plot(report,pairs,path):
    d=Drawing(1100,620);d.add(Rect(0,0,1100,620,fillColor=HexColor('#ffffff'),strokeColor=None))
    def text(x,y,s,size=10,color='#426351',bold=False,anchor='start'):d.add(String(x,y,s,fontName='Helvetica-Bold' if bold else 'Helvetica',fontSize=size,fillColor=HexColor(color),textAnchor=anchor))
    text(25,588,'Native CPU queries: secondary paired statistical diagnostics',18,bold=True)
    text(25,566,'All five published fixtures / 17 timing pairs each; original Windows i7-14650HX / Node24.13.0 measurements unchanged.',10)
    low=min(.85,math.floor(min(float(p['ratio']) for p in pairs)*20)/20);high=max(1.5,math.ceil(max(float(p['ratio']) for p in pairs)*20)/20);x=lambda v:245+560*(v-low)/(high-low)
    for value in [low,1,1.1,1.2,1.3,1.4,high]:
        d.add(Line(x(value),162,x(value),514,strokeColor=HexColor('#dce6df'),strokeWidth=1.2 if value==1 else .5));text(x(value),144,f'{value:.2f}',9,anchor='middle')
    text(850,526,'Wins / paired sign Holm p',10,bold=True)
    for i,c in enumerate(report['cases']):
        y=488-i*65;label=c['id'].replace('extruded-quadratic','Extruded P2 field').replace('modulated-quadratic','Modulated P2xP1 field');text(25,y-3,label,11,bold=True)
        for p in pairs:
            if p['case_id']==c['id']:
                yy=y+17+(int(p['trial'])%5-2)*2;d.add(Circle(x(float(p['ratio'])),yy,2,fillColor=HexColor('#a2b9aa'),strokeColor=None))
        l,h=c['bootstrap']['low'],c['bootstrap']['high'];d.add(Line(x(l),y,x(h),y,strokeColor=HexColor('#208872'),strokeWidth=3));d.add(Circle(x(c['median_ratio']),y,4,fillColor=HexColor('#208872'),strokeColor=None));text(850,y-3,f'{c["wins"]} / 17;  p = {c["holm_adjusted_p"]:.3g}',10)
    text(245,121,'Triangle latency / ruled latency (>1 favours ruled)',10)
    text(25,87,'Green: ratio of method medians + exploratory 95% paired, order-stratified percentile resampling interval (50000 draws).',9)
    text(25,66,'Grey: every raw paired speed ratio, separate from the ratio-of-medians statistic. Holm signs test paired wins, a different quantity.',9)
    text(25,45,'Secondary analysis, not a new timing run or pre-timing preregistration. Inference assumes sufficiently independent/representative trials.',9)
    text(25,24,'Serial dependence/runtime drift can affect inference; no cross-device, GPU rendering, ArcGIS software or real-DTM timing conclusion.',9)
    renderSVG.drawToFile(d,str(path))
