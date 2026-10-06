"""Pure research copy of the frozen backend directed-face strip packer.

Kept separate so NumPy-only research does not load backend application models.
Tests compare its AST and all emitted directed faces to the original function.
"""

def pack_triangle_strips(faces, max_indices=256):
    """Greedily join adjacent faces without changing any directed triangle."""
    if not isinstance(max_indices,int) or not 3<=max_indices<=256:
        raise ValueError('Invalid strip length')
    faces = [tuple(f) for f in faces]
    edge_faces = {}
    for i, face in enumerate(faces):
        for a,b in zip(face, face[1:]+face[:1]):
            edge_faces.setdefault(tuple(sorted((a,b))), []).append(i)
    available = set(range(len(faces)))
    strips = []
    def trace(start, rotation):
        original=faces[start]
        indices=list(original[rotation:]+original[:rotation]);visited={start}
        while len(indices)<max_indices:
            a,b=indices[-2:]
            adjacent=[i for i in edge_faces[tuple(sorted((a,b)))] if i in available and i not in visited]
            if len(adjacent)!=1:break
            neighbor=adjacent[0];c=next(v for v in faces[neighbor] if v not in (a,b))
            candidate=(a,c,b) if (len(indices)-2)%2 else (a,b,c)
            f=faces[neighbor]
            if candidate not in (f,f[1:]+f[:1],f[2:]+f[:2]):break
            indices.append(c);visited.add(neighbor)
        return indices,visited
    for start in range(len(faces)):
        if start not in available:continue
        candidates=[trace(start,r) for r in range(3)]
        indices,visited=max(candidates,key=lambda c:len(c[1]))
        available.difference_update(visited);strips.append(indices)
    return strips
