# Bobber Run

A cozy pixel-art sailing and fishing game in the browser: fish, sell, upgrade your boat, and restore the harbour town of Alderhaven. Voxel models are rendered with WebGL2 and drawn back down to chunky pixels; the interface is Preact.

## Run

```sh
bun install
bun run dev       # dev server with hot reload
bun run build     # production build in dist/
bun run preview   # serve the production build
bun run typecheck # TypeScript, client and backend
```

Needs a browser with WebGL2.

### Online play (optional)

Without configuration the game runs fully offline. To enable accounts, cloud saves, world records, the coastwide fund and other sailors, run a [Convex](https://convex.dev) backend from `convex/`:

```sh
bunx convex dev   # creates a dev deployment and writes VITE_CONVEX_URL to .env.local
```

Convex Auth also needs `JWT_PRIVATE_KEY`, `JWKS` and `SITE_URL` set on the deployment (see the Convex Auth setup guide). `.env.local` is gitignored.

## Controls

| Key | Action |
|---|---|
| Arrows / WASD | Row and steer |
| Space | Cast, strike, reel |
| E | Interact, visit, dock, salvage, haul |
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
- `src/net.ts`, `src/online.ts`: optional online layer; `convex/`: backend functions and schema
- `src/analytics.ts`: Databuddy setup and the typed list of game events; `src/telemetry.ts` reports screens, quests, settings and progress from game state

## Credits

Code: MIT (see `LICENSE`). Fonts are self-hosted under the SIL Open Font License: [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) and [Jersey 10](https://fonts.google.com/specimen/Jersey+10) (licences in `assets/fonts/`); Nunito Sans and Fraunces (licences in `public/fonts/`). Settings → Font offers Harbour, Pixel, and Plain; saved font choices are retained.
