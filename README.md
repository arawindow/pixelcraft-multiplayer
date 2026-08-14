# PixelCraft 2D Multiplayer — Persistent Save Build

This build includes everything from the current version:

- multiplayer rooms
- synchronized movement
- synchronized block mining/placement
- health and hunger
- crafting and furnace
- multiplayer chat
- speech bubbles above players

It now also supports PostgreSQL persistent saves.

## What is saved

World:
- room code
- all mined blocks
- all placed blocks
- generated terrain

Player, using the player's entered name inside that world:
- position
- health
- hunger
- inventory

The same player name in the same room code loads the same saved player state.

Important: there is no account/login system yet, so player names are not secure identities.

## Railway setup

1. Replace your existing GitHub files with the files from this ZIP and commit them.
2. Railway will redeploy the PixelCraft service.
3. In the SAME Railway project, click `+ New`.
4. Choose `Database`.
5. Choose `PostgreSQL`.
6. Wait for the PostgreSQL service to be created.
7. Open your PixelCraft web service.
8. Go to `Variables`.
9. Add a variable named:

   DATABASE_URL

10. Set it as a reference to the PostgreSQL service's `DATABASE_URL`.
11. Redeploy PixelCraft if Railway does not automatically redeploy after the variable is added.

After deployment, the logs should contain:

    PostgreSQL persistence ready.
    Persistent PostgreSQL saves are ENABLED.

If you instead see:

    Persistent saves are DISABLED until DATABASE_URL is configured.

then the environment variable has not been connected correctly.

## How saving works

- New worlds are saved to PostgreSQL immediately.
- Block changes mark the world as changed.
- Active worlds autosave about every 10 seconds.
- Player state is sent from the browser about every 5 seconds.
- Player state is written to PostgreSQL periodically.
- When a player disconnects, their latest state is saved.
- When the last player leaves, the world is saved and unloaded from server RAM.
- If Railway sends SIGTERM during a redeploy/restart, PixelCraft attempts a final save before shutting down.

## Testing persistence

1. Create a new room.
2. Write down the room code.
3. Mine several blocks and place several blocks.
4. Collect/craft something so your inventory changes.
5. Wait at least 10 seconds.
6. Close the browser.
7. Reopen the game.
8. Enter the SAME player name.
9. Join using the SAME room code.

Your modified world, inventory, position, health and hunger should return.

You can also test a Railway restart after waiting for an autosave.

## Local use without PostgreSQL

The game will still run without DATABASE_URL, but it falls back to memory-only saves.

## Files

- index.html
- server.js
- package.json
- README.md
- start-windows.bat
