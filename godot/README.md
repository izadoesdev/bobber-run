# Bobber Run in Godot 4.7

The port of the browser game in `../src`, one slice at a time. Web first: GDScript, the Compatibility renderer
(WebGL 2), desktop builds for free.

## Rules of the port

- **Parity only where something outside the game depends on it.** The server places the islands players buy
  (`convex/islandRules.ts`), so the seeded hash, the PRNG and island placement are ported exactly and checked against
  values recorded from the TypeScript. Everything else is rebuilt the Godot way (native noise, nodes, shaders, UI)
  rather than transliterated.
- **Data is exported, not copied.** Tables like species, boats and upgrades will be generated from the TypeScript as
  JSON, so the two can't drift apart.
- Statically typed GDScript; one concern per file.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/core` | deterministic building blocks (`seed.gd`: the lattice hash and PRNG) |
| `src/rules` | game rules shared with the server (`island_rules.gd`) |
| `tests` | headless tests (`test_*.gd`), the runner, and `fixtures/` recorded from the TypeScript |

## Running the tests

```sh
bun scripts/godot-fixtures.ts                      # re-record the fixtures after changing the rules they cover
Godot --headless --path godot --import             # once, or after adding a class
Godot --headless --path godot --script res://tests/run_tests.gd
```

The `Godot` workflow runs both when the port or the rules it mirrors change.
