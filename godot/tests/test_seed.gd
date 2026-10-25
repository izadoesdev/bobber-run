## The lattice hash and the PRNG give exactly what the TypeScript gives (src/noise.ts).
extends TestCase


func test_hash_matches_the_typescript() -> void:
	for h: Array in fixture("rules").hashes:
		expect_eq(Seed.hash32(int(h[0]), int(h[1]), int(h[2])), int(h[3]), "hash32(%d, %d, %d)" % [h[0], h[1], h[2]])


func test_prng_sequences_match_the_typescript() -> void:
	for seq: Array in fixture("rules").mulberries:
		var r := Seed.Mulberry.new(int(seq[0]))
		for k in range(1, seq.size()):   # each draw recorded as its 32-bit integer (draw * 2^32), so this is exact
			expect_eq(int(r.next() * 4294967296.0), int(seq[k]), "Mulberry(%d) draw %d" % [seq[0], k])
