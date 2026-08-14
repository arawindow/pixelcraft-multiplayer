# PixelCraft Survival — Complete Multiplayer Upgrade

This build includes the requested systems together:

- Persistent PostgreSQL worlds and player saves.
- Shared physical item drops for mined blocks, mob loot, and player death drops.
- Pickaxes, axes, swords, equipment/hotbar assignment, mining requirements, and durability.
- Server-authoritative passive animals and hostile night mobs.
- Death/respawn with inventory dropped into the world.
- Timed shared furnaces:
  - Raw Meat + Coal -> Cooked Meat
  - Iron Ore + Coal -> Iron Ingot
  - Sand + Coal -> Glass
- Persistent shared chests.
- Torch lighting and darker caves/night.
- Improved biome-style generation: forest/plains/desert/snow/mountains/beaches.
- Beds set persistent player respawn points; if all online players sleep at night, morning is skipped.
- TAB player list.
- World owner/admin commands:
  - /help
  - /players
  - /spawn
  - /kick NAME
  - /setspawn
  - /pvp on
  - /pvp off
  - /save
- Multiplayer chat and speech bubbles.

## Important upgrade note

This version extends your existing PostgreSQL schema automatically using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so you do not need to manually recreate the database.

Existing saved worlds can still load. New worlds get the improved world generation and server-synced mobs.

## Deploy to Railway

1. Replace the files in your GitHub repository with:
   - index.html
   - server.js
   - package.json
   - README.md
   - start-windows.bat
2. Commit/push.
3. Railway should redeploy automatically.
4. Keep your existing `DATABASE_URL` variable connected to PostgreSQL.
5. Check Railway logs. You should see:
   `PostgreSQL persistence ready.`

## Controls

- A / D or arrow keys: move
- Space: jump
- Left click: mine / attack
- Right click: place / interact with chest, furnace, bed
- 1–0: hotbar
- Mouse wheel: hotbar
- C: crafting
- I: inventory/equipment; click an item to assign it to the selected hotbar slot
- E: eat
- F: open nearest furnace
- Enter: chat
- Tab: player list
- Esc: close menu

## Tool progression

Stone and coal require at least a Wood Pickaxe.
Iron ore requires at least a Stone Pickaxe.
Axes speed up wood-like blocks.
Swords deal more mob/PVP damage.
Tools lose durability and eventually break.

## Persistence

The server persists:
- blocks
- terrain
- time
- mobs
- item drops
- chests and contents
- furnaces and outputs/jobs
- beds
- owner/settings/world spawn
- player inventory
- health/hunger
- position
- tool durability
- hotbar/equipment layout
- personal respawn point

Player identity is still based on the typed player name; there is no login/account authentication yet.
