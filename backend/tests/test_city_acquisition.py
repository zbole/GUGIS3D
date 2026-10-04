import io,json,sys,unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from http.client import RemoteDisconnected
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'data-pipeline'))
import acquire_city_samples as acquisition


class CityAcquisitionTests(unittest.TestCase):
    def test_get_and_connection_failure_retry_record_provenance_without_partial_source(self):
        record={'id':'york','city_name':'York','query_bbox_wgs84':[-1.1,53.947,-1.066,53.972]}
        content=json.dumps({'elements':[{'id':1,'type':'way','tags':{'building':'yes'}}]}).encode()
        with TemporaryDirectory() as directory,patch.object(acquisition,'urlopen',side_effect=[RemoteDisconnected('closed'),io.BytesIO(content)]) as download:
            folder=Path(directory)
            result=acquisition.acquire(record,folder,method='GET',request_timeout=45)
            request=download.call_args.args[0]
            self.assertEqual(request.get_method(),'GET');self.assertIsNone(request.data)
            self.assertIn('timeout%3A40',request.full_url)
            self.assertEqual(download.call_args.kwargs['timeout'],45)
            manifest=json.loads((folder/'york-source.json').read_bytes())
            self.assertEqual(manifest['http_method'],'GET');self.assertEqual(manifest['request_timeout_seconds'],45)
            self.assertEqual(len(manifest['previous_attempts']),1)
            self.assertEqual((folder/'york-osm.json').read_bytes(),content)
            self.assertEqual(result['sha256'],manifest['sha256'])
            before={p.name:p.read_bytes() for p in folder.iterdir()}
            with self.assertRaises(FileExistsError):acquisition.acquire(record,folder)
            self.assertEqual(download.call_count,2)
            self.assertEqual({p.name:p.read_bytes() for p in folder.iterdir()},before)

    def test_all_failed_requests_leave_no_source_or_empty_ready_sample(self):
        record={'id':'york','city_name':'York','query_bbox_wgs84':[-1.1,53.947,-1.066,53.972]}
        with TemporaryDirectory() as directory,patch.object(acquisition,'urlopen',side_effect=RemoteDisconnected('closed')):
            with self.assertRaisesRegex(RuntimeError,'acquisition failed'):acquisition.acquire(record,Path(directory))
            self.assertEqual(list(Path(directory).iterdir()),[])
            for settings in [{'method':'PUT'},{'request_timeout':True},{'request_timeout':500},{'endpoints':['https://example.test']}]:
                with self.assertRaises(ValueError):acquisition.acquire(record,Path(directory),**settings)


if __name__=='__main__':unittest.main()
