import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.167.1/build/three.module.js";

const socket=io();
const $=s=>document.querySelector(s);
const login=$("#login"), hud=$("#hud"), chatWrap=$("#chatWrap"),help=$("#help");
let me=null, joined=false, dimension="overworld", blocks={}, entities={}, crops={}, automation={}, selected=0;
const otherPlayers=new Map(), entityMeshes=new Map(), blockMeshes=new Map();
const keys={}, mouse={down:false}, clock=new THREE.Clock();
let yaw=0,pitch=0,velY=0,grounded=false, mineTarget=null,mineProgress=0,chatting=false, currentContainer=null, riding=null, fishing=false;
const blockGeo=new THREE.BoxGeometry(1,1,1);

const scene=new THREE.Scene();scene.background=new THREE.Color(0x87ceeb);scene.fog=new THREE.Fog(0x87ceeb,30,85);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,250);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.08;
document.body.appendChild(renderer.domElement);
const hemi=new THREE.HemisphereLight(0xddeeff,0x34402f,1.15),sun=new THREE.DirectionalLight(0xfff1d6,3.0);
sun.position.set(24,34,14);sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-36;sun.shadow.camera.right=36;sun.shadow.camera.top=36;sun.shadow.camera.bottom=-36;
sun.shadow.bias=-0.0006;
scene.add(hemi,sun);
const fillLight=new THREE.DirectionalLight(0x9cb8ff,.22);fillLight.position.set(-20,12,-20);scene.add(fillLight);

const COLORS={grass:0x64a856,dirt:0x7a5739,stone:0x777777,cobble:0x666666,sand:0xd7c27c,wood:0x8a5a2b,leaves:0x3c8c43,plank:0xb98955,glass:0xbfe8ef,coal_ore:0x303030,iron_ore:0xb88f73,gold_ore:0xe5c04c,diamond_ore:0x5be1df,water:0x3f7fc9,lava:0xff5a17,farmland:0x5b381f,wheat:0xc8b84c,torch:0xffcc55,crafting_table:0x8c6a3c,furnace:0x555555,chest:0xa46a2b,rail:0x888888,powered_rail:0xc7a13b,wire:0x8a2525,lamp:0xffe894,portal:0x8c48d7,obsidian:0x252039,snow:0xf0f5ff,ice:0xa7d8ef,brick:0x9e5744};
const SOLID=new Set(Object.keys(COLORS).filter(x=>!["water","lava","wheat","torch","wire","rail","powered_rail","portal"].includes(x)));

const textureLoader=new THREE.TextureLoader();
const maxAniso=renderer.capabilities.getMaxAnisotropy();
const TEX={};
function loadTex(name,color=true){
  const tex=textureLoader.load(`/assets/textures/${name}.png`);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.magFilter=THREE.LinearFilter;
  tex.minFilter=THREE.LinearMipmapLinearFilter;
  tex.anisotropy=Math.min(8,maxAniso);
  if(color) tex.colorSpace=THREE.SRGBColorSpace;
  return tex;
}
function loadHeight(name){
  const tex=textureLoader.load(`/assets/textures/${name}_height.png`);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping;
  tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;
  return tex;
}
["grass_top","grass_side","dirt","stone","cobble","sand","wood_side","wood_top","leaves","plank","glass","coal_ore","iron_ore","gold_ore","diamond_ore","obsidian","snow","ice","brick","farmland","wheat","torch","crafting_table","furnace","chest","rail","powered_rail","wire","lamp","portal","water","lava"].forEach(n=>TEX[n]={map:loadTex(n),height:loadHeight(n)});

