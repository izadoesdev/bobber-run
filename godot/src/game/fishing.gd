## Fishing from the boat (src/game/fishing.ts, the rod's part, ported): cast at a school in range, wait through the
## nibbles for the bite, strike in its window (a quick strike is a perfect one), then reel: holding the reel brings the
## fish in but builds tension on the line, and the fish surges in its species' own pattern; let go through the surges
## or the line snaps, slack off too long and it shakes the hook. A landed fish goes in the hold.
##
## The gear tells: a fish needs a rod of its level (and the sea giants a boat with a deck), each rod level and the
## tackle box bring bites sooner and widen the strike, the reel and a rod beyond the fish's shorten the fight, and
## braided line takes more strain. Bait, crew, towing giants, the catch card's stars and mastery come later; the
## numbers are the game's (TUNE, the strike windows, the fight patterns and lengths).
class_name Fishing
extends Node3D

signal changed
signal caught(fish: Dictionary)
signal said(text: String)

enum Stage { NONE, CAST, WAIT, BITE, REEL }

## the reel: tension per second while reeling, more with each surge; relaxing when let go; line taken back on a surge
const _TUNE := { reel = 0.22, surge = 0.95, relax = 0.7, take = 0.05 }
## the first seconds after the hook hold still (no surge, no snapping), and tension builds gently for a while after
const _GRACE := 1.5
const _OPENING := 3.0
## the nibbles each kind of fish makes before it takes the bait, as seconds before the bite
const _TEASES := { steady = [1.2], darter = [0.85, 0.45], generic = [1.3], jumper = [1.1], erratic = [1.0, 0.6], boss = [2.4, 1.3] }
## a catch's value by its quality at the hook: one, two or three stars
const _STAR_VALUE := [1.0, 1.25, 1.6]

@export var boat: Boat

var stage := Stage.NONE
## the school being fished, the bobber, how far through the stage, the line's tension and the catch's progress
var school: Schools.School
var bobber := Vector3.ZERO
var t := 0.0
var tension := 0.0
var progress := 0.0
var surge := 0.0
var reeling := false
## the school a cast would go to, or null
var target: Schools.School

var _wait := 0.0
var _teases: Array = []
var _ph := 0.0
var _perfect := false
var _kg := 0.0
var _size := 0.0
var _len := 6.0
var _misses := 0
var _fight_noise := FastNoiseLite.new()


var _bobber: MeshInstance3D
var _line: MeshInstance3D


func _ready() -> void:
	_fight_noise.seed = Seed.i32(Seed.hash32(9, 0, 101))
	_fight_noise.frequency = 1.0
	_bobber = _part(BoxMesh.new(), Color("e05a45"))
	(_bobber.mesh as BoxMesh).size = Vector3(2, 2, 2)
	_line = _part(BoxMesh.new(), Color("efe9dc"))


func _part(mesh: Mesh, colour: Color) -> MeshInstance3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = colour
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	var part := MeshInstance3D.new()
	part.mesh = mesh
	part.material_override = m
	part.visible = false
	add_child(part)
	return part


# The bobber where the line went in, bobbing; it jiggles at a nibble, plunges at the bite, and while reeling it rides
# toward the boat as the fish comes in, thrown out by its surges. The line runs to it from the rod.
func _draw_line() -> void:
	var on := stage != Stage.NONE
	_bobber.visible = on
	_line.visible = on and stage != Stage.CAST
	if not on:
		return
	var at := Vector3(bobber.x, 0.4 + sin(Time.get_ticks_msec() / 400.0) * 0.3, bobber.z)
	if stage == Stage.BITE:
		at.y = -1.2
	elif stage == Stage.REEL:
		var toward := Vector3(boat.x - bobber.x, 0.0, boat.y - bobber.z)
		at += toward * progress * 0.6 - toward.normalized() * surge * 4.0
	elif stage == Stage.CAST:                          # flying out from the boat
		at = Vector3(boat.x, 6.0, boat.y).lerp(at, minf(1.0, t / 0.55)) + Vector3.UP * sin(PI * minf(1.0, t / 0.55)) * 10.0
	_bobber.position = at
	var tip := Vector3(boat.x, 9.0, boat.y)
	var d := at - tip
	var x := d.normalized()
	var z := x.cross(Vector3.UP).normalized()
	_line.transform = Transform3D(Basis(x * d.length(), z.cross(x) * 0.6, z * 0.6), (tip + at) * 0.5)


