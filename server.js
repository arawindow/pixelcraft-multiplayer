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

const TYPES = ["grass","dirt","stone","cobble","sand","wood","leaves","plank","glass","coal_ore","iron_ore","gold_ore","diamond_ore","water","lava","farmland","wheat","torch","crafting_table","furnace","chest","rail","powered_rail","wire","lamp","portal","obsidian","snow","ice","brick"];
const DIMENSIONS = ["overworld","ember","void"];
const k=(x,y,z)=>`${x},${y},${z}`;

function noise(x,z,s=0){
  return Math.sin((x+s)*.16)*2 + Math.cos((z-s)*.13)*1.7 + Math.sin((x+z+s)*.07)*1.2;
}
function defaultPlayer(name){
  return {
    name, dimension:"overworld", pos:[0,8,0], yaw:0,pitch:0,
    health:20,hunger:20,armor:0,xp:0,level:0,
    inventory:{grass:20,dirt:20,cobble:10,wood:6,apple:3,torch:4},
    hotbar:["grass","dirt","cobble","wood","torch","wood_pickaxe","wood_sword","bow","apple"],
    equipment:{head:null,chest:null,legs:null,feet:null},
    effects:[], achievements:[], spawn:{dimension:"overworld",pos:[0,8,0]}
  };
}

function newState(){
  return {
    version:3, seed:Math.floor(Math.random()*999999),
    dimensions:{overworld:{blocks:{},time:.22,weather:"clear"},ember:{blocks:{},time:.65,weather:"ash"},void:{blocks:{},time:.82,weather:"clear"}},
    players:{}, containers:{}, furnaces:{}, crops:{}, entities:{}, structuresGenerated:{}, boss:{},
    automation:{}, achievementsGlobal:[]
  };
}
let state = newState();
try{ if(fs.existsSync(SAVE)) state = JSON.parse(fs.readFileSync(SAVE,"utf8")); }catch(e){ console.error("save load",e); }

function setBlock(dim,x,y,z,type){
  const b=state.dimensions[dim].blocks;
  const key=k(x,y,z);
  if(type==null) delete b[key]; else b[key]=type;
}
function getBlock(dim,x,y,z){ return state.dimensions[dim].blocks[k(x,y,z)] || null; }

function generateDimension(dim){
  const d=state.dimensions[dim];
  if(Object.keys(d.blocks).length) return;
  const R=34;
  if(dim==="overworld"){
    for(let x=-R;x<=R;x++) for(let z=-R;z<=R;z++){
      let h=Math.floor(3+noise(x,z,state.seed%100));
      for(let y=-4;y<=h;y++){
        let t=y===h?(h<=1?"sand":h>=6?"snow":"grass"):y>=h-2?"dirt":"stone";
        if(y<-1 && Math.sin(x*.6+y*.8+z*.5)>1.65) continue;
        if(y<h-3){
          const r=Math.abs(Math.sin(x*12.9898+z*78.233+y*37.719));
          if(r>.985)t="diamond_ore"; else if(r>.955)t="gold_ore"; else if(r>.90)t="iron_ore"; else if(r>.83)t="coal_ore";
        }
        setBlock(dim,x,y,z,t);
      }
      if(Math.random()<.018 && h>2 && Math.abs(x)>4 && Math.abs(z)>4){
        for(let y=1;y<=4;y++) setBlock(dim,x,h+y,z,"wood");
        for(let dx=-2;dx<=2;dx++)for(let dz=-2;dz<=2;dz++)for(let dy=3;dy<=5;dy++) if(Math.abs(dx)+Math.abs(dz)<4)setBlock(dim,x+dx,h+dy,z+dz,"leaves");
      }
    }
  } else if(dim==="ember"){
    for(let x=-R;x<=R;x++)for(let z=-R;z<=R;z++){
      const h=Math.floor(1+noise(x,z,55)*.6);
      for(let y=-4;y<=h;y++) setBlock(dim,x,y,z, y===h?"brick":"stone");
      if(Math.random()<.03) setBlock(dim,x,h+1,z,"lava");
    }
  } else {
    for(let x=-R;x<=R;x++)for(let z=-R;z<=R;z++){
      if(Math.hypot(x,z)<20 && noise(x,z,99)>-.3){
        let h=Math.floor(noise(x,z,99)*.25);
        for(let y=-2;y<=h;y++) setBlock(dim,x,y,z,y===h?"obsidian":"stone");
      }
    }
  }
}
DIMENSIONS.forEach(generateDimension);

