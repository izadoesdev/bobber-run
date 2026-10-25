## The player's boat: its sailing (src/game/physics.ts, ported) and its place on the sea.
##
## The state is the game's: position (x, y) on the sea (east, south), velocity, heading `a` (radians, 0 east, turning
## clockwise as seen from above) and turn rate. Physics runs on the fixed physics tick, and Godot's physics
## interpolation draws the node smoothly between ticks. Stats come from the game's own table (data/boats.json).
class_name Boat
extends Node3D

## how deep the hull sits: land shallower than this is ground under it
const _DRAFT := 0.028
const _RESTITUTION := 0.2
const _FRICTION := 0.35
## a pier's half width, round its core
const _PIER_R := 3.5

@export var tiles: WorldTiles
@export var boat_id := "row"

var x := 0.0
var y := 0.0
var vx := 0.0
var vy := 0.0
var a := 0.0
var w := 0.0
var _helm := 0.0
var _thr := 0.0
var _heel := 0.0
var _heel_v := 0.0
var _stats: Dictionary
var _hull: PackedVector2Array = []
@onready var _model: MeshInstance3D = $Model


func _ready() -> void:
	for s: Dictionary in JSON.parse_string(FileAccess.get_file_as_string("res://data/boats.json")):
		if s.id == boat_id:
			_stats = s
	_model.mesh = VoxelModel.boat_mesh(boat_id)
	# the hull outline: 18 points on an ellipse, a little blunter at the stern
	for k in 18:
		var t := k / 18.0 * TAU
		_hull.append(Vector2(cos(t) * (_stats.L if cos(t) > 0.0 else _stats.L * 0.93), sin(t) * _stats.B))
	_place()


## Put the boat at (px, py) facing `heading`, at rest.
func place_at(px: float, py: float, heading: float) -> void:
	x = px; y = py; a = heading
	vx = 0.0; vy = 0.0; w = 0.0
	_place()
	reset_physics_interpolation()


func speed() -> float:
	return Vector2(vx, vy).length()


## The boat's stats from the game's table (speed, accel, turn, L, B, prop, hp, hold).
func stats() -> Dictionary:
	return _stats


func _physics_process(dt: float) -> void:
	if State.docked != null:                          # tied up at a pier: the boat rests where it lies
		vx = 0.0; vy = 0.0; w = 0.0
		_place()
		return
	var thrust := Input.get_action_strength("sail_forward")
	var reverse := Input.get_action_strength("sail_back")
	var steer := Input.get_action_strength("steer_right") - Input.get_action_strength("steer_left")
	# the helm and throttle ease toward the controls; bigger hulls answer more slowly
	var heft := sqrt(_stats.L / 13.5)
	var rowing: bool = _stats.prop == "OARS"
	_helm = _ease(_helm, steer, (6.0 if steer else 8.0) / heft, dt)
	_thr = _ease(_thr, thrust - reverse, (5.0 if rowing else 1.6 if _stats.prop == "SAIL" else 2.5) / heft, dt)
	# forward and sideways velocity in the boat's frame; shallows and hard turns drag harder
	var c := cos(a)
	var s := sin(a)
	var vf := vx * c + vy * s
	var vs := -vx * s + vy * c
	var shallow := clampf((tiles.height(x, y) + 0.1) / 0.09, 0.0, 1.0)
	vf *= exp(-(0.6 * _stats.accel + 2.2 * shallow + 0.12 * absf(w)) * dt)
	vs *= exp(-(3.2 + 3.0 * shallow) * dt)
	vf += _thr * 20.0 * _stats.speed * _stats.accel * (0.45 if _thr < 0.0 else 1.0) * dt
	# a rudder needs water flowing past it, so ships barely turn from a standstill; oars spin a rowboat in place
	var still := 0.7 if rowing else 0.4
	var steerage := still + (1.0 - still) * smoothstep(0.0, 1.0, absf(vf) / 22.0)
	w = _ease(w, _helm * 1.25 * _stats.turn * steerage, 5.0 / heft, dt)
	a += w * dt
	# heel out of a turn (for show; a lightly damped spring)
	var target := clampf(w * vf * 0.004, -0.1, 0.1) / sqrt(heft)
	var hz := TAU * 0.55 / heft
	_heel_v += (hz * hz * (target - _heel) - 2.0 * 0.35 * hz * _heel_v) * dt
	_heel += _heel_v * dt
	c = cos(a)
	s = sin(a)
	vx = vf * c - vs * s
	vy = vf * s + vs * c
	x += vx * dt
	y += vy * dt
	_land_contacts()
	_pier_contacts()
	_place()