const materialCache=new Map();
function oneMaterial(t,face=t){
  const ck=`${t}:${face}`;if(materialCache.has(ck))return materialCache.get(ck);
  const tx=TEX[face]||TEX[t]||TEX.stone;
  const transparent=["glass","water","ice","portal","leaves"].includes(t);
  const mat=new THREE.MeshStandardMaterial({
    map:tx.map,
    bumpMap:tx.height,
    bumpScale:t==="stone"||t.includes("ore")||t==="cobble"?.12:t==="wood"||t==="plank"?.09:.055,
    roughness:t==="glass"?.18:t==="ice"?.28:t==="water"?.22:t==="metal"?.35:.82,
    metalness:["rail","powered_rail"].includes(t)?.28:0,
    transparent,
    opacity:t==="water"?.72:t==="glass"?.34:t==="portal"?.7:t==="ice"?.66:t==="leaves"?.93:1,
    alphaTest:t==="leaves"?.08:0,
    side:t==="water"?THREE.DoubleSide:THREE.FrontSide,
    emissive:t==="lava"?0xff3b0a:t==="torch"||t==="lamp"?0xffb52d:t==="portal"?0x6731a8:0x000000,
    emissiveMap:["lava","torch","lamp","portal"].includes(t)?tx.map:null,
    emissiveIntensity:t==="lava"?2.2:t==="torch"||t==="lamp"?1.55:t==="portal"?1.25:0
  });
  materialCache.set(ck,mat);return mat;
}
function materialsFor(t){
  // BoxGeometry material order: +X,-X,+Y,-Y,+Z,-Z
  if(t==="grass")return [oneMaterial(t,"grass_side"),oneMaterial(t,"grass_side"),oneMaterial(t,"grass_top"),oneMaterial(t,"dirt"),oneMaterial(t,"grass_side"),oneMaterial(t,"grass_side")];
  if(t==="wood")return [oneMaterial(t,"wood_side"),oneMaterial(t,"wood_side"),oneMaterial(t,"wood_top"),oneMaterial(t,"wood_top"),oneMaterial(t,"wood_side"),oneMaterial(t,"wood_side")];
  const m=oneMaterial(t,TEX[t]?t:"stone");return [m,m,m,m,m,m];
}
function materialFor(t){ return oneMaterial(t,TEX[t]?t:"plank"); }

const key=(x,y,z)=>`${x},${y},${z}`;
function makeBlock(k,t){
  const [x,y,z]=k.split(",").map(Number);
  const m=new THREE.Mesh(blockGeo,materialsFor(t));
  m.position.set(x,y,z);m.userData={x,y,z,type:t};
  m.castShadow=SOLID.has(t)&&!["leaves","glass","ice"].includes(t);m.receiveShadow=true;
  scene.add(m);blockMeshes.set(k,m);
}
function rebuildWorld(){
  for(const m of blockMeshes.values())scene.remove(m);blockMeshes.clear();
  for(const [k,t] of Object.entries(blocks)){
    const [x,y,z]=k.split(",").map(Number);
    const exposed=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].some(([dx,dy,dz])=>!blocks[key(x+dx,y+dy,z+dz)] || !SOLID.has(blocks[key(x+dx,y+dy,z+dz)]));
    if(exposed||!SOLID.has(t))makeBlock(k,t);
  }
}
function blockBox(x,y,z){return {minX:x-.5,maxX:x+.5,minY:y-.5,maxY:y+.5,minZ:z-.5,maxZ:z+.5}}
function playerBox(x,y,z){return {minX:x-.32,maxX:x+.32,minY:y-1.65,maxY:y+.15,minZ:z-.32,maxZ:z+.32}}
function collides(b){
  for(let x=Math.floor(b.minX-.5);x<=Math.floor(b.maxX+.5);x++)for(let y=Math.floor(b.minY-.5);y<=Math.floor(b.maxY+.5);y++)for(let z=Math.floor(b.minZ-.5);z<=Math.floor(b.maxZ+.5);z++){
    const t=blocks[key(x,y,z)];if(!t||!SOLID.has(t))continue;const q=blockBox(x,y,z);
    if(b.maxX>q.minX&&b.minX<q.maxX&&b.maxY>q.minY&&b.minY<q.maxY&&b.maxZ>q.minZ&&b.minZ<q.maxZ)return true;
  }return false;
}
function axisMove(axis,amount){
  const steps=Math.max(1,Math.ceil(Math.abs(amount)/.08)),step=amount/steps;
  for(let i=0;i<steps;i++){const p=camera.position.clone();p[axis]+=step;if(collides(playerBox(p.x,p.y,p.z)))return false;camera.position[axis]+=step}return true;
}
function groundAt(x,z){for(let y=30;y>-20;y--)if(SOLID.has(blocks[key(Math.round(x),y,Math.round(z))]))return y+.5;return 0}

