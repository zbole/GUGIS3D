from pathlib import Path
import struct
import sys
import tempfile
import unittest
import shapefile

pipeline = Path(__file__).resolve().parents[2] / 'data-pipeline'
sys.path.insert(0,str(pipeline))
try:
    from benchmark_research_packing import digest_parts, omit_absent_measures
    from benchmark_research_joined_strips import join_strips, triangles_digest
finally:
    sys.path.remove(str(pipeline))


class ResearchPackingTests(unittest.TestCase):
    def test_joined_strips_preserve_all_oriented_triangles_and_source_spans(self):
        row=[[x,y,x*y] for x in (0,1,2,3) for y in (1,0)]
        parts=[row[2:6],row[:4],row[4:8]]
        joined,mapping=join_strips(parts)
        self.assertEqual(joined,[row])
        self.assertEqual(triangles_digest(joined),triangles_digest(parts))
        for original,(group,start,length) in zip(parts,mapping):
            self.assertEqual(joined[group][start:start+length],original)
        reversed_triangle=[list(reversed(row[:3]))]
        self.assertNotEqual(triangles_digest([row[:3]]),triangles_digest(reversed_triangle))

    def test_odd_strip_or_ambiguous_connection_never_adds_extra_triangles(self):
        a,b,c,d,e=[ [i, i%2,0] for i in range(5)]
        for parts in [[[a,b,c],[b,c,d,e]],[[a,b,c,d],[c,d,e,a],[c,d,e,b]]]:
            joined,mapping=join_strips(parts)
            self.assertEqual(triangles_digest(joined),triangles_digest(parts))
            self.assertEqual(len(joined),len(parts))

    def write(self,base,measure=False):
        with shapefile.Writer(str(base),shapeType=shapefile.MULTIPATCH) as writer:
            writer.field('ID','C')
            for i in range(2):
                vertices=[[i*10,0,1],[i*10+5,0,2],[i*10,5,3],[i*10+5,5,4]]
                if measure: vertices=[[*p,7] for p in vertices]
                writer.multipatch([vertices],partTypes=[shapefile.TRIANGLE_STRIP])
                writer.record(str(i))

    def test_xyz_and_multiple_record_offsets_survive_optional_measure_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory)/'terrain'
            self.write(base)
            before=base.with_suffix('.shp').read_bytes()
            with shapefile.Reader(str(base)) as reader: digest=digest_parts(reader)
            removed,records=omit_absent_measures(base)
            self.assertEqual(records,2)
            self.assertEqual(removed,2*(16+8*4))
            after=base.with_suffix('.shp').read_bytes()
            self.assertEqual(len(after),len(before)-removed)
            self.assertEqual(struct.unpack_from('>I',after,24)[0]*2,len(after))
            with shapefile.Reader(str(base)) as reader:
                self.assertEqual(digest_parts(reader),digest)
                self.assertEqual(len(reader),2)
                self.assertEqual(list(reader.shape(1).z),[1,2,3,4])
                self.assertEqual(reader.record(1)[0],'1')
                self.assertTrue(all(v is None for v in reader.shape(1).m))

    def test_real_measures_are_rejected_without_changing_any_file(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory)/'terrain'
            self.write(base,measure=True)
            originals={suffix:base.with_suffix(suffix).read_bytes() for suffix in ('.shp','.shx','.dbf')}
            with self.assertRaisesRegex(ValueError,'Cannot omit real measures'): omit_absent_measures(base)
            self.assertEqual(originals,{s:base.with_suffix(s).read_bytes() for s in originals})

    def test_truncated_record_is_rejected_without_rewriting_source(self):
        with tempfile.TemporaryDirectory() as directory:
            base=Path(directory)/'terrain'
            self.write(base)
            invalid=base.with_suffix('.shp').read_bytes()[:-1]
            base.with_suffix('.shp').write_bytes(invalid)
            with self.assertRaisesRegex(ValueError,'Malformed'): omit_absent_measures(base)
            self.assertEqual(base.with_suffix('.shp').read_bytes(),invalid)


if __name__=='__main__':unittest.main()
