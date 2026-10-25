## Every main island, and its price, is where and what the server says it is (convex/islandRules.ts).
extends TestCase


func test_main_islands_and_prices_match_the_server() -> void:
	for c: Array in fixture("rules").islands:
		var i := int(c[0])
		var j := int(c[1])
		var m := IslandRules.main_island(i, j)
		if c[2] == null:
			expect_eq(m, null, "cell %d,%d has no main island" % [i, j])
			expect_eq(IslandRules.island_price(i, j), -1, "cell %d,%d has no price" % [i, j])
			continue
		if m == null:
			failures.append("cell %d,%d: no island, but the server has one" % [i, j])
			continue
		var where := "cell %d,%d" % [i, j]
		expect_near(m.x, c[2], 1e-9, where + " x")
		expect_near(m.y, c[3], 1e-9, where + " y")
		expect_near(m.R, c[4], 1e-9, where + " R")
		expect_near(m.peak, c[5], 1e-12, where + " peak")
		expect_eq(IslandRules.island_price(i, j), int(c[6]), where + " price")
