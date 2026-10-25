## A chart of every cell's main island, straight from the rules the server shares (IslandRules): where it is, how big,
## what it costs. Drag to pan, wheel to zoom. Run with `-- --snap=out.png` to save a screenshot of the first frame.
extends Node2D

const SEA := Color("2f6f8f")
const LAND := Color("e6d6a6")
const HOME := Color("f0cf6a")
const GRID := Color(1, 1, 1, 0.06)
## cells either side of home that are drawn
const SPAN := 14

@onready var _camera: Camera2D = $Camera2D
var _islands: Array[IslandRules.MainIsland] = []
var _dragging := false


func _ready() -> void:
	RenderingServer.set_default_clear_color(SEA)
	for j in range(-SPAN, SPAN + 1):
		for i in range(-SPAN, SPAN + 1):
			var m := IslandRules.main_island(i, j)
			if m != null:
				_islands.append(m)
	_camera.position = Vector2(IslandRules.HOME.x, IslandRules.HOME.y)
	_camera.zoom = Vector2.ONE * 0.08
	var snap := _snap_path()
	if snap:
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(snap)
		get_tree().quit()


func _draw() -> void:
	var c := IslandRules.CELL
	for k in range(-SPAN, SPAN + 2):
		draw_line(Vector2(k * c, -SPAN * c), Vector2(k * c, (SPAN + 1) * c), GRID, -1)
		draw_line(Vector2(-SPAN * c, k * c), Vector2((SPAN + 1) * c, k * c), GRID, -1)
	for m in _islands:
		var home := is_equal_approx(m.x, IslandRules.HOME.x) and is_equal_approx(m.y, IslandRules.HOME.y)
		draw_circle(Vector2(m.x, m.y), m.R, HOME if home else LAND.lerp(SEA, 0.35 - m.peak * 0.35))


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var b := event as InputEventMouseButton
		if b.button_index == MOUSE_BUTTON_LEFT:
			_dragging = b.pressed
		elif b.pressed and (b.button_index == MOUSE_BUTTON_WHEEL_UP or b.button_index == MOUSE_BUTTON_WHEEL_DOWN):
			var k := 1.15 if b.button_index == MOUSE_BUTTON_WHEEL_UP else 1 / 1.15
			_camera.zoom = (_camera.zoom * k).clamp(Vector2.ONE * 0.02, Vector2.ONE * 2)
	elif event is InputEventMouseMotion and _dragging:
		_camera.position -= (event as InputEventMouseMotion).relative / _camera.zoom


func _snap_path() -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--snap="):
			return arg.trim_prefix("--snap=")
	return ""
