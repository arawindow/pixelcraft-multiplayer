const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const WORLD_W = 260, WORLD_H = 90;
const rooms = new Map();

function hash(x,y=0){
  let n=(x*374761393 + y*668265263) ^ (x<<13);
  n=(n*(n*n*15731+789221)+1376312589);
  return ((n>>>0)%100000)/100000;
}
function smoothNoise(x){
  const i=Math.floor(x), f=x-i;
  const a=hash(i), b=hash(i+1);
  const s=f*f*(3-2*f);
  return a+(b-a)*s;
}
function generateWorld(){
  const T={AIR:0,GRASS:1,DIRT:2,STONE:3,WOOD:4,LEAF:5,COAL:6,IRON:7,SAND:8,WATER:9};
  const world=Array.from({length:WORLD_H},()=>Array(WORLD_W).fill(0));
  const surface=Array(WORLD_W).fill(0);
  const waterLevel=44;

  for(let x=0;x<WORLD_W;x++){
    const h=Math.floor(37+(smoothNoise(x/14)-.5)*13+Math.sin(x/17)*2+(smoothNoise(x/5)-.5)*4);
    surface[x]=h;
    for(let y=h;y<WORLD_H;y++){
      if(y===h) world[y][x]=T.GRASS;
      else if(y<h+4) world[y][x]=T.DIRT;
      else {
        world[y][x]=T.STONE;
        const r=hash(x,y);
        if(y>h+7 && r>.966) world[y][x]=T.COAL;
        if(y>h+14 && r<.018) world[y][x]=T.IRON;
      }
    }
    if(h>waterLevel){
      for(let y=waterLevel;y<h;y++) world[y][x]=T.WATER;
      world[h][x]=T.SAND;
      if(h+1<WORLD_H) world[h+1][x]=T.SAND;
    }
  }

  // deterministic caves
  for(let i=0;i<110;i++){
    const cx=8+hash(i,901)*(WORLD_W-16), cy=48+hash(i,902)*32;
    const r=2+hash(i,903)*4.5;
    for(let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++){
      for(let x=Math.floor(cx-r*1.6);x<=Math.ceil(cx+r*1.6);x++){
        if(x>1&&x<WORLD_W-1&&y>0&&y<WORLD_H&&((x-cx)**2/(r*r*2.2)+(y-cy)**2/(r*r)<1)){
          world[y][x]=T.AIR;
        }
      }
    }
  }

  for(let x=5;x<WORLD_W-5;x++){
    if(hash(x,888)>.88 && world[surface[x]][x]===T.GRASS && surface[x]<43){
      const sy=surface[x];
      const th=4+(hash(x,1234)>.5?1:0);
      for(let y=sy-1;y>=sy-th;y--) if(y>=0) world[y][x]=T.WOOD;
      for(let yy=sy-th-2;yy<=sy-th+1;yy++){
        for(let xx=x-2;xx<=x+2;xx++){
          if(xx>=0&&xx<WORLD_W&&yy>=0&&Math.abs(xx-x)+Math.abs(yy-(sy-th))<4&&world[yy][xx]===T.AIR){
            world[yy][xx]=T.LEAF;
          }
        }
      }
    }
  }
  return {world,surface};
}

function roomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='';
  do {
    code=Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  } while(rooms.has(code));
  return code;
}

function makeRoom(){
  const code=roomCode();
  const gen=generateWorld();
  rooms.set(code,{code,world:gen.world,surface:gen.surface,players:{}});
  return rooms.get(code);
}

function publicPlayers(room){
  return room.players;
}

function joinRoom(socket, room, name){
  socket.join(room.code);
  const sx=12*24, sy=(room.surface[12]-3)*24;
  room.players[socket.id]={id:socket.id,name:name||'Player',x:sx,y:sy,dir:1,health:10,hunger:10};
  socket.emit('roomJoined',{
    room:room.code,
    world:room.world,
    surface:room.surface,
    players:publicPlayers(room),
    spawn:{x:sx,y:sy}
  });
  socket.to(room.code).emit('playerJoined',room.players[socket.id]);
}

io.on('connection',socket=>{
  socket.on('createRoom',({name}={})=>{
    const room=makeRoom();
    joinRoom(socket,room,String(name||'Player').slice(0,16));
    
  socket.on('chatMessage', data => {
    const room = rooms.get(String(data?.room || ''));

    if (!room || !room.players[socket.id]) return;

    const player = room.players[socket.id];

    let message = String(data?.message || '').trim();

    // Prevent giant messages
    message = message.slice(0, 150);

    if (!message) return;

    io.to(room.code).emit('chatMessage', {
        playerId: socket.id,
        name: player.name,
        message,
        time: Date.now()
    });
});
  });

  socket.on('joinRoom',({room,name}={})=>{
    const code=String(room||'').toUpperCase();
    const r=rooms.get(code);
    if(!r){ socket.emit('roomError','Room not found.'); return; }
    joinRoom(socket,r,String(name||'Player').slice(0,16));
  });

  socket.on('playerMove',data=>{
    const r=rooms.get(String(data?.room||''));
    if(!r || !r.players[socket.id]) return;
    const p=r.players[socket.id];
    p.x=Number(data.x)||p.x;
    p.y=Number(data.y)||p.y;
    p.vx=Number(data.vx)||0;
    p.vy=Number(data.vy)||0;
    p.dir=Number(data.dir)||1;
    p.health=Number(data.health)||10;
    p.hunger=Number(data.hunger)||10;
    socket.to(r.code).emit('playerMove',p);
  });

  socket.on('mineBlock',data=>{
    const r=rooms.get(String(data?.room||''));
    const x=data?.x|0, y=data?.y|0;
    if(!r||x<0||x>=WORLD_W||y<0||y>=WORLD_H) return;
    r.world[y][x]=0;
    io.to(r.code).emit('blockUpdate',{x,y,block:0});
  });

  socket.on('placeBlock',data=>{
    const r=rooms.get(String(data?.room||''));
    const x=data?.x|0, y=data?.y|0, block=data?.block|0;
    if(!r||x<0||x>=WORLD_W||y<0||y>=WORLD_H) return;
    if(r.world[y][x]!==0) return;
    if(block<1||block>11) return;
    r.world[y][x]=block;
    io.to(r.code).emit('blockUpdate',{x,y,block});
  });

  socket.on('disconnect',()=>{
    for(const [code,r] of rooms){
      if(r.players[socket.id]){
        delete r.players[socket.id];
        socket.to(code).emit('playerLeft',socket.id);
        if(Object.keys(r.players).length===0){
          // Keep empty rooms alive for now. For production, add persistence/expiry.
        }
      }
    }
  });
});

server.listen(PORT,()=>console.log(`PixelCraft multiplayer running on http://localhost:${PORT}`));
