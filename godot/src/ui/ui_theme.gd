## The interface's one theme: the game's own pixel font (crisp, no smoothing), its cream and gold text, and dark panels.
class_name UiTheme

const CREAM := Color("f4efe4")
const GOLD := Color("f0cf6a")
const RED := Color("e05a45")
const AMBER := Color("f0b04a")
const _PANEL := Color(0.106, 0.165, 0.2, 0.88)
const _FONT := preload("res://assets/fonts/pixelify-sans-latin-400-normal.woff2")

static var _theme: Theme


static func get_theme() -> Theme:
	if _theme != null:
		return _theme
	var font: FontFile = _FONT.duplicate()
	font.antialiasing = TextServer.FONT_ANTIALIASING_NONE
	font.subpixel_positioning = TextServer.SUBPIXEL_POSITIONING_DISABLED
	var ts := TextServerManager.get_primary_interface()
	font.opentype_feature_overrides = { ts.name_to_tag("liga"): 0 }   # the web font's "fi" ligature is a broken glyph
	_theme = Theme.new()
	_theme.default_font = font
	_theme.default_font_size = 18
	_theme.set_color("font_color", "Label", CREAM)
	_theme.set_stylebox("panel", "PanelContainer", _box(_PANEL, 6, 10))
	_theme.set_stylebox("background", "ProgressBar", _box(Color(0, 0, 0, 0.45), 3, 0))
	_theme.set_stylebox("fill", "ProgressBar", _box(Color.WHITE, 3, 0))
	var shades := {normal = 0.72, hover = 0.82, pressed = 0.64, focus = 0.76, disabled = 0.4}   # buttons: wood, brighter when hovered
	for state: String in shades:
		_theme.set_stylebox(state, "Button", _box(Color(0.6, 0.45, 0.2, shades[state]), 4, 8))
	_theme.set_color("font_color", "Button", CREAM)
	_theme.set_color("font_hover_color", "Button", GOLD)
	return _theme


static func _box(colour: Color, radius: int, margin: int) -> StyleBoxFlat:
	var b := StyleBoxFlat.new()
	b.bg_color = colour
	b.set_corner_radius_all(radius)
	b.set_content_margin_all(margin)
	return b