function generateStructures(){
  if(state.structuresGenerated.overworld) return;
  const dim="overworld";
  const villages=[[-18,-12],[17,15]];
  for(const [cx,cz] of villages){
    for(let h=0;h<3;h++){
      const bx=cx+h*7, bz=cz+(h%2)*6;
      let gy=0; for(let y=20;y>-10;y--) if(getBlock(dim,bx,y,bz)){gy=y+1;break;}
      for(let x=bx-2;x<=bx+2;x++)for(let z=bz-2;z<=bz+2;z++){
        setBlock(dim,x,gy-1,z,"plank");
        if(x===bx-2||x===bx+2||z===bz-2||z===bz+2){
          for(let y=gy;y<=gy+2;y++)setBlock(dim,x,y,z,"wood");
        }
      }
      for(let x=bx-3;x<=bx+3;x++)for(let z=bz-3;z<=bz+3;z++)setBlock(dim,x,gy+3,z,"plank");
      setBlock(dim,bx,gy,bz-2,null);
      entity("villager",{dimension:dim,pos:[bx,gy+1,bz],health:20,profession:["farmer","smith","fisher"][h%3],ai:"village"});
    }
    // central lamp/well
    let gy=0;for(let y=20;y>-10;y--)if(getBlock(dim,cx,y,cz)){gy=y+1;break;}
    setBlock(dim,cx,gy-1,cz,"stone");setBlock(dim,cx,gy,cz,"water");
    setBlock(dim,cx+2,gy,cz,"torch");
  }
  state.structuresGenerated.overworld=true;
}

generateStructures();

function addItem(p,type,count=1){
  p.inventory[type]=(p.inventory[type]||0)+count;
}
function takeItem(p,type,count=1){
  if((p.inventory[type]||0)<count) return false;
  p.inventory[type]-=count;
  if(p.inventory[type]<=0) delete p.inventory[type];
  return true;
}
function entity(type,data={}){
  const id="e"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  state.entities[id]={id,type,...data};
  return state.entities[id];
}
function save(){ try{ fs.writeFileSync(SAVE,JSON.stringify(state)); }catch(e){ console.error("save",e); } }
setInterval(save,5000);
process.on("SIGTERM",()=>{save();process.exit(0)});
process.on("SIGINT",()=>{save();process.exit(0)});

const online = new Map();

function publicPlayer(p,id){ return {id,name:p.name,dimension:p.dimension,pos:p.pos,yaw:p.yaw,pitch:p.pitch,equipment:p.equipment,health:p.health}; }

