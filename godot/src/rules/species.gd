## The fish: the game's species table (data/species.json, exported from src/species.ts), where each one lives, and
## which one a school in some water is.
##
## A species' waters (Species.zone in the game, a test on depth and distance from home) come as a bitmap over a grid
## of depth x distance, so the rule is the game's own, not a copy. Climate decides the rest: warm-water fish in the
## south, cold-water fish in the north, home-water fish fading out toward both. Fish that live in one biome only, and
## those that live at landmarks, wait for the biome map and the landmarks.
class_name Species

static var all: Array[Dictionary] = []
static var _grid: Dictionary
static var _zones: Array[PackedByteArray] = []
static var _index: Dictionary[String, int] = {}


static func _static_init() -> void:
	var d: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/species.json"))
	_grid = d.zoneGrid
	for s: Dictionary in d.species:
		_index[s.id] = all.size()
		all.append(s)
		_zones.append(Marshalls.base64_to_raw(s.zone))


## The index of species `id`.
static func index_of(id: String) -> int:
	return _index[id]


## Whether species `n` can live in water of depth h at distance d from home (its zone, to the grid).
static func lives_in(n: int, h: float, d: float) -> bool:
	var i := clampi(roundi((h - _grid.h0) / _grid.dh), 0, int(_grid.nh) - 1)
	var j := clampi(roundi(d / _grid.dd), 0, int(_grid.nd) - 1)
	var bit := j * int(_grid.nh) + i
	return (_zones[n][bit >> 3] >> (bit & 7)) & 1 == 1


## How strongly climate favours species `n` at world y: 1 where it lives, 0 where it doesn't, between for home-water
## fish as the climate turns.
static func climate(n: int, y: float) -> float:
	var warm := clampf((y - 1500.0) / 1000.0, 0.0, 1.0)
	var cold := clampf((-y - 1300.0) / 1000.0, 0.0, 1.0)
	match all[n].region:
		"warm": return 1.0 if warm > 0.4 else 0.0
		"cold": return 1.0 if cold > 0.4 else 0.0
		"temperate": return 1.0 - maxf(warm, cold)
	return 1.0


## A species for a school in water of depth h at world (x, y): weighted by each one's spawn weight and the climate,
## drawn from `r`; -1 if nothing lives there.
static func pick(h: float, x: float, y: float, r: Seed.Mulberry) -> int:
	var d := Vector2(x - IslandRules.HOME.x, y - IslandRules.HOME.y).length()
	var weights := PackedFloat32Array()
	var total := 0.0
	for n in all.size():
		var s := all[n]
		var w := 0.0
		if s.special == null and s.habitat == null and lives_in(n, h, d):
			w = s.w * climate(n, y)
		weights.append(w)
		total += w
	if total <= 0.0:
		return -1
	var v := r.next() * total
	for n in weights.size():
		v -= weights[n]
		if weights[n] > 0.0 and v <= 0.0:
			return n
	return -1


## Whether species `n` bites now: by day it's every fish that isn't a night, dusk or weather fish (the clock and the
## weather come later).
static func biting(n: int) -> bool:
	var s := all[n]
	return s.time in ["any", "day"] and s.weather == "any"
