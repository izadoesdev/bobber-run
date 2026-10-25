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
- **One implementation of anything the game must agree on.** Terrain heights are computed once, on the CPU (native
  `FastNoiseLite` layers), and baked into tiles that the drawing, collisions and chart all read; there is no second GPU
  version to drift from it.
- **No threads assumed.** The web build is single-threaded (a `WorkerThreadPool` task would run inline and stall the
  frame), so background work runs within a per-frame budget on every platform (`TileBaker`).
- Statically typed GDScript; one concern per file.

## Layout

| Folder | What lives there |
| --- | --- |
| `src/core` | deterministic building blocks (`seed.gd`: the lattice hash and PRNG) |
| `src/rules` | game rules shared with the server (`island_rules.gd`) |
| `src/world` | the world: each cell's islands (`islands.gd`), the one terrain height function and its tiles (`terrain.gd`), and the baker that builds tiles within a frame budget (`tile_baker.gd`) |
| `src/world` (cont.) | `world_tiles.gd`: the baked tiles round the boat, and smooth height reads from them for sailing and collisions |
| `src/render` | drawing: the ground shader (water bands, surf, land bands and relief, dithered pixel art), voxel models to meshes |
| `src/game` | the game: `game.gd` (camera, pixel viewport, zoom, dev hooks), `boat.gd` (sailing physics and contacts, ported), `oars.gd`, `fishing.gd` (cast, bite, strike, reel; ported), `docking.gd`, and `state.gd` (the autoload `State`: purse, hold, sales) |
| `src/rules` (cont.) | `species.gd`: the species table, their waters and climate, which fish a school is; `market.gd`: port prices and selling |
| `src/world` (cont.) | `schools.gd`: where the fish are; `flora.gd`: what grows on a tile; `ports.gd`: where each harbour stands, its name and prices (the game's, checked) |
| `src/ui` | `hud.gd` (purse and hold, prompt, notes, reel, catch card), `port_panel.gd` (a docked port: Sell all, Set sail), `ui_theme.gd` (the one theme, in the game's pixel font) |
| `data` | exported from the TypeScript by `bun scripts/godot-export.ts`: boats, oars, trees and fish (models and tables); each species' waters as a bitmap of its zone rule |
| `scenes` | `game.tscn` (the main scene: sail the rowboat off Alderhaven, WASD or arrows), `sea_chart.tscn` (a terrain chart) |
| `tests` | headless tests (`test_*.gd`), the runner, and `fixtures/` recorded from the TypeScript |

## Running it

```sh
Godot --path godot                                  # WASD/arrows row, Space casts, strikes and reels, E docks, wheel zooms
Godot --path godot -- --snap=out.png --sail=6       # sail ahead for 6 s, save a screenshot and quit
Godot --headless --path godot -- --autofish --autosell   # catch a fish, dock at Alderhaven and sell it (exits 1 if not)
```

## The web build

```sh
Godot --headless --path godot --export-release Web ../dist-godot/index.html   # needs the 4.7.2 web export templates
cd dist-godot && python3 -m http.server 8765                                    # then open http://localhost:8765
```

It's the single-threaded variant, so it needs no special headers. A 64 x 64 sample tile of island terrain bakes in
about 9 ms on an M4 desktop and 10 ms in Chrome there.

## Running the tests

```sh
bun scripts/godot-fixtures.ts                      # re-record the fixtures after changing the rules they cover
Godot --headless --path godot --import             # once, or after adding a class
Godot --headless --path godot --script res://tests/run_tests.gd
```

The `Godot` workflow runs both when the port or the rules it mirrors change.
