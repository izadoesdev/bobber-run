// A fish under the surface: its own colours, toon-lit, faded toward the water's by how deep its school swims (0 at the
// surface .. 0.88 on the sea floor), as the game fades its fish. One material per school (they share a depth).
shader_type spatial;
render_mode diffuse_toon, specular_disabled;

uniform vec3 water : source_color = vec3(0.18, 0.43, 0.56);
uniform float fade : hint_range(0.0, 1.0) = 0.0;

void fragment() {
	ALBEDO = mix(COLOR.rgb, water, fade);
}
