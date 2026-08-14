const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Flat GitHub layout: index.html lives beside server.js.
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const WORLD_W = 260, WORLD_H = 90;
const rooms = new Map();

const hasDatabase = !!process.env.DATABASE_URL;
const db = hasDatabase
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;

async function initDatabase(){
  if(!db){
    console.warn('DATABASE_URL is not set. Running in memory-only mode.');
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS worlds (
      code VARCHAR(10) PRIMARY KEY,
      world_data JSONB NOT NULL,
      surface_data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS player_saves (
      world_code VARCHAR(10) NOT NULL REFERENCES worlds(code) ON DELETE CASCADE,
      player_name VARCHAR(32) NOT NULL,
      x DOUBLE PRECISION,
      y DOUBLE PRECISION,
      health DOUBLE PRECISION,
      hunger DOUBLE PRECISION,
      inventory JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (world_code, player_name)
    )
  `);

  console.log('PostgreSQL persistence ready.');
}

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
    const h=Math.floor(
      37+
      (smoothNoise(x/14)-.5)*13+
      Math.sin(x/17)*2+
      (smoothNoise(x/5)-.5)*4
    );

    surface[x]=h;

    for(let y=h;y<WORLD_H;y++){
      if(y===h) world[y][x]=T.GRASS;
      else if(y<h+4) world[y][x]=T.DIRT;
      else{
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

  for(let i=0;i<110;i++){
    const cx=8+hash(i,901)*(WORLD_W-16);
    const cy=48+hash(i,902)*32;
    const r=2+hash(i,903)*4.5;

    for(let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++){
      for(let x=Math.floor(cx-r*1.6);x<=Math.ceil(cx+r*1.6);x++){
        if(
          x>1 && x<WORLD_W-1 &&
          y>0 && y<WORLD_H &&
          ((x-cx)**2/(r*r*2.2)+(y-cy)**2/(r*r)<1)
        ){
          world[y][x]=T.AIR;
        }
      }
    }
  }

  for(let x=5;x<WORLD_W-5;x++){
    if(hash(x,888)>.88 && world[surface[x]][x]===T.GRASS && surface[x]<43){
      const sy=surface[x];
      const th=4+(hash(x,1234)>.5?1:0);

      for(let y=sy-1;y>=sy-th;y--){
        if(y>=0) world[y][x]=T.WOOD;
      }

      for(let yy=sy-th-2;yy<=sy-th+1;yy++){
        for(let xx=x-2;xx<=x+2;xx++){
          if(
            xx>=0 && xx<WORLD_W &&
            yy>=0 &&
            Math.abs(xx-x)+Math.abs(yy-(sy-th))<4 &&
            world[yy][xx]===T.AIR
          ){
            world[yy][xx]=T.LEAF;
          }
        }
      }
    }
  }

  return {world,surface};
}

async function codeExists(code){
  if(rooms.has(code)) return true;
  if(!db) return false;

  const result=await db.query(
    'SELECT 1 FROM worlds WHERE code=$1 LIMIT 1',
    [code]
  );
  return result.rowCount>0;
}

async function roomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  for(let attempts=0;attempts<100;attempts++){
    const code=Array.from(
      {length:4},
      ()=>chars[Math.floor(Math.random()*chars.length)]
    ).join('');

    if(!(await codeExists(code))) return code;
  }

  throw new Error('Could not allocate unique room code.');
}

async function saveWorld(room){
  if(!db || !room) return;

  await db.query(`
    INSERT INTO worlds(code,world_data,surface_data,updated_at)
    VALUES($1,$2::jsonb,$3::jsonb,NOW())
    ON CONFLICT(code) DO UPDATE SET
      world_data=EXCLUDED.world_data,
      surface_data=EXCLUDED.surface_data,
      updated_at=NOW()
  `,[
    room.code,
    JSON.stringify(room.world),
    JSON.stringify(room.surface)
  ]);

  room.dirty=false;
  room.lastSaved=Date.now();
}

async function loadRoom(code){
  if(rooms.has(code)) return rooms.get(code);
  if(!db) return null;

  const result=await db.query(`
    SELECT code,world_data,surface_data
    FROM worlds
    WHERE code=$1
    LIMIT 1
  `,[code]);

  if(result.rowCount===0) return null;

  const row=result.rows[0];
  const room={
    code:row.code,
    world:row.world_data,
    surface:row.surface_data,
    players:{},
    dirty:false,
    lastSaved:Date.now()
  };

  rooms.set(code,room);
  console.log(`Loaded saved world ${code} from PostgreSQL.`);
  return room;
}

async function makeRoom(){
  const code=await roomCode();
  const gen=generateWorld();

  const room={
    code,
    world:gen.world,
    surface:gen.surface,
    players:{},
    dirty:true,
    lastSaved:0
  };

  rooms.set(code,room);

  // Save immediately so the room code survives a restart even before mining.
  await saveWorld(room);
  return room;
}

async function loadPlayerSave(worldCode,name){
  if(!db) return null;

  const result=await db.query(`
    SELECT x,y,health,hunger,inventory
    FROM player_saves
    WHERE world_code=$1 AND player_name=$2
    LIMIT 1
  `,[worldCode,name]);

  return result.rowCount ? result.rows[0] : null;
}

async function savePlayer(room,player){
  if(!db || !room || !player) return;

  await db.query(`
    INSERT INTO player_saves(
      world_code,player_name,x,y,health,hunger,inventory,updated_at
    )
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
    ON CONFLICT(world_code,player_name) DO UPDATE SET
      x=EXCLUDED.x,
      y=EXCLUDED.y,
      health=EXCLUDED.health,
      hunger=EXCLUDED.hunger,
      inventory=EXCLUDED.inventory,
      updated_at=NOW()
  `,[
    room.code,
    player.name,
    Number.isFinite(player.x) ? player.x : null,
    Number.isFinite(player.y) ? player.y : null,
    Number.isFinite(player.health) ? player.health : 10,
    Number.isFinite(player.hunger) ? player.hunger : 10,
    JSON.stringify(player.inventory || {})
  ]);

  player.lastPersisted=Date.now();
}

function publicPlayers(room){
  const output={};

  for(const [id,p] of Object.entries(room.players)){
    output[id]={
      id:p.id,
      name:p.name,
      x:p.x,
      y:p.y,
      vx:p.vx||0,
      vy:p.vy||0,
      dir:p.dir||1,
      health:p.health,
      hunger:p.hunger
    };
  }

  return output;
}

async function joinRoom(socket,room,name){
  socket.join(room.code);

  const safeName=String(name||'Player').trim().slice(0,16)||'Player';
  const sx=12*24;
  const sy=(room.surface[12]-3)*24;

  const saved=await loadPlayerSave(room.code,safeName);

  const playerData={
    id:socket.id,
    name:safeName,
    x:saved?.x ?? sx,
    y:saved?.y ?? sy,
    vx:0,
    vy:0,
    dir:1,
    health:saved?.health ?? 10,
    hunger:saved?.hunger ?? 10,
    inventory:saved?.inventory || {},
    lastChatAt:0,
    lastPersisted:Date.now()
  };

  room.players[socket.id]=playerData;

  socket.emit('roomJoined',{
    room:room.code,
    world:room.world,
    surface:room.surface,
    players:publicPlayers(room),
    spawn:{x:sx,y:sy},
    playerState:saved ? {
      x:playerData.x,
      y:playerData.y,
      health:playerData.health,
      hunger:playerData.hunger,
      inventory:playerData.inventory
    } : null
  });

  socket.to(room.code).emit('playerJoined',{
    id:playerData.id,
    name:playerData.name,
    x:playerData.x,
    y:playerData.y,
    dir:playerData.dir,
    health:playerData.health,
    hunger:playerData.hunger
  });

  io.to(room.code).emit('chatMessage',{
    playerId:null,
    name:'Server',
    message:`${playerData.name} joined the world.`,
    time:Date.now(),
    system:true
  });
}

// Periodically flush dirty worlds and current player state.
setInterval(async()=>{
  for(const room of rooms.values()){
    try{
      if(room.dirty || Date.now()-room.lastSaved>30000){
        await saveWorld(room);
      }

      for(const player of Object.values(room.players)){
        if(Date.now()-(player.lastPersisted||0)>10000){
          await savePlayer(room,player);
        }
      }
    }catch(err){
      console.error(`Autosave failed for room ${room.code}:`,err);
    }
  }
},10000);

io.on('connection',socket=>{
  socket.on('createRoom',async({name}={})=>{
    try{
      const room=await makeRoom();
      await joinRoom(socket,room,name);
    }catch(err){
      console.error('createRoom failed:',err);
      socket.emit('roomError','Could not create world.');
    }
  });

  socket.on('joinRoom',async({room,name}={})=>{
    try{
      const code=String(room||'').trim().toUpperCase();
      const r=await loadRoom(code);

      if(!r){
        socket.emit('roomError','Room not found.');
        return;
      }

      await joinRoom(socket,r,name);
    }catch(err){
      console.error('joinRoom failed:',err);
      socket.emit('roomError','Could not load world.');
    }
  });

  socket.on('playerMove',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    if(!r || !r.players[socket.id]) return;

    const p=r.players[socket.id];

    if(Number.isFinite(Number(data.x))) p.x=Number(data.x);
    if(Number.isFinite(Number(data.y))) p.y=Number(data.y);

    p.vx=Number(data.vx)||0;
    p.vy=Number(data.vy)||0;
    p.dir=Number(data.dir)||1;

    if(Number.isFinite(Number(data.health))) p.health=Number(data.health);
    if(Number.isFinite(Number(data.hunger))) p.hunger=Number(data.hunger);

    socket.to(r.code).emit('playerMove',{
      id:p.id,
      name:p.name,
      x:p.x,
      y:p.y,
      vx:p.vx,
      vy:p.vy,
      dir:p.dir,
      health:p.health,
      hunger:p.hunger
    });
  });

  socket.on('playerState',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    if(!r || !r.players[socket.id]) return;

    const p=r.players[socket.id];

    if(Number.isFinite(Number(data.x))) p.x=Number(data.x);
    if(Number.isFinite(Number(data.y))) p.y=Number(data.y);
    if(Number.isFinite(Number(data.health))) p.health=Number(data.health);
    if(Number.isFinite(Number(data.hunger))) p.hunger=Number(data.hunger);

    if(data.inventory && typeof data.inventory==='object' && !Array.isArray(data.inventory)){
      const clean={};

      for(const [id,count] of Object.entries(data.inventory)){
        const n=Math.max(0,Math.min(9999,Math.floor(Number(count)||0)));
        clean[String(id).slice(0,12)]=n;
      }

      p.inventory=clean;
    }
  });

  socket.on('chatMessage',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    if(!r || !r.players[socket.id]) return;

    const p=r.players[socket.id];
    const now=Date.now();

    if(p.lastChatAt && now-p.lastChatAt<500) return;
    p.lastChatAt=now;

    let message=String(data?.message||'')
      .replace(/[\r\n\t]+/g,' ')
      .trim()
      .slice(0,150);

    if(!message) return;

    io.to(r.code).emit('chatMessage',{
      playerId:socket.id,
      name:p.name,
      message,
      time:now,
      system:false
    });
  });

  socket.on('mineBlock',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const x=data?.x|0;
    const y=data?.y|0;

    if(!r || x<0 || x>=WORLD_W || y<0 || y>=WORLD_H) return;

    r.world[y][x]=0;
    r.dirty=true;

    io.to(r.code).emit('blockUpdate',{x,y,block:0});
  });

  socket.on('placeBlock',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const x=data?.x|0;
    const y=data?.y|0;
    const block=data?.block|0;

    if(!r || x<0 || x>=WORLD_W || y<0 || y>=WORLD_H) return;
    if(r.world[y][x]!==0) return;
    if(block<1 || block>11) return;

    r.world[y][x]=block;
    r.dirty=true;

    io.to(r.code).emit('blockUpdate',{x,y,block});
  });

  socket.on('disconnect',async()=>{
    for(const [code,r] of rooms){
      const p=r.players[socket.id];
      if(!p) continue;

      const leavingName=p.name||'A player';

      try{
        await savePlayer(r,p);
      }catch(err){
        console.error(`Could not save player ${leavingName}:`,err);
      }

      delete r.players[socket.id];

      socket.to(code).emit('playerLeft',socket.id);

      io.to(code).emit('chatMessage',{
        playerId:null,
        name:'Server',
        message:`${leavingName} left the world.`,
        time:Date.now(),
        system:true
      });

      if(Object.keys(r.players).length===0){
        try{
          await saveWorld(r);
          rooms.delete(code);
          console.log(`Saved and unloaded empty world ${code}.`);
        }catch(err){
          console.error(`Could not unload room ${code}:`,err);
        }
      }
    }
  });
});

async function shutdown(signal){
  console.log(`${signal}: saving active worlds before shutdown...`);

  try{
    for(const room of rooms.values()){
      await saveWorld(room);
      for(const player of Object.values(room.players)){
        await savePlayer(room,player);
      }
    }
  }catch(err){
    console.error('Shutdown save failed:',err);
  }

  if(db){
    try{ await db.end(); }catch{}
  }

  server.close(()=>process.exit(0));

  // Do not hang forever during a platform restart.
  setTimeout(()=>process.exit(0),5000).unref();
}

process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));

initDatabase()
  .then(()=>{
    server.listen(PORT,()=>{
      console.log(`PixelCraft multiplayer running on port ${PORT}`);
      console.log(hasDatabase
        ? 'Persistent PostgreSQL saves are ENABLED.'
        : 'Persistent saves are DISABLED until DATABASE_URL is configured.'
      );
    });
  })
  .catch(err=>{
    console.error('Database initialization failed:',err);
    process.exit(1);
  });
