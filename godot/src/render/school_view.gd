## The schools near the boat, swimming: each fish steers (src/game/schools.ts, ported) by turning its heading at a
## fish's pace and swimming forward along it, drawn to its school, clear of its neighbours, wheeling in a bait ball,
## and feeling ahead for the shallows the length of its body. Each school is one MultiMesh of its species' fish, with
## its own material fading them into the water by how deep that species swims. A school shows while its fish bite (night
## fish only after dark) and fades in and out as that changes; at night only glowing fish and those in the lantern's
## light show clearly, the rest as dim shapes close by.
class_name SchoolView
extends Node3D

const _SHADER := preload("res://src/render/fish.gdshader")
## schools within this of the boat swim and are drawn
const _NEAR := 300.0
const _STEP := 1.0 / 60.0
const _CRUISE := { steady = 3.5, darter = 5.0, generic = 5.0, jumper = 5.5, erratic = 5.5, boss = 3.0 }
const _TURN_S := { steady = 4.0, darter = 2.5, generic = 3.0, jumper = 3.0, erratic = 1.2, boss = 5.0 }
const _ROLE_CRUISE := { bait = 6.0, drifter = 1.6, bottom = 2.4, crawler = 1.4, giant = 4.5 }
const _SWIRL := { bait = 1.5, giant = 0.7, hunter = 0.35 }
## a fish's centre wanders this far from home, and it may stray this much further before turning firmly back
const _WANDER := 2.0
const _SCATTER := 6.0
## at night, schools this much past the lantern's reach still show, dimly, fading out over the next 30
const _DIM := 110.0

@export var tiles: WorldTiles
@export var boat: Boat
var _views: Dictionary[String, MultiMeshInstance3D] = {}
## school id -> how much of it shows, easing toward what should
var _shown: Dictionary[String, float] = {}
var _t := 0.0


class Swimmer:
	var x: float
	var y: float
	var vx: float
	var vy: float
	var h: float
	var ph: float
	var turn: float
	var bias := 0.0


func _process(delta: float) -> void:
	_t += delta
	var steps := clampi(ceili(delta / _STEP - 1e-6), 1, 4)
	var seen: Dictionary[String, bool] = {}
	var night := State.is_night()
	var ease := 1.0 - exp(-1.6 * minf(delta, 0.1))
	for s in Schools.near(Vector2(boat.x, boat.y), _NEAR):
		var d := Vector2(s.x - boat.x, s.y - boat.y).length()
		var lit: bool = not night or Species.all[s.sp].look.glow or d < DayNight.light_r() + 14.0
		var want := (1.0 if lit else clampf((_DIM - d) / 30.0, 0.0, 1.0)) if Species.biting(s.sp, State.is_night(), State.is_twilight()) else 0.0
		var shown: float = want if not _shown.has(s.id) else lerpf(_shown[s.id], want, ease)   # (a school met out of sight is simply there)
		if shown < 0.02 and want == 0.0:
			_shown.erase(s.id)
			continue
		_shown[s.id] = shown
		seen[s.id] = true
		if s.fish.is_empty():
			s.fish = _spawn(s)
		for k in steps:
			_swim(s, delta / steps)
		_draw(s, shown)
	for id in _views.keys():
		if not seen.has(id):
			_views[id].queue_free()
			_views.erase(id)
	for id in _shown.keys():
		if not seen.has(id):
			_shown.erase(id)


func _spawn(s: Schools.School) -> Array:
	var look: Dictionary = Species.all[s.sp].look
	var out: Array = []
	for k in int(look.count) + 2:
		var a := s.ph + k * 2.4
		var r := float(look.radius) * (0.3 + 0.5 * fposmod(k * 0.618, 1.0))
		var f := Swimmer.new()
		f.x = s.x + cos(a) * r
		f.y = s.y + sin(a) * r
		f.h = a + PI / 2.0
		f.vx = cos(f.h) * 3.0
		f.vy = sin(f.h) * 3.0
		f.ph = s.ph + k * 0.37
		f.turn = k * 0.4
		out.append(f)
	return out


