## The sea chart: the terrain round the view, baked tile by tile in the background (TileBaker) and shown as height
## bands, with Alderhaven marked. Drag to pan, wheel to zoom.
##
## Run with `-- --snap=out.png` to wait for the view to fill, save a screenshot and quit; the bake's timings are
## printed either way (the web performance check reads them from the browser console).
extends Node2D

const _BANDS := preload("res://src/dev/height_bands.gdshader")
## tiles round the view that are kept, and baked ahead
const _MARGIN := 1

@onready var _camera: Camera2D = $Camera2D
@onready var _baker: TileBaker = $TileBaker
var _material := ShaderMaterial.new()
var _tiles: Dictionary[Vector2i, Sprite2D] = {}
var _dragging := false
var _reported := false


func _ready() -> void:
	_material.shader = _BANDS
	_baker.baked.connect(_show_tile)
	_camera.position = Vector2(IslandRules.HOME.x, IslandRules.HOME.y)
	_camera.zoom = Vector2.ONE * 0.6
	var snap := _snap_path()
	if snap:
		_baker.budget_ms = 50.0                          # nothing else to do: fill the view quickly
		while not _view_filled():
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(snap)
		get_tree().quit()


func _process(_delta: float) -> void:
	# the tiles in view (and a margin), nearest the centre first; any others are forgotten
	var wanted: Dictionary[Vector2i, bool] = {}
	for t in _tiles_in_view():
		wanted[t] = true
		if not _tiles.has(t):
			_baker.request(t)
	_baker.keep_only(wanted)
	for t in _tiles.keys():
		if not wanted.has(t):
			_tiles[t].queue_free()
			_tiles.erase(t)
	if not _reported and _view_filled():
		_report()


func _draw() -> void:
	draw_arc(Vector2(IslandRules.HOME.x, IslandRules.HOME.y), IslandRules.HOME.R * 1.3, 0.0, TAU, 64, Color("f0cf6a"), 3.0)


func _show_tile(t: Vector2i, heights: PackedFloat32Array) -> void:
	var image := Image.create_from_data(Terrain.TILE_N, Terrain.TILE_N, false, Image.FORMAT_RF, heights.to_byte_array())
	image.convert(Image.FORMAT_RH)                     # half floats filter smoothly on every WebGL 2 device; 32-bit ones may not
	var sprite := Sprite2D.new()
	sprite.texture = ImageTexture.create_from_image(image)
	sprite.material = _material
	sprite.centered = false
	sprite.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR   # heights between samples, so coasts stay smooth
	sprite.position = Vector2(t * Terrain.TILE) - Vector2.ONE * Terrain.STEP
	sprite.scale = Vector2.ONE * Terrain.STEP
	sprite.z_index = -1
	add_child(sprite)
	if _tiles.has(t):
		_tiles[t].queue_free()
	_tiles[t] = sprite


func _tiles_in_view() -> Array[Vector2i]:
	var half := get_viewport_rect().size / _camera.zoom / 2.0
	var lo := ((_camera.position - half) / Terrain.TILE).floor()
	var hi := ((_camera.position + half) / Terrain.TILE).floor()
	var centre := _camera.position / Terrain.TILE
	var out: Array[Vector2i] = []
	for ty in range(int(lo.y) - _MARGIN, int(hi.y) + _MARGIN + 1):
		for tx in range(int(lo.x) - _MARGIN, int(hi.x) + _MARGIN + 1):
			out.append(Vector2i(tx, ty))
	out.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		return (Vector2(a) + Vector2(0.5, 0.5)).distance_squared_to(centre) < (Vector2(b) + Vector2(0.5, 0.5)).distance_squared_to(centre))
	return out


func _view_filled() -> bool:
	return _tiles_in_view().all(func(t: Vector2i) -> bool: return _tiles.has(t))


func _report() -> void:
	_reported = true
	print("chart: %d tiles baked in %.0f ms, %.1f ms a tile" % [_baker.tiles_baked, _baker.bake_ms, _baker.bake_ms / maxi(1, _baker.tiles_baked)])


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var b := event as InputEventMouseButton
		if b.button_index == MOUSE_BUTTON_LEFT:
			_dragging = b.pressed
		elif b.pressed and (b.button_index == MOUSE_BUTTON_WHEEL_UP or b.button_index == MOUSE_BUTTON_WHEEL_DOWN):
			var k := 1.15 if b.button_index == MOUSE_BUTTON_WHEEL_UP else 1 / 1.15
			_camera.zoom = (_camera.zoom * k).clamp(Vector2.ONE * 0.1, Vector2.ONE * 4)
	elif event is InputEventMouseMotion and _dragging:
		_camera.position -= (event as InputEventMouseMotion).relative / _camera.zoom


func _snap_path() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--snap="):
			return arg.trim_prefix("--snap=")
	return ""
