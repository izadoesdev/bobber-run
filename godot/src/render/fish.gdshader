// A fish under the surface: its own colours, toon-lit, faded toward the water's by how deep its school swims (0 at the
// surface .. 0.88 on the sea floor), as the game fades its fish. One material per school (they share a depth). A school
// coming or going (waking at dusk, out of the lamplight at night) dithers in and out; glowing fish shine at night.
shader_type spatial;
render_mode diffuse_toon, specular_disabled;

#include "res://src/render/pixel.gdshaderinc"

uniform vec3 water : source_color = vec3(0.18, 0.43, 0.56);
uniform float fade : hint_range(0.0, 1.0) = 0.0;
// how much of the school shows (0 .. 1)
uniform float shown : hint_range(0.0, 1.0) = 1.0;
// 1 for a species that glows in the dark
uniform float glow = 0.0;

void fragment() {
	if (bayer(FRAGCOORD.xy) >= shown) {
		discard;
	}
	ALBEDO = mix(COLOR.rgb, water, fade * (1.0 - glow * night));
	EMISSION = COLOR.rgb * glow * night * 0.9;
}
