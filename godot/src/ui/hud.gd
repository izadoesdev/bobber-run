## The heads-up display over the sea, at the screen's own resolution so text stays crisp: the purse and the hold, what
## you can do now (the prompt), short notes that fade, the reel's tension and the catch's progress while a fish is on,
## the card for a fish landed, and the port panel while docked. In the interface's one theme (UiTheme).
class_name Hud
extends CanvasLayer

const _NOTE_S := 2.6

@export var fishing: Fishing
@export var docking: Docking
@export var boat: Boat

var _hold: Label
var _prompt: Label
var _note: Label
var _note_t := 0.0
var _reel: PanelContainer
var _tension: ProgressBar
var _progress: ProgressBar
var _card: PanelContainer
var _card_text: Label
var _card_t := 0.0


func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = UiTheme.get_theme()
	add_child(root)
	_hold = _chip(root, Control.PRESET_TOP_LEFT, Vector2(12, 12))
	_prompt = _chip(root, Control.PRESET_CENTER_BOTTOM, Vector2(0, -24))
	_note = _chip(root, Control.PRESET_CENTER_TOP, Vector2(0, 16))
	_reel = PanelContainer.new()
	var bars := VBoxContainer.new()
	_tension = _bar(bars, "Line")
	_progress = _bar(bars, "Catch")
	_reel.add_child(bars)
	_place(root, _reel, Control.PRESET_CENTER_BOTTOM, Vector2(0, -70))
	_card = PanelContainer.new()
	_card_text = Label.new()
	_card_text.add_theme_color_override("font_color", UiTheme.GOLD)
	_card.add_child(_card_text)
	_place(root, _card, Control.PRESET_CENTER, Vector2(0, -90))
	var port := PortPanel.new()
	port.docking = docking
	_place(root, port, Control.PRESET_CENTER_RIGHT, Vector2(-24, 0))   # beside the harbour, not over it
	port.mouse_filter = Control.MOUSE_FILTER_STOP
	fishing.said.connect(_say)
	fishing.caught.connect(_show_catch)
	docking.docked.connect(func(p: Ports.Port) -> void: _say("Tied up at " + p.name))


func _process(delta: float) -> void:
	_hold.text = "$%d    Hold %d / %d" % [State.coins, State.hold.size(), int(boat.stats().hold)]
	_prompt.text = _prompt_text()
	_prompt.get_parent().visible = not _prompt.text.is_empty()
	_note_t -= delta
	_note.get_parent().modulate.a = clampf(_note_t / 0.6, 0.0, 1.0)
	_card_t -= delta
	_card.visible = _card_t > 0.0 and State.docked == null
	_reel.visible = fishing.stage == Fishing.Stage.REEL
	if _reel.visible:
		_tension.value = fishing.tension
		_tension.modulate = UiTheme.RED if fishing.tension > 0.8 else UiTheme.AMBER if fishing.tension > 0.6 else UiTheme.CREAM
		_progress.value = fishing.progress


func _prompt_text() -> String:
	if State.docked != null:
		return ""
	match fishing.stage:
		Fishing.Stage.WAIT: return "Wait for the bite..."
		Fishing.Stage.BITE: return "[SPACE] Strike!"
		Fishing.Stage.REEL: return "Hold [SPACE] to reel. Let go when it pulls"
		Fishing.Stage.CAST: return ""
	var port := docking.port_in_reach()
	if port != null:
		return "[E] Dock at " + port.name if boat.speed() < 14.0 else "Slow down to dock"
	if fishing.target == null:
		return ""
	if fishing.room() <= 0:
		return "Your hold is full"
	return "[SPACE] Cast for " + Species.all[fishing.target.sp].name if boat.speed() < 10.0 else "Stop to fish"


func _say(text: String) -> void:
	_note.text = text
	_note_t = _NOTE_S


func _show_catch(fish: Dictionary) -> void:
	_card_text.text = "%s\n%.2f kg   %s   $%d" % [fish.name, fish.kg, "*".repeat(fish.stars), fish.value]
	_card_t = 3.0


func _chip(root: Control, preset: Control.LayoutPreset, offset: Vector2) -> Label:
	var chip := PanelContainer.new()
	var label := Label.new()
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	chip.add_child(label)
	_place(root, chip, preset, offset)
	return label


func _bar(box: VBoxContainer, name: String) -> ProgressBar:
	var row := HBoxContainer.new()
	var label := Label.new()
	label.text = name
	label.custom_minimum_size.x = 64
	var bar := ProgressBar.new()
	bar.max_value = 1.0
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(220, 12)
	bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(label)
	row.add_child(bar)
	box.add_child(row)
	return bar


# A control anchored at `preset`, offset by `offset`, growing round its anchor.
func _place(root: Control, c: Control, preset: Control.LayoutPreset, offset: Vector2) -> void:
	c.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(c)
	c.set_anchors_and_offsets_preset(preset, Control.PRESET_MODE_MINSIZE)
	# grow inward from a corner or edge, both ways along a centred one
	var left := preset in [Control.PRESET_TOP_LEFT, Control.PRESET_BOTTOM_LEFT, Control.PRESET_CENTER_LEFT]
	var right := preset in [Control.PRESET_TOP_RIGHT, Control.PRESET_BOTTOM_RIGHT, Control.PRESET_CENTER_RIGHT]
	var bottom := preset in [Control.PRESET_BOTTOM_LEFT, Control.PRESET_CENTER_BOTTOM, Control.PRESET_BOTTOM_RIGHT]
	var top := preset in [Control.PRESET_TOP_LEFT, Control.PRESET_CENTER_TOP, Control.PRESET_TOP_RIGHT]
	c.grow_horizontal = Control.GROW_DIRECTION_END if left else Control.GROW_DIRECTION_BEGIN if right else Control.GROW_DIRECTION_BOTH
	c.grow_vertical = Control.GROW_DIRECTION_BEGIN if bottom else Control.GROW_DIRECTION_END if top else Control.GROW_DIRECTION_BOTH
	c.position += offset