## Fish the boat can still carry.
func room() -> int:
	return int(boat.stats().hold) - State.hold.size()


func _process(dt: float) -> void:
	var cast := Input.is_action_just_pressed("cast")
	if State.docked != null:
		target = null
		return
	if stage == Stage.NONE:
		target = _nearest_school()
		if cast and target and boat.speed() < 10.0:
			var need := catch_need(target.sp)
			if need.is_empty():
				_cast(target)
			else:
				said.emit("%s %s" % [Species.all[target.sp].name, need])
		return
	t += dt
	# rowing off reels the line in
	if Input.get_action_strength("sail_forward") > 0.0 or Input.get_action_strength("sail_back") > 0.0:
		_end("You started rowing, so you reeled in your line")
		return
	if stage != Stage.REEL and Vector2(boat.x - bobber.x, boat.y - bobber.z).length() > 80.0:
		_end("You drifted too far from your bobber, so you reeled in")
		return
	match stage:
		Stage.CAST:
			if t > 0.55:
				_start_wait()
		Stage.WAIT:
			if cast:
				said.emit("Too early")
				_wait += 1.2
			if not _teases.is_empty() and t >= _wait - float(_teases[0]):
				_teases.pop_front()
				said.emit("A nibble...")
			if t >= _wait:
				stage = Stage.BITE
				t = 0.0
				said.emit("A bite! Strike now")
		Stage.BITE:
			var sp := Species.all[school.sp]
			var rod := State.level("rod")
			# a new captain's windows, wider after each miss, a little narrower for rarer fish
			var widen := 1.5 * (1.0 + 0.2 * mini(3, _misses)) * clampf(0.7 + 0.06 * float(sp.w), 0.75, 1.0)
			var perfect := ((0.32 if boat.stats().prop == "OARS" else 0.2) + 0.03 * rod + 0.05 * maxi(0, State.level("tackle") - 1)) * widen
			if cast:
				_hook(t < perfect)
			elif t > (0.75 + 0.12 * rod) * widen:
				said.emit("It got away")
				_misses += 1
				_start_wait()
		Stage.REEL:
			_reel(dt)
	_draw_line()
	changed.emit()


func _cast(s: Schools.School) -> void:
	school = s
	stage = Stage.CAST
	t = 0.0
	var jitter := Vector2.from_angle(randf() * TAU) * randf() * 8.0
	bobber = Vector3(s.x + jitter.x, 0.0, s.y + jitter.y)
	said.emit("Cast for " + Species.all[s.sp].name)
	changed.emit()


func _start_wait() -> void:
	var sp := Species.all[school.sp]
	stage = Stage.WAIT
	t = 0.0
	_wait = (2.5 + randf() * 4.5) * (1.0 - 0.1 * State.level("rod")) * (1.0 - 0.12 * State.level("tackle")) * (0.7 if sp.role == "bait" else 1.0)
	_teases = _TEASES[sp.fight].filter(func(before: float) -> bool: return before < _wait - 0.3)


func _hook(perfect: bool) -> void:
	var sp := Species.all[school.sp]
	stage = Stage.REEL
	t = 0.0
	_perfect = perfect
	_misses = 0
	tension = 0.1 if perfect else 0.25
	progress = 0.2 if perfect else 0.08
	_ph = randf() * 10.0
	_size = minf(1.0, pow(randf(), 2.2) + (0.1 if perfect else 0.0))
	_kg = snappedf(lerpf(sp.kg[0], sp.kg[1], _size), 0.01)
	var edge := clampi(State.level("rod") - int(sp.rod), 0, 3)   # rod levels beyond what the fish needs
	_len = (3.5 + 27.0 * _heft(_kg)) * (1.0 - 0.35 * float(sp.diff)) * (1.0 - 0.08 * edge) / (1.0 + 0.12 * State.level("reel"))
	said.emit("Perfect strike!" if perfect else "Hooked!")


