# Blockcraft Complete

A persistent multiplayer voxel survival sandbox for GitHub + Railway.

This project implements original Blockcraft versions of:
- Dropped item entities and pickup
- Shared synchronized chests
- Timed server-side furnaces
- Farmland/crops and crop growth
- Animals
- Hostile mobs with chase AI
- Boss encounter
- Armor/equipment state
- Bows and projectiles
- Water/lava blocks with compact server-side spreading fluid simulation
- Dynamic day/night lighting and emissive blocks
- Weather state
- Procedural terrain, caves, ores, trees
- Generated village structures and wandering villager NPCs
- Alternate dimensions
- Portals
- Wire/lamp automation state
- XP/achievement progression and compact enchanting
- Potion consumption/effects
- Boats and minecarts
- Fishing
- Persistent multiplayer players/world/entities
- Multiplayer chat + speech bubbles
- Health/hunger
- Crafting
- Mining and block placement

## Files

```text
.gitignore
package.json
railway.json
README.md
server.js
index.html
style.css
client.js
```

## Railway

1. Push these files to GitHub.
2. Connect that repository to Railway.
3. Add a Railway Volume mounted at `/data`.
4. Add variable `DATA_DIR=/data`.
5. Generate a public domain.
6. Railway runs `npm start`.

Persistent state is stored at `/data/world.json`.

## Controls

- WASD: move
- Space: jump/swim up
- Shift: sprint
- Left click: mine / attack
- Right click: place / use
- 1-9: hotbar
- E: inventory/crafting
- Enter: multiplayer chat
- G: achievements
- F: bow / vehicle / fishing rod / food action
- R: healing potion
- Q: drop selected item

## Scope

This is an original browser voxel game. It does not use Minecraft textures, sounds, code, maps, UI assets, or other copyrighted game assets. The implemented systems are compact browser-game equivalents, not a claim of feature-for-feature parity with the commercial Minecraft codebase.


## Semi-realistic graphics pack

This build includes original 96×96 textured voxel materials in `assets/textures/`, per-face grass/log materials, bump mapping, anisotropic filtering, ACES filmic tone mapping, soft 2048px shadows, atmospheric fog, weather-dependent lighting, transparent water/glass/ice, and emissive lava/portal/light materials.

All included textures are original generated assets for Blockcraft and do not use Minecraft texture files.


## Safe performance pass

This build deliberately keeps the original working per-block Three.js renderer and semi-realistic materials. Performance changes are conservative: incremental block visual updates instead of full-world rebuilds, 48-block visual distance, nearby-only shadow casting, 1024px shadow map, adaptive 0.9–1.35 render pixel ratio, 15Hz player network updates, 5Hz server simulation snapshots, entity distance culling, and interpolation for remote players/entities. No chunk renderer, custom geometry, texture atlas, or instanced terrain is used.


## Survival gameplay expansion

This build keeps the known-working semi-realistic per-block renderer and adds:

- 3×3 interactive crafting grid with server-validated recipes
- wood/stone/iron tools, durability and tool-specific mining
- leather/iron armor equipment and damage reduction
- proper block/mob drops and persistent dropped-item entities
- synchronized multiplayer chests
- timed furnaces with fuel, progress, smelting and synchronized GUI
- farmland, hoes, seeds, hydration-aware wheat growth and harvesting
- apples, meat, cooked food, saturation and healing food
- cows, pigs, sheep, chickens, zombies, skeletons and spiders
- hostile chasing, skeleton projectiles and daytime passive wandering
- inventory drop on death and multiplayer respawn
- biome-aware terrain generation, improved caves/ores, village houses, farms and mineshaft structure
- doors, fences, stairs, slabs and ladders
- bow combat, arrows, XP and levels
- local torch/lamp/lava point lights
- rain/storm particle effects
- block-breaking particles

The renderer itself remains the conservative working Mesh-per-visible-block renderer; no chunk/instancing rewrite is used.


## Permanent daytime and stable shadows

- The overworld is now permanently daytime.
- The directional sun no longer travels through the sky.
- Shadow casters are no longer repeatedly toggled as the player moves.
- A fixed 1024×1024 soft shadow map and tighter shadow camera reduce flickering/shimmer.
- `normalBias` is used to reduce shadow acne on voxel surfaces.
- Rain and storms remain available, but they only change daylight brightness and fog.


## Infinite procedural world
- Persistent terrain generates in 16x16 chunks as players travel.
- Existing saved builds are protected from regeneration.
- The browser keeps nearby chunks only and unloads distant data/meshes.
- Returning streams saved chunks back from the server.
- The working semi-realistic renderer and permanent daytime are preserved.


## Smoother rendering

- block meshes are pooled and reused;
- newly streamed blocks are created over multiple frames instead of one large spike;
- nearby blocks are prioritized in the render queue;
- parsed block coordinates are cached;
- raycasts only inspect nearby chunk meshes;
- visual quality, textures, bump maps, lighting, shadows and render distance are unchanged.
