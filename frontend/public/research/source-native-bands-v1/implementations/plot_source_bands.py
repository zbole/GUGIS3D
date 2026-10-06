"""Scientific file-cost and source-relative P1 error figure; all controls shown."""
from reportlab.graphics.shapes import Drawing,Rect,String,Line
from reportlab.graphics import renderSVG
from reportlab.lib.colors import HexColor
def plot(report,path):
    d=Drawing(1100,870);d.add(Rect(0,0,1100,870,fillColor=HexColor('#ffffff'),strokeColor=None))
    def text(x,y,s,size=10,color='#426351',bold=False,anchor='start'):d.add(String(x,y,s,fontName='Helvetica-Bold' if bold else 'Helvetica',fontSize=size,fillColor=HexColor(color),textAnchor=anchor))
    text(25,840,'Real DTM: preserve the same source function with fewer vector nodes',17,bold=True)
    text(25,819,'All 20 fixed 65x65 Float32 source windows; same 64x64m domain between pixel centres. Complete file bytes.',10)
    c=report['cases'][0];models={e['family']:e for e in c['models']};items=[('Source-cell P2 triangles',models['source_p2']['binary_bytes'],'#547d94'),('GUGIS native ruled bands',models['ruled']['binary_bytes'],'#228a73'),('Source-node P1 strips',models['source_p1']['binary_bytes'],'#b99864'),('Implicit-XY Float32 grid',c['regular_grid']['bytes'],'#859d8a')]
    maximum=max(v[1] for v in items)
    for i,(label,value,color) in enumerate(items):
        y=759-i*36;text(280,y+4,label,11,anchor='end');width=650*value/maximum;d.add(Rect(300,y,width,18,fillColor=HexColor(color),strokeColor=None));text(307+width,y+4,f'{value/1000:.3f} kB',10)
    text(25,598,'Vector comparison: ruled bands and P2 preserve the same bilinear function (full-domain E2 < 1e-8 m2).',10,bold=True)
    text(25,579,'Regular-grid and GeoTIFF controls may be smaller. This is not a raster-storage superiority or heap-memory claim.',10)
    text(25,548,'Source-node P1: whole-domain RMS residual against the source bilinear function / mm',11,bold=True)
    largest=max(next(m for m in c['models'] if m['family']=='source_p1')['rms_integral_m']*1000 for c in report['cases'])
    for i,c in enumerate(report['cases']):
        value=next(m for m in c['models'] if m['family']=='source_p1')['rms_integral_m']*1000;y=510-i*20;text(270,y+3,c['id'],9,anchor='end');d.add(Rect(288,y,650*value/largest,12,fillColor=HexColor('#b99864'),strokeColor=None));text(295+650*value/largest,y+2,f'{value:.3f}',9)
    text(25,76,'GUGIS / P2 agreement is relative to the original cellwise bilinear DTM, not independently surveyed ground.',9)
    text(25,57,'All original source heights are preserved. ODN metre convention follows the EA publication; unit metadata caveat retained.',9)
    text(25,38,'Full Float64 integration and native gradient/node checks accompany the files. Not paper-author or ArcGIS execution.',9)
    text(25,19,'File-cost bars use identical topology counts at every site; complete per-site raw results are published.',9)
    renderSVG.drawToFile(d,str(path))
