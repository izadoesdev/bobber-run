// The ground of one terrain tile, flat on the sea as in the game: water in bands by depth, a line of surf where it
// meets the shore and a slow shimmer; land in bands (sand, meadow, forest, rock, snow) lit by its slope against the
// sun. Pixel art: colours snap to bands, with a 4 x 4 ordered dither where one band gives way to the next, and the
// viewport's own pixels do the rest. Heights come from the tile's baked samples (tile_n a side, one of border each way).
// Lit by the time of day and, after dark, the boat's lantern.
shader_type spatial;
render_mode unshaded, cull_disabled;

#include "res://src/render/pixel.gdshaderinc"

uniform sampler2D heights : filter_linear, repeat_disable;
uniform float tile_n = 66.0;
// world units between samples
uniform float step = 2.0;
// the tile's corner in world (x, y)
uniform vec2 origin;

float height_at(vec2 uv) {
	// UV runs 0..1 across the tile's interior; sample k sits at (k + 0.5) / tile_n
	return texture(heights, (uv * (tile_n - 2.0) + 1.5) / tile_n).r;
}

// across a band edge `e` wide at `at`, which side this pixel takes (dithered)
float band(float h, float at, float e, float dither) {
	return step(dither, clamp((h - at) / e + 0.5, 0.0, 1.0));
}

void fragment() {
	vec2 world = origin + UV * (tile_n - 2.0) * step;
	float h = height_at(UV);
	float d = 1.0 / (tile_n - 2.0);
	vec2 g = vec2(height_at(UV + vec2(d, 0)) - height_at(UV - vec2(d, 0)), height_at(UV + vec2(0, d)) - height_at(UV - vec2(0, d))) / (2.0 * step);
	float t = bayer(FRAGCOORD.xy);
	vec3 col;
	if (h < 0.0) {
		col = vec3(0.13, 0.33, 0.47);                                                  // deep
		col = mix(col, vec3(0.18, 0.43, 0.56), band(h, -0.38, 0.12, t));               // sea
		col = mix(col, vec3(0.27, 0.56, 0.65), band(h, -0.14, 0.06, t));               // shallows
		col = mix(col, vec3(0.42, 0.72, 0.73), band(h, -0.045, 0.03, t));              // the shelf by the beach
		float swell = sin(dot(world, vec2(0.08, 0.05)) + TIME * 1.1) * sin(dot(world, vec2(-0.05, 0.09)) - TIME * 0.7);
		col *= 1.0 + 0.04 * step(0.55, swell + t * 0.3);                               // flecks of light on the swell
		float surf = band(h, -0.016, 0.012, t) * step(0.35, 0.5 + 0.5 * sin(TIME * 1.8 - h * 300.0));
		col = mix(col, vec3(0.94, 0.97, 0.96), surf);                                  // the surf line, breaking
	} else {
		col = vec3(0.90, 0.83, 0.62);                                                  // sand
		col = mix(col, vec3(0.48, 0.64, 0.33), band(h, 0.075, 0.03, t));               // meadow
		col = mix(col, vec3(0.28, 0.45, 0.26), band(h, 0.36, 0.08, t));                // forest
		col = mix(col, vec3(0.53, 0.53, 0.51), band(h, 0.67, 0.07, t));                // rock
		col = mix(col, vec3(0.94, 0.95, 0.97), band(h, 0.94, 0.05, t));                // snow
		vec3 n = normalize(vec3(-g.x * 60.0, -g.y * 60.0, 1.0));                      // relief, exaggerated so hills read
		float lit = dot(n, normalize(sun_dir));
		col *= 0.82 + 0.14 * band(lit, 0.62, 0.12, t) + 0.12 * band(lit, 0.82, 0.08, t);   // three tones of light
	}
	vec3 lp = lamplight(world, t);
	col *= day_light + lp * 0.6;
	col = mix(col, col * vec3(1.0, 0.86, 0.62), clamp(lp.r * 0.7, 0.0, 1.0)) + lp * 0.3;   // the lamp outshines the night
	ALBEDO = col;
}
