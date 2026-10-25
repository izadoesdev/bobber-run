## Seeded integers: the lattice hash and the small PRNG the world is drawn from.
##
## These must give exactly what src/noise.ts gives (the server places islands with them, and every client must agree),
## so they reproduce JavaScript's 32-bit integer arithmetic on GDScript's 64-bit ints: Math.imul, `>>>` and `| 0` each
## wrap to 32 bits. tests/test_seed.gd checks them against values recorded from the TypeScript.
class_name Seed

const _U32 := 0x1_0000_0000


## A value wrapped to a signed 32-bit integer (JavaScript's `x | 0` on an integer).
static func i32(x: int) -> int:
	x &= 0xFFFF_FFFF
	return x - _U32 if x >= 0x8000_0000 else x


## Math.imul: the low 32 bits of a product, signed. Both factors fit in 32 bits, so the 64-bit product never overflows.
static func imul(a: int, b: int) -> int:
	return i32(i32(a) * i32(b))


## `x >>> n` on a 32-bit value: shifted as unsigned.
static func ushr(x: int, n: int) -> int:
	return (x & 0xFFFF_FFFF) >> n


## 32-bit integer hash of a lattice point and a salt, unsigned (noise.ts hash; renamed, as hash() is a GDScript global).
static func hash32(x: int, y: int, s: int = 0) -> int:
	var h := i32(imul(x, 374761393) + imul(y, 668265263) + imul(s, 1442695041))
	h = imul(h ^ ushr(h, 13), 1274126177)
	return ushr(h ^ ushr(h, 16), 0)


## hash32() as a float in [0, 1).
static func hash01(x: int, y: int, s: int = 0) -> float:
	return hash32(x, y, s) / float(_U32)


## The 32-bit FNV-1a hash of a string's characters (world.ts idSalt), unsigned.
static func fnv1a(text: String) -> int:
	var h := i32(2166136261)
	for k in text.length():
		h = imul(h ^ text.unicode_at(k), 16777619)
	return ushr(h, 0)


## The small seeded PRNG (noise.ts mulberry): next() returns floats in [0, 1), the same sequence as the TypeScript.
class Mulberry:
	var _a: int

	func _init(seed_value: int) -> void:
		_a = Seed.i32(seed_value)

	func next() -> float:
		_a = Seed.i32(_a + 0x6D2B79F5)
		var t := Seed.imul(_a ^ Seed.ushr(_a, 15), 1 | _a)
		t = Seed.i32(Seed.i32(t + Seed.imul(t ^ Seed.ushr(t, 7), 61 | t)) ^ t)
		return Seed.ushr(t ^ Seed.ushr(t, 14), 0) / float(Seed._U32)