func _swim(s: Schools.School, dt: float) -> void:
	var sp: Dictionary = Species.all[s.sp]
	var look: Dictionary = sp.look
	var role: String = look.role
	var style: String = "steady" if look.bottom else sp.fight
	var cruise: float = _ROLE_CRUISE.get(role, _CRUISE[style])
	var R: float = look.radius
	var reach := R + _WANDER + _SCATTER
	var sep: float = look.space
	var half: float = look.body * 0.5
	var swirl: float = _SWIRL.get(role, 0.0) * cruise * (1.0 if fposmod(s.ph, 1.0) < 0.5 else -1.0)
	var cx := s.x + cos(_t * 0.11 + s.ph) * _WANDER
	var cy := s.y + sin(_t * 0.083 + s.ph * 2.0) * _WANDER
	# bait and shoals edge away from the boat when it comes close
	var away := Vector2(s.x - boat.x, s.y - boat.y)
	var near := R + 18.0
	if role in ["bait", "shoal", "drifter"] and away.length() < near:
		var push := away.normalized() * minf(_SCATTER, near - away.length())
		cx += push.x; cy += push.y
	var top := cruise * 3.0
	for f: Swimmer in s.fish:
		var dx := cx - f.x
		var dy := cy - f.y
		var d := maxf(1e-3, sqrt(dx * dx + dy * dy))
		var od := Vector2(f.x - s.x, f.y - s.y).length()
		var pull := 8.0 if od > reach else 2.2 if d > R else 0.9 if role == "bait" else 0.35
		var sw := swirl * minf(1.0, d / R)
		var ax := dx * pull - dy / d * sw
		var ay := dy * pull + dx / d * sw
		var nvx := 0.0
		var nvy := 0.0
		var nn := 0
		for o: Swimmer in s.fish:                        # neighbours: room to swim, and their heading
			if o == f:
				continue
			var ex := f.x - o.x
			var ey := f.y - o.y
			var e2 := ex * ex + ey * ey
			if e2 >= 9.0 * sep * sep:
				continue
			nvx += o.vx; nvy += o.vy; nn += 1
			if e2 < sep * sep and e2 > 1e-6:
				var e := sqrt(e2)
				var k := (sep - e) * 4.0 / e
				ax += ex * k; ay += ey * k
		if nn:
			ax += (nvx / nn - f.vx) * 0.6
			ay += (nvy / nn - f.vy) * 0.6
		f.turn -= dt
		if f.turn <= 0.0:
			f.turn = _TURN_S[style] * (0.6 + randf() * 0.8)
			f.bias = randf() * 2.0 - 1.0
		var hx := cos(f.h)
		var hy := sin(f.h)
		var v := sqrt(f.vx * f.vx + f.vy * f.vy)
		ax -= hy * f.bias * cruise * 0.5; ay += hx * f.bias * cruise * 0.5
		var dv := (_rhythm(style, role, cruise, f.ph) - v) * 2.0
		ax += hx * dv; ay += hy * dv
		var ahead := half + 3.0 + v * 0.5                 # shallows ahead: turn down the slope, and ease off
		if tiles.height(f.x + hx * ahead, f.y + hy * ahead) > -0.08:
			var g := Vector2(tiles.height(f.x + 3, f.y) - tiles.height(f.x - 3, f.y), tiles.height(f.x, f.y + 3) - tiles.height(f.x, f.y - 3))
			var u := -g.normalized() if g.length() > 1e-4 else Vector2(dx, dy) / d
			ax += u.x * 40.0 - hx * v; ay += u.y * 40.0 - hy * v
		var acc := Vector2(ax, ay).limit_length(30.0)
		f.vx += acc.x * dt; f.vy += acc.y * dt
		var spd := minf(top, sqrt(f.vx * f.vx + f.vy * f.vy))
		if spd > 0.25:
			var rate := (0.8 if role == "giant" else 1.8 + spd * 0.25) * dt
			f.h += clampf(angle_difference(f.h, atan2(f.vy, f.vx)), -rate, rate)
		var nx := f.x + cos(f.h) * spd * dt
		var ny := f.y + sin(f.h) * spd * dt
		var k := minf(1.0, 4.0 * dt)                     # it swims the way it faces; where it means to go follows that
		f.vx += (cos(f.h) * spd - f.vx) * k; f.vy += (sin(f.h) * spd - f.vy) * k
		if tiles.height(nx, ny) > -0.06 or tiles.height(nx + cos(f.h) * half, ny + sin(f.h) * half) > -0.06:
			f.h += clampf(angle_difference(f.h, atan2(s.y - f.y, s.x - f.x)), -3.0 * dt, 3.0 * dt)   # never into the shallows
			f.vx *= 0.5; f.vy *= 0.5
			continue
		f.x = nx; f.y = ny


# Darters dash and pause, erratic fish surge and dawdle, bottom fish lie still with now and then a glide, crabs scuttle
# and stop; the rest ease between a little slower and faster.
func _rhythm(style: String, role: String, cruise: float, ph: float) -> float:
	if role == "bottom": return cruise if fposmod(_t * 0.07 + ph, 1.0) < 0.12 else cruise * 0.04
	if role == "crawler": return cruise if fposmod(_t * 0.3 + ph, 1.0) < 0.35 else 0.0
	if style == "darter": return cruise * 3.0 if fposmod(_t * 0.6 + ph, 1.0) < 0.18 else cruise * 0.35
	if style == "erratic": return cruise * (0.5 + absf(sin(_t * 1.3 + ph * 2.1)) * 1.2)
	return cruise * (0.8 + 0.3 * sin(_t * 0.4 + ph))


func _draw(s: Schools.School, shown: float) -> void:
	var sp: Dictionary = Species.all[s.sp]
	var look: Dictionary = sp.look
	var view: MultiMeshInstance3D = _views.get(s.id)
	if view == null:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = VoxelModel.fish_mesh(sp.id)
		mm.instance_count = s.fish.size()
		view = MultiMeshInstance3D.new()
		view.multimesh = mm
		var m := ShaderMaterial.new()
		m.shader = _SHADER
		m.set_shader_parameter("fade", clampf((0.9 - float(look.z)) * 0.32 * float(look.fade), 0.0, 0.88))   # how deep it swims
		m.set_shader_parameter("glow", 1.0 if look.glow else 0.0)
		view.material_override = m
		view.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(view)
		_views[s.id] = view
	view.material_override.set_shader_parameter("shown", shown)
	var mm := view.multimesh
	# fished-out schools thin to a straggler
	mm.visible_instance_count = maxi(1, roundi((int(look.count) + 2) * float(s.stock) / s.max_stock)) if s.stock > 0 else 1
	var sideways := PI / 2.0 if look.role == "crawler" else 0.0   # crabs walk sideways
	for k in s.fish.size():
		var f: Swimmer = s.fish[k]
		var basis := Basis(Vector3.UP, -(f.h + sideways)).scaled(Vector3.ONE * float(look.size))
		mm.set_instance_transform(k, Transform3D(basis, Vector3(f.x, 0.05, f.y)))
