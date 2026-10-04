"""Research-only strip regrouping; controls and represented functions stay fixed.

Patch identifiers and first-hit derivative ties on shared boundaries can change.
No formal project writes or approximation/refinement occur in this service.
"""
from collections import Counter
import hashlib
import json
from ..environment_models import Terrain, TerrainPatch
from .terrain_triangles import pack_triangle_strips


def primitives(terrain):
    """Index signatures distinguish bilinear quads from oriented triangles."""
    result=[]
    for patch in terrain.patches:
        if patch.kind=='ruled-strip':
            for a,b,c,d in zip(patch.left,patch.right,patch.left[1:],patch.right[1:]):
                # Simultaneous reversal of both parametric coordinates is equal.
                result.append(('ruled',min((a,b,c,d),(d,c,b,a))))
        elif patch.kind=='triangle-strip':
            for face in patch.faces():
                result.append(('triangle',min(face,face[1:]+face[:1],face[2:]+face[:2])))
        else:
            raise ValueError('Compaction research accepts ruled and triangle strips only')
    return Counter(result)


def primitive_sha256(terrain):
    packed=json.dumps(sorted(primitives(terrain).items()),separators=(',',':')).encode()
    return hashlib.sha256(packed).hexdigest()


def compact_strips(terrain,*,max_boundary=128,max_indices=256):
    if isinstance(max_boundary,bool) or not isinstance(max_boundary,int) or not 2<=max_boundary<=128:
        raise ValueError('Invalid ruled-boundary budget')
    if isinstance(max_indices,bool) or not isinstance(max_indices,int) or not 3<=max_indices<=256:
        raise ValueError('Invalid triangle-strip budget')
    terrain=Terrain.model_validate(terrain)
    quads=[];triangles=[]
    for patch in terrain.patches:
        if patch.kind=='ruled-strip':
            quads.extend(zip(patch.left,patch.right,patch.left[1:],patch.right[1:]))
        elif patch.kind=='triangle-strip':triangles.extend(patch.faces())
        else:raise ValueError('Compaction research accepts ruled and triangle strips only')
    starts={};ends={}
    for i,(a,b,c,d) in enumerate(quads):
        starts.setdefault((a,b),[]).append(i);ends.setdefault((c,d),[]).append(i)
    available=set(range(len(quads)));boundaries=[]
    # Start open chains at their incoming ends; cycles are deterministically cut.
    order=[i for i,(a,b,_,_) in enumerate(quads) if len(ends.get((a,b),[]))!=1]
    ordered=set(order);order.extend(i for i in range(len(quads)) if i not in ordered)
    for start in order:
        if start not in available:continue
        a,b,c,d=quads[start];left=[a,c];right=[b,d];available.remove(start)
        while len(left)<max_boundary:
            candidates=[i for i in starts.get((left[-1],right[-1]),[]) if i in available]
            if len(candidates)!=1:break
            neighbor=candidates[0];_,_,c,d=quads[neighbor]
            left.append(c);right.append(d);available.remove(neighbor)
        boundaries.append((left,right))
    patches=[TerrainPatch(id=f'h{i}',kind='ruled-strip',left=a,right=b) for i,(a,b) in enumerate(boundaries)]
    strips=pack_triangle_strips(triangles,max_indices)
    for indices in strips:
        patches.append(TerrainPatch(id=f'h{len(patches)}',kind='triangle-strip',indices=indices))
    data=terrain.model_dump(exclude_none=True)
    data['patches']=[p.model_dump(exclude_none=True) for p in patches]
    compact=Terrain.model_validate(data)
    if primitives(compact)!=primitives(terrain):raise ValueError('Compaction changed represented geometry')
    return compact,{'original_patches':len(terrain.patches),'compact_patches':len(patches),
        'ruled_quads':len(quads),'ruled_strips':len(boundaries),'triangle_faces':len(triangles),
        'triangle_strips':len(strips),'primitive_sha256':primitive_sha256(compact),
        'controls_unchanged':compact.points==terrain.points,
        'patch_ids_preserved':False,'boundary_derivative_tie_order_preserved':False}
