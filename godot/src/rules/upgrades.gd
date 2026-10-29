## The outfitter's upgrades: the game's table (data/upgrades.json, exported from src/econ.ts): each one's name, shop
## category, what it costs and does at each level, and what a level of it adds. Only those whose effect the port has
## so far are for sale; the rest come with what they improve (the hull with damage, sonar with the chart, the crew
## with contracts...).
class_name Upgrades

## for sale, in the game's shop order: the drive, the hold, the fishing gear, the lantern and the cook
const FOR_SALE: PackedStringArray = ["prop", "hold", "rod", "reel", "line", "tackle", "ice", "lantern", "cook"]

## what a level of these adds: top speed and hull (fractions), fish carried, line strain and sale value
static var step: Dictionary
## shop categories, in order
static var cats: PackedStringArray
static var _by_key: Dictionary[String, Dictionary] = {}


static func _static_init() -> void:
	var d: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/upgrades.json"))
	step = d.step
	cats = d.cats
	for u: Dictionary in d.upgrades:
		_by_key[u.key] = u


## Upgrade `key`'s table entry: { key, names, cat, costs, lv, req }.
static func get_upgrade(key: String) -> Dictionary:
	return _by_key[key]


## Its name on a boat with drive `prop` (OARS, SAIL or ENGINE): the drive upgrade is named after it.
static func name_of(key: String, prop: String) -> String:
	return _by_key[key].names[prop]


## How many levels it has.
static func levels(key: String) -> int:
	return _by_key[key].costs.size()


## What the level after `level` costs, or -1 once it's at the top.
static func cost(key: String, level: int) -> int:
	var costs: Array = _by_key[key].costs
	return int(costs[level]) if level < costs.size() else -1
