## Where each world cell's main island is, and what it costs: the part of the world the server knows too.
##
## Mirrors convex/islandRules.ts, which places the islands players buy. The two must agree exactly, so this file holds
## only that shared contract, and tests/test_island_rules.gd checks it against values recorded from the TypeScript.
class_name IslandRules

const CELL := 560
const MAX_ISLANDS := 6
const CROWN_PRICE := 2_500_000
## Alderhaven, the home island in cell (0, 0)
const HOME := { x = 280.0, y = 280.0, R = 145.0, peak = 0.8 }

## main islands' size: tuned for open channels between islands (about a fifth of the sea near home is land)
const _SCALE := 0.75
## islands bought before the third world layout keep the size they were bought at
const _KEPT_SIZE: Array[Vector2i] = [Vector2i(0, -1), Vector2i(2, -2)]
const _PRICE_BASE := 100_000
const _PRICE_PER_SIZE := 300_000


## A cell's main island: its centre, radius and peak height.
class MainIsland:
	var x: float
	var y: float
	var R: float
	var peak: float

	func _init(x_: float, y_: float, r_: float, peak_: float) -> void:
		x = x_; y = y_; R = r_; peak = peak_


## The main island of cell (i, j), or null (about 28% of cells have none), drawn from `r`, the cell's generator
## (Mulberry(Seed.hash32(i, j, 7))), which the world goes on drawing the cell's islets from.
static func draw_main_island(i: int, j: int, r: Seed.Mulberry) -> MainIsland:
	if i == 0 and j == 0:
		return MainIsland.new(HOME.x, HOME.y, HOME.R, HOME.peak)
	if r.next() >= 0.72:
		return null
	var x := i * CELL + CELL * (0.3 + 0.4 * r.next())
	var y := j * CELL + CELL * (0.3 + 0.4 * r.next())
	var size := (75.0 + pow(r.next(), 1.25) * 230.0) * (1.0 if Vector2i(i, j) in _KEPT_SIZE else _SCALE)
	return MainIsland.new(x, y, size, 0.6 + 0.4 * r.next())


## The main island of cell (i, j), or null.
static func main_island(i: int, j: int) -> MainIsland:
	return draw_main_island(i, j, Seed.Mulberry.new(Seed.hash32(i, j, 7)))


## Coins for the main island of cell (i, j), or -1 when the cell has none: by its area and how near home it lies
## (a far island costs half what the same island would at home), rounded to $5,000; Alderhaven is the crown.
static func island_price(i: int, j: int) -> int:
	var m := main_island(i, j)
	if m == null:
		return -1
	if i == 0 and j == 0:
		return CROWN_PRICE
	var d := Vector2(m.x - HOME.x, m.y - HOME.y).length()
	var near := 0.5 + 0.5 / (1.0 + pow(d / 4000.0, 1.5))
	var price := roundi((_PRICE_BASE + _PRICE_PER_SIZE * pow(m.R / 100.0, 2.0) * near) / 5000.0) * 5000
	return mini(CROWN_PRICE - 500_000, price)
