# Bobber Run

A cozy pixel-art sailing and fishing game in the browser: fish, sell, upgrade your boat, and restore the harbour town of Alderhaven. Out in the far waters, pirates sail from hidden coves. A sail flying no colours shadows you, then runs up the black flag and hails you to heave to: stop and pay a tribute from your hold, run (upwind, where a square rigger can't follow), or refuse and fight under the red flag, no quarter. Guns are slow and heavy, so a fight is manoeuvring for a few decisive broadsides, and every ship fights her own way: sloops dart in to grapple and board you, brigantines rake you or charge to ram, galleons run out double-shotted broadsides, bomb ketches walk their shells onto you, oared galleys row up into the wind to lay their long bow gun on you, and fire ships are sailed at you to blow up alongside. Your lookout calls out what each is doing, ships out of sight show at the screen's edge, and in a fight a gun deck along the bottom shows each weapon you fire with its key and what it would do now (hover one, or press ?, for how it works); arm your boat (broadside guns, a bow swivel, a mortar, powder kegs, an iron ram, chain, grape and fire shot) or buy a fighting ship that fights her own way too (a sailing Revenue Cutter with a long bow chaser; then engines, whatever the wind: a Coast Guard Cutter whose boarders take beaten pirates for the bounty, a Rocket Gunboat that walks a barrage along a ship's course, an armoured Dreadnought whose three turrets swing onto any bearing and fire salvoes that make beaten pirates strike, a Destroyer with torpedoes, a Missile Cruiser whose missiles home on a pirate wherever she is, and an Aircraft Carrier whose jets fly out past any gun's reach, bomb a pirate pass after pass and land back aboard to rearm), sink or board them for their loot, raid their stashes, hear of coves at the inn and dig up buried treasure (or switch pirates off in Settings; Battle aids, on by default, draws firing arcs and fall-of-shot rings). The working and pleasure boats each have a trick of their own too: a Speedboat that opens her throttles for a burst of speed, a Catamaran that flies a hull and outruns every sail in a storm, a Schooner that is the fastest ship afloat with the wind on her beam, a Sailing Yacht that points higher into the wind than any other sail, a Research Vessel whose sonar names every school, a Flagship that makes every boat fishing for you bring in half as much again, an Icebreaker that opens the far north, a Motor Yacht whose underwater lights draw fish at night, a Superyacht whose helicopter flies the catch to market while you fish on, and an Ocean Liner whose passengers pay their fares from harbour to harbour. Voxel models are rendered with WebGL2 and drawn back down to chunky pixels; the interface is Preact.

## Run

```sh
bun install
bun run dev       # dev server with hot reload
bun run build     # production build in dist/
bun run preview   # serve the production build
bun run typecheck # TypeScript, client and backend
bun run test      # unit tests (tests/)
bun run e2e       # browser tests (e2e/, Playwright)
bun run bench     # CPU cost of world generation (scripts/bench.ts); browser probes in scripts/probes/
```

Needs a browser with WebGL2.

### Online play (optional)

Without configuration the game runs fully offline. To enable accounts, cloud saves, world records, the coastwide fund and other sailors, run a [Convex](https://convex.dev) backend from `convex/`:

```sh
bunx convex dev   # creates a dev deployment and writes VITE_CONVEX_URL to .env.local
```

Convex Auth also needs `AUTH_PRIVATE_KEY` and `AUTH_JWKS` on the deployment: `bunx @convex-dev/auth` generates and sets them. `.env.local` is gitignored.

## Controls

| Key | Action |
|---|---|
| Arrows / WASD | Row and steer |
| Space | Cast, strike, reel |
| E | Interact, visit, dock, salvage, haul, dig, raid |
| R / L3 | Fire the broadside: the rail facing a pirate in its arc abeam (touch: Fire) |
| T / V / Z | Fire the mortar / drop a powder keg astern / change shot (round, chain, grape, fire) |
| Y | Fire a torpedo or missile, or launch a plane (warships that carry them) |
| K | Your boat's special. Every sail hoists a spinnaker: fast before the wind, it flogs close-hauled and blows out in a gale. The Rowboat's crew sprint, and every other engine sounds her horn, which sometimes brings dolphins. The Research Vessel pings her sonar to chart every school within 150 m, the Speedboat opens her throttles for a burst of speed, and the Superyacht's helicopter flies the catch to the nearest charted harbour and sells it there |
| B / C | Switch bait / throw chum |
| Tab | Ship and hold |
| Q / R3 | Choose the next nearby fish or sea creature (touch: Next fish) |
| M / L / J | Sea chart / logbook / journal |
| Mouse wheel / - and + | Zoom the sea view |
| F | Fullscreen |
| Esc / controller Start | Pause, including during a cast or fight (touch: Menu) |
| `` ` `` or F2 | Cheat console (dev builds only, or with `VITE_ENABLE_CHEATS=1`) |

Keys can be rebound under Controls. Gamepads work too. Settings > Pixel style switches between Chunky, Crisp and Smooth.

### Analytics

Production builds send page views, web vitals, errors and the game events in `src/analytics.ts` to [Databuddy](https://www.databuddy.cc). Development builds send nothing unless `VITE_DATABUDDY_DEV=1`; set `VITE_DATABUDDY_CLIENT_ID` to report to your own site. Nothing personal is sent (see `public/privacy.html`).

## Code

TypeScript throughout (`bun run typecheck` checks the client and `convex/`).

- `src/main.ts`: entry point, fixed-step loop, window fitting; `input.ts` keyboard and gamepad; `menus.ts` per-screen input
- `src/game.ts` and `src/game/`: simulation, physics, fishing and schools, ports, saves, the next-step guide; `econ.ts` and `species.ts` boats, upgrades and fish; `world.ts` procedural world; `story.ts` quests; `camera.ts` zoom
- `src/gl/`: WebGL2 renderer, shaders, voxel meshes
- `src/ui/`: Preact TSX interface, icons, sea chart
- `src/audio.ts`: synthesized sound effects, ambience and music
- `src/game/pirates.ts`, `arms.ts`, `gunnery.ts`, `treasure.ts`: pirate ships and their captains' tactics, weapons and shot, flight of balls, shells and kegs, cove raids and buried treasure; coves are placed in `world.ts`; `src/ui/combat.tsx` draws the lookout's calls, grappling lines, edge pips, the battle chip, the lookout's condition words and the optional battle aids (firing arcs, impact rings)
- `src/net.ts`, `src/online.ts`: optional online layer; `convex/`: backend functions and schema; `server/`: the realtime relay for boat positions and chat
- `src/analytics.ts`: Databuddy setup and the typed list of game events; `src/telemetry.ts` reports screens, quests, settings and progress from game state

## Credits

Code: MIT (see `LICENSE`). Fonts are self-hosted under the SIL Open Font License: [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans), [Jersey 10](https://fonts.google.com/specimen/Jersey+10), Nunito Sans and Fraunces (licences in `public/fonts/`). Settings → Font switches between Harbour, Pixel and Plain.