func _reel(dt: float) -> void:
	var sp := Species.all[school.sp]
	var diff := float(sp.diff)
	var grace := t < _GRACE
	if not grace:
		_ph += dt * (1.5 + diff * 2.5)
	surge = 0.0 if grace else _fight(sp.fight, _ph)
	var power := 0.45 + 0.55 * _heft(_kg)
	reeling = Input.is_action_pressed("cast")
	if reeling:
		tension += (_TUNE.reel + _TUNE.surge * surge * power) * dt * minf(1.0, 0.6 + 0.4 * t / _OPENING)
		progress += dt / _len * (1.0 - minf(0.6, surge * 0.35))
	else:
		tension -= _TUNE.relax * dt
		if surge > 0.9:
			progress -= (surge - 0.9) * _TUNE.take * power * dt   # it runs against a slack reel and takes line back
	tension = clampf(tension, 0.0, line_max() * (0.55 if grace else 1.0))
	if tension >= line_max():
		_end("Your line snapped")
	elif progress <= 0.0 and t > 1.5:
		_end("It shook the hook. Reel in when it calms")
	elif progress >= 1.0:
		_land()


func _land() -> void:
	var sp := Species.all[school.sp]
	var stars := 1 + (1 if _perfect else 0) + (1 if randf() < 0.07 else 0)
	var fish := { sp = school.sp, name = sp.name, kg = _kg, stars = stars, value = maxi(1, roundi(float(sp.base) * (0.55 + 0.9 * _size) * _STAR_VALUE[stars - 1])) }
	school.stock -= 1
	if room() > 0:
		State.add_fish(fish)
		caught.emit(fish)
	else:
		said.emit("Your hold is full: the %s goes back" % sp.name)
	_end("")


func _end(text: String) -> void:
	if text:
		said.emit(text)
	stage = Stage.NONE
	school = null
	reeling = false
	tension = 0.0
	progress = 0.0
	_draw_line()
	changed.emit()


# How hard each kind of fish pulls at fight phase ph (0 slack, over 1 a surge).
func _fight(style: String, ph: float) -> float:
	match style:
		"steady": return 0.45 + 0.25 * sin(ph * 0.6)
		"darter": return pow(maxf(0.0, sin(ph * 1.9)), 5.0) * 2.6 + 0.1
		"jumper": return maxf(0.0, sin(ph) * 1.1 + sin(ph * 2.7 + 1.0) * 0.5 - 0.2)
		"erratic": return maxf(0.0, _fight_noise.get_noise_2d(ph * 0.8, 3.1) * 1.85 + 0.15)
		"boss": return maxf(0.0, _fight_noise.get_noise_2d(ph * 0.7, 9.7) * 1.5 + 0.1)
	return maxf(0.0, sin(ph) * 1.3 + sin(ph * 2.7 + 1.0) * 0.6 - 0.2)   # generic


## The strain the line takes before it snaps: 1, and more with braided line.
func line_max() -> float:
	return 1.0 + Upgrades.step.line * State.level("line")


## Why species `sp` can't be landed with this rod and boat ("needs a level 3 rod"), or "" if it can.
func catch_need(sp: int) -> String:
	var s := Species.all[sp]
	if int(s.rod) > State.level("rod"):
		return "needs a level %d rod" % (int(s.rod) + 1)
	if int(s.deck) > int(boat.stats().deck):
		return "needs a bigger boat"                   # (the shipyard comes later)
	return ""


# The school to fish: the nearest biting one in casting range that still has fish, one you can land before one you
# can't (castTargets in the game).
func _nearest_school() -> Schools.School:
	var best: Schools.School = null
	var best_key := INF
	var reach := 50.0 + float(boat.stats().L) * 0.5
	for s in Schools.near(Vector2(boat.x, boat.y), reach):
		var d := Vector2(s.x - boat.x, s.y - boat.y).length()
		var key := d + (0.0 if catch_need(s.sp).is_empty() else 1e6)
		if d < reach and key < best_key and s.stock > 0 and Species.biting(s.sp, State.is_night(), State.is_twilight()):
			best_key = key
			best = s
	return best


# 0 for a sprat up to 1 for half a tonne: how much a fish's weight lengthens its fight and hardens its surges.
static func _heft(kg: float) -> float:
	return clampf(log(kg + 1.0) / log(500.0), 0.0, 1.0)
