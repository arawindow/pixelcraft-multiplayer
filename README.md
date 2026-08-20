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


## Performance architecture

The semi-realistic graphics are retained, but the browser renderer has been optimized:

- 16×16 chunk rendering instead of one `THREE.Mesh` per block
- up to three meshes per chunk: opaque, transparent and emissive
- only visible voxel faces are emitted into chunk geometry
- 1024×512 padded terrain texture atlas + matching height atlas
- block edits rebuild only their affected chunk and edge neighbor chunks
- circular four-chunk render distance with streamed chunk loading/unloading
- chunk build queue to prevent large frame stalls
- nearby-only shadow casting
- 1536px soft shadow map instead of rendering all blocks into a 2048px map
- adaptive pixel ratio between 0.85 and 1.5 based on measured FPS
- entity render-distance culling
- entity/player interpolation between network updates
- player network movement throttled to about 12.5 updates/second
- server entity simulation snapshots reduced to 5 updates/second
