# PixelCraft 2D Multiplayer

## Run locally

1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:

   npm install
   npm start

4. Open `http://localhost:3000`.

To test multiplayer on one computer, open the page in two browser tabs. Create a room in one tab and join with the room code in the other.

## Play with friends on the same Wi-Fi

Run the server on your computer and find your computer's local IP address, for example `192.168.1.25`.

Your friend can then open:

`http://192.168.1.25:3000`

Both devices must be on the same network and your firewall must allow Node.js on the private network.

## Put it online

Deploy this whole folder to a Node.js host that supports WebSockets. The server automatically uses the host's `PORT` environment variable.

Typical deployment flow:

- Push this folder to a Git repository.
- Create a Node.js web service.
- Build command: `npm install`
- Start command: `npm start`
- Give friends the resulting HTTPS URL.

## Multiplayer features in this version

- Create/join rooms with 4-character codes.
- Player names.
- Other players visible in real time.
- Shared player movement.
- Shared mining.
- Shared block placement.
- Server-owned canonical block world.

## Current limitations

- Animals are still simulated locally per browser, not server-authoritative.
- Inventory, health, hunger, crafting, and food are local to each player.
- Worlds are stored in server memory and reset when the server restarts.
- No login/account system.
- No anti-cheat or movement validation yet.
