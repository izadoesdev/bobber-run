// A terrain tile's heights (the red channel, below 0 water) as the chart's colour bands: deep sea, shallows, the
// beach, meadow, forest, rock and snow.
shader_type canvas_item;

void fragment() {
	float h = texture(TEXTURE, UV).r;
	vec3 deep = vec3(0.12, 0.30, 0.42), sea = vec3(0.18, 0.44, 0.56), shallow = vec3(0.36, 0.66, 0.70);
	vec3 col = mix(deep, sea, smoothstep(-0.55, -0.3, h));
	col = mix(col, shallow, smoothstep(-0.16, -0.03, h));
	if (h > 0.0) {
		col = vec3(0.90, 0.84, 0.65);                                               // sand
		col = mix(col, vec3(0.46, 0.62, 0.33), smoothstep(0.05, 0.1, h));           // meadow
		col = mix(col, vec3(0.27, 0.43, 0.25), smoothstep(0.3, 0.42, h));           // forest
		col = mix(col, vec3(0.52, 0.52, 0.50), smoothstep(0.62, 0.72, h));          // rock
		col = mix(col, vec3(0.93, 0.94, 0.96), smoothstep(0.9, 0.98, h));           // snow
	}
	COLOR = vec4(col, 1.0);
}
