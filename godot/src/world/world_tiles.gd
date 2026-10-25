## The baked terrain round a point of interest: tiles are asked for nearest first, baked in the background (TileBaker),
## kept while they're near, and forgotten when they're not. Heights are read from them between samples, smoothly, so
## sailing, collisions and the ground drawn all see the same terrain; where a tile isn't baked yet the height function
## answers instead (the same function the tiles are baked from).
class_name WorldTiles
extends Node

signal tile_added(tile: Vector2i, heights: PackedFloat32Array)
signal tile_dropped(tile: Vector2i)

## tiles kept round the centre, each way
@export var keep_radius := 3

var _tiles: Dictionary[Vector2i, PackedFloat32Array] = {}
@onready var _baker: TileBaker = $TileBaker


func _ready() -> void:
	_baker.baked.connect(_on_baked)


## Keep the tiles round world point `centre` baked, nearest first, and drop those further away.
func follow(centre: Vector2) -> void:
	var c := Vector2i((centre / Terrain.TILE).floor())
	var wanted: Dictionary[Vector2i, bool] = {}
	var order: Array[Vector2i] = []
	for dy in range(-keep_radius, keep_radius + 1):
		for dx in range(-keep_radius, keep_radius + 1):
			order.append(c + Vector2i(dx, dy))
	order.sort_custom(func(a: Vector2i, b: Vector2i) -> bool: return (a - c).length_squared() < (b - c).length_squared())
	for t in order:
		wanted[t] = true
		if not _tiles.has(t):
			_baker.request(t)
	_baker.keep_only(wanted)
	for t in _tiles.keys():
		if not wanted.has(t):
			_tiles.erase(t)
			tile_dropped.emit(t)


## Whether every tile within `radius` tiles of world point `centre` is baked.
func ready_around(centre: Vector2, radius := 1) -> bool:
	var c := Vector2i((centre / Terrain.TILE).floor())
	for dy in range(-radius, radius + 1):
		for dx in range(-radius, radius + 1):
			if not _tiles.has(c + Vector2i(dx, dy)):
				return false
	return true


## The terrain height at world point (x, y), read between the baked samples.
func height(x: float, y: float) -> float:
	var t := Vector2i(floori(x / Terrain.TILE), floori(y / Terrain.TILE))
	var h: PackedFloat32Array = _tiles.get(t, PackedFloat32Array())
	if h.is_empty():
		return Terrain.height_at(x, y)
	# sample k of a row sits at world t * TILE + (k - 1) * STEP
	var fx := (x - t.x * Terrain.TILE) / Terrain.STEP + 1.0
	var fy := (y - t.y * Terrain.TILE) / Terrain.STEP + 1.0
	var ix := floori(fx)
	var iy := floori(fy)
	var ax := fx - ix
	var ay := fy - iy
	var o := iy * Terrain.TILE_N + ix
	var top := lerpf(h[o], h[o + 1], ax)
	var bottom := lerpf(h[o + Terrain.TILE_N], h[o + Terrain.TILE_N + 1], ax)
	return lerpf(top, bottom, ay)


func _on_baked(t: Vector2i, heights: PackedFloat32Array) -> void:
	_tiles[t] = heights
	tile_added.emit(t, heights)
