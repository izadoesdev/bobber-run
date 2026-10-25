## What grows on a tile's land: one candidate spot per 6 x 6 world cell, jittered by a hash, so a tree is always in the
## same place; what stands there follows the height and the climate, as the game's default rules have it
## (src/gl/renderer.ts tileTrees, outside an island theme): boulders on the beach, round trees, bushes and rocks low
## down, pines on the slopes, rocks at the top, palms in the warm south and snow pines in the cold north. Island themes
## and biomes come with the biome map.
class_name Flora

const _CELL := 6
const _SALT := 42


## The trees of tile `t` from its baked `heights`: kind -> flat array of (x, y, scale, yaw) per tree.
static func tile_trees(t: Vector2i, heights: PackedFloat32Array) -> Dictionary[String, PackedFloat32Array]:
	var out: Dictionary[String, PackedFloat32Array] = {}
	var x0 := t.x * Terrain.TILE
	var y0 := t.y * Terrain.TILE
	for gy in range(floori(y0 / float(_CELL)), floori((y0 + Terrain.TILE - 1) / float(_CELL)) + 1):
		for gx in range(floori(x0 / float(_CELL)), floori((x0 + Terrain.TILE - 1) / float(_CELL)) + 1):
			var px := gx * _CELL + floori(Seed.hash01(gx, gy, _SALT) * _CELL)
			var py := gy * _CELL + floori(Seed.hash01(gx, gy, _SALT + 1) * _CELL)
			if px < x0 or px >= x0 + Terrain.TILE or py < y0 or py >= y0 + Terrain.TILE:
				continue
			var kind := _kind(_height(heights, px - x0, py - y0), gx, gy, py)
			if kind.is_empty():
				continue
			if not out.has(kind):
				out[kind] = PackedFloat32Array()
			out[kind].append_array([px + 0.5, py + 0.5, 0.85 + Seed.hash01(gx, gy, 46) * 0.35, Seed.hash01(gx, gy, 47) * TAU])
	return out


# What stands at a spot of height v (cell gx, gy; world y py), or "".
static func _kind(v: float, gx: int, gy: int, py: int) -> String:
	if v < 0.03:
		return ""                                      # (mangroves in the shallows come with the biomes)
	var r := Seed.hash01(gx, gy, 41)
	var warm := clampf((py - 1500.0) / 1000.0, 0.0, 1.0)
	var cold := clampf((-py - 1300.0) / 1000.0, 0.0, 1.0)
	var rr := Seed.hash01(gx, gy, 45)
	var kind := ""
	if v < 0.12:
		if r < 0.025: kind = "boulders"                # the odd heap of stones on the beach
	elif v < 0.36:
		if r < 0.06: kind = "round"
		elif r < 0.08: kind = "rock"
		elif r < 0.17: kind = "bush" if r < 0.13 else "berrybush"
	elif v < 0.76:
		if r < 0.72: kind = "pine" if v > 0.5 or r < 0.25 else "round"
	elif r < 0.06:
		kind = "boulders" if r < 0.025 else "rock"
	var stony := kind == "rock" or kind == "boulders"
	var shrub := kind == "bush" or kind == "berrybush"
	if warm > rr and v >= 0.12 and v < 0.24 and r < 0.14:
		kind = "palm"
	elif not kind.is_empty() and not stony and not shrub and cold > rr:
		kind = "snowpine"
	elif kind == "pine" and warm > rr:
		kind = "round"
	if cold > 0.5 and kind == "palm":
		kind = "snowpine"                              # nothing tropical on the ice
	if (kind == "pine" or kind == "round" or kind == "snowpine") and Seed.hash01(gx, gy, 44) < 0.3:
		kind += "B"                                    # the big variant
	return kind


# The height at tile-local world point (lx, ly), from the tile's samples (nearest; a tree only needs its band).
static func _height(heights: PackedFloat32Array, lx: int, ly: int) -> float:
	return heights[(ly / Terrain.STEP + 1) * Terrain.TILE_N + lx / Terrain.STEP + 1]
