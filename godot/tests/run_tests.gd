## Runs every test_*() method of every tests/test_*.gd script, and exits non-zero if any failed:
## Godot --headless --path godot --script res://tests/run_tests.gd
extends SceneTree


func _init() -> void:
	var passed := 0
	var failed := 0
	for file in DirAccess.get_files_at("res://tests"):
		if not (file.begins_with("test_") and file.ends_with(".gd")) or file == "test_case.gd":
			continue
		var script: GDScript = load("res://tests/" + file)
		for method in script.get_script_method_list():
			if not String(method.name).begins_with("test_"):
				continue
			var test: TestCase = script.new()
			test.call(method.name)
			if test.failures.is_empty():
				passed += 1
				continue
			failed += 1
			for failure in test.failures:
				printerr("FAIL %s %s: %s" % [file, method.name, failure])
	print("%d passed, %d failed" % [passed, failed])
	quit(1 if failed else 0)
