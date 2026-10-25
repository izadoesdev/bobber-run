## Bakes terrain tiles in the background of the frame: queued tiles are baked a row at a time until this frame's
## budget is spent, then carried on next frame. The web build has no threads (a worker task would run inline and stall
## the frame), so this is how the world loads without hitches on every platform.
class_name TileBaker
extends Node

signal baked(tile: Vector2i, heights: PackedFloat32Array)

## milliseconds of each frame given to baking
@export var budget_ms := 3.0

## tiles baked so far, and the milliseconds they took altogether
var tiles_baked := 0
var bake_ms := 0.0

var _queue: Array[Vector2i] = []
var _current := Vector2i.ZERO
var _heights := PackedFloat32Array()
var _islands: Array[Islands.Island] = []
var _row := -1


## Ask for tile `tile`; nearer requests should come first. A tile already queued or being baked isn't added twice.
func request(tile: Vector2i) -> void:
	if not (tile in _queue or (_row >= 0 and tile == _current)):
		_queue.append(tile)


## Forget queued tiles that are no longer wanted (the one being baked is finished).
func keep_only(wanted: Dictionary) -> void:
	_queue = _queue.filter(func(t: Vector2i) -> bool: return wanted.has(t))


func _process(_delta: float) -> void:
	var start := Time.get_ticks_usec()
	var stop := start + int(budget_ms * 1000.0)
	while Time.get_ticks_usec() < stop:
		if _row < 0:
			if _queue.is_empty():
				break
			_current = _queue.pop_front()
			_heights = PackedFloat32Array()
			_heights.resize(Terrain.TILE_N * Terrain.TILE_N)
			_islands = Terrain.tile_islands(_current.x, _current.y)
			_row = 0
		Terrain.bake_row(_current.x, _current.y, _row, _islands, _heights)
		_row += 1
		if _row == Terrain.TILE_N:
			_row = -1
			tiles_baked += 1
			baked.emit(_current, _heights)
	bake_ms += (Time.get_ticks_usec() - start) / 1000.0
