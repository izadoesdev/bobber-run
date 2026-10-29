## A voyage saved is the voyage read back, and a save that's damaged or from another version can't break a new one.
extends TestCase


func test_a_voyage_reads_back_as_saved() -> void:
	var cod := Species.index_of("cod")
	var hold: Array[Dictionary] = [{ sp = cod, name = "Cod", kg = 2.5, stars = 3, value = 41 }]
	var up: Dictionary[String, int] = { rod = 2, lantern = 1 }
	var v := SaveGame.parse(SaveGame.to_text({ coins = 123, clock = 1000.5, hold = hold, up = up, x = 300.0, y = -40.25, a = 1.5 }))
	expect_eq(v.coins, 123, "coins")
	expect_eq(v.clock, 1000.5, "clock")
	expect_eq([v.x, v.y, v.a], [300.0, -40.25, 1.5], "where the boat lies")
	expect_eq(v.hold, hold, "the hold")
	expect_eq(v.up, up, "the upgrades")


func test_a_damaged_save_is_no_save_or_loses_only_what_is_damaged() -> void:
	expect_eq(SaveGame.parse(""), {}, "empty file")
	expect_eq(SaveGame.parse("{\"version\": 1, \"coins\""), {}, "cut short")
	expect_eq(SaveGame.parse("{\"version\": 99, \"coins\": 5}"), {}, "another version")
	var v := SaveGame.parse(JSON.stringify({ version = 1, coins = "lots", clock = -5, x = 10, up = { rod = 99, hull = 2, reel = "x" }, hold = [
		{ sp = "cod", kg = 1, stars = 9, value = -3 }, { sp = "no-such-fish" }, "junk"] }))
	expect_eq(v.has("coins"), false, "coins that aren't a number are left to the new voyage")
	expect_eq(v.clock, 0.0, "a clock before the start")
	expect_eq(v.hold.size(), 1, "only the fish this build knows")
	expect_eq([v.hold[0].stars, v.hold[0].value], [3, 0], "stars and value in range")
	expect_eq(v.up, { rod = Upgrades.levels("rod") }, "upgrade levels within their levels, only those for sale")
