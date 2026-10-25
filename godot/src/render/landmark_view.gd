## The harbours round the boat: each port's harbour (the game's own models, exported), its pier running out to sea
## along the port's heading. Lighthouses and wrecks come later.
class_name LandmarkView
extends Node3D

@export var boat: Boat
## harbours within this of the boat are shown
const _NEAR := 420.0
var _shown: Dictionary[String, MeshInstance3D] = {}


func _process(_delta: float) -> void:
	var seen: Dictionary[String, bool] = {}
	for p in Ports.near(Vector2(boat.x, boat.y), _NEAR):
		seen[p.id] = true
		if _shown.has(p.id):
			continue
		var m := MeshInstance3D.new()
		m.mesh = VoxelModel.harbour_mesh(p.design)
		m.position = Vector3(p.x, 0.0, p.y)
		m.rotation.y = -p.ang                          # the model's +u (the pier) along the port's heading
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(m)
		_shown[p.id] = m
	for id in _shown.keys():
		if not seen.has(id):
			_shown[id].queue_free()
			_shown.erase(id)
