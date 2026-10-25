## Base for test scripts: each test_*() method records what it found wrong; run_tests.gd reports them.
class_name TestCase
extends RefCounted

var failures: PackedStringArray = []


func expect_eq(got: Variant, want: Variant, what: String) -> void:
	if got != want:
		failures.append("%s: got %s, want %s" % [what, got, want])


func expect_near(got: float, want: float, tolerance: float, what: String) -> void:
	if absf(got - want) > tolerance:
		failures.append("%s: got %.12f, want %.12f" % [what, got, want])


## A JSON fixture from tests/fixtures (recorded from the TypeScript by scripts/godot-fixtures.ts).
func fixture(name: String) -> Dictionary:
	return JSON.parse_string(FileAccess.get_file_as_string("res://tests/fixtures/%s.json" % name))
