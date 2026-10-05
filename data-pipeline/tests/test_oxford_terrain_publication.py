import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

import numpy as np
import rasterio

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from publish_oxford_terrain_benchmark import verify, checked, DEST, SHA
from raster_l2_audit import integrate_model


class OxfordTerrainPublicationTests(unittest.TestCase):
    def test_complete_geometry_and_bindings(self):
        report, raw, audit, audit_raw=verify(DEST)
        summary=json.loads((ROOT/'shared/oxford-terrain-benchmark.json').read_bytes())
        self.assertEqual(SHA(raw),summary['parent_report_sha256'])
        self.assertEqual(SHA(audit_raw),summary['query_audit_sha256'])
        self.assertEqual(summary['publisher_sha256'],SHA((ROOT/'data-pipeline/publish_oxford_terrain_benchmark.py').read_text(encoding='utf8').replace('\r\n','\n').encode()))
        self.assertEqual(sum(a['hits'] for a in audit['rows']),49152)
        for name,digest in summary['figures'].items(): self.assertEqual(SHA((DEST/name).read_bytes()),digest)
        self.assertEqual(SHA((DEST/'results.csv').read_bytes()),summary['results_csv_sha256'])
        gains=[]
        for case in report['cases']:
            package=summary['packages'][case['id']]
            content=checked(DEST,package['filename'],package['sha256'],package['bytes'])
            with zipfile.ZipFile(DEST/package['filename']) as archive:
                self.assertIsNone(archive.testzip())
                self.assertEqual(len(archive.namelist()),31)
                for name in archive.namelist(): self.assertEqual(archive.read(name),(DEST/name).read_bytes())
            for m in case['models']:
                self.assertTrue(m['target_met']); self.assertLessEqual(m['continuous_bound_m'],m['target_m'])
                if m['family']=='local_triangles': gains.append(100*(1-m['bytes']/m['multipatch']['five_component_bytes']))
        self.assertEqual(len(gains),6); self.assertGreater(min(gains),27); self.assertLess(max(gains),33)

    def test_crops_are_fixed_original_source_pixels(self):
        report=json.loads((DEST/'results.json').read_bytes())
        sources={s['city_id']:s for s in json.loads((ROOT/'shared/public-terrain-sources-v2.json').read_bytes())['sources']}
        for case in report['cases']:
            source=sources[case['city_id']]
            path=ROOT/'backend/data/terrain'/f"{case['city_id']}-ea-dtm-1m.tif"
            self.assertEqual(SHA(path.read_bytes()),case['source_raster_sha256'])
            ref=json.loads((DEST/case['id']/'reference.json').read_bytes())
            with rasterio.open(path) as raster:
                fraction=.5 if case['site_id']=='centre' else .25
                row=int(raster.height*fraction); col=raster.width//2
                self.assertEqual(case['source_window'],[row-32,col-32,65,65])
                actual=raster.read(1,window=rasterio.windows.Window(col-32,row-32,65,65))[::-1]
                np.testing.assert_array_equal(actual,np.asarray(ref['height']))
                self.assertEqual(case['origin_bng'],list(raster.xy(row,col)))
                self.assertEqual(raster.crs.to_epsg(),27700)

    def test_fingerprint_and_path_tampering_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary); (folder/'fixture.json').write_bytes(b'original')
            self.assertEqual(checked(folder,'fixture.json',SHA(b'original')),b'original')
            with self.assertRaisesRegex(ValueError,'fingerprint'): checked(folder,'fixture.json',SHA(b'changed'))
            with self.assertRaisesRegex(ValueError,'Unsafe'): checked(folder,'../fixture.json',SHA(b'original'))

    def test_saved_models_reproduce_the_whole_domain_integrals(self):
        report=json.loads((DEST/'results.json').read_bytes())
        for case in report['cases']:
            reference=json.loads((DEST/case['id']/'reference.json').read_bytes())
            for m in case['models']:
                # Every site, fine triangle model and coarse partition candidate.
                # Recompute every Oxford model, both families and all three targets.
                integral=integrate_model(reference,json.loads((DEST/case['id']/m['filename']).read_bytes()))
                self.assertAlmostEqual(integral['e2_m2'],m['e2_m2'],places=10)
                self.assertEqual(integral['integrated_area_m2'],4096)
                self.assertEqual(integral['native_triangles'],m['native_triangles'])
                self.assertEqual(integral['ruled_quads'],m['ruled_quads'])


if __name__=='__main__': unittest.main()
