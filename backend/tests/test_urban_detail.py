import json
import unittest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.main import app
from app.studio_models import BuildingDocument, BuildingParameters
from app.services.building_generator import generate_building, document_bytes
from app.services.city_generator import footprint_document
from app.services.urban_detail import refine_document, subtract_rectangle, area, line_intervals
from app.services.component_colors import COMPONENT_COLORS, color_components


class UrbanDetailTests(unittest.TestCase):
    def footprint(self, concave=False, height=12):
        ring = [[-2.60,51.45],[-2.5997,51.45],[-2.5997,51.4501]]
        if concave:
            ring.extend([[-2.59985,51.4501],[-2.59985,51.4502]])
        else:
            ring[-1]=[-2.5997,51.4502]
        ring.extend([[-2.60,51.4502],ring[0]])
        return footprint_document(ring,'Detailed test',height,'Test outline','Test height')

    def test_all_solid_categories_have_distinct_persisted_colors(self):
        self.assertEqual(len(set(COMPONENT_COLORS.values())),10)
        for kind in ('tower','villa','georgian','victorian','wills','cabot','cathedral'):
            doc=generate_building(BuildingParameters(kind=kind,floors=3,units=1))
            for node in doc.nodes:
                if node.template:
                    self.assertEqual(doc.templates[node.template].color,COMPONENT_COLORS[node.category])

    def test_refinement_preserves_outline_anchor_height_and_input(self):
        for concave in (False,True):
            original=self.footprint(concave)
            before=document_bytes(original)
            result=refine_document(original,{'building:levels':'4'})
            self.assertEqual(document_bytes(original),before)
            self.assertEqual(result.parameters.floors,4)
            self.assertEqual(result.parameters.longitude,original.parameters.longitude)
            self.assertEqual(result.overview['body'].vertices,original.templates['volume'].vertices)
            self.assertGreater(len(result.nodes),80)
            self.assertTrue(any(n.rotation_z for n in result.nodes))
            categories={n.category for n in result.nodes if n.template}
            self.assertTrue({'wall','window','door','roof','slab','stair','railing','ornament'}<=categories)
            self.assertEqual(BuildingDocument.model_validate_json(document_bytes(result)),result)
            self.assertIn('推演',result.nodes[0].attributes['精度说明'])

    def test_slab_clipping_leaves_stair_opening_and_stays_inside_plan(self):
        original=[[-5,-4],[5,-4],[5,4],[-5,4]]
        pieces=subtract_rectangle(original,[-1,-2,1,2])
        self.assertAlmostEqual(sum(area(p) for p in pieces),72)
        self.assertTrue(all(-5<=x<=5 and -4<=y<=4 for p in pieces for x,y in p))
        result=refine_document(self.footprint())
        def volume(template):
            if template.kind=='box':
                return template.size[0]*template.size[1]*template.size[2]
            total=0
            for face in template.triangles:
                a,b,c=[template.vertices[i] for i in face]
                total+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6
            return total
        def slabs(floor):
            return sum(volume(result.templates[n.template]) for n in result.nodes if n.category=='slab' and n.floor==floor)
        self.assertGreater(slabs(1),slabs(2)+.1)

    def test_interior_partitions_follow_concave_wings_and_have_real_door_openings(self):
        ring=[(0,0),(12,0),(12,8),(8,8),(8,3),(4,3),(4,8),(0,8)]
        self.assertEqual(line_intervals(ring,5),[(0.0,4.0),(8.0,12.0)])
        result=refine_document(self.footprint(concave=True))
        groups={n.id for n in result.nodes if n.id.startswith('zone')}
        self.assertGreater(len(groups),0)
        for parent in groups:
            children=[n for n in result.nodes if n.parent==parent]
            self.assertEqual({n.category for n in children},{'wall','door'})
            wall=next(n for n in children if n.category=='wall')
            self.assertEqual(result.templates[wall.template].kind,'mesh')

    def test_older_shared_materials_split_before_recoloring(self):
        original=generate_building(BuildingParameters(floors=1,units=1))
        wall=next(n for n in original.nodes if n.category=='wall')
        door=next(n for n in original.nodes if n.category=='door')
        door.template=wall.template
        before=document_bytes(original)
        result=color_components(original)
        wall,door=[next(n for n in result.nodes if n.category==c) for c in ('wall','door')]
        self.assertNotEqual(wall.template,door.template)
        self.assertNotEqual(result.templates[wall.template].color,result.templates[door.template].color)
        self.assertEqual(before,document_bytes(original))

    def test_new_format_capabilities_cannot_leak_into_old_versions(self):
        doc=refine_document(self.footprint())
        for version in ('1.0','1.1'):
            payload=doc.model_dump();payload['version']=version
            with self.assertRaises(ValidationError):BuildingDocument.model_validate(payload)
        payload=doc.model_dump();payload['nodes'][0]['rotation_z']=10
        with self.assertRaises(ValidationError):BuildingDocument.model_validate(payload)

    def test_refine_route_and_small_outbuilding(self):
        original=self.footprint(height=1.8)
        response=TestClient(app).post('/city/refine',content=document_bytes(original))
        self.assertEqual(response.status_code,200)
        result=BuildingDocument.model_validate(response.json()['document'])
        self.assertEqual(result.parameters.floors,1)
        self.assertFalse(any(n.category=='stair' for n in result.nodes))
        self.assertEqual(BuildingDocument.model_validate_json(document_bytes(refine_document(result))),result)


if __name__=='__main__':unittest.main()