function spriteText(text,color="#fff"){
  const c=document.createElement("canvas"),ctx=c.getContext("2d");c.width=512;c.height=128;ctx.font="bold 40px Arial";ctx.textAlign="center";ctx.fillStyle="rgba(0,0,0,.45)";ctx.fillRect(0,32,512,64);ctx.fillStyle=color;ctx.fillText(text,256,78);
  const tex=new THREE.CanvasTexture(c),mat=new THREE.SpriteMaterial({map:tex,transparent:true}),s=new THREE.Sprite(mat);s.scale.set(4,1,1);return s;
}
function addOther(p){
  const g=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.7,1.3,.45),new THREE.MeshStandardMaterial({color:0x4a7ec7})),head=new THREE.Mesh(new THREE.BoxGeometry(.65,.65,.65),new THREE.MeshStandardMaterial({color:0xd9aa7d}));
  body.position.y=.65;head.position.y=1.65;g.add(body,head);const tag=spriteText(p.name);tag.position.y=2.35;g.add(tag);g.position.fromArray(p.pos);scene.add(g);otherPlayers.set(p.id,{group:g,tag,speech:null});
}
function speech(id,text){
  const o=otherPlayers.get(id);if(!o)return;if(o.speech)o.group.remove(o.speech);o.speech=spriteText(text,"#ffe68a");o.speech.position.y=2.9;o.group.add(o.speech);setTimeout(()=>{if(o.speech){o.group.remove(o.speech);o.speech=null}},5000);
}
function syncEntities(newEnt){
  entities=newEnt;
  for(const [id,m] of entityMeshes)if(!entities[id]){scene.remove(m);entityMeshes.delete(id)}
  for(const [id,e] of Object.entries(entities)){
    if(e.dimension!==dimension)continue;
    let m=entityMeshes.get(id);
    if(!m){
      if(e.type==="drop"){m=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),materialFor(COLORS[e.item]?e.item:"plank"))}
      else if(e.type==="projectile"){m=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,.7),new THREE.MeshStandardMaterial({color:0xeeeecc}))}
      else if(e.type==="boat"){m=new THREE.Mesh(new THREE.BoxGeometry(1.6,.35,.8),new THREE.MeshStandardMaterial({color:0x7b4c28}))}
      else if(e.type==="minecart"){m=new THREE.Mesh(new THREE.BoxGeometry(1.2,.6,.8),new THREE.MeshStandardMaterial({color:0x555555}))}
      else {const color=e.type==="hostile"?0x5f9d4a:e.type==="cow"?0x6c4b35:e.type==="sheep"?0xe8e8e8:e.type==="villager"?0xb98c68:e.type==="boss"?0x7a2d91:0xffffff;m=new THREE.Mesh(new THREE.BoxGeometry(e.type==="boss"?2.5:.9,e.type==="boss"?3:1.4,e.type==="boss"?2.5:.9),new THREE.MeshStandardMaterial({color}));}
      m.userData={entityId:id,type:e.type};scene.add(m);entityMeshes.set(id,m);
    }
    m.position.fromArray(e.pos);
    if(e.type==="drop")m.rotation.y+=.04;
  }
}

