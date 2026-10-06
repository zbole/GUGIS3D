"""Scientific vector heatmap using the available ReportLab graphics renderer."""
from reportlab.graphics.shapes import Drawing,Rect,String
from reportlab.graphics import renderSVG
from reportlab.lib.colors import Color,HexColor

def plot(report,path):
    drawing=Drawing(820,790);drawing.add(Rect(0,0,820,790,fillColor=HexColor('#ffffff'),strokeColor=None))
    drawing.add(String(24,762,'Real DTM control: E2(ruled grid) / E2(adaptive P1)',fontName='Helvetica-Bold',fontSize=16,fillColor=HexColor('#294c3f')))
    drawing.add(String(24,741,'Same complete native JSON ceiling; all 20 fixed sites. Ratios below 1 would favour ruled grids.',fontSize=10,fillColor=HexColor('#536d60')))
    maximum=max(1.1,max(1-p['e2_reduction_percent']/100 for c in report['cases'] for p in c['pairs'] if p['e2_reduction_percent'] is not None))
    for j,label in enumerate(['10 cm P1 ceiling','25 cm P1 ceiling','50 cm P1 ceiling']):drawing.add(String(350+j*150,708,label,fontName='Helvetica-Bold',fontSize=10,textAnchor='middle'))
    for i,c in enumerate(report['cases']):
        y=673-i*29;drawing.add(String(257,y+9,c['id'],fontSize=10,textAnchor='end',fillColor=HexColor('#355247')))
        for j,p in enumerate(c['pairs']):
            value=None if p['e2_reduction_percent'] is None else 1-p['e2_reduction_percent']/100
            level=0 if value is None else max(0,min(1,(value-1)/(maximum-1)))
            color=HexColor('#e8edef') if value is None else Color(.99-.25*level,.94-.66*level,.72-.54*level)
            drawing.add(Rect(279+j*150,y,142,25,fillColor=color,strokeColor=HexColor('#ffffff'),strokeWidth=.8))
            drawing.add(String(350+j*150,y+8,'No fitting file' if value is None else f'{value:.2f}',fontSize=10,textAnchor='middle',fillColor=HexColor('#3b4236')))
    drawing.add(String(24,63,'Ratio > 1: the selected regular ruled grid has higher full-domain E2 than retained adaptive P1.',fontSize=10,fillColor=HexColor('#536d60')))
    drawing.add(String(24,45,'No fitting file: all 98 native candidates exceed that complete P1 file ceiling; not zero error.',fontSize=10,fillColor=HexColor('#536d60')))
    drawing.add(String(24,27,'Source-relative E2, Float64 integration; not ground-truth accuracy, paper-author timing or ArcGIS execution.',fontSize=10,fillColor=HexColor('#536d60')))
    renderSVG.drawToFile(drawing,str(path))
