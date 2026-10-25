## The islands of each world cell: its main island (the one players can buy, placed by IslandRules), the islets drawn
## after it from the same generator, and each main island's coastline of coves and headlands.
##
## Drawn the way src/world.ts draws them, so the same islands stand in the same places; only the main islands are a
## contract with the server, the rest just keeps the sea familiar.
class_name Islands

## how many islets survive: tuned with the main islands' size for open channels between islands
const _ISLET_KEEP := 0.5
## an island's land reaches this far, squared and in units of its radius, round a plain coast
const ROUND_REACH2 := 2.3
## heights are read from the islands of the 3 x 3 cells round a point, so no island may reach further than this
const _MAX_REACH := IslandRules.CELL * 1.25
## headings a coastline is baked at
const _COAST_N := 64


class Island:
	var x: float
	var y: float
	var R: float
	var peak: float
	var islet: bool
	## the coast factor at _COAST_N + 1 headings (a factor on distance: > 1 a cove, < 1 a headland); empty if round
	var coast := PackedFloat32Array()
	## how far its land can reach, squared and in units of R
	var reach2 := ROUND_REACH2
	## how mountainous its interior is (0 for islets)
	var mountains := 0.0
	## the headings of its coves, deepest first (where a port is tried first)
	var coves := PackedFloat32Array()

	func _init(x_: float, y_: float, r_: float, peak_: float, islet_: bool) -> void:
		x = x_; y = y_; R = r_; peak = peak_; islet = islet_


static var _cells: Dictionary[Vector2i, Array] = {}
static var _near_cell := Vector2i(1 << 30, 0)
static var _near: Array[Island] = []


## The islands of cell (i, j), the main island first.
static func in_cell(i: int, j: int) -> Array[Island]:
	var k := Vector2i(i, j)
	if _cells.has(k):
		return _cells[k]
	var r := Seed.Mulberry.new(Seed.hash32(i, j, 7))
	var list: Array[Island] = []
	var m := IslandRules.draw_main_island(i, j, r)      # the server draws it too, from the same first numbers
	var main: Island = null
	if m != null:
		main = Island.new(m.x, m.y, m.R, m.peak, false)
		_shape_coast(main, i == 0 and j == 0)
		main.mountains = smoothstep(50.0, 170.0, main.R) * (0.35 + 0.65 * Seed.hash01(roundi(main.x), roundi(main.y), 41)) \
			* (0.7 + 0.6 * clampf((-main.y - 1300.0) / 1000.0, 0.0, 1.0))   # bigger and further north, more rugged
		list.append(main)
	for q in int(r.next() * 3.6):
		var x: float
		var y: float
		if main != null and r.next() < 0.7:            # most islets ring the main island
			var a := r.next() * TAU
			var d := main.R * (1.1 + r.next() * 0.7)
			x = main.x + cos(a) * d
			y = main.y + sin(a) * d
		else:
			x = (i + 0.15 + 0.7 * r.next()) * IslandRules.CELL
			y = (j + 0.15 + 0.7 * r.next()) * IslandRules.CELL
		var sandbar := r.next() < 0.3
		var size := 12.0 + r.next() * 28.0
		var peak := 0.1 + 0.08 * r.next() if sandbar else 0.45 + 0.4 * r.next()
		if Seed.hash01(i * 8 + q, j, 77) < _ISLET_KEEP:
			list.append(Island.new(x, y, size, peak, true))
	_cells[k] = list
	return list


## The islands of the 3 x 3 cells round cell (ci, cj), row by row. Neighbouring points nearly always share a cell, so
## the last list is kept.
static func near(ci: int, cj: int) -> Array[Island]:
	var k := Vector2i(ci, cj)
	if k == _near_cell:
		return _near
	var list: Array[Island] = []
	for dj in range(-1, 2):
		for di in range(-1, 2):
			list.append_array(in_cell(ci + di, cj + dj))
	_near_cell = k
	_near = list
	return list


## The coast factor of island `is` toward (dx, dy) from its centre (1 for a round coast).
static func coast_at(isle: Island, dx: float, dy: float) -> float:
	var f := (atan2(dy, dx) + PI) / TAU * _COAST_N
	var k := mini(int(f), _COAST_N - 1)
	return lerpf(isle.coast[k], isle.coast[k + 1], f - k)


# Coves bitten into big main islands (sheltered water, where ports sit) and headlands reaching out from them, baked
# into a table by heading. Alderhaven keeps its round shape.
static func _shape_coast(isle: Island, home: bool) -> void:
	if home or isle.R < 70.0:
		return
	var sx := roundi(isle.x)
	var sy := roundi(isle.y)
	var bends: Array[Vector3] = []                     # heading, width, depth (< 0 a cove, > 0 a headland)
	if isle.R >= 80.0:
		for k in 2 + int(Seed.hash01(sx, sy, 51) * 3):
			bends.append(Vector3(Seed.hash01(sx, sy, 52 + k) * TAU, 0.14 + 0.16 * Seed.hash01(sx, sy, 56 + k), -(0.3 + 0.3 * Seed.hash01(sx, sy, 60 + k))))
	for k in 1 + int(Seed.hash01(sx, sy, 64) * 3):
		bends.append(Vector3(Seed.hash01(sx, sy, 65 + k) * TAU, 0.2 + 0.3 * Seed.hash01(sx, sy, 69 + k), 0.3 + 0.6 * Seed.hash01(sx, sy, 73 + k)))
	var cove_list := bends.filter(func(b: Vector3) -> bool: return b.z < 0.0)
	cove_list.sort_custom(func(p: Vector3, q: Vector3) -> bool: return p.z < q.z)
	for b: Vector3 in cove_list:
		isle.coves.append(b.x)
	var lowest := sqrt(ROUND_REACH2) * isle.R / _MAX_REACH  # clipped so its land stays within the cells heights look at
	var narrowest := 1.0
	isle.coast.resize(_COAST_N + 1)
	for k in _COAST_N + 1:
		var a := float(k) / _COAST_N * TAU - PI
		var factor := 1.0
		for b in bends:
			var da := angle_difference(b.x, a) / b.y
			var g := exp(-da * da)
			factor *= 1.0 - b.z * g if b.z < 0.0 else 1.0 / (1.0 + b.z * g)
		isle.coast[k] = maxf(lowest, factor)
		narrowest = minf(narrowest, isle.coast[k])
	isle.reach2 = ROUND_REACH2 / (narrowest * narrowest)
