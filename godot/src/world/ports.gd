## The ports: where on its island each cell's harbour stands, its name, what it pays for each fish and whether it has a
## shipyard (src/world.ts landmarks and makePort, ported).
##
## A port tries its island's deepest cove first, sheltered water inside a bay, then heading by heading round the
## island, for a shore with room for a pier and deep water off it. Its name and prices are drawn as the game draws
## them, so Alderhaven pays here what it pays there (tests/test_ports.gd). Lighthouses and wrecks come later.
class_name Ports

## candidate pier headings round an island
const _DIRS := 32
## how many species existed when port prices were first drawn; never change this (later species hash their own)
const _LEGACY_SPECIES := 43
const _S1 := ["Kel", "Mar", "Bri", "Ash", "Dun", "Hav", "Ros", "Tor", "Pen", "Sal", "Fen", "Wen", "Orm", "Lun", "Car", "Gray", "Bram", "Stor", "Oak", "Mor"]
const _S2 := ["wick", "mere", "holm", "by", "stead", "haven", "mouth", "ness", "ford", "ton", "sey", "point", "head", "water", "bury", "skerry", "cove", "sound"]


class Port:
	var id: String
	var name: String
	## where the pier meets the land, and the way it points out to sea
	var x: float
	var y: float
	var ang: float
	## the pier's far end (dock here), and where a docked boat lies
	var end: Vector2
	var dock: Vector2
	## price multiplier per species index
	var mult: PackedFloat64Array
	var shipyard: bool
	## the harbour design (0 is Alderhaven's)
	var design: int


static var _cells: Dictionary[Vector2i, Array] = {}


## The ports within the square of half-size `rad` round world point `at`.
static func near(at: Vector2, rad: float) -> Array[Port]:
	var out: Array[Port] = []
	var c := IslandRules.CELL
	for j in range(floori((at.y - rad) / c) - 1, floori((at.y + rad) / c) + 2):
		for i in range(floori((at.x - rad) / c) - 1, floori((at.x + rad) / c) + 2):
			for p: Port in in_cell(i, j):
				if absf(p.x - at.x) < rad and absf(p.y - at.y) < rad:
					out.append(p)
	return out


## Alderhaven, the home port.
static func home() -> Port:
	return in_cell(0, 0)[0]


## The port of cell (i, j), if it has one (as a list: empty or one).
static func in_cell(i: int, j: int) -> Array:
	var k := Vector2i(i, j)
	if _cells.has(k):
		return _cells[k]
	var out: Array = []
	var r := Seed.Mulberry.new(Seed.hash32(i, j, 99))
	var main: Islands.Island = null
	for isle in Islands.in_cell(i, j):
		if not isle.islet:
			main = isle
			break
	var home_cell := i == 0 and j == 0
	if main != null:
		# its deepest cove first, sheltered water inside a bay; Alderhaven faces south-east
		var spin := r.next() * TAU
		var a0 := 0.6 if home_cell else (main.coves[0] if not main.coves.is_empty() else spin)
		if home_cell or (main.R >= 70.0 and r.next() < 0.62):
			for q in _DIRS:
				var di := (roundi(a0 / TAU * _DIRS) + q) % _DIRS
				var a := float(di) / _DIRS * TAU
				var s := _shore_along(main, a)
				if s != Vector2.INF and _open_water(s, a):
					out.append(_make(i, j, home_cell, r, s, a))
					break
	_cells[k] = out
	return out


## Whether (x, y) is on a harbour's grounds (its buildings inland of the pier), where nothing grows.
static func on_grounds(x: float, y: float) -> bool:
	for p in near(Vector2(x, y), 40.0):
		var back := Vector2(p.x, p.y) - Vector2.from_angle(p.ang) * 12.0
		if Vector2(x, y).distance_to(Vector2(p.x, p.y)) < 13.0 or Vector2(x, y).distance_to(back) < 21.0:
			return true
	return false


static func _make(i: int, j: int, home_cell: bool, r: Seed.Mulberry, s: Vector2, a: float) -> Port:
	var p := Port.new()
	var dir := Vector2.from_angle(a)
	p.id = "port:%d,%d" % [i, j]
	p.name = "Alderhaven" if home_cell else _S1[int(r.next() * _S1.size())] + _S2[int(r.next() * _S2.size())]
	p.x = s.x - dir.x * 3.0
	p.y = s.y - dir.y * 3.0
	p.ang = a
	p.end = Vector2(p.x, p.y) + dir * 26.0
	p.dock = Vector2(p.x, p.y) + dir * 44.0
	# the first 43 species' prices and the shipyard come off one sequence; later species hash their own, so appending
	# a species never reshuffles a port
	var pr := Seed.Mulberry.new(Seed.hash32(i, j, 5))
	p.mult.resize(Species.all.size())
	for k in _LEGACY_SPECIES:
		p.mult[k] = 0.75 + pr.next() * 0.7
	p.shipyard = home_cell or pr.next() < 0.45
	for k in range(_LEGACY_SPECIES, Species.all.size()):
		p.mult[k] = 0.75 + Seed.hash01(i, j, Seed.fnv1a(Species.all[k].id)) * 0.7
	p.design = 0 if home_cell else int(Seed.hash01(roundi(p.x), roundi(p.y), 61) * 3)
	return p


# The outermost land walking out from an island's centre along heading a, or Vector2.INF.
static func _shore_along(isle: Islands.Island, a: float) -> Vector2:
	var dir := Vector2.from_angle(a)
	var last := Vector2.INF
	var d := 0.0
	while d < IslandRules.CELL * 1.25:
		var p := Vector2(isle.x, isle.y) + dir * d
		if Terrain.height_at(p.x, p.y) > 0.0:
			last = p
		elif last != Vector2.INF and d > isle.R * 0.35:
			return last
		d += 2.0
	return Vector2.INF


# Room for a pier and a docked boat heading out from p along a: water ahead, deep water further out, clear both sides.
static func _open_water(p: Vector2, a: float) -> bool:
	var dir := Vector2.from_angle(a)
	var side := Vector2(-dir.y, dir.x) * 14.0
	for k in range(1, 15):
		var q := p + dir * (k * 4.0)
		if Terrain.height_at(q.x, q.y) > (-0.1 if k * 4 > 18 else 0.0):
			return false
		if k * 4 > 14 and (Terrain.height_at(q.x + side.x, q.y + side.y) > -0.02 or Terrain.height_at(q.x - side.x, q.y - side.y) > -0.02):
			return false
	return true
