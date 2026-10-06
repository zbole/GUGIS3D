import importlib.util,json,tempfile,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
class TileTests(unittest.TestCase):
    def test_fixed_512m_crop_is_valid_original_pixels_and_all_tile_boundaries_share_source_heights(self):
        from PIL import Image
        fixed=json.loads((ROOT/'frontend/public/research/source-native-bands-v1/manchester-centre/reference.json').read_bytes());top,left,_,_=fixed['source_window'];top-=224;left-=224
        with Image.open(ROOT/'backend/data/terrain/manchester-ea-dtm-1m.tif') as im:z=np.asarray(im.crop((left,top,left+513,top+513)))[::-1]
        self.assertEqual(z.shape,(513,513));self.assertTrue(np.isfinite(z).all());self.assertLess(abs(z).max(),10000);self.assertEqual(z[256,256],fixed['height'][32][32])
        total=0
        for row in range(8):
            for col in range(8):
                t=z[64*row:64*row+65,64*col:64*col+65];total+=t.size
                if col<7:np.testing.assert_array_equal(t[:,-1],z[64*row:64*row+65,64*(col+1)])
                if row<7:np.testing.assert_array_equal(t[-1,:],z[64*(row+1),64*col:64*col+65])
        self.assertEqual(total,270400);self.assertEqual(total-z.size,7231)
if __name__=='__main__':unittest.main()
