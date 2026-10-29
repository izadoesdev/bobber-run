extends TestCase


func test_buying_requires_funds_and_stops_at_the_last_level() -> void:
	var previous_coins := State.coins
	var previous_up := State.up.duplicate()
	State.up.clear()
	var price := Upgrades.cost("hold", 0)
	State.coins = price - 1
	expect_eq(State.buy("hold"), false, "insufficient funds")
	expect_eq(State.coins, price - 1, "a rejected purchase spends nothing")
	expect_eq(State.level("hold"), 0, "a rejected purchase fits nothing")
	State.coins = price
	expect_eq(State.buy("hold"), true, "the exact price is enough")
	expect_eq(State.coins, 0, "the catalog price is charged")
	expect_eq(State.level("hold"), 1, "one level is fitted")
	State.up.hold = Upgrades.levels("hold")
	State.coins = 10000
	expect_eq(State.buy("hold"), false, "the final level cannot be bought again")
	expect_eq(State.coins, 10000, "a completed track spends nothing")
	State.coins = previous_coins
	State.up = previous_up


func test_exported_upgrades_have_names_and_a_description_for_each_price() -> void:
	for key in Upgrades.FOR_SALE:
		var upgrade := Upgrades.get_upgrade(key)
		expect_eq(upgrade.lv.size(), Upgrades.levels(key), "%s descriptions match prices" % key)
		expect_eq(Upgrades.cost(key, Upgrades.levels(key)), -1, "%s ends at its last level" % key)
		for drive in ["OARS", "SAIL", "ENGINE"]:
			expect_eq(Upgrades.name_of(key, drive).is_empty(), false, "%s has a name for %s" % [key, drive])


func test_restoring_an_upgraded_hold_does_not_discard_its_extra_fish() -> void:
	var previous_coins := State.coins
	var previous_clock := State.clock
	var previous_up := State.up.duplicate()
	var previous_hold := State.hold.duplicate(true)
	State.up.clear()
	State.hold.clear()
	var boat := Boat.new()
	boat.set_physics_process(false)
	var model := MeshInstance3D.new()
	model.name = "Model"
	boat.add_child(model)
	(Engine.get_main_loop() as SceneTree).root.add_child(boat)
	var capacity := int(boat.stats().hold) + int(Upgrades.step.hold)
	var fish := { sp = Species.index_of("cod"), kg = 1.0, stars = 1, value = 10 }
	var hold: Array[Dictionary] = []
	for i in capacity:
		hold.append(fish.duplicate())
	var path := "user://test-upgrade-restore-%d.json" % Time.get_ticks_usec()
	SaveGame.write(path, SaveGame.to_text({ coins = 123, clock = 1000.0, hold = hold, up = { hold = 1 }, x = 0.0, y = 0.0, a = 0.0 }))
	var autosave := Autosave.new()
	autosave.boat = boat
	autosave.path = path
	expect_eq(autosave.restore(), true, "the voyage restores")
	expect_eq(State.level("hold"), 1, "the saved upgrade restores")
	expect_eq(int(boat.stats().hold), capacity, "the boat has its saved capacity")
	expect_eq(State.hold.size(), capacity, "every fish in the upgraded hold survives")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	autosave.free()
	boat.free()
	State.coins = previous_coins
	State.clock = previous_clock
	State.up = previous_up
	State.hold.assign(previous_hold)
