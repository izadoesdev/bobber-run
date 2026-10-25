## Draws what grows on the islands round the boat: for each baked tile, one MultiMesh per kind of tree, rock or bush
## (Flora places them), so a tile's whole forest is a handful of draw calls. Follows a WorldTiles like Ground does.
class_name FloraView
extends Node3D

@export var tiles: WorldTiles
var _tiles: Dictionary[Vector2i, Node3D] = {}


func _ready() -> void:
	tiles.tile_added.connect(_add)
	tiles.tile_dropped.connect(_drop)


func _add(t: Vector2i, heights: PackedFloat32Array) -> void:
	_drop(t)
	var trees := Flora.tile_trees(t, heights)
	if trees.is_empty():
		return
	var group := Node3D.new()
	for kind in trees:
		var spots := trees[kind]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = VoxelModel.tree_mesh(kind)
		mm.instance_count = spots.size() / 4
		for k in mm.instance_count:
			var o := k * 4
			var basis := Basis(Vector3.UP, spots[o + 3]).scaled(Vector3.ONE * spots[o + 2])
			mm.set_instance_transform(k, Transform3D(basis, Vector3(spots[o], 0.0, spots[o + 1])))
		var view := MultiMeshInstance3D.new()
		view.multimesh = mm
		view.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		group.add_child(view)
	add_child(group)
	_tiles[t] = group


func _drop(t: Vector2i) -> void:
	if _tiles.has(t):
		_tiles[t].queue_free()
		_tiles.erase(t)
