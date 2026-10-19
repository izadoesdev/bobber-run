# Bobber Run

A cozy pixel-art sailing and fishing game in the browser: fish, sell, upgrade your boat, and restore the harbour town of Alderhaven. Voxel models are rendered with WebGL2 and drawn back down to chunky pixels; the interface is Preact.

## Run

```sh
bun install
bun run dev       # dev server with hot reload
bun run build     # production build in dist/
bun run preview   # serve the production build
```

Needs a browser with WebGL2.

## Controls

| Key | Action |
|---|---|
| Arrows / WASD | Row and steer |
| Space | Cast, strike, reel |
| E | Dock, salvage, haul |
| B / C | Switch bait / throw chum |
| Tab | Ship and hold |
| M / L / J | Sea chart / logbook / journal |
| F | Fullscreen |
| Esc | Pause |

Keys can be rebound under Controls. Gamepads work too. Settings > Pixel style switches between Chunky, Crisp and Smooth.

## Code

- `src/main.js`: entry point, input, fixed-step loop, window fitting
- `src/game.js`: simulation, physics, saves; `econ.js` species, boats, upgrades; `world.js` procedural world; `story.js` quests
- `src/gl/`: WebGL2 renderer, shaders, voxel meshes
- `src/ui/`: Preact + htm interface, icons, sea chart
- `src/audio.js`: synthesized sound effects, ambience and music

## Credits

Fonts: [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans) and [Jersey 10](https://fonts.google.com/specimen/Jersey+10), SIL Open Font License (see `assets/fonts/`).
