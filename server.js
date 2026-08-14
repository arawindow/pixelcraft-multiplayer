const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const TILE = 24;
const WORLD_W = 260;
const WORLD_H = 90;
const rooms = new Map();

const T = {
  AIR:0, GRASS:1, DIRT:2, STONE:3, WOOD:4, LEAF:5, COAL:6, IRON:7,
  SAND:8, WATER:9, CRAFT:10, FURNACE:11, CHEST:12, TORCH:13,
  SNOW:14, CACTUS:15, GLASS:16, BED:17
};
const I = {
  PLANK:101, STICK:102, WOOD_PICK:103, STONE_PICK:104, TORCH:105,
  RAW_MEAT:106, COOKED_MEAT:107, IRON_INGOT:108, IRON_PICK:109,
  WOOD_AXE:110, STONE_AXE:111, IRON_AXE:112,
  WOOD_SWORD:113, STONE_SWORD:114, IRON_SWORD:115, WOOL:116
};

const hasDatabase = !!process.env.DATABASE_URL;
const db = hasDatabase ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized:false } : undefined
}) : null;

function cleanInventory(obj){
  const out = {};
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for(const [id,count] of Object.entries(obj)){
    const n = Math.max(0, Math.min(9999, Math.floor(Number(count)||0)));
    out[String(id).slice(0,12)] = n;
  }
  return out;
}

function cleanToolState(obj){
  const out = {};
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  for(const [id,d] of Object.entries(obj)){
    const n = Math.max(0, Math.min(1000, Math.floor(Number(d)||0)));
    out[String(id).slice(0,12)] = n;
  }
  return out;
}