function ui(){
  if(!me)return;
  $("#health").textContent="❤ ".repeat(Math.ceil(me.health/2));
  $("#armor").textContent="◆ ".repeat(Math.ceil((me.armor||0)/2));
  $("#hunger").textContent="● ".repeat(Math.ceil(me.hunger/2));
  $("#effects").textContent=(me.effects||[]).filter(e=>e.until>Date.now()).map(e=>e.type).join(" · ");
  $("#dimensionLabel").textContent=dimension.toUpperCase();
  const hb=$("#hotbar");hb.innerHTML="";
  me.hotbar.forEach((item,i)=>{const d=document.createElement("div");d.className="hot"+(i===selected?" sel":"");const col=COLORS[item]??0x999999;d.innerHTML=`<div class="icon" style="background:#${col.toString(16).padStart(6,"0")}"></div>${i+1} ${item||"-"}<br>${me.inventory[item]||""}`;hb.appendChild(d)});
}
const recipes=["plank","crafting_table","chest","furnace","torch","wood_pickaxe","stone_pickaxe","iron_pickaxe","wood_sword","bow","arrow","rail","powered_rail","wire","lamp","obsidian","portal","boat","minecart","fishing_rod","leather_helmet","leather_chest","healing_potion"];
function inventoryUI(){
  const g=$("#inventoryGrid");g.className="grid";g.innerHTML="";
  Object.entries(me.inventory).sort().forEach(([i,c])=>{const d=document.createElement("div");d.className="inv-slot";d.innerHTML=`<b>${i}</b><span class=count>${c}</span>`;g.appendChild(d)});
  $("#equipment").innerHTML=Object.entries(me.equipment).map(([s,i])=>`<div class=equip>${s}: ${i||"empty"}</div>`).join("")+
  `<div class=equip>XP level: ${me.level||0}</div><div class=equip><button id=enchantBtn>Enchant selected tool (1 level)</button></div>`;
  setTimeout(()=>{const b=$("#enchantBtn");if(b)b.onclick=()=>{const item=me.hotbar[selected];if(item)socket.emit("enchant",{item})}},0);
  $("#craftRecipes").innerHTML=recipes.map(r=>`<div class=recipe><div><b>${r}</b><br><small>Server-validated recipe</small></div><button data-craft="${r}">Craft</button></div>`).join("");
  document.querySelectorAll("[data-craft]").forEach(b=>b.onclick=()=>socket.emit("craft",{recipe:b.dataset.craft}));
}
function achievementsUI(){
  const all=["first_block","first_craft","traveler","farmer","angler","engineer","dimension_hopper","boss_slayer"];
  $("#achievementList").innerHTML=all.map(a=>`<div class=recipe><b>${a}</b><span>${me.achievements.includes(a)?"Unlocked":"Locked"}</span></div>`).join("");
}
function toast(t){const el=$("#achievementToast");el.textContent="Achievement: "+t;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600)}

