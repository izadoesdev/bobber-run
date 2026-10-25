## The terrain: one height function for the whole world (below 0 is water, deeper is more negative, above 0 is land),
## and tiles of it baked for the renderer, the chart and everything that asks about many points at once.
##
## Built on Godot's native FastNoiseLite: a domain warp that makes coastlines wander, a slow swell of the sea floor,
## a fractal that shapes each island, finer detail near the shore, and ridged mountains inland. The islands themselves
## (where, how big, their coves and headlands) come from Islands. There is one implementation, on the CPU, so what
## the boat runs aground on is always what is drawn.
class_name Terrain

## a tile's side in world units; world units between its samples (heights are read between them smoothly, so a coast
## still lands between samples); samples along its side, with one of border each way for slopes and seams
const TILE := 128
const STEP := 2
const TILE_N := TILE / STEP + 2
## relief starts this far above the sea, so beaches stay low and sandy
const _LIFT := 0.14
## coastlines wander this far
const _WARP := 36.0

# each layer has its own fixed seed (through Seed, not an engine hash that could change between Godot versions)
static var _warp_x := _noise(1, 0.0042)
static var _warp_y := _noise(2, 0.0042)
static var _floor := _noise(3, 0.0016)
static var _shape := _noise(4, 0.009, FastNoiseLite.FRACTAL_FBM, 3, 2.03)
static var _detail := _noise(5, 0.022, FastNoiseLite.FRACTAL_FBM, 3, 2.03)
static var _ridges := _noise(6, 0.012, FastNoiseLite.FRACTAL_RIDGED, 2, 2.3, 0.55)


## Terrain height at world point (x, y).
static func height_at(x: float, y: float) -> float:
	var wx := x + _WARP * _warp_x.get_noise_2d(x, y)
	var wy := y + _WARP * _warp_y.get_noise_2d(x, y)
	return _height(x, y, wx, wy, Islands.near(floori(wx / IslandRules.CELL), floori(wy / IslandRules.CELL)))


# The height at (x, y), whose warped point is (wx, wy), among `islands` (any list holding every island that can reach
# the point: the 3 x 3 cells round it for a single point, the few that reach a tile for a bake).
static func _height(x: float, y: float, wx: float, wy: float, islands: Array[Islands.Island]) -> float:
	var h := -0.5 + 0.1 * _floor.get_noise_2d(x, y)
	var shape := NAN
	var best := -9.0
	var top: Islands.Island = null
	for isle in islands:
		var dx := wx - isle.x
		var dy := wy - isle.y
		var d2 := (dx * dx + dy * dy) / (isle.R * isle.R)
		if d2 > isle.reach2:
			continue
		# coves and headlands scale the distance by heading, easing in away from the centre
		var k := 1.0
		if not isle.coast.is_empty() and d2 > 0.16:
			k += (Islands.coast_at(isle, dx, dy) - 1.0) * smoothstep(0.16, 0.66, d2)
		if d2 * k * k > Islands.ROUND_REACH2:
			continue
		if is_nan(shape):
			shape = _shape.get_noise_2d(x, y)
		var d := sqrt(d2) * (1.0 + 0.3 * shape) * k
		var base := 1.0 - d * d
		var e := isle.peak * pow(base, 1.4) if base > 0.0 else isle.peak * base
		if e > best:
			best = e
			top = isle
	if top == null:
		return h
	var e := best
	if e > -0.25:                                      # the shore and shallows get finer detail
		e += 0.15 * minf(1.0, (e + 0.25) / 0.5) * _detail.get_noise_2d(x, y)
	if e > _LIFT and top.mountains > 0.01:             # mountains rise only well above the sea, so coasts don't move
		var ridge := (_ridges.get_noise_2d(x, y) + 1.0) * 0.5
		e += smoothstep(_LIFT, _LIFT + 0.35, e) * top.mountains * 0.7 * ridge * ridge
	return maxf(h, e)


## The islands whose land can reach tile (tx, ty) at all (coastlines wander by up to the warp). Most tiles have none,
## and their bake is the sea floor alone.
static func tile_islands(tx: int, ty: int) -> Array[Islands.Island]:
	var rect := Rect2(tx * TILE - STEP, ty * TILE - STEP, TILE_N * STEP, TILE_N * STEP).grow(_WARP)
	var c := IslandRules.CELL
	var out: Array[Islands.Island] = []
	for cj in range(floori(rect.position.y / c) - 1, floori(rect.end.y / c) + 2):
		for ci in range(floori(rect.position.x / c) - 1, floori(rect.end.x / c) + 2):
			for isle in Islands.in_cell(ci, cj):
				var nearest := Vector2(isle.x, isle.y).clamp(rect.position, rect.end)
				if nearest.distance_squared_to(Vector2(isle.x, isle.y)) <= isle.R * isle.R * isle.reach2:
					out.append(isle)
	return out


## The heights of tile (tx, ty): TILE_N x TILE_N samples STEP apart, row by row, from world (tx * TILE - STEP, ty * TILE - STEP).
static func bake_tile(tx: int, ty: int) -> PackedFloat32Array:
	var out := PackedFloat32Array()
	out.resize(TILE_N * TILE_N)
	var islands := tile_islands(tx, ty)
	for row in TILE_N:
		bake_row(tx, ty, row, islands, out)
	return out


## One row of tile (tx, ty) into `out`, among its `islands` (tile_islands), so a bake can be spread over frames.
static func bake_row(tx: int, ty: int, row: int, islands: Array[Islands.Island], out: PackedFloat32Array) -> void:
	var x0 := tx * TILE - STEP
	var y := float(ty * TILE - STEP + row * STEP)
	var o := row * TILE_N
	if islands.is_empty():                             # open sea: the floor alone, no warp to work out
		for c in TILE_N:
			out[o + c] = -0.5 + 0.1 * _floor.get_noise_2d(x0 + c * STEP, y)
		return
	for c in TILE_N:
		var x := float(x0 + c * STEP)
		out[o + c] = _height(x, y, x + _WARP * _warp_x.get_noise_2d(x, y), y + _WARP * _warp_y.get_noise_2d(x, y), islands)


static func _noise(layer: int, frequency: float, fractal := FastNoiseLite.FRACTAL_NONE, octaves := 1, lacunarity := 2.0, gain := 0.5) -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.seed = Seed.i32(Seed.hash32(layer, 0, 101))
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	n.frequency = frequency
	n.fractal_type = fractal
	n.fractal_octaves = octaves
	n.fractal_lacunarity = lacunarity
	n.fractal_gain = gain
	return n