io.on("connection", socket=>{
  socket.on("join", ({username})=>{
    username=String(username||"").trim().replace(/[^\w\-]/g,"").slice(0,16);
    if(username.length<2) return socket.emit("joinError","Use at least 2 letters/numbers.");
    if([...online.values()].includes(username)) return socket.emit("joinError","That username is already online.");
    if(!state.players[username]) state.players[username]=defaultPlayer(username);
    const p=state.players[username]; online.set(socket.id,username);
    socket.join(p.dimension);
    socket.emit("init", {self:p, dimensions:state.dimensions, entities:state.entities, containers:state.containers, furnaces:state.furnaces, crops:state.crops, automation:state.automation,
      players:[...online.entries()].filter(([id])=>id!==socket.id).map(([id,n])=>publicPlayer(state.players[n],id))});
    socket.to(p.dimension).emit("playerJoin",publicPlayer(p,socket.id));
    io.to(p.dimension).emit("systemChat",`${username} joined the world`);
  });

  socket.on("move", d=>{
    const n=online.get(socket.id); if(!n)return; const p=state.players[n];
    if(!Array.isArray(d.pos)||d.pos.some(v=>!Number.isFinite(v)))return;
    p.pos=d.pos.map(v=>Math.max(-200,Math.min(200,v))); p.yaw=+d.yaw||0;p.pitch=+d.pitch||0;
    socket.to(p.dimension).volatile.emit("playerMove",{id:socket.id,pos:p.pos,yaw:p.yaw,pitch:p.pitch});
  });

  socket.on("chat", text=>{
    const n=online.get(socket.id);if(!n)return; text=String(text||"").trim().slice(0,120);if(!text)return;
    const p=state.players[n]; io.to(p.dimension).emit("chat",{id:socket.id,name:n,text});
  });

  socket.on("block", d=>{
    const n=online.get(socket.id);if(!n)return; const p=state.players[n];
    const {x,y,z}=d; if(![x,y,z].every(Number.isInteger)||Math.abs(x)>100||Math.abs(z)>100||y<-20||y>40)return;
    if(d.action==="break"){
      const t=getBlock(p.dimension,x,y,z); if(!t)return;
      setBlock(p.dimension,x,y,z,null);
      if(!["water","lava","portal"].includes(t)) entity("drop",{dimension:p.dimension,pos:[x,y+.2,z],item:t,count:1,age:0});
      io.to(p.dimension).emit("blockUpdate",{x,y,z,type:null});
      io.to(p.dimension).emit("entitySync",state.entities);
    }else if(d.action==="place" && TYPES.includes(d.type)){
      if(getBlock(p.dimension,x,y,z))return;
      if(!takeItem(p,d.type,1))return;
      setBlock(p.dimension,x,y,z,d.type);
      io.to(p.dimension).emit("blockUpdate",{x,y,z,type:d.type});
      socket.emit("playerState",p);
    }
  });

  socket.on("dropItem", ({item,count=1})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    count=Math.max(1,Math.min(64,Math.floor(count)));
    if(!takeItem(p,item,count))return;
    entity("drop",{dimension:p.dimension,pos:[p.pos[0],p.pos[1],p.pos[2]],item,count,age:0});
    io.to(p.dimension).emit("entitySync",state.entities);socket.emit("playerState",p);
  });

  socket.on("pickup", ({id})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],e=state.entities[id];
    if(!e||e.type!=="drop"||e.dimension!==p.dimension)return;
    const dx=e.pos[0]-p.pos[0],dy=e.pos[1]-p.pos[1],dz=e.pos[2]-p.pos[2];
    if(dx*dx+dy*dy+dz*dz>9)return;
    addItem(p,e.item,e.count);delete state.entities[id];
    socket.emit("playerState",p);io.to(p.dimension).emit("entitySync",state.entities);
  });

  socket.on("craft", ({recipe})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    const recipes={
      plank:{need:{wood:1},give:{plank:4}},
      crafting_table:{need:{plank:4},give:{crafting_table:1}},
      chest:{need:{plank:8},give:{chest:1}},
      furnace:{need:{cobble:8},give:{furnace:1}},
      torch:{need:{coal_ore:1,wood:1},give:{torch:4}},
      wood_pickaxe:{need:{plank:3,wood:2},give:{wood_pickaxe:1}},
      stone_pickaxe:{need:{cobble:3,wood:2},give:{stone_pickaxe:1}},
      iron_pickaxe:{need:{iron_ingot:3,wood:2},give:{iron_pickaxe:1}},
      wood_sword:{need:{plank:2,wood:1},give:{wood_sword:1}},
      bow:{need:{wood:3,string:3},give:{bow:1}},
      arrow:{need:{stone:1,wood:1},give:{arrow:4}},
      rail:{need:{iron_ingot:2,wood:1},give:{rail:8}},
      powered_rail:{need:{gold_ingot:2,wire:1},give:{powered_rail:4}},
      wire:{need:{iron_ingot:1,coal_ore:1},give:{wire:4}},
      lamp:{need:{glass:1,wire:1,torch:1},give:{lamp:1}},
      obsidian:{need:{stone:4,coal_ore:2},give:{obsidian:1}},
      portal:{need:{obsidian:8,diamond:1},give:{portal:1}},
      boat:{need:{plank:5},give:{boat:1}},
      minecart:{need:{iron_ingot:5},give:{minecart:1}},
      fishing_rod:{need:{wood:3,string:2},give:{fishing_rod:1}},
      leather_helmet:{need:{leather:5},give:{leather_helmet:1}},
      leather_chest:{need:{leather:8},give:{leather_chest:1}},
      healing_potion:{need:{apple:1,glass:1},give:{healing_potion:1}}
    };
    const r=recipes[recipe]; if(!r)return;
    for(const [i,c] of Object.entries(r.need)) if((p.inventory[i]||0)<c)return;
    for(const [i,c] of Object.entries(r.need)) takeItem(p,i,c);
    for(const [i,c] of Object.entries(r.give)) addItem(p,i,c);
    socket.emit("playerState",p);
  });

  socket.on("openContainer", ({x,y,z})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],id=`${p.dimension}:${k(x,y,z)}`;
    if(getBlock(p.dimension,x,y,z)==="chest"){
      if(!state.containers[id])state.containers[id]={slots:{}};
      socket.emit("containerData",{kind:"chest",id,data:state.containers[id]});
    }else if(getBlock(p.dimension,x,y,z)==="furnace"){
      if(!state.furnaces[id])state.furnaces[id]={input:null,inputCount:0,fuel:0,output:null,outputCount:0,progress:0};
      socket.emit("containerData",{kind:"furnace",id,data:state.furnaces[id]});
    }
  });

  socket.on("containerTransfer", d=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(d.kind==="chest"){
      const c=state.containers[d.id];if(!c)return;
      if(d.dir==="in" && takeItem(p,d.item,1)) c.slots[d.item]=(c.slots[d.item]||0)+1;
      if(d.dir==="out" && (c.slots[d.item]||0)>0){c.slots[d.item]--;addItem(p,d.item,1);if(c.slots[d.item]<=0)delete c.slots[d.item];}
      socket.emit("containerData",{kind:"chest",id:d.id,data:c});socket.emit("playerState",p);
    } else if(d.kind==="furnace"){
      const f=state.furnaces[d.id];if(!f)return;
      if(d.dir==="input" && takeItem(p,d.item,1)){if(!f.input||f.input===d.item){f.input=d.item;f.inputCount++;}else addItem(p,d.item,1);}
      if(d.dir==="fuel" && takeItem(p,d.item,1)){f.fuel+=d.item==="coal_ore"?12:4;}
      if(d.dir==="output" && f.outputCount>0){addItem(p,f.output,f.outputCount);f.outputCount=0;f.output=null;}
      socket.emit("containerData",{kind:"furnace",id:d.id,data:f});socket.emit("playerState",p);
    }
  });

  socket.on("plant", ({x,y,z})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(getBlock(p.dimension,x,y,z)!=="farmland"||getBlock(p.dimension,x,y+1,z))return;
    if(!takeItem(p,"seed",1))return;
    setBlock(p.dimension,x,y+1,z,"wheat");state.crops[`${p.dimension}:${k(x,y+1,z)}`]={stage:0};
    io.to(p.dimension).emit("blockUpdate",{x,y:y+1,z,type:"wheat"});socket.emit("playerState",p);
  });

  socket.on("usePortal", ({target})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!DIMENSIONS.includes(target))return;
    socket.leave(p.dimension);p.dimension=target;p.pos=[0,8,0];socket.join(target);
    socket.emit("dimensionChange",{dimension:target,blocks:state.dimensions[target].blocks,entities:state.entities});
    socket.to(target).emit("playerJoin",publicPlayer(p,socket.id));
  });

  socket.on("equip", ({slot,item})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!["head","chest","legs","feet"].includes(slot)||!item)return;
    if(!takeItem(p,item,1))return;
    if(p.equipment[slot])addItem(p,p.equipment[slot],1);
    p.equipment[slot]=item;
    p.armor=Object.values(p.equipment).filter(Boolean).length*2;
    socket.emit("playerState",p);
  });

  socket.on("consume", ({item})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!takeItem(p,item,1))return;
    if(item==="apple")p.hunger=Math.min(20,p.hunger+4);
    if(item==="healing_potion"){p.health=Math.min(20,p.health+8);p.effects.push({type:"regen",until:Date.now()+10000});}
    socket.emit("playerState",p);
  });

  socket.on("attack", ({entityId,damage=2})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],e=state.entities[entityId];if(!e)return;
    const dx=e.pos[0]-p.pos[0],dy=e.pos[1]-p.pos[1],dz=e.pos[2]-p.pos[2];if(dx*dx+dy*dy+dz*dz>36)return;
    e.health=(e.health||10)-Math.max(1,Math.min(10,damage));
    if(e.health<=0){
      if(e.type==="cow"){entity("drop",{dimension:e.dimension,pos:e.pos,item:"leather",count:1,age:0});entity("drop",{dimension:e.dimension,pos:e.pos,item:"meat",count:2,age:0});}
      if(e.type==="sheep")entity("drop",{dimension:e.dimension,pos:e.pos,item:"wool",count:2,age:0});
      if(e.type==="hostile")entity("drop",{dimension:e.dimension,pos:e.pos,item:"string",count:1,age:0});
      if(e.type==="boss"){entity("drop",{dimension:e.dimension,pos:e.pos,item:"boss_core",count:1,age:0});p.achievements.push("boss_slayer");}
      delete state.entities[entityId]; p.xp+=5; while(p.xp >= (p.level+1)*10){p.xp-=(p.level+1)*10;p.level++;}
    }
    io.to(p.dimension).emit("entitySync",state.entities);socket.emit("playerState",p);
  });

  socket.on("shoot", ({dir})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!takeItem(p,"arrow",1))return;
    entity("projectile",{dimension:p.dimension,pos:[...p.pos],vel:dir.map(v=>v*12),owner:n,age:0});
    io.to(p.dimension).emit("entitySync",state.entities);socket.emit("playerState",p);
  });

  socket.on("spawnVehicle", ({type})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!["boat","minecart"].includes(type)||!takeItem(p,type,1))return;
    entity(type,{dimension:p.dimension,pos:[...p.pos],health:10});
    io.to(p.dimension).emit("entitySync",state.entities);socket.emit("playerState",p);
  });


  socket.on("enchant", ({item})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if((p.inventory[item]||0)<1 || p.level<1)return;
    p.level--; p.inventory[item]--; const enchanted=`enchanted_${item}`;addItem(p,enchanted,1);
    socket.emit("playerState",p);
  });

  socket.on("vehicleMove", ({id,pos})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n],e=state.entities[id];
    if(!e||!["boat","minecart"].includes(e.type)||e.dimension!==p.dimension||!Array.isArray(pos)||pos.length!==3)return;
    const dx=e.pos[0]-p.pos[0],dz=e.pos[2]-p.pos[2];if(dx*dx+dz*dz>36)return;
    e.pos=pos.map(v=>Math.max(-200,Math.min(200,+v||0)));
  });

  socket.on("achievement", ({id})=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    if(!p.achievements.includes(id)){p.achievements.push(id);socket.emit("achievementUnlocked",id);}
  });

  socket.on("disconnect", ()=>{
    const n=online.get(socket.id);if(!n)return;const p=state.players[n];
    online.delete(socket.id);io.to(p.dimension).emit("playerLeave",{id:socket.id});io.to(p.dimension).emit("systemChat",`${n} left the world`);
  });
});