async function initDatabase(){
  if(!db){
    console.warn('DATABASE_URL not set. Persistence is memory-only.');
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

  await db.query(`ALTER TABLE worlds ADD COLUMN IF NOT EXISTS entities_data JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await db.query(`ALTER TABLE worlds ADD COLUMN IF NOT EXISTS owner_name VARCHAR(32)`);
  await db.query(`ALTER TABLE worlds ADD COLUMN IF NOT EXISTS settings_data JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await db.query(`ALTER TABLE worlds ADD COLUMN IF NOT EXISTS spawn_data JSONB NOT NULL DEFAULT '{}'::jsonb`);

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

  await db.query(`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS spawn_x DOUBLE PRECISION`);
  await db.query(`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS spawn_y DOUBLE PRECISION`);
  await db.query(`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS tool_state JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await db.query(`ALTER TABLE player_saves ADD COLUMN IF NOT EXISTS hotbar_data JSONB NOT NULL DEFAULT '[]'::jsonb`);

  console.log('PostgreSQL persistence ready.');
}

function hash(x,y=0){
  let n=(x*374761393+y*668265263)^(x<<13);
  n=(n*(n*n*15731+789221)+1376312589);
  return ((n>>>0)%100000)/100000;
}
function smoothNoise(x){
  const i=Math.floor(x),f=x-i,a=hash(i),b=hash(i+1),s=f*f*(3-2*f);
  return a+(b-a)*s;
}

function biomeAt(x){
  const n=smoothNoise(x/32);
  if(n<.18) return 'desert';
  if(n<.36) return 'plains';
  if(n<.58) return 'forest';
  if(n<.76) return 'snow';
  return 'mountain';
}

function generateWorld(){
  const world=Array.from({length:WORLD_H},()=>Array(WORLD_W).fill(T.AIR));
  const surface=Array(WORLD_W).fill(0);
  const waterLevel=45;

  for(let x=0;x<WORLD_W;x++){
    const biome=biomeAt(x);
    let h=38+(smoothNoise(x/13)-.5)*10+Math.sin(x/18)*2;
    if(biome==='mountain') h-=8+(smoothNoise(x/6))*9;
    if(biome==='desert') h+=2;
    if(biome==='plains') h+=1;
    h=Math.max(17,Math.min(54,Math.floor(h)));
    surface[x]=h;

    for(let y=h;y<WORLD_H;y++){
      const depth=y-h;
      if(depth===0){
        if(biome==='desert') world[y][x]=T.SAND;
        else if(biome==='snow') world[y][x]=T.SNOW;
        else world[y][x]=T.GRASS;
      }else if(depth<4){
        world[y][x]=biome==='desert'?T.SAND:T.DIRT;
      }else{
        world[y][x]=T.STONE;
        const r=hash(x,y);
        if(y>h+6 && r>.963) world[y][x]=T.COAL;
        if(y>h+13 && r<.020) world[y][x]=T.IRON;
      }
    }

    if(h>waterLevel){
      for(let y=waterLevel;y<h;y++) world[y][x]=T.WATER;
      world[h][x]=T.SAND;
      if(h+1<WORLD_H) world[h+1][x]=T.SAND;
    }else if(Math.abs(h-waterLevel)<=2){
      world[h][x]=T.SAND;
    }
  }

  // caves
  for(let i=0;i<125;i++){
    const cx=7+hash(i,901)*(WORLD_W-14);
    const cy=48+hash(i,902)*31;
    const r=2+hash(i,903)*4.8;
    for(let y=Math.floor(cy-r);y<=Math.ceil(cy+r);y++){
      for(let x=Math.floor(cx-r*1.7);x<=Math.ceil(cx+r*1.7);x++){
        if(x>1&&x<WORLD_W-1&&y>0&&y<WORLD_H &&
          ((x-cx)**2/(r*r*2.5)+(y-cy)**2/(r*r)<1)){
          world[y][x]=T.AIR;
        }
      }
    }
  }

  // vegetation
  for(let x=4;x<WORLD_W-4;x++){
    const biome=biomeAt(x);
    const sy=surface[x];
    if(biome==='desert' && hash(x,400)>.91 && world[sy][x]===T.SAND){
      const h=2+(hash(x,401)>.55?1:0);
      for(let j=1;j<=h;j++) if(sy-j>=0) world[sy-j][x]=T.CACTUS;
      continue;
    }

    const chance=biome==='forest'?.78:biome==='plains'?.92:biome==='snow'?.88:1;
    if(hash(x,888)>chance && sy<46 && [T.GRASS,T.SNOW].includes(world[sy][x])){
      const th=4+(hash(x,1234)>.5?1:0);
      for(let y=sy-1;y>=sy-th;y--) if(y>=0) world[y][x]=T.WOOD;
      for(let yy=sy-th-2;yy<=sy-th+1;yy++){
        for(let xx=x-2;xx<=x+2;xx++){
          if(xx>=0&&xx<WORLD_W&&yy>=0 &&
             Math.abs(xx-x)+Math.abs(yy-(sy-th))<4 &&
             world[yy][xx]===T.AIR){
            world[yy][xx]=T.LEAF;
          }
        }
      }
    }
  }

  return {world,surface};
}

function groundY(room, px){
  const tx=Math.max(0,Math.min(WORLD_W-1,Math.floor(px/TILE)));
  return room.surface[tx]*TILE;
}

function makePassiveMob(room, type, x){
  const defs={
    pig:{hp:4,w:22,h:14},
    cow:{hp:6,w:24,h:17},
    sheep:{hp:5,w:23,h:16}
  };
  const d=defs[type];
  return {
    id:'m'+Math.random().toString(36).slice(2,10),
    type, hostile:false, x, y:groundY(room,x)-d.h/2-1,
    vx:(Math.random()<.5?-1:1)*(12+Math.random()*18),
    hp:d.hp,maxHp:d.hp,w:d.w,h:d.h,wander:1+Math.random()*4,hurt:0,attackCd:0
  };
}

function makeHostileMob(room,type,x){
  const defs={
    zombie:{hp:8,w:18,h:28,speed:42,damage:2},
    slime:{hp:5,w:20,h:15,speed:55,damage:1}
  };
  const d=defs[type];
  return {
    id:'m'+Math.random().toString(36).slice(2,10),
    type, hostile:true, x, y:groundY(room,x)-d.h/2-1,
    vx:0,hp:d.hp,maxHp:d.hp,w:d.w,h:d.h,speed:d.speed,damage:d.damage,
    wander:0,hurt:0,attackCd:0
  };
}

function seedPassiveMobs(room){
  const mobs={};
  for(let i=0;i<18;i++){
    const tx=8+Math.floor(hash(i,777)*(WORLD_W-16));
    const x=(tx+.5)*TILE;
    const type=['pig','cow','sheep'][i%3];
    const m=makePassiveMob(room,type,x);
    mobs[m.id]=m;
  }
  return mobs;
}

async function codeExists(code){
  if(rooms.has(code)) return true;
  if(!db) return false;
  const r=await db.query('SELECT 1 FROM worlds WHERE code=$1 LIMIT 1',[code]);
  return r.rowCount>0;
}
async function roomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let tries=0;tries<100;tries++){
    const c=Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
    if(!(await codeExists(c))) return c;
  }
  throw new Error('Unable to allocate room code');
}

function serializeEntities(room){
  return {
    drops:room.drops,
    mobs:room.mobs,
    chests:room.chests,
    furnaces:room.furnaces,
    beds:room.beds,
    timeOfDay:room.timeOfDay
  };
}

async function saveWorld(room){
  if(!db||!room) return;
  await db.query(`
    INSERT INTO worlds(code,world_data,surface_data,entities_data,owner_name,settings_data,spawn_data,updated_at)
    VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::jsonb,NOW())
    ON CONFLICT(code) DO UPDATE SET
      world_data=EXCLUDED.world_data,
      surface_data=EXCLUDED.surface_data,
      entities_data=EXCLUDED.entities_data,
      owner_name=EXCLUDED.owner_name,
      settings_data=EXCLUDED.settings_data,
      spawn_data=EXCLUDED.spawn_data,
      updated_at=NOW()
  `,[
    room.code,JSON.stringify(room.world),JSON.stringify(room.surface),
    JSON.stringify(serializeEntities(room)),room.ownerName,
    JSON.stringify(room.settings),JSON.stringify(room.spawn)
  ]);
  room.dirty=false;
  room.lastSaved=Date.now();
}

async function makeRoom(ownerName){
  const code=await roomCode();
  const gen=generateWorld();
  const spawnTx=12;
  const room={
    code,world:gen.world,surface:gen.surface,players:{},
    ownerName:String(ownerName||'Player').slice(0,16),
    settings:{pvp:false},
    spawn:{x:(spawnTx+.5)*TILE,y:(gen.surface[spawnTx]-2)*TILE},
    drops:{},mobs:{},chests:{},furnaces:{},beds:{},
    timeOfDay:.23,dirty:true,lastSaved:0,lastMobBroadcast:0,lastTimeBroadcast:0,lastHostileSpawn:0
  };
  room.mobs=seedPassiveMobs(room);
  rooms.set(code,room);
  await saveWorld(room);
  return room;
}

async function loadRoom(code){
  if(rooms.has(code)) return rooms.get(code);
  if(!db) return null;
  const q=await db.query(`
    SELECT code,world_data,surface_data,entities_data,owner_name,settings_data,spawn_data
    FROM worlds WHERE code=$1 LIMIT 1
  `,[code]);
  if(!q.rowCount) return null;
  const row=q.rows[0], e=row.entities_data||{};
  const surface=row.surface_data;
  const room={
    code:row.code,world:row.world_data,surface,players:{},
    ownerName:row.owner_name||'Player',
    settings:Object.assign({pvp:false},row.settings_data||{}),
    spawn:Object.assign({x:12.5*TILE,y:(surface[12]-2)*TILE},row.spawn_data||{}),
    drops:e.drops||{},mobs:e.mobs||{},chests:e.chests||{},furnaces:e.furnaces||{},beds:e.beds||{},
    timeOfDay:Number.isFinite(e.timeOfDay)?e.timeOfDay:.23,
    dirty:false,lastSaved:Date.now(),lastMobBroadcast:0,lastTimeBroadcast:0,lastHostileSpawn:0
  };
  rooms.set(code,room);
  console.log(`Loaded world ${code}`);
  return room;
}

async function loadPlayerSave(code,name){
  if(!db) return null;
  const q=await db.query(`
    SELECT x,y,health,hunger,inventory,spawn_x,spawn_y,tool_state,hotbar_data
    FROM player_saves WHERE world_code=$1 AND player_name=$2 LIMIT 1
  `,[code,name]);
  return q.rowCount?q.rows[0]:null;
}
async function savePlayer(room,p){
  if(!db||!room||!p) return;
  await db.query(`
    INSERT INTO player_saves(world_code,player_name,x,y,health,hunger,inventory,spawn_x,spawn_y,tool_state,hotbar_data,updated_at)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10::jsonb,$11::jsonb,NOW())
    ON CONFLICT(world_code,player_name) DO UPDATE SET
      x=EXCLUDED.x,y=EXCLUDED.y,health=EXCLUDED.health,hunger=EXCLUDED.hunger,
      inventory=EXCLUDED.inventory,spawn_x=EXCLUDED.spawn_x,spawn_y=EXCLUDED.spawn_y,
      tool_state=EXCLUDED.tool_state,hotbar_data=EXCLUDED.hotbar_data,updated_at=NOW()
  `,[
    room.code,p.name,p.x,p.y,p.health,p.hunger,JSON.stringify(p.inventory||{}),
    p.spawnX,p.spawnY,JSON.stringify(p.toolState||{}),JSON.stringify(p.hotbar||[])
  ]);
  p.lastPersisted=Date.now();
}

function publicPlayer(p){
  return {id:p.id,name:p.name,x:p.x,y:p.y,vx:p.vx||0,vy:p.vy||0,dir:p.dir||1,
    health:p.health,hunger:p.hunger,sleeping:!!p.sleeping};
}
function publicPlayers(room){
  const o={}; for(const [id,p] of Object.entries(room.players)) o[id]=publicPlayer(p); return o;
}
function broadcastPlayerList(room){
  io.to(room.code).emit('playerList',{
    ownerName:room.ownerName,
    players:Object.values(room.players).map(p=>({id:p.id,name:p.name,health:p.health,hunger:p.hunger}))
  });
}

async function joinRoom(socket,room,name){
  const safeName=String(name||'Player').trim().slice(0,16)||'Player';
  const saved=await loadPlayerSave(room.code,safeName);
  const p={
    id:socket.id,name:safeName,
    x:saved?.x ?? room.spawn.x,y:saved?.y ?? room.spawn.y,
    vx:0,vy:0,dir:1,
    health:saved?.health ?? 10,hunger:saved?.hunger ?? 10,
    inventory:cleanInventory(saved ? (saved.inventory||{}) : {[T.DIRT]:20,[T.WOOD]:6,[T.GRASS]:4}),
    toolState:cleanToolState(saved?.tool_state||{}),
    hotbar:Array.isArray(saved?.hotbar_data) && saved.hotbar_data.length===10
      ? saved.hotbar_data.map(Number)
      : [T.DIRT,T.STONE,T.WOOD,I.TORCH,I.WOOD_PICK,I.STONE_PICK,I.WOOD_SWORD,I.COOKED_MEAT,T.CHEST,T.BED],
    spawnX:saved?.spawn_x ?? room.spawn.x,spawnY:saved?.spawn_y ?? room.spawn.y,
    lastChatAt:0,lastPersisted:Date.now(),attackCd:0,sleeping:false
  };
  room.players[socket.id]=p;
  socket.join(room.code);

  socket.emit('roomJoined',{
    room:room.code,world:room.world,surface:room.surface,players:publicPlayers(room),
    ownerName:room.ownerName,settings:room.settings,worldSpawn:room.spawn,
    drops:room.drops,mobs:room.mobs,chests:room.chests,furnaces:room.furnaces,beds:room.beds,
    timeOfDay:room.timeOfDay,
    playerState:{
      x:p.x,y:p.y,health:p.health,hunger:p.hunger,inventory:p.inventory,
      toolState:p.toolState,hotbar:p.hotbar,spawnX:p.spawnX,spawnY:p.spawnY
    }
  });

  socket.to(room.code).emit('playerJoined',publicPlayer(p));
  io.to(room.code).emit('chatMessage',{
    playerId:null,name:'Server',message:`${p.name} joined the world.`,time:Date.now(),system:true
  });
  broadcastPlayerList(room);
}

function blockDrop(block){
  if(block===T.TORCH) return I.TORCH;
  return block;
}

function spawnDrop(room,item,qty,x,y,toolDurability=null){
  if(!item||qty<=0) return;
  const id='d'+Math.random().toString(36).slice(2,10);
  const d={id,item:Number(item),qty:Math.floor(qty),x,y,vx:(Math.random()-.5)*55,vy:-60,
    born:Date.now(),toolDurability};
  room.drops[id]=d; room.dirty=true;
  io.to(room.code).emit('dropSpawn',d);
  return d;
}

function spillInventory(room,p,x,y){
  for(const [id,count] of Object.entries(p.inventory||{})){
    let left=Math.floor(Number(count)||0);
    while(left>0){
      const qty=Math.min(left,16);
      const numericId=Number(id);
      const dur=(left===Math.floor(Number(count)||0) && p.toolState && p.toolState[id]!=null) ? p.toolState[id] : null;
      spawnDrop(room,numericId,qty,x+(Math.random()-.5)*20,y-8,dur);
      left-=qty;
    }
  }
}

function emitInventory(p){
  io.to(p.id).emit('inventorySnapshot',{inventory:p.inventory,toolState:p.toolState});
}

function killPlayer(room,p,reason='died'){
  spillInventory(room,p,p.x,p.y);
  p.inventory={};
  p.toolState={};
  p.health=10;p.hunger=8;
  p.x=p.spawnX??room.spawn.x;p.y=p.spawnY??room.spawn.y;
  p.vx=p.vy=0;p.sleeping=false;
  io.to(p.id).emit('playerRespawn',{
    reason,x:p.x,y:p.y,health:p.health,hunger:p.hunger,inventory:p.inventory,toolState:p.toolState
  });
  io.to(room.code).emit('chatMessage',{
    playerId:null,name:'Server',message:`${p.name} ${reason}.`,time:Date.now(),system:true
  });
  io.to(room.code).emit('playerMove',publicPlayer(p));
  room.dirty=true;
}

function mobLoot(room,mob){
  if(mob.type==='pig') spawnDrop(room,I.RAW_MEAT,2,mob.x,mob.y);
  if(mob.type==='cow') spawnDrop(room,I.RAW_MEAT,3,mob.x,mob.y);
  if(mob.type==='sheep'){
    spawnDrop(room,I.RAW_MEAT,1,mob.x,mob.y);
    spawnDrop(room,I.WOOL,1+Math.floor(Math.random()*2),mob.x+8,mob.y);
  }
  if(mob.type==='zombie'){
    if(Math.random()<.45) spawnDrop(room,T.COAL,1,mob.x,mob.y);
  }
  if(mob.type==='slime'){
    if(Math.random()<.35) spawnDrop(room,T.DIRT,1,mob.x,mob.y);
  }
}

function nearestPlayer(room,mob,maxDist=500){
  let best=null,bd=maxDist;
  for(const p of Object.values(room.players)){
    const d=Math.hypot(p.x-mob.x,p.y-mob.y);
    if(d<bd){best=p;bd=d;}
  }
  return best;
}

function isNight(room){
  const sun=Math.sin(room.timeOfDay*Math.PI*2);
  return sun<-.05;
}

function updateMobs(room,dt,now){
  const night=isNight(room);

  // Spawn hostiles at night.
  const hostileCount=Object.values(room.mobs).filter(m=>m.hostile).length;
  if(night && Object.keys(room.players).length && hostileCount<10 && now-room.lastHostileSpawn>2500){
    room.lastHostileSpawn=now;
    const players=Object.values(room.players);
    const target=players[Math.floor(Math.random()*players.length)];
    let x=target.x+(Math.random()<.5?-1:1)*(220+Math.random()*220);
    x=Math.max(TILE*2,Math.min(WORLD_W*TILE-TILE*2,x));
    const type=Math.random()<.65?'zombie':'slime';
    const m=makeHostileMob(room,type,x);
    room.mobs[m.id]=m;room.dirty=true;
  }

  // Despawn remaining hostiles during bright day.
  if(!night){
    for(const [id,m] of Object.entries(room.mobs)){
      if(m.hostile && Math.random()<dt*.04){
        delete room.mobs[id];room.dirty=true;
      }
    }
  }

  for(const m of Object.values(room.mobs)){
    m.hurt=Math.max(0,(m.hurt||0)-dt);
    m.attackCd=Math.max(0,(m.attackCd||0)-dt);

    if(m.hostile){
      const p=nearestPlayer(room,m,650);
      if(p){
        const dx=p.x-m.x;
        m.vx=Math.sign(dx||1)*(m.speed||40);
        if(Math.abs(dx)<26 && Math.abs(p.y-m.y)<38 && m.attackCd<=0){
          m.attackCd=1.1;
          p.health=Math.max(0,p.health-(m.damage||1));
          io.to(p.id).emit('healthUpdate',{health:p.health,source:m.type});
          if(p.health<=0) killPlayer(room,p,'was defeated');
        }
      }else m.vx=0;
    }else{
      m.wander=(m.wander||0)-dt;
      if(m.wander<=0){
        m.wander=1.5+Math.random()*4;
        if(Math.random()<.28)m.vx=0;
        else m.vx=(Math.random()<.5?-1:1)*(10+Math.random()*22);
      }
    }

    const nx=m.x+(m.vx||0)*dt;
    const edge=nx+Math.sign(m.vx||1)*(m.w/2+3);
    const gy=groundY(room,edge);
    const currentGround=groundY(room,m.x);
    if(Math.abs(gy-currentGround)>TILE*1.6){
      m.vx*= -1;
    }else{
      m.x=Math.max(TILE,Math.min(WORLD_W*TILE-TILE,nx));
    }
    m.y=groundY(room,m.x)-m.h/2-1;
  }
}

function updateDrops(room,dt,now){
  for(const [id,d] of Object.entries(room.drops)){
    d.vy=(d.vy||0)+400*dt;
    d.x+=(d.vx||0)*dt;
    d.y+=(d.vy||0)*dt;
    d.vx*=Math.pow(.15,dt);
    const gy=groundY(room,d.x)-4;
    if(d.y>gy){d.y=gy;d.vy=0;}

    if(now-d.born>10*60*1000){
      delete room.drops[id];room.dirty=true;
      io.to(room.code).emit('dropRemove',id);
      continue;
    }

    for(const p of Object.values(room.players)){
      if(Math.hypot(p.x-d.x,p.y-d.y)<28){
        p.inventory[String(d.item)]=(p.inventory[String(d.item)]||0)+d.qty;
        if(d.toolDurability!=null && p.toolState[String(d.item)]==null){
          p.toolState[String(d.item)]=d.toolDurability;
        }
        delete room.drops[id];room.dirty=true;
        io.to(room.code).emit('dropRemove',id);
        emitInventory(p);
        break;
      }
    }
  }
}

const SMELT_RECIPES={
  meat:{input:I.RAW_MEAT,fuel:T.COAL,output:I.COOKED_MEAT,qty:1,duration:6000,name:'Cooked Meat'},
  iron:{input:T.IRON,fuel:T.COAL,output:I.IRON_INGOT,qty:1,duration:8000,name:'Iron Ingot'},
  glass:{input:T.SAND,fuel:T.COAL,output:T.GLASS,qty:1,duration:7000,name:'Glass'}
};

function updateFurnaces(room,now){
  for(const f of Object.values(room.furnaces)){
    if(f.job && !f.job.done && now>=f.job.finishAt){
      const r=SMELT_RECIPES[f.job.recipe];
      f.output[String(r.output)]=(f.output[String(r.output)]||0)+r.qty;
      f.job.done=true;
      f.job=null;
      room.dirty=true;
      io.to(room.code).emit('furnaceUpdate',f);
    }
  }
}

function allPlayersSleeping(room){
  const ps=Object.values(room.players);
  return ps.length>0 && ps.every(p=>p.sleeping);
}

function tick(){
  const now=Date.now(),dt=.1;
  for(const room of rooms.values()){
    room.timeOfDay=(room.timeOfDay+dt/720)%1;
    updateMobs(room,dt,now);
    updateDrops(room,dt,now);
    updateFurnaces(room,now);

    if(allPlayersSleeping(room) && isNight(room)){
      room.timeOfDay=.27;
      for(const p of Object.values(room.players)) p.sleeping=false;
      io.to(room.code).emit('chatMessage',{
        playerId:null,name:'Server',message:'Everyone slept. Morning arrived.',time:now,system:true
      });
    }

    if(now-room.lastMobBroadcast>200){
      room.lastMobBroadcast=now;
      io.to(room.code).emit('mobState',room.mobs);
      io.to(room.code).emit('dropState',room.drops);
    }
    if(now-room.lastTimeBroadcast>1000){
      room.lastTimeBroadcast=now;
      io.to(room.code).emit('worldTime',room.timeOfDay);
    }
  }
}
setInterval(tick,100);

setInterval(async()=>{
  for(const room of rooms.values()){
    try{
      if(room.dirty || Date.now()-room.lastSaved>30000) await saveWorld(room);
      for(const p of Object.values(room.players)){
        if(Date.now()-(p.lastPersisted||0)>10000) await savePlayer(room,p);
      }
    }catch(e){console.error('Autosave:',e);}
  }
},10000);

function chestKey(x,y){return `${x},${y}`;}

io.on('connection',socket=>{
  socket.on('createRoom',async({name}={})=>{
    try{
      const room=await makeRoom(name);
      await joinRoom(socket,room,name);
    }catch(e){console.error(e);socket.emit('roomError','Could not create world.');}
  });

  socket.on('joinRoom',async({room,name}={})=>{
    try{
      const code=String(room||'').trim().toUpperCase();
      const r=await loadRoom(code);
      if(!r){socket.emit('roomError','World not found.');return;}
      await joinRoom(socket,r,name);
    }catch(e){console.error(e);socket.emit('roomError','Could not load world.');}
  });

  socket.on('playerMove',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id]; if(!r||!p)return;
    if(Number.isFinite(Number(data.x)))p.x=Number(data.x);
    if(Number.isFinite(Number(data.y)))p.y=Number(data.y);
    p.vx=Number(data.vx)||0;p.vy=Number(data.vy)||0;p.dir=Number(data.dir)||1;
    socket.to(r.code).emit('playerMove',publicPlayer(p));
  });

  socket.on('playerState',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    if(Number.isFinite(Number(data.x)))p.x=Number(data.x);
    if(Number.isFinite(Number(data.y)))p.y=Number(data.y);
    if(Number.isFinite(Number(data.health)))p.health=Math.max(0,Math.min(10,Number(data.health)));
    if(Number.isFinite(Number(data.hunger)))p.hunger=Math.max(0,Math.min(10,Number(data.hunger)));
    p.inventory=cleanInventory(data.inventory);
    p.toolState=cleanToolState(data.toolState);
    if(Array.isArray(data.hotbar) && data.hotbar.length===10)p.hotbar=data.hotbar.map(x=>Number(x)||0);
    if(Number.isFinite(Number(data.spawnX)))p.spawnX=Number(data.spawnX);
    if(Number.isFinite(Number(data.spawnY)))p.spawnY=Number(data.spawnY);
  });

  socket.on('chatMessage',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    let msg=String(data?.message||'').replace(/[\r\n\t]+/g,' ').trim().slice(0,150);
    if(!msg)return;
    const now=Date.now();if(p.lastChatAt&&now-p.lastChatAt<500)return;p.lastChatAt=now;

    if(msg.startsWith('/')){
      const [cmd,...args]=msg.slice(1).split(/\s+/);
      const c=cmd.toLowerCase();
      if(c==='help'){
        socket.emit('chatMessage',{playerId:null,name:'Server',
          message:'/players /spawn /help; owner: /kick NAME /setspawn /pvp on|off /save',time:now,system:true});
        return;
      }
      if(c==='players'){
        socket.emit('chatMessage',{playerId:null,name:'Server',
          message:'Online: '+Object.values(r.players).map(x=>x.name).join(', '),time:now,system:true});
        return;
      }
      if(c==='spawn'){
        p.x=p.spawnX??r.spawn.x;p.y=p.spawnY??r.spawn.y;
        socket.emit('teleport',{x:p.x,y:p.y});return;
      }
      const owner=p.name===r.ownerName;
      if(!owner){
        socket.emit('chatMessage',{playerId:null,name:'Server',message:'Owner command only.',time:now,system:true});
        return;
      }
      if(c==='kick'){
        const targetName=args.join(' ').toLowerCase();
        const target=Object.values(r.players).find(x=>x.name.toLowerCase()===targetName && x.id!==p.id);
        if(target){io.to(target.id).emit('kicked');setTimeout(()=>io.sockets.sockets.get(target.id)?.disconnect(true),150);}
        return;
      }
      if(c==='setspawn'){
        r.spawn={x:p.x,y:p.y};r.dirty=true;
        io.to(r.code).emit('chatMessage',{playerId:null,name:'Server',message:'World spawn updated.',time:now,system:true});
        return;
      }
      if(c==='pvp'){
        const v=(args[0]||'').toLowerCase();
        if(v==='on'||v==='off'){r.settings.pvp=v==='on';r.dirty=true;io.to(r.code).emit('settingsUpdate',r.settings);}
        return;
      }
      if(c==='save'){
        saveWorld(r).then(()=>socket.emit('chatMessage',{playerId:null,name:'Server',message:'World saved.',time:Date.now(),system:true}));
        return;
      }
      socket.emit('chatMessage',{playerId:null,name:'Server',message:'Unknown command. Try /help.',time:now,system:true});
      return;
    }

    io.to(r.code).emit('chatMessage',{playerId:socket.id,name:p.name,message:msg,time:now,system:false});
  });

  socket.on('mineBlock',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    const x=data?.x|0,y=data?.y|0;
    if(x<0||x>=WORLD_W||y<0||y>=WORLD_H)return;
    const cx=(x+.5)*TILE,cy=(y+.5)*TILE;
    if(Math.hypot(cx-p.x,cy-p.y)>TILE*5.5)return;
    const block=r.world[y][x];if(block===T.AIR||block===T.WATER)return;

    const key=chestKey(x,y);
    if(block===T.CHEST && r.chests[key]){
      for(const [id,n] of Object.entries(r.chests[key].items||{})) spawnDrop(r,Number(id),n,cx,cy);
      delete r.chests[key];
    }
    if(block===T.FURNACE && r.furnaces[key]){
      const f=r.furnaces[key];
      for(const [id,n] of Object.entries(f.output||{})) spawnDrop(r,Number(id),n,cx,cy);
      delete r.furnaces[key];
    }
    if(block===T.BED) delete r.beds[key];

    r.world[y][x]=T.AIR;r.dirty=true;
    spawnDrop(r,blockDrop(block),1,cx,cy);
    io.to(r.code).emit('blockUpdate',{x,y,block:T.AIR});
  });

  socket.on('placeBlock',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    const x=data?.x|0,y=data?.y|0,block=data?.block|0;
    if(x<0||x>=WORLD_W||y<0||y>=WORLD_H)return;
    if(Math.hypot((x+.5)*TILE-p.x,(y+.5)*TILE-p.y)>TILE*5.5)return;
    if(r.world[y][x]!==T.AIR)return;
    const allowed=[T.GRASS,T.DIRT,T.STONE,T.WOOD,T.LEAF,T.SAND,T.CRAFT,T.FURNACE,T.CHEST,T.TORCH,T.SNOW,T.CACTUS,T.GLASS,T.BED];
    if(!allowed.includes(block))return;
    r.world[y][x]=block;r.dirty=true;
    const key=chestKey(x,y);
    if(block===T.CHEST)r.chests[key]={x,y,items:{}};
    if(block===T.FURNACE)r.furnaces[key]={x,y,output:{},job:null};
    if(block===T.BED)r.beds[key]={x,y};
    io.to(r.code).emit('blockUpdate',{x,y,block});
  });

  socket.on('attackMob',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id],m=r?.mobs[data?.mobId];if(!r||!p||!m)return;
    if(Math.hypot(p.x-m.x,p.y-m.y)>TILE*3.4)return;
    const held=Number(data?.heldItem)||0;
    const dmg=held===I.IRON_SWORD?5:held===I.STONE_SWORD?4:held===I.WOOD_SWORD?3:1;
    m.hp-=dmg;m.hurt=.2;
    if([I.WOOD_SWORD,I.STONE_SWORD,I.IRON_SWORD].includes(held)) socket.emit('toolDamage',{item:held,amount:1});
    if(m.hp<=0){mobLoot(r,m);delete r.mobs[m.id];r.dirty=true;}
  });

  socket.on('attackPlayer',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id],t=r?.players[data?.targetId];if(!r||!p||!t||!r.settings.pvp)return;
    if(Math.hypot(p.x-t.x,p.y-t.y)>TILE*3.2)return;
    const held=Number(data?.heldItem)||0;
    const dmg=held===I.IRON_SWORD?4:held===I.STONE_SWORD?3:held===I.WOOD_SWORD?2:1;
    t.health=Math.max(0,t.health-dmg);io.to(t.id).emit('healthUpdate',{health:t.health,source:p.name});
    if(t.health<=0)killPlayer(r,t,'was defeated by '+p.name);
  });

  socket.on('playerDied',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(r&&p)killPlayer(r,p,'died');
  });

  socket.on('openChest',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    const key=chestKey(data.x|0,data.y|0),c=r.chests[key];if(!c)return;
    if(Math.hypot((c.x+.5)*TILE-p.x,(c.y+.5)*TILE-p.y)>TILE*5)return;
    socket.emit('chestOpen',c);
  });

  socket.on('chestTransfer',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    p.inventory=cleanInventory(data.inventory);
    const key=chestKey(data.x|0,data.y|0),c=r.chests[key];if(!c)return;
    const id=String(Number(data.item)||0),dir=data.direction;
    if(dir==='deposit' && (p.inventory[id]||0)>0){
      p.inventory[id]--;c.items[id]=(c.items[id]||0)+1;
    }else if(dir==='withdraw' && (c.items[id]||0)>0){
      c.items[id]--;p.inventory[id]=(p.inventory[id]||0)+1;
    }
    if(c.items[id]===0)delete c.items[id];
    if(p.inventory[id]===0)delete p.inventory[id];
    r.dirty=true;emitInventory(p);
    io.to(r.code).emit('chestUpdate',c);
  });

  socket.on('openFurnace',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    const f=r.furnaces[chestKey(data.x|0,data.y|0)];if(f)socket.emit('furnaceOpen',f);
  });

  socket.on('startSmelt',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    p.inventory=cleanInventory(data.inventory);
    const f=r.furnaces[chestKey(data.x|0,data.y|0)],recipe=SMELT_RECIPES[data.recipe];
    if(!f||!recipe||f.job)return;
    const input=String(recipe.input),fuel=String(recipe.fuel);
    if((p.inventory[input]||0)<1||(p.inventory[fuel]||0)<1){socket.emit('furnaceMessage','Need input + coal.');return;}
    p.inventory[input]--;p.inventory[fuel]--;
    if(!p.inventory[input])delete p.inventory[input];if(!p.inventory[fuel])delete p.inventory[fuel];
    f.job={recipe:data.recipe,startedAt:Date.now(),finishAt:Date.now()+recipe.duration};
    r.dirty=true;emitInventory(p);io.to(r.code).emit('furnaceUpdate',f);
  });

  socket.on('collectFurnace',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    const f=r.furnaces[chestKey(data.x|0,data.y|0)];if(!f)return;
    for(const [id,n] of Object.entries(f.output||{}))p.inventory[id]=(p.inventory[id]||0)+n;
    f.output={};r.dirty=true;emitInventory(p);io.to(r.code).emit('furnaceUpdate',f);
  });

  socket.on('useBed',data=>{
    const r=rooms.get(String(data?.room||'').toUpperCase());
    const p=r?.players[socket.id];if(!r||!p)return;
    const b=r.beds[chestKey(data.x|0,data.y|0)];if(!b)return;
    if(Math.hypot((b.x+.5)*TILE-p.x,(b.y+.5)*TILE-p.y)>TILE*5)return;
    p.spawnX=(b.x+.5)*TILE;p.spawnY=(b.y-1)*TILE;p.sleeping=isNight(r);
    socket.emit('spawnPointSet',{x:p.spawnX,y:p.spawnY});
    io.to(r.code).emit('chatMessage',{playerId:null,name:'Server',
      message:p.sleeping?`${p.name} is sleeping.`:`${p.name}'s respawn point was set.`,
      time:Date.now(),system:true});
  });

  socket.on('disconnect',async()=>{
    for(const [code,r] of rooms){
      const p=r.players[socket.id];if(!p)continue;
      const name=p.name;
      try{await savePlayer(r,p);}catch(e){console.error(e);}
      delete r.players[socket.id];
      socket.to(code).emit('playerLeft',socket.id);
      io.to(code).emit('chatMessage',{playerId:null,name:'Server',message:`${name} left the world.`,time:Date.now(),system:true});
      broadcastPlayerList(r);
      if(!Object.keys(r.players).length){
        try{await saveWorld(r);rooms.delete(code);console.log(`Saved/unloaded ${code}`);}catch(e){console.error(e);}
      }
    }
  });
});

async function shutdown(sig){
  console.log(sig,'saving...');
  try{
    for(const r of rooms.values()){
      await saveWorld(r);
      for(const p of Object.values(r.players))await savePlayer(r,p);
    }
  }catch(e){console.error(e);}
  if(db)try{await db.end();}catch{}
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(0),5000).unref();
}
process.on('SIGTERM',()=>shutdown('SIGTERM'));
process.on('SIGINT',()=>shutdown('SIGINT'));

initDatabase().then(()=>{
  server.listen(PORT,()=>console.log(`PixelCraft on port ${PORT} | persistence ${hasDatabase?'ON':'OFF'}`));
}).catch(e=>{console.error('DB init failed',e);process.exit(1);});
