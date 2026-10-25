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
## how far the wheel zooms: views from this many times closer to this many times further out
const _ZOOM_IN := 0.5
const _ZOOM_OUT := 3.0

## the view's height over _VIEW_HEIGHT: 1 is the game's default, more shows more sea
var zoom := 1.0

@onready var _view: SubViewportContainer = $View
@onready var _camera: Camera3D = $View/Viewport/Camera
@onready var _world: Node3D = $View/Viewport/World
@onready var _tiles: WorldTiles = $View/Viewport/World/WorldTiles
@onready var _baker: TileBaker = $View/Viewport/World/WorldTiles/TileBaker
@onready var _boat: Boat = $View/Viewport/World/Boat
@onready var _autosave: Autosave = $Autosave


func _ready() -> void:
	_world.scale = Vector3(1.0, sqrt(2.0), sqrt(2.0))
	_camera.rotation = Vector3(-_TILT, 0.0, 0.0)
	get_viewport().size_changed.connect(_fit)
	_fit()
	var start := _start_spot()
	_boat.place_at(start.x, start.y, start.angle_to_point(Vector2(IslandRules.HOME.x, IslandRules.HOME.y)) + PI / 2)
	var args := {}
	for arg in OS.get_cmdline_user_args():
		var kv := arg.trim_prefix("--").split("=", true, 1)
		args[kv[0]] = kv[1] if kv.size() > 1 else ""
	var dev_run := args.has("snap") or args.has("autofish")
	_autosave.path = args.get("save", "") if dev_run else SaveGame.PATH   # (a dev run keeps no voyage unless told where)
	if _autosave.restore():
		start = Vector2(_boat.x, _boat.y)
	_baker.budget_ms = 40.0                            # a quick start: the sea round the boat first
	_tiles.follow(start)
	if dev_run:
		_dev_hooks(args)


func _process(_delta: float) -> void:
	var at := Vector2(_boat.x, _boat.y)
	_tiles.follow(at)
	if _baker.budget_ms > 3.0 and _tiles.ready_around(at, 2):
		_baker.budget_ms = 3.0                         # loaded: from now on, baking shares the frame
	# the camera looks at the boat, snapped to whole world units so the ground doesn't shimmer as it moves
	var target := _world.to_global(Vector3(roundf(_boat.x), 0.0, roundf(_boat.y)))
	_camera.position = target + _camera.global_basis.z * 400.0


func _unhandled_input(event: InputEvent) -> void:
	var b := event as InputEventMouseButton
	if b and b.pressed and (b.button_index == MOUSE_BUTTON_WHEEL_UP or b.button_index == MOUSE_BUTTON_WHEEL_DOWN):
		zoom = clampf(zoom * (1.0 / 1.15 if b.button_index == MOUSE_BUTTON_WHEEL_UP else 1.15), _ZOOM_IN, _ZOOM_OUT)
		_fit()


# The pixel scale: a whole number of screen pixels per world unit, so the view is about _VIEW_HEIGHT * zoom units
# tall (zoomed far out, a pixel can cover more than a world unit: the camera shows more than the viewport's pixels).
func _fit() -> void:
	var px := get_viewport().get_visible_rect().size.y
	_view.stretch_shrink = maxi(1, roundi(px / (_VIEW_HEIGHT * zoom)))
	_camera.size = maxf(px / _view.stretch_shrink, _VIEW_HEIGHT * zoom)
	_tiles.keep_radius = ceili(_VIEW_HEIGHT * zoom * 1.6 / Terrain.TILE / 2.0) + 1


# Open water just off Alderhaven, to the south.
func _start_spot() -> Vector2:
	var home := Vector2(IslandRules.HOME.x, IslandRules.HOME.y)
	for k in 32:
		var p := home + Vector2.from_angle(PI / 2 + k * TAU / 32.0) * IslandRules.HOME.R * _START_OFF
		if Terrain.height_at(p.x, p.y) < -0.15:
			return p
	return home + Vector2(0, IslandRules.HOME.R * 2.0)