function sim(){
  const now=Date.now();
  for(const dim of DIMENSIONS){
    const d=state.dimensions[dim];
    d.time=(d.time+.00035)%1;
    if(dim==="overworld" && Math.random()<.0015)d.weather=Math.random()<.65?"rain":Math.random()<.5?"storm":"clear";
    if(dim==="overworld" && Math.random()<.006)d.weather="clear";
  }

  // crops
  for(const [id,c] of Object.entries(state.crops)){
    if(Math.random()<.04)c.stage=Math.min(7,c.stage+1);
  }

  // furnaces
  for(const f of Object.values(state.furnaces)){
    const smelt={iron_ore:"iron_ingot",gold_ore:"gold_ingot",sand:"glass",meat:"cooked_meat"};
    if(f.input && f.fuel>0 && smelt[f.input]){
      f.progress+=1; f.fuel-=.08;
      if(f.progress>=100){f.output=smelt[f.input];f.outputCount++;f.inputCount--;if(f.inputCount<=0){f.input=null;f.inputCount=0}f.progress=0;}
    }
  }

  // spawn animals/hostiles/boss
  for(const dim of DIMENSIONS){
    const players=[...online.values()].map(n=>state.players[n]).filter(p=>p.dimension===dim);
    if(!players.length)continue;
    const count=Object.values(state.entities).filter(e=>e.dimension===dim).length;
    if(count<32 && Math.random()<.08){
      const p=players[Math.floor(Math.random()*players.length)], a=Math.random()*Math.PI*2,r=10+Math.random()*14;
      const type = dim==="overworld" ? (state.dimensions[dim].time>.55 && state.dimensions[dim].time<.95 ? "hostile" : Math.random()<.5?"cow":"sheep") : "hostile";
      entity(type,{dimension:dim,pos:[p.pos[0]+Math.cos(a)*r,5,p.pos[2]+Math.sin(a)*r],health:type==="hostile"?12:10,ai:"wander"});
    }
    if(dim==="void" && !Object.values(state.entities).some(e=>e.type==="boss"&&e.dimension==="void")){
      entity("boss",{dimension:"void",pos:[0,8,-18],health:180,ai:"boss"});
    }
  }

  // entities
  for(const e of Object.values(state.entities)){
    e.age=(e.age||0)+.1;
    if(e.type==="drop"){
      e.pos[1]=Math.max(1,e.pos[1]-.04);
      if(e.age>900) delete state.entities[e.id];
    }
    if(e.type==="projectile"){
      e.pos[0]+=e.vel[0]*.1;e.pos[1]+=e.vel[1]*.1;e.pos[2]+=e.vel[2]*.1;e.vel[1]-=.5;
      for(const other of Object.values(state.entities)){
        if(other===e||!other.health||other.dimension!==e.dimension)continue;
        const dx=other.pos[0]-e.pos[0],dy=other.pos[1]-e.pos[1],dz=other.pos[2]-e.pos[2];
        if(dx*dx+dy*dy+dz*dz<1.2){other.health-=5;delete state.entities[e.id];if(other.health<=0)delete state.entities[other.id];break;}
      }
      if(e.age>8)delete state.entities[e.id];
    }
    if(["cow","sheep","hostile","boss","villager"].includes(e.type)){
      const candidates=[...online.values()].map(n=>state.players[n]).filter(p=>p.dimension===e.dimension);
      if(!candidates.length)continue;
      let target=candidates[0],best=1e9;
      for(const p of candidates){const dx=p.pos[0]-e.pos[0],dz=p.pos[2]-e.pos[2],d=dx*dx+dz*dz;if(d<best){best=d;target=p}}
      if(e.type==="villager"){
        e.pos[0]+=Math.sin(now/1800+e.pos[2])*.01;e.pos[2]+=Math.cos(now/1700+e.pos[0])*.01;
      } else if(e.type==="hostile"||e.type==="boss"){
        const d=Math.sqrt(best)||1,s=e.type==="boss"?.12:.07;e.pos[0]+=(target.pos[0]-e.pos[0])/d*s;e.pos[2]+=(target.pos[2]-e.pos[2])/d*s;
        if(d<1.5){target.health=Math.max(0,target.health-(e.type==="boss"?.5:.18));}
      }else{
        e.pos[0]+=Math.sin(now/1000+e.pos[2])*.015;e.pos[2]+=Math.cos(now/1300+e.pos[0])*.015;
      }
    }
  }

  // players passive sim
  for(const n of online.values()){
    const p=state.players[n];
    p.hunger=Math.max(0,p.hunger-.002);
    if(p.hunger<=0)p.health=Math.max(0,p.health-.02);
    if(p.health<=0){p.health=20;p.hunger=20;p.dimension=p.spawn.dimension;p.pos=[...p.spawn.pos];}
  }


  // compact fluid simulation: exposed water/lava slowly spreads horizontally/downward.
  if(Math.random()<.35){
    for(const dim of DIMENSIONS){
      const b=state.dimensions[dim].blocks;
      let processed=0;
      for(const [kk,type] of Object.entries(b)){
        if(processed++>120)break;
        if(type!=="water"&&type!=="lava")continue;
        const [x,y,z]=kk.split(",").map(Number);
        const candidates=[[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]];
        for(const [dx,dy,dz] of candidates){
          if(Math.random()>.08)continue;
          const nx=x+dx,ny=y+dy,nz=z+dz;
          if(!getBlock(dim,nx,ny,nz)){
            setBlock(dim,nx,ny,nz,type);
            io.to(dim).emit("blockUpdate",{x:nx,y:ny,z:nz,type});
            break;
          }
        }
      }
    }
  }

  // automation: wire powers adjacent lamps/powered rail if adjacent torch
  for(const dim of DIMENSIONS){
    const b=state.dimensions[dim].blocks;
    for(const [key,type] of Object.entries(b)){
      if(type!=="wire")continue;
      const [x,y,z]=key.split(",").map(Number);
      const powered=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>getBlock(dim,x+dx,y+dy,z+dz)==="torch");
      state.automation[`${dim}:${key}`]={powered};
    }
  }

  for(const dim of DIMENSIONS) io.to(dim).emit("tick",{time:state.dimensions[dim].time,weather:state.dimensions[dim].weather,entities:state.entities,crops:state.crops,automation:state.automation});
}
setInterval(sim,100);

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("Blockcraft Complete on",PORT));