# Hull points pushed back out of land along the slope, with impulses (a bounce and some friction) that also spin the
# boat, a few passes deep.
func _land_contacts() -> void:
	var inertia := 200.0 * pow(_stats.L / 13.5, 2.0)
	for pass_ in 3:
		var c := cos(a)
		var s := sin(a)
		var hit := false
		for p in _hull:
			var px := x + p.x * c - p.y * s
			var py := y + p.x * s + p.y * c
			var h := tiles.height(px, py)
			if h <= -_DRAFT:
				continue
			hit = true
			var gx := tiles.height(px + 1.5, py) - tiles.height(px - 1.5, py)
			var gy := tiles.height(px, py + 1.5) - tiles.height(px, py - 1.5)
			var gl := Vector2(gx, gy).length()
			var n := Vector2(-gx, -gy) / gl if gl > 1e-6 else Vector2(x - px, y - py).normalized()
			var pen := minf(2.5, (h + _DRAFT) / (gl / 3.0) + 0.05) if gl > 1e-6 else 0.5
			var rx := px - x
			var ry := py - y
			x += n.x * pen * 0.4
			y += n.y * pen * 0.4
			var vpx := vx - w * ry
			var vpy := vy + w * rx
			var vn := vpx * n.x + vpy * n.y
			if vn >= 0.0:
				continue
			var rn := rx * n.y - ry * n.x
			var j := -(1.0 + _RESTITUTION) * vn / (1.0 + rn * rn / inertia)
			vx += j * n.x; vy += j * n.y; w += rn * j / inertia
			var tx := -n.y
			var ty := n.x
			var vt := vpx * tx + vpy * ty
			var rt := rx * ty - ry * tx
			var jt := clampf(-vt / (1.0 + rt * rt / inertia), -_FRICTION * j, _FRICTION * j)
			vx += jt * tx; vy += jt * ty; w += rt * jt / inertia
		if not hit:
			break


# Piers are solid: each touches the hull at its deepest edge (hull edges, not points, so a pier end can't slip between
# them), pushed out with the same impulses as land.
func _pier_contacts() -> void:
	var piers := Ports.near(Vector2(x, y), 60.0 + float(_stats.L))
	if piers.is_empty():
		return
	var inertia := 200.0 * pow(_stats.L / 13.5, 2.0)
	for pass_ in 3:
		var c := cos(a)
		var s := sin(a)
		var hull := PackedVector2Array()
		for p in _hull:
			hull.append(Vector2(x + p.x * c - p.y * s, y + p.x * s + p.y * c))
		var any := false
		for port in piers:
			var a0 := Vector2(port.x, port.y)
			var a1 := a0 + Vector2.from_angle(port.ang) * 27.0
			var deepest := -1.0
			var at := Vector2.ZERO
			var n := Vector2.ZERO
			for k in hull.size():
				var e0 := hull[k]
				var e1 := hull[(k + 1) % hull.size()]
				var pq := Geometry2D.get_closest_points_between_segments(e0, e1, a0, a1)
				var d := pq[0].distance_to(pq[1])
				if d < _PIER_R and _PIER_R - d > deepest:
					deepest = _PIER_R - d
					at = pq[0]
					n = (pq[0] - pq[1]) / d if d > 1e-4 else Vector2(-(e1 - e0).y, (e1 - e0).x).normalized()
			if deepest < 0.0:
				continue
			any = true
			var rx := at.x - x
			var ry := at.y - y
			x += n.x * deepest * 0.4
			y += n.y * deepest * 0.4
			var vpx := vx - w * ry
			var vpy := vy + w * rx
			var vn := vpx * n.x + vpy * n.y
			if vn < 0.0:
				var rn := rx * n.y - ry * n.x
				var j := -(1.0 + _RESTITUTION) * vn / (1.0 + rn * rn / inertia)
				vx += j * n.x; vy += j * n.y; w += rn * j / inertia
		if not any:
			break


# The node follows the sea state: world (x, y) is (X, Z), the bow along the heading, bobbing and heeling.
func _place() -> void:
	var t := Time.get_ticks_msec() / 1000.0
	position = Vector3(x, -0.4 + sin(t * 1.6) * 0.2, y)
	rotation = Vector3(_heel, -a, sin(t * 1.1) * 0.025)


static func _ease(v: float, target: float, rate: float, dt: float) -> float:
	return v + (target - v) * (1.0 - exp(-rate * dt))
