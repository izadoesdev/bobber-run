## Sailing round Alderhaven: the boat, the sea and islands round it, and the camera.
##
## The world is drawn as the game draws it: from above at a slant, so a thing's height lifts it up the screen (screen y
## is world y minus height). That's an orthographic camera tilted 45 degrees, with the world scaled by root 2 along
## the sea's y and up, so neither is foreshortened. It renders into a small viewport, one pixel per world unit, scaled
## up by a whole number with no smoothing for the pixel-art look.
extends Node

## world units the view is tall at the default zoom (the rowboat's view in the game)
const _VIEW_HEIGHT := 200.0
const _TILT := deg_to_rad(45.0)
## how far the boat starts off Alderhaven's centre, in its radii
const _START_OFF := 1.45

@onready var _view: SubViewportContainer = $View
@onready var _camera: Camera3D = $View/Viewport/Camera
@onready var _sun: DirectionalLight3D = $View/Viewport/Sun
@onready var _world: Node3D = $View/Viewport/World
@onready var _tiles: WorldTiles = $View/Viewport/World/WorldTiles
@onready var _baker: TileBaker = $View/Viewport/World/WorldTiles/TileBaker
@onready var _boat: Boat = $View/Viewport/World/Boat


func _ready() -> void:
	_world.scale = Vector3(1.0, sqrt(2.0), sqrt(2.0))
	_camera.rotation = Vector3(-_TILT, 0.0, 0.0)
	_sun.look_at(_sun.global_position - Vector3(-0.62, 0.77, -0.15).normalized())   # from the north-west, high up
	get_viewport().size_changed.connect(_fit)
	_fit()
	var start := _start_spot()
	_boat.place_at(start.x, start.y, start.angle_to_point(Vector2(IslandRules.HOME.x, IslandRules.HOME.y)) + PI / 2)
	_baker.budget_ms = 40.0                            # a quick start: the sea round the boat first
	_tiles.follow(start)
	_dev_snapshot()


func _process(_delta: float) -> void:
	var at := Vector2(_boat.x, _boat.y)
	_tiles.follow(at)
	if _baker.budget_ms > 3.0 and _tiles.ready_around(at, 2):
		_baker.budget_ms = 3.0                         # loaded: from now on, baking shares the frame
	# the camera looks at the boat, snapped to whole world units so the ground doesn't shimmer as it moves
	var target := _world.to_global(Vector3(roundf(_boat.x), 0.0, roundf(_boat.y)))
	_camera.position = target + _camera.global_basis.z * 400.0


# The pixel scale: a whole number of screen pixels per world unit, so the view is about _VIEW_HEIGHT units tall.
func _fit() -> void:
	var px := get_viewport().get_visible_rect().size.y
	_view.stretch_shrink = maxi(1, roundi(px / _VIEW_HEIGHT))
	_camera.size = px / _view.stretch_shrink


# Open water just off Alderhaven, to the south.
func _start_spot() -> Vector2:
	var home := Vector2(IslandRules.HOME.x, IslandRules.HOME.y)
	for k in 32:
		var p := home + Vector2.from_angle(PI / 2 + k * TAU / 32.0) * IslandRules.HOME.R * _START_OFF
		if Terrain.height_at(p.x, p.y) < -0.15:
			return p
	return home + Vector2(0, IslandRules.HOME.R * 2.0)


# `-- --snap=out.png [--sail=seconds]`: once the sea round the boat is baked, hold the throttle for that long, save a
# screenshot and quit (how the port is checked without someone at the keyboard).
func _dev_snapshot() -> void:
	var args := {}
	for arg in OS.get_cmdline_user_args():
		var kv := arg.trim_prefix("--").split("=")
		args[kv[0]] = kv[1] if kv.size() > 1 else ""
	if not args.has("snap"):
		return
	while not _tiles.ready_around(Vector2(_boat.x, _boat.y), 2):
		await get_tree().process_frame
	var sail := float(args.get("sail", "0"))
	if sail > 0.0:
		Input.action_press("sail_forward")
		Input.action_press("steer_right", 0.4)
		await get_tree().create_timer(sail).timeout
		Input.action_release("sail_forward")
		Input.action_release("steer_right")
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(args.snap)
	print("snap: boat at %.0f, %.0f, %.1f units/s" % [_boat.x, _boat.y, _boat.speed()])
	get_tree().quit()
