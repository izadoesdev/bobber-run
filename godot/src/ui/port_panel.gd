## A port, docked: its name and your purse, then two tabs. The Market has the fish in the hold at this port's prices,
## Sell all, and a night at the inn (rest until dusk for the night fish, or sleep until morning). The Outfitter has
## the upgrades for sale (Upgrades), by shop category: each one's level, what the next level does, and its price.
## Set sail leaves. The game's port has more tabs (the shipyard, harbour projects, contracts); they come later.
class_name PortPanel
extends PanelContainer

@export var docking: Docking
@export var boat: Boat

var _title: Label
var _coins: Label
var _fish: Label
var _sell: Button
var _rest: Button
## the Market and Outfitter tabs, and each upgrade's Buy button
var tabs: TabContainer
var buy_buttons: Dictionary[String, Button] = {}
var _about: Dictionary[String, Label] = {}


func _ready() -> void:
	theme = UiTheme.get_theme()
	custom_minimum_size = Vector2(470, 0)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	add_child(box)
	_title = Label.new()
	_title.add_theme_color_override("font_color", UiTheme.GOLD)
	_title.add_theme_font_size_override("font_size", 26)
	box.add_child(_title)
	_coins = Label.new()
	box.add_child(_coins)
	tabs = TabContainer.new()
	tabs.use_hidden_tabs_for_min_size = true           # the panel keeps its size from tab to tab
	box.add_child(tabs)
	tabs.add_child(_market_tab())
	tabs.add_child(_outfitter_tab())
	var leave := Button.new()
	leave.text = "Set sail  [E]"
	leave.pressed.connect(docking.set_sail)
	box.add_child(leave)
	visible = false
	docking.docked.connect(func(_p: Ports.Port) -> void: _refresh())
	docking.undocked.connect(func() -> void: visible = false)
	State.changed.connect(func() -> void: if visible: _refresh())


func _market_tab() -> Control:
	var tab := VBoxContainer.new()
	tab.name = "Market"
	tab.add_theme_constant_override("separation", 10)
	_fish = Label.new()
	tab.add_child(_fish)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	tab.add_child(row)
	_sell = Button.new()
	_sell.pressed.connect(_sell_all)
	row.add_child(_sell)
	_rest = Button.new()
	_rest.pressed.connect(State.rest)
	row.add_child(_rest)
	return tab


func _outfitter_tab() -> Control:
	var scroll := ScrollContainer.new()
	scroll.name = "Outfitter"
	scroll.custom_minimum_size.y = 340
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 6)
	scroll.add_child(list)
	for cat in Upgrades.cats:
		var keys := Array(Upgrades.FOR_SALE).filter(func(k: String) -> bool: return Upgrades.get_upgrade(k).cat == cat)
		if keys.is_empty():
			continue
		var heading := Label.new()
		heading.text = cat.capitalize()
		heading.add_theme_color_override("font_color", UiTheme.GOLD)
		list.add_child(heading)
		for key: String in keys:
			var row := HBoxContainer.new()
			var about := Label.new()
			about.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			about.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			about.add_theme_font_size_override("font_size", 15)
			row.add_child(about)
			var buy := Button.new()
			buy.custom_minimum_size.x = 84
			buy.size_flags_vertical = Control.SIZE_SHRINK_CENTER
			buy.pressed.connect(State.buy.bind(key))
			row.add_child(buy)
			list.add_child(row)
			_about[key] = about
			buy_buttons[key] = buy
	return scroll


func _refresh() -> void:
	var p := State.docked
	visible = p != null
	if p == null:
		return
	_title.text = p.name
	_coins.text = "Purse  $%d" % State.coins
	var lines := PackedStringArray()
	for f in State.hold:
		lines.append("%s  %.2f kg   $%d" % [f.name, f.kg, Market.fish_price(p, f)])
	_fish.text = "\n".join(lines) if lines else "Your hold is empty"
	_sell.text = "Sell all  $%d" % Market.sale_value(p)
	_sell.disabled = State.hold.is_empty()
	_rest.text = "Rest until dusk" if State.is_daytime() else "Sleep until morning"
	_rest.tooltip_text = "Night fish only bite after dark" if State.is_daytime() else "Day fish return at dawn"
	for key in buy_buttons:
		var level := State.level(key)
		var price := Upgrades.cost(key, level)
		_about[key].text = "%s  %d/%d\n%s" % [Upgrades.name_of(key, boat.stats().prop), level, Upgrades.levels(key),
			Upgrades.get_upgrade(key).lv[level] if price >= 0 else "Fully upgraded"]
		buy_buttons[key].text = "$%d" % price if price >= 0 else "Done"
		buy_buttons[key].disabled = price < 0 or price > State.coins
	if not _sell.disabled:
		_sell.grab_focus()


func _sell_all() -> void:
	var p := State.docked
	if p != null and not State.hold.is_empty():
		Market.sell_all(p)
