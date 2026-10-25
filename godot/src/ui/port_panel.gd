## A port, docked: its name, your purse, the fish in the hold at this port's prices, Sell all, a night at the inn
## (rest until dusk for the night fish, or sleep until morning), and Set sail.
## The game's port has more tabs (the outfitter, shipyard, harbour projects, contracts); they come later.
class_name PortPanel
extends PanelContainer

@export var docking: Docking

var _title: Label
var _coins: Label
var _fish: Label
var _sell: Button
var _rest: Button


func _ready() -> void:
	theme = UiTheme.get_theme()
	custom_minimum_size = Vector2(380, 0)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	add_child(box)
	_title = Label.new()
	_title.add_theme_color_override("font_color", UiTheme.GOLD)
	_title.add_theme_font_size_override("font_size", 26)
	box.add_child(_title)
	_coins = Label.new()
	box.add_child(_coins)
	_fish = Label.new()
	box.add_child(_fish)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	box.add_child(row)
	_sell = Button.new()
	_sell.pressed.connect(_sell_all)
	row.add_child(_sell)
	_rest = Button.new()
	_rest.pressed.connect(State.rest)
	row.add_child(_rest)
	var leave := Button.new()
	leave.text = "Set sail  [E]"
	leave.pressed.connect(docking.set_sail)
	row.add_child(leave)
	visible = false
	docking.docked.connect(func(_p: Ports.Port) -> void: _refresh())
	docking.undocked.connect(func() -> void: visible = false)
	State.changed.connect(func() -> void: if visible: _refresh())


func _refresh() -> void:
	var p := State.docked
	visible = p != null
	if p == null:
		return
	_title.text = p.name
	_coins.text = "Purse  $%d" % State.coins
	var lines := PackedStringArray()
	for f in State.hold:
		lines.append("%s  %.2f kg   $%d" % [f.name, f.kg, roundi(f.value * Market.price_at(p, f.sp))])
	_fish.text = "\n".join(lines) if lines else "Your hold is empty"
	var total := Market.sale_value(p)
	_sell.text = "Sell all  $%d" % total
	_sell.disabled = State.hold.is_empty()
	_rest.text = "Rest until dusk" if State.is_daytime() else "Sleep until morning"
	_rest.tooltip_text = "Night fish only bite after dark" if State.is_daytime() else "Day fish return at dawn"
	_sell.grab_focus()


func _sell_all() -> void:
	var p := State.docked
	if p != null and not State.hold.is_empty():
		Market.sell_all(p)
