const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 2e6 });

app.get("/", (_,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.get("/index.html", (_,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.get("/client.js", (_,res)=>res.sendFile(path.join(__dirname,"client.js")));
app.get("/style.css", (_,res)=>res.sendFile(path.join(__dirname,"style.css")));
app.use("/assets", express.static(path.join(__dirname,"assets")));
app.get("/health", (_,res)=>res.json({ok:true,players:io.engine.clientsCount}));

const DATA_DIR = process.env.DATA_DIR || __dirname;
const SAVE = path.join(DATA_DIR,"world.json");
fs.mkdirSync(DATA_DIR,{recursive:true});

const BLOCKS = [
  "grass","dirt","stone","cobble","sand","wood","leaves","plank","glass",
  "coal_ore","iron_ore","gold_ore","diamond_ore","water","lava","farmland","wheat",
  "torch","crafting_table","furnace","chest","rail","powered_rail","wire","lamp",
  "portal","obsidian","snow","ice","brick",
  "door","door_open","fence","stairs","slab","ladder"
];
const PLACEABLE = new Set(BLOCKS.filter(x=>x!=="door_open"));
const DIMENSIONS = ["overworld","ember","void"];
const WORLD_CHUNK_SIZE=16;
const SERVER_GEN_RADIUS=3;
const k=(x,y,z)=>`${x},${y},${z}`;

const TOOL_MAX = {
  wood_pickaxe:60, stone_pickaxe:132, iron_pickaxe:251,
  wood_axe:60, stone_axe:132, iron_axe:251,
  wood_shovel:60, stone_shovel:132, iron_shovel:251,
  wood_hoe:60, stone_hoe:132, iron_hoe:251,
  wood_sword:60, stone_sword:132, iron_sword:251,
  bow:384
};
const ARMOR_VALUE = {
  leather_helmet:1, leather_chest:3, leather_legs:2, leather_boots:1,
  iron_helmet:2, iron_chest:6, iron_legs:5, iron_boots:2
};

const RECIPES = {
  plank:{pattern:["wood"],give:{plank:4}},
  crafting_table:{pattern:["plank","plank","plank","plank"],give:{crafting_table:1}},
  chest:{pattern:["plank","plank","plank","plank","plank","plank","plank","plank"],give:{chest:1}},
  furnace:{pattern:["cobble","cobble","cobble","cobble","cobble","cobble","cobble","cobble"],give:{furnace:1}},
  torch:{pattern:["coal","stick"],give:{torch:4}},
  stick:{pattern:["plank","plank"],give:{stick:4}},
  wood_pickaxe:{pattern:["plank","plank","plank","stick","stick"],give:{wood_pickaxe:1}},
  stone_pickaxe:{pattern:["cobble","cobble","cobble","stick","stick"],give:{stone_pickaxe:1}},
  iron_pickaxe:{pattern:["iron_ingot","iron_ingot","iron_ingot","stick","stick"],give:{iron_pickaxe:1}},
  wood_axe:{pattern:["plank","plank","plank","stick","stick"],give:{wood_axe:1}},
  stone_axe:{pattern:["cobble","cobble","cobble","stick","stick"],give:{stone_axe:1}},
  iron_axe:{pattern:["iron_ingot","iron_ingot","iron_ingot","stick","stick"],give:{iron_axe:1}},
  wood_shovel:{pattern:["plank","stick","stick"],give:{wood_shovel:1}},
  stone_shovel:{pattern:["cobble","stick","stick"],give:{stone_shovel:1}},
  iron_shovel:{pattern:["iron_ingot","stick","stick"],give:{iron_shovel:1}},
  wood_hoe:{pattern:["plank","plank","stick","stick"],give:{wood_hoe:1}},
  stone_hoe:{pattern:["cobble","cobble","stick","stick"],give:{stone_hoe:1}},
  iron_hoe:{pattern:["iron_ingot","iron_ingot","stick","stick"],give:{iron_hoe:1}},
  wood_sword:{pattern:["plank","plank","stick"],give:{wood_sword:1}},
  stone_sword:{pattern:["cobble","cobble","stick"],give:{stone_sword:1}},
  iron_sword:{pattern:["iron_ingot","iron_ingot","stick"],give:{iron_sword:1}},
  bow:{pattern:["stick","stick","stick","string","string","string"],give:{bow:1}},
  arrow:{pattern:["flint","stick","feather"],give:{arrow:4}},
  door:{pattern:["plank","plank","plank","plank","plank","plank"],give:{door:3}},
  fence:{pattern:["plank","stick","plank","plank","stick","plank"],give:{fence:3}},
  stairs:{pattern:["plank","plank","plank","plank","plank","plank"],give:{stairs:4}},
  slab:{pattern:["plank","plank","plank"],give:{slab:6}},
  ladder:{pattern:["stick","stick","stick","stick","stick","stick","stick"],give:{ladder:3}},
  leather_helmet:{pattern:["leather","leather","leather","leather","leather"],give:{leather_helmet:1}},
  leather_chest:{pattern:Array(8).fill("leather"),give:{leather_chest:1}},
  leather_legs:{pattern:Array(7).fill("leather"),give:{leather_legs:1}},
  leather_boots:{pattern:Array(4).fill("leather"),give:{leather_boots:1}},
  iron_helmet:{pattern:Array(5).fill("iron_ingot"),give:{iron_helmet:1}},
  iron_chest:{pattern:Array(8).fill("iron_ingot"),give:{iron_chest:1}},
  iron_legs:{pattern:Array(7).fill("iron_ingot"),give:{iron_legs:1}},
  iron_boots:{pattern:Array(4).fill("iron_ingot"),give:{iron_boots:1}},
  healing_potion:{pattern:["glass","apple"],give:{healing_potion:1}}
};

function noise(x,z,s=0){
  return Math.sin((x+s)*.13)*2.2 + Math.cos((z-s)*.11)*1.9 + Math.sin((x+z+s)*.055)*1.5;
}
function biomeAt(x,z,seed){
  const v=Math.sin((x+seed)*.045)+Math.cos((z-seed)*.038);
  if(v>1.05)return "snow";
  if(v<-.9)return "desert";
  if(Math.sin((x-z+seed)*.07)>.55)return "forest";
  if(Math.cos((x+z)*.04)>.72)return "mountains";
  return "plains";
}
function defaultPlayer(name){
  return {
    name, dimension:"overworld", pos:[0,8,0], yaw:0,pitch:0,
    health:20,hunger:20,saturation:5,armor:0,xp:0,level:0,
    inventory:{grass:20,dirt:20,cobble:10,wood:8,apple:3,torch:4,stick:4},
    hotbar:["grass","dirt","cobble","wood","torch","wood_pickaxe","wood_sword","bow","apple"],
    equipment:{head:null,chest:null,legs:null,feet:null},
    durability:{wood_pickaxe:60,wood_sword:60,bow:384},
    effects:[], achievements:[], spawn:{dimension:"overworld",pos:[0,8,0]},
    deaths:0
  };
}
function newState(){
  return {
    version:5, seed:Math.floor(Math.random()*999999),
    dimensions:{
      overworld:{blocks:{},time:.22,weather:"clear"},
      ember:{blocks:{},time:.65,weather:"ash"},
      void:{blocks:{},time:.82,weather:"clear"}
    },
    players:{}, containers:{}, furnaces:{}, crops:{}, entities:{},
    structuresGenerated:{}, automation:{}, achievementsGlobal:[], generatedChunks:{}
  };
}
let state = newState();
try{ if(fs.existsSync(SAVE)) state=JSON.parse(fs.readFileSync(SAVE,"utf8")); }catch(e){console.error("save load",e)}
state.version=5;
state.players ||= {}; state.containers ||= {}; state.furnaces ||= {}; state.crops ||= {}; state.entities ||= {};
state.structuresGenerated ||= {}; state.automation ||= {}; state.generatedChunks ||= {};
state.dimensions ||= newState().dimensions;
for(const dim of DIMENSIONS) state.dimensions[dim] ||= {blocks:{},time:.2,weather:"clear"};

function migratePlayer(p,name){
  Object.assign(p,{name:name||p.name});
  p.inventory ||= {}; p.hotbar ||= ["grass","dirt","cobble","wood","torch","wood_pickaxe","wood_sword","bow","apple"];
  p.equipment ||= {head:null,chest:null,legs:null,feet:null};
  p.durability ||= {};
  p.effects ||= []; p.achievements ||= [];
  p.health=Number.isFinite(p.health)?p.health:20; p.hunger=Number.isFinite(p.hunger)?p.hunger:20;
  p.saturation=Number.isFinite(p.saturation)?p.saturation:5; p.xp ||= 0;p.level ||= 0;p.deaths ||= 0;
  p.dimension ||= "overworld"; p.pos ||= [0,8,0]; p.spawn ||= {dimension:"overworld",pos:[0,8,0]};
  for(const item of Object.keys(p.inventory)) if(TOOL_MAX[item] && p.durability[item]==null)p.durability[item]=TOOL_MAX[item];
  return p;
}
for(const [n,p] of Object.entries(state.players))migratePlayer(p,n);

function setBlock(dim,x,y,z,type){
  const b=state.dimensions[dim].blocks,kk=k(x,y,z);
  if(type==null){
    if(b[kk]!=null){delete b[kk];if(typeof unindexServerBlock==="function")unindexServerBlock(dim,kk)}
  }else{
    const fresh=b[kk]==null;b[kk]=type;
    if(fresh&&typeof indexServerBlock==="function")indexServerBlock(dim,kk);
  }
}
function getBlock(dim,x,y,z){return state.dimensions[dim].blocks[k(x,y,z)]||null}
function terrainHeight(dim,x,z){
  for(let y=30;y>-12;y--)if(getBlock(dim,x,y,z))return y;
  return 0;
}


function floorDiv(n,d){return Math.floor(n/d)}
function worldChunkKey(cx,cz){return `${cx},${cz}`}
const serverChunkBlocks=new Map();
function serverIndexKey(dim,x,z){return `${dim}:${worldChunkKey(floorDiv(x,WORLD_CHUNK_SIZE),floorDiv(z,WORLD_CHUNK_SIZE))}`}
function indexServerBlock(dim,kk){
  const [x,,z]=kk.split(",").map(Number),ck=serverIndexKey(dim,x,z);
  if(!serverChunkBlocks.has(ck))serverChunkBlocks.set(ck,new Set());
  serverChunkBlocks.get(ck).add(kk);
}
function unindexServerBlock(dim,kk){
  const [x,,z]=kk.split(",").map(Number),ck=serverIndexKey(dim,x,z),s=serverChunkBlocks.get(ck);
  if(!s)return;s.delete(kk);if(!s.size)serverChunkBlocks.delete(ck);
}
function rebuildServerChunkIndex(){
  serverChunkBlocks.clear();
  for(const dim of DIMENSIONS)for(const kk of Object.keys(state.dimensions[dim].blocks||{}))indexServerBlock(dim,kk);
}
function chunkCoordsForPos(x,z){return [floorDiv(Math.floor(x),WORLD_CHUNK_SIZE),floorDiv(Math.floor(z),WORLD_CHUNK_SIZE)]}
function markExistingChunksGenerated(){
  for(const dim of DIMENSIONS){
    for(const kk of Object.keys(state.dimensions[dim].blocks||{})){
      const [x,,z]=kk.split(",").map(Number);
      state.generatedChunks[`${dim}:${worldChunkKey(floorDiv(x,WORLD_CHUNK_SIZE),floorDiv(z,WORLD_CHUNK_SIZE))}`]=true;
    }
  }
}
markExistingChunksGenerated();
function generateOverworldChunk(cx,cz){
  const marker=`overworld:${worldChunkKey(cx,cz)}`;if(state.generatedChunks[marker])return;
  const seed=state.seed%1000,minX=cx*WORLD_CHUNK_SIZE,minZ=cz*WORLD_CHUNK_SIZE;
  for(let lx=0;lx<WORLD_CHUNK_SIZE;lx++)for(let lz=0;lz<WORLD_CHUNK_SIZE;lz++){
    const x=minX+lx,z=minZ+lz,biome=biomeAt(x,z,seed);let h=Math.floor(3+noise(x,z,seed));
    if(biome==="mountains")h+=Math.floor(Math.max(0,noise(x*.8,z*.8,seed))*1.5)+2;if(biome==="desert")h=Math.min(h,4);
    for(let y=-5;y<=h;y++){
      const cave=y<h-2&&y>-4&&(Math.sin(x*.44+y*.72+z*.39)+Math.cos(x*.19-y*.63+z*.51)>1.48);if(cave)continue;
      let type="stone";
      if(y===h)type=biome==="desert"?"sand":biome==="snow"?"snow":"grass";else if(y>=h-2)type=biome==="desert"?"sand":"dirt";else{
        const ore=Math.abs(Math.sin(x*12.9898+z*78.233+y*37.719+seed));
        if(y<-1&&ore>.988)type="diamond_ore";else if(y<2&&ore>.96)type="gold_ore";else if(ore>.91)type="iron_ore";else if(ore>.83)type="coal_ore";
      }setBlock("overworld",x,y,z,type);
    }
    const tree=Math.abs(Math.sin(x*91.17+z*47.73+seed*.13)),canTree=lx>=2&&lx<=13&&lz>=2&&lz<=13;
    if(canTree&&((biome==="forest"&&tree>.92)||(biome==="plains"&&tree>.985))){
      const trunk=3+(Math.abs(Math.floor(Math.sin(x+z+seed)*1000))%2);for(let y=1;y<=trunk;y++)setBlock("overworld",x,h+y,z,"wood");
      for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=trunk-1;dy<=trunk+1;dy++)if(Math.abs(dx)+Math.abs(dz)<4)setBlock("overworld",x+dx,h+dy,z+dz,"leaves");
    }
  }state.generatedChunks[marker]=true;
}
function generateOtherChunk(dim,cx,cz){
  const marker=`${dim}:${worldChunkKey(cx,cz)}`;if(state.generatedChunks[marker])return;const minX=cx*WORLD_CHUNK_SIZE,minZ=cz*WORLD_CHUNK_SIZE;
  for(let lx=0;lx<WORLD_CHUNK_SIZE;lx++)for(let lz=0;lz<WORLD_CHUNK_SIZE;lz++){
    const x=minX+lx,z=minZ+lz;if(dim==="ember"){
      const h=Math.floor(1+noise(x,z,55)*.6);for(let y=-4;y<=h;y++)setBlock(dim,x,y,z,y===h?"brick":"stone");if(Math.abs(Math.sin(x*7.1+z*2.3))>.985)setBlock(dim,x,h+1,z,"lava");
    }else if(noise(x,z,99)>-.35){const h=Math.floor(noise(x,z,99)*.25);for(let y=-2;y<=h;y++)setBlock(dim,x,y,z,y===h?"obsidian":"stone");}
  }state.generatedChunks[marker]=true;
}
function ensureWorldChunk(dim,cx,cz){if(dim==="overworld")generateOverworldChunk(cx,cz);else generateOtherChunk(dim,cx,cz)}
function ensureChunksAround(dim,x,z,r=SERVER_GEN_RADIUS){const [cx,cz]=chunkCoordsForPos(x,z);for(let dz=-r;dz<=r;dz++)for(let dx=-r;dx<=r;dx++)ensureWorldChunk(dim,cx+dx,cz+dz)}
function chunkPayload(dim,cx,cz){
  ensureWorldChunk(dim,cx,cz);
  const out={},set=serverChunkBlocks.get(`${dim}:${worldChunkKey(cx,cz)}`);
  if(set)for(const kk of set){const type=state.dimensions[dim].blocks[kk];if(type)out[kk]=type}
  return {dimension:dim,cx,cz,blocks:out};
}
function initialDimensionPayload(dim,x,z){
  ensureChunksAround(dim,x,z,SERVER_GEN_RADIUS);const [pcx,pcz]=chunkCoordsForPos(x,z),blocks={};
  for(let dz=-SERVER_GEN_RADIUS;dz<=SERVER_GEN_RADIUS;dz++)for(let dx=-SERVER_GEN_RADIUS;dx<=SERVER_GEN_RADIUS;dx++)Object.assign(blocks,chunkPayload(dim,pcx+dx,pcz+dz).blocks);
  return {blocks,time:state.dimensions[dim].time,weather:state.dimensions[dim].weather};
}
function generateDimension(dim){
  if(Object.keys(state.dimensions[dim].blocks).length)return;
  ensureChunksAround(dim,0,0,2);
}
DIMENSIONS.forEach(generateDimension);

function entity(type,data={}){
  const id="e"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  state.entities[id]={id,type,...data};
  return state.entities[id];
}
function generateStructures(){
  if(state.structuresGenerated.survivalV5)return;
  const dim="overworld";
  const sites=[[-24,-18],[24,18],[24,-22]];
  for(const [cx,cz] of sites){
    const ground=terrainHeight(dim,cx,cz)+1;
    // Small village house
    for(let x=cx-3;x<=cx+3;x++)for(let z=cz-3;z<=cz+3;z++)setBlock(dim,x,ground-1,z,"plank");
    for(let y=ground;y<=ground+3;y++){
      for(let x=cx-3;x<=cx+3;x++){setBlock(dim,x,y,cz-3,"wood");setBlock(dim,x,y,cz+3,"wood")}
      for(let z=cz-3;z<=cz+3;z++){setBlock(dim,cx-3,y,z,"wood");setBlock(dim,cx+3,y,z,"wood")}
    }
    setBlock(dim,cx,ground,cz-3,"door"); setBlock(dim,cx,ground+1,cz-3,null);
    for(let x=cx-4;x<=cx+4;x++)for(let z=cz-4;z<=cz+4;z++)setBlock(dim,x,ground+4,z,"stairs");
    setBlock(dim,cx+2,ground,cz,"chest");
    state.containers[`${dim}:${k(cx+2,ground,cz)}`]={slots:{apple:2,seed:6,coal:4}};
    entity("villager",{dimension:dim,pos:[cx,ground+1,cz],health:20,profession:"farmer",ai:"village"});
    // Farm
    for(let x=cx-6;x<=cx-4;x++)for(let z=cz-2;z<=cz+2;z++){
      setBlock(dim,x,ground-1,z,"farmland");
      if(Math.random()<.65){setBlock(dim,x,ground,z,"wheat");state.crops[`${dim}:${k(x,ground,z)}`]={stage:Math.floor(Math.random()*8)}}
    }
  }
  // A simple abandoned mineshaft
  const mx=-5,mz=26,gy=terrainHeight(dim,mx,mz)-4;
  for(let z=mz-8;z<=mz+8;z++){
    for(let x=mx-2;x<=mx+2;x++)for(let y=gy;y<=gy+3;y++)setBlock(dim,x,y,z,null);
    if((z-mz)%4===0){
      setBlock(dim,mx-2,gy,z,"fence");setBlock(dim,mx+2,gy,z,"fence");
      setBlock(dim,mx-2,gy+2,z,"wood");setBlock(dim,mx+2,gy+2,z,"wood");
    }
    setBlock(dim,mx,gy,z,"rail");
  }
  state.structuresGenerated.survivalV5=true;
}
generateStructures();

function addItem(p,item,count=1){
  p.inventory[item]=(p.inventory[item]||0)+count;
  if(TOOL_MAX[item]&&p.durability[item]==null)p.durability[item]=TOOL_MAX[item];
}
function takeItem(p,item,count=1){
  if((p.inventory[item]||0)<count)return false;
  p.inventory[item]-=count;if(p.inventory[item]<=0){delete p.inventory[item];if(TOOL_MAX[item])delete p.durability[item]}
  return true;
}
function useDurability(p,item,amount=1){
  if(!TOOL_MAX[item]||!(p.inventory[item]>0))return;
  p.durability[item]=(p.durability[item]??TOOL_MAX[item])-amount;
  if(p.durability[item]<=0){
    takeItem(p,item,1);
    if(p.inventory[item]>0)p.durability[item]=TOOL_MAX[item];
  }
}
function recomputeArmor(p){
  p.armor=Object.values(p.equipment).reduce((s,i)=>s+(ARMOR_VALUE[i]||0),0);
}
function damagePlayer(p,amount){
  const reduction=Math.min(.72,(p.armor||0)*.04);
  p.health=Math.max(0,p.health-amount*(1-reduction));
}
function dropInventory(p){
  for(const [item,count] of Object.entries(p.inventory)){
    if(count<=0)continue;
    const stacks=Math.min(12,Math.ceil(count/16));
    let remain=count;
    for(let i=0;i<stacks;i++){
      const c=Math.min(16,remain);remain-=c;
      entity("drop",{dimension:p.dimension,pos:[p.pos[0]+(Math.random()-.5)*1.6,p.pos[1],p.pos[2]+(Math.random()-.5)*1.6],item,count:c,age:0});
    }
  }
  p.inventory={};p.durability={};p.hotbar=Array(9).fill(null);
  for(const [slot,item] of Object.entries(p.equipment)){if(item)entity("drop",{dimension:p.dimension,pos:[...p.pos],item,count:1,age:0});p.equipment[slot]=null}
  recomputeArmor(p);
}
function respawnPlayer(p){
  p.deaths=(p.deaths||0)+1;dropInventory(p);
  p.dimension=p.spawn?.dimension||"overworld";p.pos=[...(p.spawn?.pos||[0,8,0])];
  p.health=20;p.hunger=20;p.saturation=5;p.effects=[];
}
function blockDrop(type,tool){
  if(type==="stone")return "cobble";
  if(type==="coal_ore")return tool?.includes("pickaxe")?"coal":null;
  if(type==="iron_ore")return tool?.includes("pickaxe")?"iron_ore":null;
  if(type==="gold_ore")return tool?.includes("pickaxe")?"gold_ore":null;
  if(type==="diamond_ore")return tool?.includes("iron_pickaxe")?"diamond":null;
  if(type==="leaves"){
    const r=Math.random();return r<.12?"seed":r<.16?"apple":null;
  }
  if(type==="wheat")return null;
  if(type==="door_open")return "door";
  return type;
}
function toolSuitable(type,tool=""){
  if(["stone","cobble","coal_ore","iron_ore","gold_ore","diamond_ore","obsidian","furnace"].includes(type))return tool.includes("pickaxe");
  if(["wood","plank","crafting_table","chest","door","door_open","fence","stairs","slab"].includes(type))return tool.includes("axe");
  if(["dirt","grass","sand","snow","farmland"].includes(type))return tool.includes("shovel");
  return true;
}
function recipeMatch(items,pattern){
  const a=items.filter(Boolean).sort(),b=[...pattern].sort();
  return a.length===b.length&&a.every((v,i)=>v===b[i]);
}
function craftRecipe(p,id,grid=null){
  const r=RECIPES[id];if(!r)return false;
  const items=grid?grid.filter(Boolean):r.pattern;
  if(grid&&!recipeMatch(items,r.pattern))return false;
  const counts={};for(const i of r.pattern)counts[i]=(counts[i]||0)+1;
  for(const [i,c] of Object.entries(counts))if((p.inventory[i]||0)<c)return false;
  for(const [i,c] of Object.entries(counts))takeItem(p,i,c);
  for(const [i,c] of Object.entries(r.give))addItem(p,i,c);
  return true;
}

function save(){try{fs.writeFileSync(SAVE,JSON.stringify(state))}catch(e){console.error("save",e)}}
setInterval(save,20000);
process.on("SIGTERM",()=>{save();process.exit(0)});process.on("SIGINT",()=>{save();process.exit(0)});

rebuildServerChunkIndex();
const online=new Map();
const containerWatchers=new Map();
function publicPlayer(p,id){return{id,name:p.name,dimension:p.dimension,pos:p.pos,yaw:p.yaw,pitch:p.pitch,equipment:p.equipment,health:p.health,armor:p.armor}}
function broadcastContainer(id,kind,data){
  const watchers=containerWatchers.get(id);if(!watchers)return;
  for(const sid of watchers)io.to(sid).emit("containerData",{kind,id,data});
}
function sendState(socket,p){socket.emit("playerState",p)}

io.on("connection",socket=>{
  socket.on("join",({username})=>{
    username=String(username||"").trim().replace(/[^\w\-]/g,"").slice(0,16);
    if(username.length<2)return socket.emit("joinError","Use at least 2 letters/numbers.");
    if([...online.values()].includes(username))return socket.emit("joinError","That username is already online.");
    if(!state.players[username])state.players[username]=defaultPlayer(username);
    const p=migratePlayer(state.players[username],username);recomputeArmor(p);
    ensureChunksAround(p.dimension,p.pos[0],p.pos[2]);p._chunk=chunkCoordsForPos(p.pos[0],p.pos[2]);
    online.set(socket.id,username);socket.join(p.dimension);
    const partialDimensions={};for(const dim of DIMENSIONS)partialDimensions[dim]=dim===p.dimension?initialDimensionPayload(dim,p.pos[0],p.pos[2]):{blocks:{},time:state.dimensions[dim].time,weather:state.dimensions[dim].weather};
    socket.emit("init",{self:p,dimensions:partialDimensions,entities:state.entities,containers:state.containers,furnaces:state.furnaces,crops:state.crops,automation:state.automation,
      players:[...online.entries()].filter(([id])=>id!==socket.id).map(([id,n])=>publicPlayer(state.players[n],id))});
    socket.to(p.dimension).emit("playerJoin",publicPlayer(p,socket.id));
    io.to(p.dimension).emit("systemChat",`${username} joined the world`);
  });

  socket.on("chunkRequest",({dimension,cx,cz})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];if(dimension!==p.dimension||!Number.isInteger(cx)||!Number.isInteger(cz))return;
    const [pcx,pcz]=chunkCoordsForPos(p.pos[0],p.pos[2]);if(Math.abs(cx-pcx)>6||Math.abs(cz-pcz)>6)return;socket.emit("chunkData",chunkPayload(dimension,cx,cz));
  });

  socket.on("move",d=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!Array.isArray(d.pos)||d.pos.length!==3||d.pos.some(v=>!Number.isFinite(v)))return;
    p.pos=[d.pos[0],Math.max(-40,Math.min(80,d.pos[1])),d.pos[2]];p.yaw=+d.yaw||0;p.pitch=+d.pitch||0;
    const nc=chunkCoordsForPos(p.pos[0],p.pos[2]);if(!p._chunk||p._chunk[0]!==nc[0]||p._chunk[1]!==nc[1]){p._chunk=nc;ensureChunksAround(p.dimension,p.pos[0],p.pos[2]);}
    socket.to(p.dimension).volatile.emit("playerMove",{id:socket.id,pos:p.pos,yaw:p.yaw,pitch:p.pitch});
  });
  socket.on("chat",text=>{
    const n=online.get(socket.id);if(!n)return;text=String(text||"").trim().slice(0,120);if(!text)return;
    const p=state.players[n];io.to(p.dimension).emit("chat",{id:socket.id,name:n,text});
  });

  socket.on("block",d=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    const {x,y,z}=d;if(![x,y,z].every(Number.isInteger)||y<-20||y>45)return;
    if(d.action==="break"){
      const t=getBlock(p.dimension,x,y,z);if(!t)return;
      const tool=String(d.tool||"");
      if(t==="wheat"){
        const cid=`${p.dimension}:${k(x,y,z)}`,crop=state.crops[cid],stage=crop?.stage??0;
        setBlock(p.dimension,x,y,z,null);delete state.crops[cid];
        if(stage>=7){entity("drop",{dimension:p.dimension,pos:[x,y+.2,z],item:"wheat_item",count:1,age:0});entity("drop",{dimension:p.dimension,pos:[x,y+.2,z],item:"seed",count:1+Math.floor(Math.random()*2),age:0})}
        else entity("drop",{dimension:p.dimension,pos:[x,y+.2,z],item:"seed",count:1,age:0});
        io.to(p.dimension).emit("blockUpdate",{x,y,z,type:null,oldType:t});io.to(p.dimension).emit("entitySync",state.entities);return;
      }
      setBlock(p.dimension,x,y,z,null);
      const drop=blockDrop(t,tool);
      if(drop)entity("drop",{dimension:p.dimension,pos:[x,y+.2,z],item:drop,count:1,age:0});
      if(toolSuitable(t,tool))useDurability(p,tool,1); else if(TOOL_MAX[tool])useDurability(p,tool,2);
      io.to(p.dimension).emit("blockUpdate",{x,y,z,type:null,oldType:t});
      io.to(p.dimension).emit("entitySync",state.entities);sendState(socket,p);
    } else if(d.action==="place"&&PLACEABLE.has(d.type)){
      if(getBlock(p.dimension,x,y,z)||!takeItem(p,d.type,1))return;
      setBlock(p.dimension,x,y,z,d.type);
      io.to(p.dimension).emit("blockUpdate",{x,y,z,type:d.type});sendState(socket,p);
    }
  });

  socket.on("useBlock",({x,y,z})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],t=getBlock(p.dimension,x,y,z);
    if(t==="door"){setBlock(p.dimension,x,y,z,"door_open");io.to(p.dimension).emit("blockUpdate",{x,y,z,type:"door_open"})}
    else if(t==="door_open"){setBlock(p.dimension,x,y,z,"door");io.to(p.dimension).emit("blockUpdate",{x,y,z,type:"door"})}
  });

  socket.on("till",({x,y,z,tool})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],t=getBlock(p.dimension,x,y,z);
    if(!["grass","dirt"].includes(t)||!String(tool||"").includes("hoe"))return;
    setBlock(p.dimension,x,y,z,"farmland");useDurability(p,tool,1);
    io.to(p.dimension).emit("blockUpdate",{x,y,z,type:"farmland"});sendState(socket,p);
  });

  socket.on("plant",({x,y,z})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(getBlock(p.dimension,x,y,z)!=="farmland"||getBlock(p.dimension,x,y+1,z)||!takeItem(p,"seed",1))return;
    setBlock(p.dimension,x,y+1,z,"wheat");state.crops[`${p.dimension}:${k(x,y+1,z)}`]={stage:0};
    io.to(p.dimension).emit("blockUpdate",{x,y:y+1,z,type:"wheat"});sendState(socket,p);
  });

  socket.on("dropItem",({item,count=1})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];count=Math.max(1,Math.min(64,Math.floor(count)));
    if(!takeItem(p,item,count))return;
    entity("drop",{dimension:p.dimension,pos:[p.pos[0],p.pos[1],p.pos[2]],item,count,age:0});
    io.to(p.dimension).emit("entitySync",state.entities);sendState(socket,p);
  });
  socket.on("pickup",({id})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],e=state.entities[id];
    if(!e||e.type!=="drop"||e.dimension!==p.dimension)return;
    const dx=e.pos[0]-p.pos[0],dy=e.pos[1]-p.pos[1],dz=e.pos[2]-p.pos[2];if(dx*dx+dy*dy+dz*dz>9)return;
    addItem(p,e.item,e.count);delete state.entities[id];sendState(socket,p);io.to(p.dimension).emit("entitySync",state.entities);
  });

  socket.on("craft",({recipe})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(craftRecipe(p,recipe)){sendState(socket,p);socket.emit("achievementUnlocked","crafter")}
  });
  socket.on("craftGrid",({grid,recipe})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!Array.isArray(grid)||grid.length!==9)return;
    if(craftRecipe(p,recipe,grid)){sendState(socket,p);socket.emit("craftResult",{ok:true,recipe})}
    else socket.emit("craftResult",{ok:false,recipe});
  });

  socket.on("openContainer",({x,y,z})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],id=`${p.dimension}:${k(x,y,z)}`,t=getBlock(p.dimension,x,y,z);
    if(t==="chest"){
      state.containers[id] ||= {slots:{}};
      containerWatchers.set(id,(containerWatchers.get(id)||new Set()).add(socket.id));
      socket.emit("containerData",{kind:"chest",id,data:state.containers[id]});
    } else if(t==="furnace"){
      state.furnaces[id] ||= {input:null,inputCount:0,fuel:0,output:null,outputCount:0,progress:0,dimension:p.dimension};
      containerWatchers.set(id,(containerWatchers.get(id)||new Set()).add(socket.id));
      socket.emit("containerData",{kind:"furnace",id,data:state.furnaces[id]});
    }
  });
  socket.on("closeContainer",({id})=>{const s=containerWatchers.get(id);if(s){s.delete(socket.id);if(!s.size)containerWatchers.delete(id)}});

  socket.on("containerTransfer",d=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(d.kind==="chest"){
      const c=state.containers[d.id];if(!c)return;
      if(d.dir==="in"&&takeItem(p,d.item,1))c.slots[d.item]=(c.slots[d.item]||0)+1;
      if(d.dir==="out"&&(c.slots[d.item]||0)>0){c.slots[d.item]--;addItem(p,d.item,1);if(c.slots[d.item]<=0)delete c.slots[d.item]}
      broadcastContainer(d.id,"chest",c);sendState(socket,p);
    } else if(d.kind==="furnace"){
      const f=state.furnaces[d.id];if(!f)return;
      const fuelValues={coal:80,wood:15,plank:10};
      if(d.dir==="input"&&takeItem(p,d.item,1)){if(!f.input||f.input===d.item){f.input=d.item;f.inputCount++}else addItem(p,d.item,1)}
      if(d.dir==="fuel"&&fuelValues[d.item]&&takeItem(p,d.item,1))f.fuel+=fuelValues[d.item];
      if(d.dir==="output"&&f.outputCount>0){addItem(p,f.output,f.outputCount);f.outputCount=0;f.output=null}
      broadcastContainer(d.id,"furnace",f);sendState(socket,p);
    }
  });

  socket.on("equip",({slot,item})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!["head","chest","legs","feet"].includes(slot)||!ARMOR_VALUE[item]||!takeItem(p,item,1))return;
    if(p.equipment[slot])addItem(p,p.equipment[slot],1);
    p.equipment[slot]=item;recomputeArmor(p);sendState(socket,p);
    socket.to(p.dimension).emit("playerEquipment",{id:socket.id,equipment:p.equipment});
  });
  socket.on("unequip",({slot})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],item=p.equipment?.[slot];if(!item)return;
    addItem(p,item,1);p.equipment[slot]=null;recomputeArmor(p);sendState(socket,p);
  });

  socket.on("consume",({item})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    const foods={apple:[4,2],wheat_item:[1,.5],meat:[3,1],cooked_meat:[8,6]};
    if(item==="healing_potion"){
      if(!takeItem(p,item,1))return;p.health=Math.min(20,p.health+8);p.effects.push({type:"regen",until:Date.now()+10000});
    }else if(foods[item]){
      if(!takeItem(p,item,1))return;p.hunger=Math.min(20,p.hunger+foods[item][0]);p.saturation=Math.min(20,p.saturation+foods[item][1]);
    } else return;
    sendState(socket,p);
  });

  socket.on("attack",({entityId,tool})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],e=state.entities[entityId];if(!e)return;
    const dx=e.pos[0]-p.pos[0],dy=e.pos[1]-p.pos[1],dz=e.pos[2]-p.pos[2];if(dx*dx+dy*dy+dz*dz>36)return;
    const damage=String(tool||"").includes("iron_sword")?8:String(tool||"").includes("stone_sword")?6:String(tool||"").includes("wood_sword")?4:2;
    e.health=(e.health||10)-damage;if(TOOL_MAX[tool])useDurability(p,tool,1);
    if(e.health<=0){
      const drops={
        cow:[["leather",1],["meat",2]],
        pig:[["meat",2]],
        sheep:[["wool",2],["meat",1]],
        chicken:[["feather",2],["meat",1]],
        zombie:[["rotten_flesh",1]],
        skeleton:[["bone",1],["arrow",2]],
        spider:[["string",2]],
        hostile:[["string",1]]
      };
      for(const [item,c] of (drops[e.type]||[]))entity("drop",{dimension:e.dimension,pos:e.pos,item,count:c,age:0});
      delete state.entities[entityId];p.xp+=5;while(p.xp>=(p.level+1)*10){p.xp-=(p.level+1)*10;p.level++}
    }
    io.to(p.dimension).emit("entitySync",state.entities);sendState(socket,p);
  });

  socket.on("shoot",({dir,tool})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!Array.isArray(dir)||dir.length!==3||!takeItem(p,"arrow",1))return;
    entity("projectile",{dimension:p.dimension,pos:[...p.pos],vel:dir.map(v=>v*14),owner:n,age:0,damage:5});
    useDurability(p,tool||"bow",1);io.to(p.dimension).emit("entitySync",state.entities);sendState(socket,p);
  });

  socket.on("achievement",({id})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!p.achievements.includes(id)){p.achievements.push(id);socket.emit("achievementUnlocked",id)}
  });

  socket.on("disconnect",()=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    online.delete(socket.id);for(const [id,s] of containerWatchers){s.delete(socket.id);if(!s.size)containerWatchers.delete(id)}
    io.to(p.dimension).emit("playerLeave",{id:socket.id});io.to(p.dimension).emit("systemChat",`${n} left the world`);
  });
});

