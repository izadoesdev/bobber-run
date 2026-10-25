// What every shader of the sea shares: the time of day (set by DayNight as global uniforms) and the pixel-art dither.

// 0 by day .. 1 at night
global uniform float night;
// the light on the ground, per channel, 1 at noon
global uniform vec3 day_light;
// toward the sun (or the moon), in (east, south, up)
global uniform vec3 sun_dir;
// the boat's lantern: world x, y, its reach and how brightly it burns (0 by day)
global uniform vec4 lamp;

// 0..1 threshold of a 4 x 4 Bayer matrix at this screen pixel
float bayer(vec2 p) {
	ivec2 q = ivec2(mod(p, 4.0));
	int m[16] = int[](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
	return (float(m[q.y * 4 + q.x]) + 0.5) / 16.0;
}

// The lantern's warm light at world point p: a broad soft pool stepped into rings (dithered at each step), as the
// game's lamp pools are.
vec3 lamplight(vec2 p, float dither) {
	float k = clamp(1.0 - length(p - lamp.xy) / lamp.z, 0.0, 1.0);
	k = k * k * (3.0 - 2.0 * k) * (0.55 + 0.45 * k);
	k = floor(k * 5.0 + dither) / 5.0;
	return vec3(1.0, 0.72, 0.376) * 0.8 * k * lamp.w;
}