# How the port is checked without someone at the keyboard: `-- --autofish` plays the fishing until a fish is landed
# (and exits 1 if none is, so CI can run it headless), and `--autosell` then docks at Alderhaven and sells it
# (`--snap-docked=out.png` saves the port panel first); `-- --snap=out.png [--sail=seconds] [--zoom=z] [--at=x,y]`
# waits for the sea round the boat to bake, holds the throttle that long, saves a screenshot and quits. `--clock=0.75`
# sets the time of day first (a fraction of the first day; 0.75 is the middle of the night). These runs leave the
# player's voyage alone: `--save=path` keeps one at `path` instead (picked up at the start, saved before quitting).
func _dev_hooks(args: Dictionary) -> void:
	if args.has("clock"):
		State.clock = float(args.clock) * State.DAYLEN
	if args.has("zoom"):
		zoom = float(args.zoom)
		_fit()
	if args.has("at"):
		var p: PackedStringArray = args.at.split(",")
		_boat.place_at(float(p[0]), float(p[1]), 0.0)
	while not _tiles.ready_around(Vector2(_boat.x, _boat.y), _tiles.keep_radius):
		await get_tree().process_frame
	if args.has("autofish"):
		var ok := await _autofish()
		if ok and args.has("autosell"):
			ok = await _autosell()
		if not args.has("snap"):
			_autosave.save()
			get_tree().quit(0 if ok else 1)
			return
	var sail := float(args.get("sail", "0"))
	if sail > 0.0:
		Input.action_press("sail_forward")
		Input.action_press("steer_right", 0.4)
		await get_tree().create_timer(sail).timeout
		Input.action_release("sail_forward")
		Input.action_release("steer_right")
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(args.snap)
	print("snap: boat at %.0f, %.0f, %.1f units/s; day %d, purse $%d, %d in the hold" % [_boat.x, _boat.y, _boat.speed(),
		State.day_number(), State.coins, State.hold.size()])
	_autosave.save()
	get_tree().quit()


# Play the fishing as a player would, until a fish is landed or a minute passes: cast at the school in range, strike
# at the bite, then reel, letting go whenever the line gets tight or the fish surges. Whether a fish was landed.
func _autofish() -> bool:
	var fishing: Fishing = $View/Viewport/World/Fishing
	# moor beside the nearest school that's biting, on open water
	var at := Vector2(_boat.x, _boat.y)
	var near := Schools.near(at, 900).filter(func(q: Schools.School) -> bool: return Species.biting(q.sp, State.is_night(), State.is_twilight()) and q.stock > 0)
	near.sort_custom(func(p: Schools.School, q: Schools.School) -> bool: return at.distance_to(Vector2(p.x, p.y)) < at.distance_to(Vector2(q.x, q.y)))
	if not near.is_empty():
		var s: Schools.School = near[0]
		for k in 16:
			var p := Vector2(s.x, s.y) + Vector2.from_angle(k * TAU / 16.0) * 34.0
			if Terrain.height_at(p.x, p.y) < -0.12:
				_boat.place_at(p.x, p.y, 0.0)
				break
		while not _tiles.ready_around(Vector2(_boat.x, _boat.y), 1):
			await get_tree().process_frame
	var landed := []
	fishing.caught.connect(func(f: Dictionary) -> void: landed.append(f))
	fishing.said.connect(func(text: String) -> void: print("fishing: ", text))
	var until := Time.get_ticks_msec() + 60_000
	while landed.is_empty() and Time.get_ticks_msec() < until:
		var press := false
		match fishing.stage:
			Fishing.Stage.NONE: press = fishing.target != null
			Fishing.Stage.BITE: press = true
			Fishing.Stage.REEL: press = fishing.tension < 0.6 and fishing.surge < 0.9
		if press: Input.action_press("cast")
		else: Input.action_release("cast")
		await get_tree().process_frame
		if fishing.stage != Fishing.Stage.REEL:
			Input.action_release("cast")
			await get_tree().process_frame
	Input.action_release("cast")
	print("autofish: ", "landed %s, %.2f kg, $%d" % [landed[0].name, landed[0].kg, landed[0].value] if landed else "nothing landed in a minute")
	return not landed.is_empty()


# Tie up at Alderhaven's pier and sell the hold as a player would (E to dock, Space on the focused Sell all); whether
# the coins came in and the hold emptied.
func _autosell() -> bool:
	var home := Ports.home()
	var off := home.end + Vector2.from_angle(home.ang) * 12.0
	_boat.place_at(off.x, off.y, home.ang + PI)
	while not _tiles.ready_around(off, 1):
		await get_tree().process_frame
	var before := State.coins
	var fish := State.hold.size()
	await _tap("interact")
	if State.docked == null:
		print("autosell: couldn't dock at ", home.name)
		return false
	for arg in OS.get_cmdline_user_args():            # --snap-docked=out.png: the port panel, before selling
		if arg.begins_with("--snap-docked="):
			await RenderingServer.frame_post_draw
			get_viewport().get_texture().get_image().save_png(arg.trim_prefix("--snap-docked="))
	await _tap("ui_accept")
	var ok := State.coins > before and State.hold.is_empty()
	print("autosell: docked at %s, sold %d fish for $%d (purse $%d)" % [home.name, fish, State.coins - before, State.coins])
	return ok


# A press and release of `action` as real input events, so focused buttons hear it as well as polled actions.
func _tap(action: String) -> void:
	for pressed in [true, false]:
		var e := InputEventAction.new()
		e.action = action
		e.pressed = pressed
		Input.parse_input_event(e)
		await get_tree().process_frame
		await get_tree().process_frame
