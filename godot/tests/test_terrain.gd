## The terrain: land where the server's islands are, sea between, and baked tiles that are the height function itself.
extends TestCase


func test_every_main_island_is_land_at_its_heart() -> void:
	for j in range(-8, 9):
		for i in range(-8, 9):
			var m := IslandRules.main_island(i, j)
			if m != null:
				expect_eq(Terrain.height_at(m.x, m.y) > 0.0, true, "the main island of cell %d,%d is land at its centre" % [i, j])


func test_open_water_far_from_any_island_is_sea() -> void:
	# a point is open sea when no island of the 3 x 3 cells round it reaches it, with room for the coast to wander
	var seen := 0
	for j in range(-6, 7):
		for i in range(-6, 7):
			var p := Vector2((i + 0.5) * IslandRules.CELL, (j + 0.5) * IslandRules.CELL)
			var clear := true
			for isle in Islands.near(i, j):
				if p.distance_to(Vector2(isle.x, isle.y)) < isle.R * sqrt(isle.reach2) + 60.0:
					clear = false
			if clear:
				seen += 1
				expect_eq(Terrain.height_at(p.x, p.y) < -0.2, true, "open water at %s is sea" % p)
	expect_eq(seen > 10, true, "enough open water was found to test")


func test_a_baked_tile_is_the_height_function_and_its_seams_match() -> void:
	var a := Terrain.bake_tile(2, 2)
	var b := Terrain.bake_tile(3, 2)                   # its neighbour to the east
	var n := Terrain.TILE_N
	var s := Terrain.STEP
	for k in [0, 7, 40, n - 1]:
		# (tiles keep 32-bit floats)
		expect_near(a[k * n + 5], Terrain.height_at(2 * Terrain.TILE - s + 5 * s, 2 * Terrain.TILE - s + k * s), 1e-6, "tile sample %d" % k)
		# a's last interior column and b's west border are the same world column
		expect_eq(a[k * n + n - 2], b[k * n], "seam row %d" % k)


func test_baked_tiles_match_the_height_function_everywhere_they_were_sampled() -> void:
	# across island, coast and open-sea tiles: the per-tile island list leaves nothing out
	for t: Vector2i in [Vector2i(2, 2), Vector2i(1, 1), Vector2i(-3, 4), Vector2i(9, -7), Vector2i(0, 0)]:
		var h := Terrain.bake_tile(t.x, t.y)
		for k in range(0, Terrain.TILE_N * Terrain.TILE_N, 251):
			var x := t.x * Terrain.TILE + (k % Terrain.TILE_N - 1) * Terrain.STEP
			var y := t.y * Terrain.TILE + (k / Terrain.TILE_N - 1) * Terrain.STEP
			expect_near(h[k], Terrain.height_at(x, y), 1e-6, "tile %s at %d,%d" % [t, x, y])


func test_tiles_bake_quickly() -> void:
	var t0 := Time.get_ticks_usec()
	for t: Vector2i in [Vector2i(0, 0), Vector2i(1, 0), Vector2i(2, 1), Vector2i(-4, 3)]:   # Alderhaven and its neighbours, island-heavy
		Terrain.bake_tile(t.x, t.y)
	var ms := (Time.get_ticks_usec() - t0) / 4000.0
	print("  island tiles bake in %.1f ms each" % ms)
	# about 9 ms on an M4; the bound is loose enough for a slow CI runner, tight enough to catch per-sample work creeping back
	expect_eq(ms < 100.0, true, "an island tile bakes in under 100 ms (%.1f ms)" % ms)
