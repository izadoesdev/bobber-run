## The boat's wake: flecks of foam left on the water behind the stern that spread a little and fade, dropped faster
## the faster the boat goes and none when it's still. Native particles, laid flat on the sea in world space so they stay where
## they were dropped as the boat sails on.
class_name Wake
extends CPUParticles3D

@export var boat: Boat
## the boat's speed (world units a second) at which the wake is at its thickest
@export var full_speed := 40.0


func _ready() -> void:
	var fleck := QuadMesh.new()
	fleck.size = Vector2.ONE * 1.6
	fleck.orientation = PlaneMesh.FACE_Y              # lying on the water
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.vertex_color_use_as_albedo = true
	fleck.material = m
	mesh = fleck
	local_coords = false
	amount = 90
	lifetime = 1.6
	emitting = false
	gravity = Vector3.ZERO
	direction = Vector3(0, 0, 1)
	spread = 80.0
	initial_velocity_min = 1.0
	initial_velocity_max = 4.0
	emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	emission_sphere_radius = 2.0
	scale_amount_min = 0.6
	scale_amount_max = 1.2
	var fade := Gradient.new()
	fade.set_color(0, Color(0.95, 0.98, 0.97, 0.85))
	fade.set_color(1, Color(0.95, 0.98, 0.97, 0.0))
	color_ramp = fade


func _process(_delta: float) -> void:
	var k := clampf(boat.speed() / full_speed, 0.0, 1.0)
	emitting = k > 0.08
	speed_scale = 0.5 + 0.5 * k                        # a slow boat drops its flecks more slowly
