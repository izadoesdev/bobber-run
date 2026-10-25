## Tying up at a harbour (src/game/sailing.ts, ported): near a pier's end and slow, E docks the boat there, lying off
## the pier facing out to sea; E again (or the port's Set sail) casts off.
class_name Docking
extends Node

signal docked(port: Ports.Port)
signal undocked

@export var boat: Boat
## the boat must be slower than this to dock
const _SLOW := 14.0


## The port whose pier end the boat is at, or null.
func port_in_reach() -> Ports.Port:
	for p in Ports.near(Vector2(boat.x, boat.y), 120.0):
		if Vector2(boat.x, boat.y).distance_to(p.end) < 30.0 + float(boat.stats().L):
			return p
	return null


func _process(_delta: float) -> void:
	if not Input.is_action_just_pressed("interact"):
		return
	if State.docked != null:
		set_sail()
		return
	var p := port_in_reach()
	if p != null and boat.speed() < _SLOW:
		State.docked = p
		boat.place_at(p.dock.x, p.dock.y, p.ang)
		docked.emit(p)


func set_sail() -> void:
	State.docked = null
	undocked.emit()
