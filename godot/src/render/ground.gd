## The ground under the sea and the islands: one flat quad per baked tile, drawn by ground.gdshader from the tile's
## heights. Follows a WorldTiles: a tile appears when it's baked and goes when it's dropped.
class_name Ground
extends Node3D

const _SHADER := preload("res://src/render/ground.gdshader")

@export var tiles: WorldTiles
var _quads: Dictionary[Vector2i, MeshInstance3D] = {}
var _plane := PlaneMesh.new()


func _ready() -> void:
	_plane.size = Vector2.ONE * Terrain.TILE
	tiles.tile_added.connect(_add)
	tiles.tile_dropped.connect(_drop)


func _add(t: Vector2i, heights: PackedFloat32Array) -> void:
	var image := Image.create_from_data(Terrain.TILE_N, Terrain.TILE_N, false, Image.FORMAT_RF, heights.to_byte_array())
	image.convert(Image.FORMAT_RH)                     # half floats filter smoothly on every WebGL 2 device
	var material := ShaderMaterial.new()
	material.shader = _SHADER
	material.set_shader_parameter("heights", ImageTexture.create_from_image(image))
	material.set_shader_parameter("tile_n", float(Terrain.TILE_N))
	material.set_shader_parameter("step", float(Terrain.STEP))
	var quad := MeshInstance3D.new()
	quad.mesh = _plane
	quad.material_override = material
	quad.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	quad.position = Vector3((t.x + 0.5) * Terrain.TILE, 0.0, (t.y + 0.5) * Terrain.TILE)   # world (x, y) is (X, Z)
	add_child(quad)
	_drop(t)
	_quads[t] = quad


func _drop(t: Vector2i) -> void:
	if _quads.has(t):
		_quads[t].queue_free()
		_quads.erase(t)
