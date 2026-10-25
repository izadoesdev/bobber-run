## The voyage on disk: the purse, the fish in the hold, the clock and where the boat lies, as JSON in user:// (in a
## browser, Godot keeps user:// in IndexedDB). Fish are saved by species id, not by their place in the table, so a
## save still reads after species are added. A file that won't parse, or is from another version, is no save at all;
## a field that's missing or the wrong type is left out, so the new voyage's stands.
class_name SaveGame

const PATH := "user://voyage.json"
const VERSION := 1


## The save text for this voyage.
static func to_text(coins: int, clock: float, hold: Array[Dictionary], at: Vector2, heading: float) -> String:
	var fish := []
	for f in hold:
		fish.append({ sp = Species.all[f.sp].id, kg = f.kg, stars = f.stars, value = f.value })
	return JSON.stringify({ version = VERSION, savedAt = Time.get_unix_time_from_system(), coins = coins, clock = clock,
		hold = fish, x = at.x, y = at.y, a = heading }, "\t")


## A voyage read back from save text, checked field by field: { hold, and coins, clock, x, y, a where they're sound
## numbers }, with each fish as the hold keeps it ({ sp, name, kg, stars, value }); empty if the text isn't a save of
## this version.
static func parse(text: String) -> Dictionary:
	var json := JSON.new()                             # (quietly: a damaged save isn't an engine error)
	if json.parse(text) != OK:
		return {}
	var d: Variant = json.data
	if not d is Dictionary or d.get("version") != float(VERSION):
		return {}
	var hold: Array[Dictionary] = []
	var fish: Variant = d.get("hold")
	for f: Variant in fish if fish is Array else []:
		var id := str(f.get("sp")) if f is Dictionary else ""
		if not Species.has(id):
			continue                                       # a species this build doesn't know
		var sp := Species.index_of(id)
		hold.append({ sp = sp, name = Species.all[sp].name, kg = maxf(0.0, _num(f, "kg", 0.0)),
			stars = clampi(int(_num(f, "stars", 1.0)), 1, 3), value = maxi(0, int(_num(f, "value", 0.0))) })
	var out := { hold = hold }
	for key: String in ["coins", "clock", "x", "y", "a"]:
		if is_finite(_num(d, key, NAN)):
			out[key] = d[key]
	if out.has("coins"):
		out.coins = maxi(0, int(out.coins))
	if out.has("clock"):
		out.clock = maxf(0.0, out.clock)
	return out


## Write save text to `path`, whole or not at all: to a scratch file first, then over the old save.
static func write(path: String, text: String) -> bool:
	var scratch := path + ".new"
	var file := FileAccess.open(scratch, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(text)
	file.close()
	return DirAccess.rename_absolute(scratch, path) == OK


## The voyage saved at `path`, or empty if there's none (or it can't be read).
static func read(path: String) -> Dictionary:
	return parse(FileAccess.get_file_as_string(path)) if FileAccess.file_exists(path) else {}


# A finite number from d[key], or `fallback`.
static func _num(d: Dictionary, key: String, fallback: float) -> float:
	var v: Variant = d.get(key)
	return v if v is float and is_finite(v) else fallback
