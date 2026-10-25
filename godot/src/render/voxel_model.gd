## Voxel models exported from the game (scripts/godot-export.ts, godot/data), turned into meshes: every face of a voxel
## that touches air becomes a quad in its material's colour, and Godot's lighting shades it (a toon-banded material
## gives the game's lit / mid / shadow tones).
##
## Model axes: u along the boat (bow +u), v across it (starboard +v), z up. In the mesh, u is +X, z is +Y and v is +Z,
## so a node turned by -heading about Y points its bow along the boat's heading on the sea (see Boat).
class_name VoxelModel

static var _meshes: Dictionary[String, ArrayMesh] = {}
static var _material: StandardMaterial3D


## The mesh of boat `id`, built once.
static func boat_mesh(id: String) -> ArrayMesh:
	if not _meshes.has(id):
		_meshes[id] = build(JSON.parse_string(FileAccess.get_file_as_string("res://data/boats/%s.json" % id)))
	return _meshes[id]


## The shared material: vertex colours, toon diffuse, no specular.
static func material() -> StandardMaterial3D:
	if _material == null:
		_material = StandardMaterial3D.new()
		_material.vertex_color_use_as_albedo = true
		_material.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
		_material.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	return _material


## A mesh from an exported model: { u0, v0, nu, nv, nz, palette: [{ ramp: [shadow, mid, lit], glow }], cells }.
static func build(model: Dictionary) -> ArrayMesh:
	var nu := int(model.nu)
	var nv := int(model.nv)
	var nz := int(model.nz)
	var u0 := int(model.u0)
	var v0 := int(model.v0)
	var cells := Marshalls.base64_to_raw(model.cells)
	var colours := PackedColorArray()
	for p: Dictionary in model.palette:
		colours.append(Color(p.ramp[1]))
	var solid := func(u: int, v: int, z: int) -> bool:
		return u >= 0 and v >= 0 and z >= 0 and u < nu and v < nv and z < nz and cells[(z * nv + v) * nu + u] != 0
	var verts := PackedVector3Array()
	var normals := PackedVector3Array()
	var vcols := PackedColorArray()
	var indices := PackedInt32Array()
	for z in nz:
		for v in nv:
			for u in nu:
				var m := cells[(z * nv + v) * nu + u]
				if m == 0:
					continue
				var centre := Vector3(u + u0, z + 0.5, v + v0)   # mesh space: x = u, y = z (from the keel up), z = v
				for f in 6:
					var d: Vector3i = _FACE_DIR[f]
					if solid.call(u + d.x, v + d.z, z + d.y):
						continue
					var base := verts.size()
					for corner: Vector3 in _FACE_CORNERS[f]:
						verts.append(centre + corner * 0.5)
						normals.append(Vector3(d))
						vcols.append(colours[m - 1])
					indices.append_array([base, base + 2, base + 1, base, base + 3, base + 2])
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = vcols
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, material())
	return mesh


# the six faces of a cube (mesh axes, x = u, y = z, z = v): the neighbour they face, and their corners, counter-clockwise
# seen from outside (the triangles are emitted reversed: Godot's front faces are clockwise)
const _FACE_DIR: Array[Vector3i] = [Vector3i(1, 0, 0), Vector3i(-1, 0, 0), Vector3i(0, 1, 0), Vector3i(0, -1, 0), Vector3i(0, 0, 1), Vector3i(0, 0, -1)]
const _FACE_CORNERS := [
	[Vector3(1, -1, -1), Vector3(1, 1, -1), Vector3(1, 1, 1), Vector3(1, -1, 1)],
	[Vector3(-1, -1, 1), Vector3(-1, 1, 1), Vector3(-1, 1, -1), Vector3(-1, -1, -1)],
	[Vector3(-1, 1, -1), Vector3(-1, 1, 1), Vector3(1, 1, 1), Vector3(1, 1, -1)],
	[Vector3(-1, -1, 1), Vector3(-1, -1, -1), Vector3(1, -1, -1), Vector3(1, -1, 1)],
	[Vector3(1, -1, 1), Vector3(1, 1, 1), Vector3(-1, 1, 1), Vector3(-1, -1, 1)],
	[Vector3(-1, -1, -1), Vector3(-1, 1, -1), Vector3(1, 1, -1), Vector3(1, -1, -1)],
]
