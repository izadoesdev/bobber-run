## Ports have the game's names, prices and shipyards (src/world.ts makePort): what Alderhaven pays here is what it
## pays in the game. Where a port stands follows the terrain, which the port draws its own way, so cells are compared
## where both worlds have a port.
extends TestCase


func test_ports_have_the_games_names_prices_and_shipyards() -> void:
	var both := 0
	for row: Array in fixture("rules").ports:
		var i := int(row[0])
		var j := int(row[1])
		var mine := Ports.in_cell(i, j)
		if mine.is_empty():
			continue
		both += 1
		var p: Ports.Port = mine[0]
		var where := "port %d,%d" % [i, j]
		expect_eq(p.name, row[2], where + " name")
		expect_eq(p.shipyard, row[3], where + " shipyard")
		var mult: Array = row[4]
		for k in mult.size():
			expect_near(p.mult[k], mult[k], 1e-9, where + " price of species %d" % k)
	expect_eq(both >= 10, true, "at least 10 ports to compare (%d)" % both)


func test_alderhaven_is_the_home_port() -> void:
	var home := Ports.home()
	expect_eq(home.name, "Alderhaven", "the home port's name")
	expect_eq(home.shipyard, true, "Alderhaven has a shipyard")
	expect_eq(Vector2(home.x, home.y).distance_to(Vector2(IslandRules.HOME.x, IslandRules.HOME.y)) < IslandRules.HOME.R * 1.4, true, "it stands on Alderhaven's shore")
