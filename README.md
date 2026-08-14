# PixelCraft 2D Multiplayer

This build matches the flat GitHub/Railway layout you currently use.

Files:
- index.html
- server.js
- package.json
- README.md
- start-windows.bat

Chat controls:
- Enter: open chat
- Enter again: send
- Esc: cancel
- 150 character maximum
- Messages only go to players in the same room
- Join/leave system messages
- Latest 50 messages kept in the browser
- Basic 500 ms server anti-spam cooldown

Railway:
Upload/replace the files in your GitHub repository. Railway should redeploy automatically.

Local test:
npm install
npm start

Then open http://localhost:3000 in two tabs.

Persistence note:
Rooms/worlds/chat history are still stored in memory and are cleared by a server restart/redeploy.
