import copy,hashlib,json,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
from prepare_city_source import public_source


class PublicCitySourceTests(unittest.TestCase):
    def source(self):
        data={'osm3s':{'copyright':'© OpenStreetMap contributors'},'elements':[
            {'type':'way','id':17,'tags':{'name':'Test building','height':'12','building':'yes','building:levels':'3',
                'min_height':'0','roof:shape':'gabled','phone':'omitted','contact:email':'omitted',
                'description:en':'omitted','note':'omitted'},'geometry':[{'lat':53.96,'lon':-1.08}]}]}
        raw=json.dumps(data).encode();return data,raw,{'city_id':'york','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}

    def test_publication_preserves_geometry_building_semantics_attribution_and_original_inputs(self):
        data,raw,manifest=self.source();before=copy.deepcopy(manifest)
        content,result=public_source(raw,manifest);prepared=json.loads(content)
        self.assertEqual(manifest,before);self.assertEqual(json.loads(raw),data)
        original=data['elements'][0];retained=prepared['elements'][0]
        self.assertEqual(retained['geometry'],original['geometry']);self.assertEqual(retained['id'],17)
        self.assertEqual(retained['tags'],{k:v for k,v in original['tags'].items() if k not in ['phone','contact:email','description:en','note']})
        self.assertEqual(prepared['osm3s'],data['osm3s'])
        self.assertEqual(result['retained_download_sha256'],manifest['sha256'])
        self.assertEqual(result['retained_download_bytes'],len(raw));self.assertEqual(result['bytes'],len(content))
        self.assertEqual(result['sha256'],hashlib.sha256(content).hexdigest())
        self.assertEqual(sum(result['publication_filter']['removed_tag_counts'].values()),4)

    def test_partial_or_changed_source_and_invalid_city_never_produce_a_public_extract(self):
        data,raw,manifest=self.source()
        with self.assertRaisesRegex(ValueError,'checksum'):public_source(raw+b' ',manifest)
        for source in [[],{'elements':[],'remark':'timeout'},{'elements':[3]},{'elements':[{'tags':[]}]}]:
            raw=json.dumps(source).encode();m={**manifest,'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
            with self.assertRaises(ValueError):public_source(raw,m)
        with self.assertRaisesRegex(ValueError,'identifier'):public_source(raw,{**m,'city_id':'../escape'})


if __name__=='__main__':unittest.main()
