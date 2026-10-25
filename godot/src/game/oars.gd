## The rowboat's oars, rowed by the rower: each side has its own stroke, so a turn can pull one oar while the other
## rests (as physics.ts rowOars and models.ts oarGeom have them). Rowing ahead pulls both, turning pulls the outer
## oar, backing water runs both backward, and a resting oar drifts back to its rest. The oarlock, reach, stroke and
## colours are the game's (data/oars.json).
class_name Oars
extends Node3D

@export var boat: Boat

var _o: Dictionary
## each side's stroke phase: [0, 1) is one stroke, the first half pulling the blade aft through the water
var _phase := { -1: 0.5, 1: 0.5 }
var _parts := {}                                   # side -> [shaft, blade, arm] MeshInstance3Ds


func _ready() -> void:
	if boat.boat_id != "row":                          # only the rowboat is rowed
		visible = false
		set_process(false)
		return
	_o = JSON.parse_string(FileAccess.get_file_as_string("res://data/oars.json"))
	for side in [-1, 1]:
		_parts[side] = [_part(Color(_o.shaft)), _part(Color(_o.blade)), _part(Color(_o.coat))]


func _process(delta: float) -> void:
	var thrust := Input.get_action_strength("sail_forward") > 0.0
	var back := Input.get_action_strength("sail_back") > 0.0 and not thrust
	var steer := signf(Input.get_action_strength("steer_right") - Input.get_action_strength("steer_left"))
	for side: int in [-1, 1]:
		var outer := steer != 0.0 and side == -steer
		var rate := -0.7 if back else (1.0 if not steer else (1.0 if outer else 0.45)) if thrust else (1.05 if outer else 0.0)
		var ph: float = _phase[side]
		if rate != 0.0:
			ph += delta * 0.75 * rate
		elif absf(fposmod(ph, 1.0) - 0.5) > 0.03:      # drift back to rest
			ph += delta * 0.75
		_phase[side] = ph
		_pose(side, fposmod(ph, 1.0))


# One side's oar at stroke phase `ph`: the blade sweeps aft through the water, then lifts and swings forward.
func _pose(side: int, ph: float) -> void:
	var sweep: float = _o.sweep
	var bu: float
	var bz: float
	if ph < 0.5:
		bu = sweep - 2.0 * sweep * smoothstep(0.0, 1.0, ph / 0.5)
		bz = 0.3
	else:
		var q := (ph - 0.5) / 0.5
		bu = -sweep + 2.0 * sweep * smoothstep(0.0, 1.0, q)
		bz = 0.3 + 3.6 * sin(PI * q)
	# model space (u ahead, v starboard, z up) is the mesh's (x, z, y)
	var lock := _m(_o.lockU, side * _o.lockV, _o.lockZ)
	var blade := _m(bu, side * _o.reach, bz)
	var handle := lock + (lock - blade) * 0.3
	var neck := blade + (lock - blade).normalized() * 5.0
	var parts: Array = _parts[side]
	_span(parts[0], handle, neck, 1.2)          # at least a pixel across, or it drops out of the low-res view
	_span(parts[1], neck, blade, 1.6)
	_span(parts[2], _m(1.0, side * 3.0, 7.5), handle, 1.2)   # the rower's arm on the handle


static func _m(u: float, v: float, z: float) -> Vector3:
	return Vector3(u, z, v)


# A box `thick` across, stretched from p to q.
static func _span(part: MeshInstance3D, p: Vector3, q: Vector3, thick: float) -> void:
	var d := q - p
	var x := d.normalized()
	var z := x.cross(Vector3.UP if absf(x.y) < 0.9 else Vector3.RIGHT).normalized()
	part.transform = Transform3D(Basis(x * d.length(), z.cross(x) * thick, z * thick), (p + q) * 0.5)


func _part(colour: Color) -> MeshInstance3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = colour
	m.diffuse_mode = BaseMaterial3D.DIFFUSE_TOON
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	var part := MeshInstance3D.new()
	part.mesh = BoxMesh.new()
	part.material_override = m
	add_child(part)
	return part
