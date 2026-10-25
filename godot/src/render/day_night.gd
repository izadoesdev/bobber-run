## The time of day, lit as the game lights it (environment in src/gl/renderer.ts, ported): the sun arcs across the
## sky by day, warm and low at dusk and dawn; by night the light is a cool moon's and the boat's lantern throws a warm
## pool round it. Drives the sun, the sky's ambient light and the lantern for the models, and the global uniforms of
## pixel.gdshaderinc for the ground and the fish.
class_name DayNight
extends Node

## the lantern's reach on the water (the game's light radius, lightR, for a boat without a lantern upgrade)
const LAMP_R := 21.0

const _SUN_DAY := Vector3(1.0, 0.95, 0.86)
const _SUN_DUSK := Vector3(1.3, 0.66, 0.32)
const _SUN_NIGHT := Vector3(0.26, 0.35, 0.52)
const _AMB_DAY := Vector3(0.5, 0.58, 0.68)
const _AMB_DUSK := Vector3(0.42, 0.36, 0.56)
const _AMB_NIGHT := Vector3(0.1, 0.155, 0.25)
const _TINT_DAY := Vector3(1.02, 1.0, 0.97)
const _TINT_DUSK := Vector3(1.14, 0.95, 0.86)
const _TINT_NIGHT := Vector3(0.93, 1.01, 1.0)
## where the moon lights from, in (east, south, up): (cos 1.6 pi, sin 1.6 pi, 0.7)
const _MOON := Vector3(0.309, -0.951, 0.7)

@export var sun: DirectionalLight3D
@export var environment: WorldEnvironment
@export var lantern: OmniLight3D
@export var boat: Boat

# the scene's light at noon, as set in the scene, to scale from
var _sun_energy: float
var _ambient: Color


func _ready() -> void:
	_sun_energy = sun.light_energy
	_ambient = environment.environment.ambient_light_color


func _process(_delta: float) -> void:
	var c := State.day_fraction()
	var dk := State.darkness()
	var dusk := maxf(maxf(_bell(c, 0.6, 0.05), _bell(c, 0.95, 0.04)), _bell(c, -0.05, 0.04)) * (1.0 - dk * 0.5)
	# the sun arcs across the sky through the day; by night the light comes from a fixed moon
	var day_t := clampf(fposmod(c + 0.05, 1.0) / 0.69, 0.0, 1.0)
	var a := PI * 1.25 + (day_t - 0.5) * 1.3
	var dir := Vector3(cos(a), sin(a), 0.3 + 0.6 * sin(PI * day_t)).lerp(_MOON, dk).normalized()
	var sun_c := _SUN_DAY.lerp(_SUN_DUSK, dusk).lerp(_SUN_NIGHT, dk) * (1.0 - dk * 0.62)
	var amb := _AMB_DAY.lerp(_AMB_DUSK, dusk).lerp(_AMB_NIGHT, dk)
	# the game lifts its exposure a little at night and tints the frame; both fold into the light here
	var grade := _TINT_DAY.lerp(_TINT_DUSK, dusk).lerp(_TINT_NIGHT, dk) / _TINT_DAY * (1.0 + dk * 0.25 / 1.06)
	var sun_k := sun_c / _SUN_DAY * grade
	var amb_k := amb / _AMB_DAY * grade
	# the models: world (east, south, up) is the scene's (x, z, y), and the light shines away from the sun
	sun.basis = Basis.looking_at(-Vector3(dir.x, dir.z, dir.y))
	sun.light_color = Color(sun_k.x, sun_k.y, sun_k.z)
	sun.light_energy = _sun_energy
	environment.environment.ambient_light_color = _ambient * Color(amb_k.x, amb_k.y, amb_k.z)
	# the ground: the water's light in the game (ambient, and the sun at about 0.87), relative to noon's
	var light := (amb + sun_c * 0.87) / (_AMB_DAY + _SUN_DAY * 0.87) * grade
	var burn := smoothstep(0.15, 0.6, dk)                # the lantern, lit as night falls
	RenderingServer.global_shader_parameter_set("night", dk)
	RenderingServer.global_shader_parameter_set("day_light", light)
	RenderingServer.global_shader_parameter_set("sun_dir", dir)
	RenderingServer.global_shader_parameter_set("lamp", Vector4(boat.x, boat.y, LAMP_R * 1.6, burn))
	lantern.light_energy = 2.0 * burn
	lantern.visible = burn > 0.01


static func _bell(x: float, centre: float, width: float) -> float:
	var d := (x - centre) / width
	return exp(-d * d)
