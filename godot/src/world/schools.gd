## Where the fish are: each 420-unit cell of sea has one cluster of two to four schools at its most fishable spot
## (the edge of a drop-off or a coast, where fish gather), the water there choosing what they are (Species.pick).
## Behind a bait ball a predator from a little deeper; each school has a few fish to catch. Deterministic from the
## seed, so the same schools are always in the same water.
##
## The game's hotspots also surface and dive, drift, and hold a golden fish now and then; those come later.
class_name Schools

const CELL := 420
## a school's home needs open water this deep all round it
const _OPEN := -0.09
const _BAIT := ["anchovy", "sardine", "herring"]


class School:
	var id: String
	var x: float
	var y: float
	var sp: int
	var stock: int
	var max_stock: int
	## its own phase, for swimming
	var ph: float
	## its fish as they swim (SchoolView), once it's been near the boat
	var fish: Array = []

	func _init(id_: String, x_: float, y_: float, sp_: int, stock_: int, ph_: float) -> void:
		id = id_; x = x_; y = y_; sp = sp_; stock = stock_; max_stock = stock_; ph = ph_


static var _cells: Dictionary[Vector2i, Array] = {}


## The schools within the square of half-size `rad` round world point `at`.
static func near(at: Vector2, rad: float) -> Array[School]:
	var out: Array[School] = []
	for j in range(floori((at.y - rad) / CELL), floori((at.y + rad) / CELL) + 1):
		for i in range(floori((at.x - rad) / CELL), floori((at.x + rad) / CELL) + 1):
			for s: School in _cell(i, j):
				if absf(s.x - at.x) < rad and absf(s.y - at.y) < rad:
					out.append(s)
	return out


static func _cell(i: int, j: int) -> Array:
	var k := Vector2i(i, j)
	if _cells.has(k):
		return _cells[k]
	var r := Seed.Mulberry.new(Seed.hash32(i, j, 7919))
	var list: Array = []
	# the most fishable spot of 30 tries in the cell, among those with open water round them for a school
	var best := Vector2.INF
	var score := -1.0
	for t in 30:
		var p := Vector2((i + 0.07 + 0.86 * r.next()) * CELL, (j + 0.07 + 0.86 * r.next()) * CELL)
		var h := Terrain.height_at(p.x, p.y)
		if h > -0.08 or not _open_round(p, 28.0):
			continue
		var edge := absf(Terrain.height_at(p.x + 24, p.y) - Terrain.height_at(p.x - 24, p.y)) + absf(Terrain.height_at(p.x, p.y + 24) - Terrain.height_at(p.x, p.y - 24))
		var sc := edge * 3.0 + (0.4 if h > -0.3 else 0.0) + r.next() * 0.3
		if sc > score:
			score = sc
			best = p
	if best != Vector2.INF:
		var used: Array[int] = []
		var bait := false
		for tries in 12:
			var m := list.size()
			if m == 4 or (m >= 2 and r.next() < 0.35):
				break
			var p := best + (Vector2((r.next() - 0.5) * 50, (r.next() - 0.5) * 36) if m else Vector2.ZERO)
			var h := Terrain.height_at(p.x, p.y)
			var sp := Species.pick(h - 0.15 if m == 1 and bait else h, p.x, p.y, r)   # behind a bait ball, a predator from deeper
			if sp < 0 or sp in used or (m > 0 and bait and Species.all[sp].id in _BAIT):
				continue
			if not _open_round(p, Species.all[sp].look.radius + 8.0):
				continue
			var is_bait: bool = Species.all[sp].id in _BAIT
			var stock := 3 + int(r.next() * 3) if is_bait else 2 + int(r.next() * 2)
			list.append(School.new("%d,%d,%d" % [i, j, m], p.x, p.y, sp, stock, r.next() * TAU))
			if m == 0:
				bait = is_bait
			used.append(sp)
	_cells[k] = list
	return list


# Open water round p out to `reach`, so the school's fish never meet the shallows.
static func _open_round(p: Vector2, reach: float) -> bool:
	for k in 12:
		for f: float in [0.5, 1.0]:
			var q := p + Vector2.from_angle(k * TAU / 12.0) * reach * f
			if Terrain.height_at(q.x, q.y) > _OPEN:
				return false
	return Terrain.height_at(p.x, p.y) <= _OPEN