let tickCount=0;
function sim(){
  tickCount++;
  const now=Date.now();

  for(const dim of DIMENSIONS){
    const d=state.dimensions[dim];d.time=dim==="overworld"?.30:(d.time+.0007)%1;
    if(dim==="overworld"){
      if(Math.random()<.001)d.weather=Math.random()<.55?"rain":Math.random()<.45?"storm":"clear";
      if(Math.random()<.004)d.weather="clear";
    }
  }

  // Crops: grow only with farmland below. Moisture/water nearby gives a growth bonus.
  for(const [id,c] of Object.entries(state.crops)){
    const [dim,coord]=id.split(":");const [x,y,z]=coord.split(",").map(Number);
    if(getBlock(dim,x,y,z)!=="wheat"){delete state.crops[id];continue}
    let hydrated=false;
    for(let dx=-4;dx<=4&&!hydrated;dx++)for(let dz=-4;dz<=4;dz++)if(getBlock(dim,x+dx,y-1,z+dz)==="water"){hydrated=true;break}
    if(Math.random()<(hydrated?.06:.025))c.stage=Math.min(7,c.stage+1);
  }

  // Furnaces: 10 seconds-ish per item at this 5 Hz simulation.
  const smelt={iron_ore:"iron_ingot",gold_ore:"gold_ingot",sand:"glass",meat:"cooked_meat"};
  for(const [id,f] of Object.entries(state.furnaces)){
    if(f.input&&f.inputCount>0&&f.fuel>0&&smelt[f.input]){
      f.progress+=2;f.fuel=Math.max(0,f.fuel-.2);
      if(f.progress>=100){
        const result=smelt[f.input];
        if(!f.output||f.output===result){f.output=result;f.outputCount++;f.inputCount--;if(f.inputCount<=0){f.input=null;f.inputCount=0}f.progress=0}
      }
    } else if(!f.input)f.progress=0;
    if(tickCount%5===0)broadcastContainer(id,"furnace",f);
  }

  // Spawn animals by day; hostile variants at night.
  for(const dim of DIMENSIONS){
    const players=[...online.values()].map(n=>state.players[n]).filter(p=>p.dimension===dim);
    if(!players.length)continue;
    const alive=Object.values(state.entities).filter(e=>e.dimension===dim&&!["drop","projectile"].includes(e.type)).length;
    if(alive<28&&Math.random()<.07){
      const p=players[Math.floor(Math.random()*players.length)],a=Math.random()*Math.PI*2,r=12+Math.random()*12;
      const x=Math.round(p.pos[0]+Math.cos(a)*r),z=Math.round(p.pos[2]+Math.sin(a)*r),y=terrainHeight(dim,x,z)+1.2;
      const night=state.dimensions[dim].time>.52&&state.dimensions[dim].time<.96;
      let type;
      if(dim!=="overworld"||night)type=["zombie","skeleton","spider"][Math.floor(Math.random()*3)];
      else type=["cow","pig","sheep","chicken"][Math.floor(Math.random()*4)];
      entity(type,{dimension:dim,pos:[x,y,z],health:["zombie","skeleton","spider"].includes(type)?12:10,ai:type});
    }
  }

  // Entity simulation.
  for(const [id,e] of Object.entries(state.entities)){
    e.age=(e.age||0)+.2;
    if(e.type==="drop"){
      e.pos[1]=Math.max(terrainHeight(e.dimension,Math.round(e.pos[0]),Math.round(e.pos[2]))+1,e.pos[1]-.08);
      if(e.age>600)delete state.entities[id];
      continue;
    }
    if(e.type==="projectile"){
      e.pos[0]+=e.vel[0]*.2;e.pos[1]+=e.vel[1]*.2;e.pos[2]+=e.vel[2]*.2;e.vel[1]-=.65;
      for(const other of Object.values(state.entities)){
        if(other===e||!other.health||other.dimension!==e.dimension)continue;
        const dx=other.pos[0]-e.pos[0],dy=other.pos[1]-e.pos[1],dz=other.pos[2]-e.pos[2];
        if(dx*dx+dy*dy+dz*dz<1.1){other.health-=e.damage||5;delete state.entities[id];if(other.health<=0)delete state.entities[other.id];break}
      }
      if(e.age>8)delete state.entities[id];continue;
    }

    const mobs=["cow","pig","sheep","chicken","zombie","skeleton","spider","villager"];
    if(!mobs.includes(e.type))continue;
    const candidates=[...online.values()].map(n=>state.players[n]).filter(p=>p.dimension===e.dimension);
    if(!candidates.length)continue;
    let target=null,best=1e9;
    for(const p of candidates){const dx=p.pos[0]-e.pos[0],dz=p.pos[2]-e.pos[2],d=dx*dx+dz*dz;if(d<best){best=d;target=p}}
    if(!target)continue;
    const dist=Math.sqrt(best)||1;
    if(["zombie","skeleton","spider"].includes(e.type)&&dist<18){
      if(e.type==="skeleton"&&dist>4&&dist<14&&Math.random()<.025){
        const dx=(target.pos[0]-e.pos[0])/dist,dz=(target.pos[2]-e.pos[2])/dist;
        entity("projectile",{dimension:e.dimension,pos:[...e.pos],vel:[dx*8,2,dz*8],owner:"mob",age:0,damage:3});
      } else {
        const speed=e.type==="spider"?.18:.12;e.pos[0]+=(target.pos[0]-e.pos[0])/dist*speed;e.pos[2]+=(target.pos[2]-e.pos[2])/dist*speed;
      }
      if(dist<1.45&&Math.random()<.18)damagePlayer(target,e.type==="spider"?.7:1);
    } else {
      e.pos[0]+=Math.sin(now/900+e.pos[2])*.018;e.pos[2]+=Math.cos(now/1100+e.pos[0])*.018;
    }
    e.pos[1]=terrainHeight(e.dimension,Math.round(e.pos[0]),Math.round(e.pos[2]))+1.2;
  }

  // Hunger, regen, death/respawn.
  for(const [sid,name] of online){
    const p=state.players[name];
    if(p.saturation>0)p.saturation=Math.max(0,p.saturation-.004);
    else p.hunger=Math.max(0,p.hunger-.003);
    if(p.hunger>=18&&p.health<20)p.health=Math.min(20,p.health+.025);
    if(p.hunger<=0)damagePlayer(p,.04);
    for(const ef of p.effects||[])if(ef.type==="regen"&&ef.until>now&&p.health<20)p.health=Math.min(20,p.health+.03);
    p.effects=(p.effects||[]).filter(e=>e.until>now);
    if(p.health<=0){
      const oldDim=p.dimension;respawnPlayer(p);
      io.to(oldDim).emit("entitySync",state.entities);
      io.to(sid).emit("death",{pos:p.pos,dimension:p.dimension,deaths:p.deaths});
      sendState(io.sockets.sockets.get(sid),p);
    }
  }

  if(tickCount%2===0){
    for(const [sid,name] of online){
      const p=state.players[name],nearby={};
      for(const [id,e] of Object.entries(state.entities)){
        if(e.dimension!==p.dimension)continue;
        const dx=e.pos[0]-p.pos[0],dz=e.pos[2]-p.pos[2];
        if(dx*dx+dz*dz<=65*65)nearby[id]=e;
      }
      io.to(sid).emit("tick",{time:state.dimensions[p.dimension].time,weather:state.dimensions[p.dimension].weather,entities:nearby,crops:state.crops,automation:state.automation});
    }
  }
}
setInterval(sim,200);

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("Blockcraft Survival Systems on",PORT));
