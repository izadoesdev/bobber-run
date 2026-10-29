## Keeps the voyage (SaveGame): picks it up when the game starts, and writes it as you play: when the purse, the hold,
## the upgrades or the clock jumps, on docking and casting off, when the window loses focus, and every 15 seconds, as the game does.
class_name Autosave
extends Node

const _EVERY_S := 15.0

@export var boat: Boat
@export var docking: Docking
## where the voyage is kept; empty keeps nothing (the dev runs, unless given --save=path)
var path := SaveGame.PATH
var _t := 0.0
var _due := false


func _ready() -> void:
	State.changed.connect(func() -> void: _due = true)
	docking.docked.connect(func(_p: Ports.Port) -> void: _due = true)
	docking.undocked.connect(func() -> void: _due = true)


## Put the saved voyage back: purse, hold, clock, and the boat where it lay. Whether there was one to put back.
func restore() -> bool:
	var v := SaveGame.read(path) if not path.is_empty() else {}
	if v.is_empty():
		return false
	State.coins = v.get("coins", State.coins)
	State.clock = v.get("clock", State.clock)
	State.up = v.up
	boat.fit_upgrades()
	State.hold.assign(v.hold.slice(0, int(boat.stats().hold)))
	if v.has("x") and v.has("y") and Terrain.height_at(v.x, v.y) < 0.0:
		boat.place_at(v.x, v.y, v.get("a", 0.0))
	State.changed.emit()
	_due = false
	return true


func _process(delta: float) -> void:
	_t += delta
	if _due or _t > _EVERY_S:
		save()


func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_OUT or what == NOTIFICATION_WM_CLOSE_REQUEST:
		save()


func save() -> void:
	_t = 0.0
	_due = false
	if not path.is_empty():
		SaveGame.write(path, SaveGame.to_text({ coins = State.coins, clock = State.clock, hold = State.hold, up = State.up,
			x = boat.x, y = boat.y, a = boat.a }))