$("#joinBtn").onclick=()=>socket.emit("join",{username:$("#username").value});
$("#username").addEventListener("keydown",e=>{if(e.key==="Enter")$("#joinBtn").click()});
socket.on("joinError",e=>$("#loginError").textContent=e);
socket.on("init",d=>{
  me=d.self;dimension=me.dimension;blocks=d.dimensions[dimension].blocks;entities=d.entities;crops=d.crops;automation=d.automation;joined=true;
  camera.position.fromArray(me.pos);login.classList.add("hidden");hud.classList.remove("hidden");chatWrap.classList.remove("hidden");help.classList.remove("hidden");rebuildWorld();syncEntities(entities);d.players.filter(p=>p.dimension===dimension).forEach(addOther);ui();renderer.domElement.requestPointerLock();
});
socket.on("playerState",p=>{me=p;ui();if(!$("#inventoryScreen").classList.contains("hidden"))inventoryUI()});
socket.on("playerJoin",p=>{if(p.dimension===dimension&&!otherPlayers.has(p.id))addOther(p)});
socket.on("playerLeave",({id})=>{const o=otherPlayers.get(id);if(o){scene.remove(o.group);otherPlayers.delete(id)}});
socket.on("playerMove",d=>{const o=otherPlayers.get(d.id);if(o)o.group.position.fromArray(d.pos)});
socket.on("blockUpdate",d=>{const kk=key(d.x,d.y,d.z);if(d.type)blocks[kk]=d.type;else delete blocks[kk];rebuildWorld()});
socket.on("entitySync",syncEntities);
socket.on("tick",d=>{syncEntities(d.entities);crops=d.crops;automation=d.automation;updateSky(d.time,d.weather)});
socket.on("dimensionChange",d=>{
  dimension=d.dimension;blocks=d.blocks;camera.position.set(0,8,0);for(const o of otherPlayers.values())scene.remove(o.group);otherPlayers.clear();for(const m of entityMeshes.values())scene.remove(m);entityMeshes.clear();rebuildWorld();syncEntities(d.entities);ui();
});
socket.on("chat",d=>{addChat(`<b>${d.name}</b>: ${escapeHtml(d.text)}`);speech(d.id,d.text)});
socket.on("systemChat",t=>addChat(escapeHtml(t),true));
socket.on("achievementUnlocked",toast);
socket.on("containerData",d=>{currentContainer=d;openContainerUI(d)});
function escapeHtml(s){return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function addChat(html,sys=false){const d=document.createElement("div");d.className="chat-line"+(sys?" sys":"");d.innerHTML=html;$("#chatLog").appendChild(d);while($("#chatLog").children.length>10)$("#chatLog").firstChild.remove()}

document.addEventListener("keydown",e=>{
  if(!joined)return;
  if(chatting){if(e.key==="Enter"){const t=$("#chatInput").value;$("#chatInput").value="";$("#chatInput").style.display="none";chatting=false;socket.emit("chat",t);renderer.domElement.requestPointerLock()}return}
  keys[e.code]=true;
  if(e.code.startsWith("Digit")){const i=+e.code.slice(5)-1;if(i>=0&&i<9){selected=i;ui()}}
  if(e.code==="KeyE")openModal("inventoryScreen",inventoryUI);
  if(e.code==="KeyG")openModal("achievementsScreen",achievementsUI);
  if(e.code==="Enter"){chatting=true;document.exitPointerLock();$("#chatInput").style.display="block";$("#chatInput").focus()}
  if(e.code==="KeyQ"){const item=me.hotbar[selected];if(item)socket.emit("dropItem",{item,count:1})}
  if(e.code==="KeyR"){if((me.inventory.healing_potion||0)>0)socket.emit("consume",{item:"healing_potion"})}
  if(e.code==="KeyF")useAction();
});
document.addEventListener("keyup",e=>keys[e.code]=false);
document.addEventListener("mousemove",e=>{if(document.pointerLockElement!==renderer.domElement||chatting)return;yaw-=e.movementX*.0022;pitch=Math.max(-1.5,Math.min(1.5,pitch-e.movementY*.0022));camera.rotation.order="YXZ";camera.rotation.y=yaw;camera.rotation.x=pitch});
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
function openModal(id,cb){document.exitPointerLock();$("#"+id).classList.remove("hidden");cb&&cb()}
function closeModal(id){$("#"+id).classList.add("hidden");renderer.domElement.requestPointerLock()}

const ray=new THREE.Raycaster();ray.far=6;
function rayHit(){ray.setFromCamera(new THREE.Vector2(),camera);return ray.intersectObjects([...blockMeshes.values(),...entityMeshes.values()],false)[0]||null}
renderer.domElement.addEventListener("mousedown",e=>{if(document.pointerLockElement!==renderer.domElement)return;if(e.button===0){mouse.down=true;mineProgress=0}else if(e.button===2)rightAction()});
renderer.domElement.addEventListener("mouseup",e=>{if(e.button===0){mouse.down=false;mineProgress=0;$("#mineFill").style.width="0"}});
renderer.domElement.addEventListener("contextmenu",e=>e.preventDefault());

function toolDamage(){
  const item=me.hotbar[selected]||"";return item.includes("sword")?6:item.includes("pickaxe")?4:2;
}
function miningSpeed(type){
  const item=me.hotbar[selected]||"";
  if(["stone","cobble","coal_ore","iron_ore","gold_ore","diamond_ore","obsidian"].includes(type))return item.includes("iron_pickaxe")?3.5:item.includes("stone_pickaxe")?2.3:item.includes("wood_pickaxe")?1.4:.45;
  if(["wood","plank","chest","crafting_table"].includes(type))return 1.6;
  return 2.2;
}
function mineTick(dt){
  if(!mouse.down)return;
  const h=rayHit();if(!h)return;
  if(h.object.userData.entityId){socket.emit("attack",{entityId:h.object.userData.entityId,damage:toolDamage()});mouse.down=false;return}
  const d=h.object.userData;if(!d.type)return;
  const id=key(d.x,d.y,d.z);if(mineTarget!==id){mineTarget=id;mineProgress=0}
  mineProgress+=dt*miningSpeed(d.type);$("#mineFill").style.width=Math.min(100,mineProgress*100)+"%";
  if(mineProgress>=1){socket.emit("block",{action:"break",x:d.x,y:d.y,z:d.z});socket.emit("achievement",{id:"first_block"});mineProgress=0}
}
function rightAction(){
  const h=rayHit();if(!h)return;
  if(h.object.userData.entityId){
    const e=entities[h.object.userData.entityId];if(e&&e.type==="drop")socket.emit("pickup",{id:e.id});return;
  }
  const d=h.object.userData, type=d.type;
  if(type==="chest"||type==="furnace"){socket.emit("openContainer",{x:d.x,y:d.y,z:d.z});return}
  if(type==="portal"){socket.emit("usePortal",{target:dimension==="overworld"?"ember":dimension==="ember"?"void":"overworld"});socket.emit("achievement",{id:"dimension_hopper"});return}
  if(type==="grass"&&(me.inventory.seed||0)>0){
    socket.emit("block",{action:"break",x:d.x,y:d.y,z:d.z});setTimeout(()=>socket.emit("block",{action:"place",x:d.x,y:d.y,z:d.z,type:"farmland"}),80);return;
  }
  if(type==="farmland"&&(me.inventory.seed||0)>0){socket.emit("plant",{x:d.x,y:d.y,z:d.z});socket.emit("achievement",{id:"farmer"});return}
  const place=me.hotbar[selected];if(!COLORS[place])return;
  const n=h.face.normal,x=d.x+n.x,y=d.y+n.y,z=d.z+n.z;
  socket.emit("block",{action:"place",x,y,z,type:place});
}
function useAction(){
  const h=rayHit();
  if(h&&h.object.userData.entityId){
    const e=entities[h.object.userData.entityId];
    if(e.type==="boat"||e.type==="minecart"){riding=e.id;return}
  }
  const item=me.hotbar[selected];
  if(item==="bow"){const v=new THREE.Vector3();camera.getWorldDirection(v);socket.emit("shoot",{dir:[v.x,v.y,v.z]})}
  else if(item==="boat"||item==="minecart")socket.emit("spawnVehicle",{type:item});
  else if(item==="fishing_rod"){fishing=!fishing;setTimeout(()=>{if(fishing){socket.emit("achievement",{id:"angler"});socket.emit("chat","caught a fish");fishing=false}},2200+Math.random()*3500)}
  else if(item==="apple")socket.emit("consume",{item:"apple"});
}
function openContainerUI(d){
  openModal("containerScreen");
  $("#containerTitle").textContent=d.kind==="chest"?"Chest":"Furnace";
  const inv=Object.entries(me.inventory).map(([i,c])=>`<button data-in="${i}">${i} (${c})</button>`).join(" ");
  if(d.kind==="chest"){
    const out=Object.entries(d.data.slots).map(([i,c])=>`<button data-out="${i}">${i} (${c})</button>`).join(" ");
    $("#containerBody").innerHTML=`<div class=container-col><h3>Your inventory</h3>${inv}</div><div class=container-col><h3>Chest</h3>${out||"Empty"}</div>`;
    document.querySelectorAll("[data-in]").forEach(b=>b.onclick=()=>socket.emit("containerTransfer",{kind:"chest",id:d.id,dir:"in",item:b.dataset.in}));
    document.querySelectorAll("[data-out]").forEach(b=>b.onclick=()=>socket.emit("containerTransfer",{kind:"chest",id:d.id,dir:"out",item:b.dataset.out}));
  }else{
    const f=d.data;
    $("#containerBody").innerHTML=`<div class=container-col><h3>Your inventory</h3>${inv}</div><div class=container-col><h3>Furnace</h3>Input: ${f.input||"-"} x${f.inputCount}<br>Fuel: ${Math.floor(f.fuel)}<br>Progress: ${Math.floor(f.progress)}%<br>Output: ${f.output||"-"} x${f.outputCount}<br><button id=takeOutput>Take output</button></div>`;
    document.querySelectorAll("[data-in]").forEach(b=>b.onclick=()=>{const item=b.dataset.in;socket.emit("containerTransfer",{kind:"furnace",id:d.id,dir:item==="coal_ore"||item==="wood"?"fuel":"input",item})});
    $("#takeOutput").onclick=()=>socket.emit("containerTransfer",{kind:"furnace",id:d.id,dir:"output"});
  }
}

function move(dt){
  if(!joined||document.pointerLockElement!==renderer.domElement)return;
  let ix=0,iz=0;if(keys.KeyW)iz-=1;if(keys.KeyS)iz+=1;if(keys.KeyA)ix-=1;if(keys.KeyD)ix+=1;
  if(riding&&entities[riding]){
    const e=entities[riding],sp=e.type==="boat"?6:8;const f=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));e.pos[0]+=f.x*(-iz)*sp*dt;e.pos[2]+=f.z*(-iz)*sp*dt;camera.position.set(e.pos[0],e.pos[1]+1.8,e.pos[2]);socket.volatile.emit("vehicleMove",{id:riding,pos:e.pos});return;
  }
  if(ix||iz){const l=Math.hypot(ix,iz);ix/=l;iz/=l;const sp=(keys.ShiftLeft||keys.ShiftRight)?6.4:4.3;const f=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),r=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));const mv=new THREE.Vector3().addScaledVector(f,-iz).addScaledVector(r,ix).normalize().multiplyScalar(sp*dt);axisMove("x",mv.x);axisMove("z",mv.z)}
  if(keys.Space&&grounded){velY=6.5;grounded=false}
  const here=blocks[key(Math.round(camera.position.x),Math.floor(camera.position.y-1),Math.round(camera.position.z))];
  if(here==="water"){velY=Math.max(velY,-1.5);if(keys.Space)velY=2.2}else velY-=17.5*dt;
  const moved=axisMove("y",velY*dt);if(!moved){if(velY<0)grounded=true;velY=0}else grounded=false;
  if(camera.position.y<-15){camera.position.set(0,10,0);velY=0}
  socket.volatile.emit("move",{pos:[camera.position.x,camera.position.y,camera.position.z],yaw,pitch});
}
function updateSky(time,weather){
  const a=time*Math.PI*2, daylight=Math.max(.035,Math.sin(a)*.9+.14);
  const dawn=new THREE.Color(0xe7a06d), dayc=new THREE.Color(0x7fb4d6), night=new THREE.Color(0x050a13);
  const sky=night.clone().lerp(dayc,Math.min(1,daylight*1.18));
  if(daylight>.12&&daylight<.42)sky.lerp(dawn,.20);
  if(weather==="rain")sky.lerp(new THREE.Color(0x5f7180),.48);
  if(weather==="storm")sky.lerp(new THREE.Color(0x303842),.68);
  scene.background.copy(sky);scene.fog.color.copy(sky);
  scene.fog.near=weather==="storm"?18:weather==="rain"?25:34;
  scene.fog.far=weather==="storm"?58:weather==="rain"?70:92;
  sun.intensity=daylight*3.0*(weather==="storm"?.42:weather==="rain"?.7:1);
  hemi.intensity=.28+daylight*1.05;
  sun.color.set(daylight<.4?0xffb77a:0xfff0d2);
  sun.position.set(Math.cos(a)*42,Math.sin(a)*46,14);
  renderer.toneMappingExposure=.82+daylight*.35;
  if(dimension==="ember"){scene.background.set(0x39130d);scene.fog.color.set(0x39130d);sun.color.set(0xff6a32);sun.intensity=1.25}
  if(dimension==="void"){scene.background.set(0x05020a);scene.fog.color.set(0x05020a);sun.color.set(0x7d65cc);sun.intensity=.5}
  $("#weatherLabel").textContent=weather.toUpperCase();
}
let audioCtx=null;
function sound(freq=220,d=.06){if(!audioCtx)audioCtx=new AudioContext();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.frequency.value=freq;g.gain.value=.025;o.connect(g).connect(audioCtx.destination);o.start();g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+d);o.stop(audioCtx.currentTime+d)}
renderer.domElement.addEventListener("click",()=>sound(180,.03));

function animate(){requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);move(dt);mineTick(dt);for(const [id,e] of Object.entries(entities)){if(e.type==="drop"&&e.dimension===dimension){const dx=e.pos[0]-camera.position.x,dy=e.pos[1]-camera.position.y,dz=e.pos[2]-camera.position.z;if(dx*dx+dy*dy+dz*dz<2.4)socket.emit("pickup",{id})}}renderer.render(scene,camera)}
animate();
window.addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});

