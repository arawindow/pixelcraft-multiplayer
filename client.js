import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.167.1/build/three.module.js";

const socket=io();
const $=s=>document.querySelector(s);
const login=$("#login"), hud=$("#hud"), chatWrap=$("#chatWrap"),help=$("#help");
let me=null, joined=false, dimension="overworld", blocks={}, entities={}, crops={}, automation={}, selected=0;
const otherPlayers=new Map(), entityMeshes=new Map();
const chunkMeshes=new Map(), chunkIndex=new Map(), dirtyChunks=new Set(), chunkBuildQueue=[];
const keys={}, mouse={down:false}, clock=new THREE.Clock();
let yaw=0,pitch=0,velY=0,grounded=false, mineTarget=null,mineProgress=0,chatting=false, currentContainer=null, riding=null, fishing=false;

const CHUNK_SIZE=16, RENDER_DISTANCE=4, SHADOW_DISTANCE=2, ENTITY_DISTANCE=52;
let lastPlayerChunk=null, lastMoveSend=0, frameAccumulator=0, frameCounter=0, adaptiveTimer=0;
let renderRatio=Math.min(devicePixelRatio,1.35);

const scene=new THREE.Scene();scene.background=new THREE.Color(0x6f9fbd);scene.fog=new THREE.Fog(0x6f9fbd,30,85);
const camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,250);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:"high-performance"});
renderer.setSize(innerWidth,innerHeight);
renderer.setPixelRatio(renderRatio);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.08;
document.body.appendChild(renderer.domElement);
const hemi=new THREE.HemisphereLight(0xddeeff,0x34402f,1.25),sun=new THREE.DirectionalLight(0xfff1d6,3.0);
sun.position.set(24,34,14);sun.castShadow=true;
sun.shadow.mapSize.set(1536,1536);sun.shadow.camera.left=-28;sun.shadow.camera.right=28;sun.shadow.camera.top=28;sun.shadow.camera.bottom=-28;
sun.shadow.bias=-0.0006;
scene.add(hemi,sun);
const fillLight=new THREE.DirectionalLight(0x9cb8ff,.28);fillLight.position.set(-20,12,-20);scene.add(fillLight);
const moonLight=new THREE.AmbientLight(0x60758d,.55);scene.add(moonLight);

const COLORS={grass:0x64a856,dirt:0x7a5739,stone:0x777777,cobble:0x666666,sand:0xd7c27c,wood:0x8a5a2b,leaves:0x3c8c43,plank:0xb98955,glass:0xbfe8ef,coal_ore:0x303030,iron_ore:0xb88f73,gold_ore:0xe5c04c,diamond_ore:0x5be1df,water:0x3f7fc9,lava:0xff5a17,farmland:0x5b381f,wheat:0xc8b84c,torch:0xffcc55,crafting_table:0x8c6a3c,furnace:0x555555,chest:0xa46a2b,rail:0x888888,powered_rail:0xc7a13b,wire:0x8a2525,lamp:0xffe894,portal:0x8c48d7,obsidian:0x252039,snow:0xf0f5ff,ice:0xa7d8ef,brick:0x9e5744};
const NON_SOLID=new Set(["water","lava","wheat","torch","wire","rail","powered_rail","portal"]);
const SOLID=new Set(Object.keys(COLORS).filter(x=>!NON_SOLID.has(x)));
const TRANSPARENT=new Set(["water","glass","ice","leaves"]);
const EMISSIVE=new Set(["lava","torch","lamp","portal"]);


// -----------------------------------------------------------------------------
// TERRAIN RENDERER
// Clean renderer: detailed individual textures + chunked InstancedMesh.
// Terrain uses MeshBasicMaterial deliberately: weather/light can change the sky,
// but terrain visibility can never disappear because of a lighting/shader issue.
// -----------------------------------------------------------------------------
const textureLoader=new THREE.TextureLoader();
const maxAniso=renderer.capabilities.getMaxAnisotropy();

const TEXTURE_FILE={
  grass:"grass_top",
  dirt:"dirt",
  stone:"stone",
  cobble:"cobble",
  sand:"sand",
  wood:"wood_side",
  leaves:"leaves",
  plank:"plank",
  glass:"glass",
  coal_ore:"coal_ore",
  iron_ore:"iron_ore",
  gold_ore:"gold_ore",
  diamond_ore:"diamond_ore",
  water:"water",
  lava:"lava",
  farmland:"farmland",
  wheat:"wheat",
  torch:"torch",
  crafting_table:"crafting_table",
  furnace:"furnace",
  chest:"chest",
  rail:"rail",
  powered_rail:"powered_rail",
  wire:"wire",
  lamp:"lamp",
  portal:"portal",
  obsidian:"obsidian",
  snow:"snow",
  ice:"ice",
  brick:"brick"
};

const textures=new Map();
const blockMaterials=new Map();

function loadBlockTexture(type){
  if(textures.has(type))return textures.get(type);
  const file=TEXTURE_FILE[type]||"stone";
  const tex=textureLoader.load(
    `/assets/textures/${file}.png`,
    undefined,
    undefined,
    err=>console.error("Texture failed:",type,file,err)
  );
  tex.colorSpace=THREE.SRGBColorSpace;
  tex.wrapS=tex.wrapT=THREE.ClampToEdgeWrapping;
  tex.magFilter=THREE.LinearFilter;
  tex.minFilter=THREE.LinearMipmapLinearFilter;
  tex.anisotropy=Math.min(8,maxAniso);
  textures.set(type,tex);
  return tex;
}

function materialForBlock(type){
  if(blockMaterials.has(type))return blockMaterials.get(type);
  const transparent=TRANSPARENT.has(type);
  const mat=new THREE.MeshBasicMaterial({
    color:0xffffff,
    map:loadBlockTexture(type),
    transparent,
    opacity:type==="water"?.72:type==="glass"?.48:type==="ice"?.72:type==="leaves"?.94:1,
    alphaTest:type==="leaves"?.06:0,
    depthWrite:!["water","glass"].includes(type),
    side:THREE.DoubleSide,
    fog:true
  });
  blockMaterials.set(type,mat);
  return mat;
}

const sharedCubeGeometry=new THREE.BoxGeometry(1,1,1);
const key=(x,y,z)=>`${x},${y},${z}`;
const floorDiv=(n,d)=>Math.floor(n/d);
const chunkKey=(cx,cz)=>`${cx},${cz}`;
function chunkForBlock(x,z){return [floorDiv(x,CHUNK_SIZE),floorDiv(z,CHUNK_SIZE)]}
function chunkForPos(x,z){return [floorDiv(Math.floor(x+.5),CHUNK_SIZE),floorDiv(Math.floor(z+.5),CHUNK_SIZE)]}

function indexWorld(){
  chunkIndex.clear();
  for(const k of Object.keys(blocks)){
    const [x,,z]=k.split(",").map(Number);
    const [cx,cz]=chunkForBlock(x,z),ck=chunkKey(cx,cz);
    if(!chunkIndex.has(ck))chunkIndex.set(ck,new Set());
    chunkIndex.get(ck).add(k);
  }
}

function updateBlockIndex(x,y,z,type){
  const k=key(x,y,z),[cx,cz]=chunkForBlock(x,z),ck=chunkKey(cx,cz);
  if(type){
    if(!chunkIndex.has(ck))chunkIndex.set(ck,new Set());
    chunkIndex.get(ck).add(k);
  }else{
    const s=chunkIndex.get(ck);
    if(s){s.delete(k);if(!s.size)chunkIndex.delete(ck)}
  }
}

function removeChunkMesh(ck){
  const rec=chunkMeshes.get(ck);
  if(!rec)return;
  scene.remove(rec.group);
  // sharedCubeGeometry and cached materials/textures are intentionally retained.
  chunkMeshes.delete(ck);
}

function clearChunks(){
  for(const ck of [...chunkMeshes.keys()])removeChunkMesh(ck);
  chunkBuildQueue.length=0;
  dirtyChunks.clear();
  lastPlayerChunk=null;
}

function isExposedBlock(x,y,z,type){
  const neighbours=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  for(const [dx,dy,dz] of neighbours){
    const n=blocks[key(x+dx,y+dy,z+dz)];
    if(!n)return true;
    if(TRANSPARENT.has(type)&&n!==type)return true;
    if(!SOLID.has(n)||TRANSPARENT.has(n)||EMISSIVE.has(n))return true;
  }
  return NON_SOLID.has(type)||EMISSIVE.has(type);
}

function buildChunk(cx,cz){
  const ck=chunkKey(cx,cz);
  removeChunkMesh(ck);

  const set=chunkIndex.get(ck);
  if(!set||!set.size)return;

  const originX=cx*CHUNK_SIZE,originZ=cz*CHUNK_SIZE;
  const byType=new Map();

  for(const k of set){
    const type=blocks[k];
    if(!type)continue;
    const [x,y,z]=k.split(",").map(Number);
    if(!isExposedBlock(x,y,z,type))continue;
    if(!byType.has(type))byType.set(type,[]);
    byType.get(type).push([x,y,z]);
  }

  const group=new THREE.Group();
  group.position.set(originX,0,originZ);
  group.name=`chunk:${ck}`;
  group.userData={cx,cz};
  group.frustumCulled=false;

  const meshes=[];
  const matrix=new THREE.Matrix4();

  for(const [type,positions] of byType){
    const mesh=new THREE.InstancedMesh(
      sharedCubeGeometry,
      materialForBlock(type),
      positions.length
    );

    mesh.name=`chunk:${ck}:${type}`;
    mesh.frustumCulled=false;
    mesh.userData={
      type,
      instanceBlocks:positions,
      layer:TRANSPARENT.has(type)?"transparent":EMISSIVE.has(type)?"emissive":"terrain"
    };

    for(let i=0;i<positions.length;i++){
      const [x,y,z]=positions[i];
      matrix.identity().setPosition(x-originX,y,z-originZ);
      mesh.setMatrixAt(i,matrix);
    }
    mesh.instanceMatrix.needsUpdate=true;
    mesh.castShadow=false;      // terrain visibility/performance first
    mesh.receiveShadow=false;   // MeshBasicMaterial ignores lighting anyway
    if(TRANSPARENT.has(type))mesh.renderOrder=2;

    group.add(mesh);
    meshes.push(mesh);
  }

  group.updateMatrixWorld(true);
  scene.add(group);
  chunkMeshes.set(ck,{cx,cz,group,meshes});
}

function queueChunk(cx,cz,front=false){
  if(chunkBuildQueue.some(q=>q[0]===cx&&q[1]===cz))return;
  front?chunkBuildQueue.unshift([cx,cz]):chunkBuildQueue.push([cx,cz]);
}

function dequeueChunk(cx,cz){
  for(let i=chunkBuildQueue.length-1;i>=0;i--){
    if(chunkBuildQueue[i][0]===cx&&chunkBuildQueue[i][1]===cz)chunkBuildQueue.splice(i,1);
  }
}

function markChunkDirty(cx,cz){
  dirtyChunks.add(chunkKey(cx,cz));
  queueChunk(cx,cz,true);
}

function markBlockDirty(x,z){
  const [cx,cz]=chunkForBlock(x,z);
  markChunkDirty(cx,cz);
  const lx=((x%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
  const lz=((z%CHUNK_SIZE)+CHUNK_SIZE)%CHUNK_SIZE;
  if(lx===0)markChunkDirty(cx-1,cz);
  if(lx===CHUNK_SIZE-1)markChunkDirty(cx+1,cz);
  if(lz===0)markChunkDirty(cx,cz-1);
  if(lz===CHUNK_SIZE-1)markChunkDirty(cx,cz+1);
}

function updateVisibleChunks(force=false){
  if(!joined)return;
  const pc=chunkForPos(camera.position.x,camera.position.z);
  if(!force&&lastPlayerChunk&&pc[0]===lastPlayerChunk[0]&&pc[1]===lastPlayerChunk[1])return;

  lastPlayerChunk=pc;
  const wanted=new Set(),order=[];

  for(let dz=-RENDER_DISTANCE;dz<=RENDER_DISTANCE;dz++){
    for(let dx=-RENDER_DISTANCE;dx<=RENDER_DISTANCE;dx++){
      if(dx*dx+dz*dz>(RENDER_DISTANCE+.35)*(RENDER_DISTANCE+.35))continue;
      const cx=pc[0]+dx,cz=pc[1]+dz,ck=chunkKey(cx,cz);
      wanted.add(ck);
      order.push([dx*dx+dz*dz,cx,cz]);
    }
  }

  for(const ck of [...chunkMeshes.keys()]){
    if(!wanted.has(ck))removeChunkMesh(ck);
  }

  order.sort((a,b)=>a[0]-b[0]);
  for(const [,cx,cz] of order){
    if(!chunkMeshes.has(chunkKey(cx,cz)))queueChunk(cx,cz);
  }
}

function processChunkQueue(){
  // One chunk per frame prevents long pauses. Spawn chunks are built synchronously.
  if(!chunkBuildQueue.length)return;
  const [cx,cz]=chunkBuildQueue.shift();
  if(lastPlayerChunk){
    const d=Math.max(Math.abs(cx-lastPlayerChunk[0]),Math.abs(cz-lastPlayerChunk[1]));
    if(d>RENDER_DISTANCE+1)return;
  }
  buildChunk(cx,cz);
  dirtyChunks.delete(chunkKey(cx,cz));
}

function updateRenderDebug(){
  if(!joined)return;
  let instances=0,drawMeshes=0;
  for(const rec of chunkMeshes.values()){
    for(const m of rec.meshes){
      instances+=m.count||0;
      if(m.parent&&m.visible)drawMeshes++;
    }
  }
  const p=camera.position;
  $("#objective").textContent=
    `${Object.keys(blocks).length} blocks · ${chunkMeshes.size} chunks · `+
    `${drawMeshes} draw meshes · ${instances} instances · `+
    `camera ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`;
}

function rebuildWorld(){
  clearChunks();
  indexWorld();
  updateVisibleChunks(true);
}

function blockBox(x,y,z){
  return {minX:x-.5,maxX:x+.5,minY:y-.5,maxY:y+.5,minZ:z-.5,maxZ:z+.5};
}

function playerBox(x,y,z){
  return {minX:x-.32,maxX:x+.32,minY:y-1.65,maxY:y+.15,minZ:z-.32,maxZ:z+.32};
}

function collides(b){
  for(let x=Math.floor(b.minX-.5);x<=Math.floor(b.maxX+.5);x++){
    for(let y=Math.floor(b.minY-.5);y<=Math.floor(b.maxY+.5);y++){
      for(let z=Math.floor(b.minZ-.5);z<=Math.floor(b.maxZ+.5);z++){
        const t=blocks[key(x,y,z)];
        if(!t||!SOLID.has(t))continue;
        const q=blockBox(x,y,z);
        if(
          b.maxX>q.minX&&b.minX<q.maxX&&
          b.maxY>q.minY&&b.minY<q.maxY&&
          b.maxZ>q.minZ&&b.minZ<q.maxZ
        )return true;
      }
    }
  }
  return false;
}

function axisMove(axis,amount){
  const steps=Math.max(1,Math.ceil(Math.abs(amount)/.08));
  const step=amount/steps;
  for(let i=0;i<steps;i++){
    const p=camera.position.clone();
    p[axis]+=step;
    if(collides(playerBox(p.x,p.y,p.z)))return false;
    camera.position[axis]+=step;
  }
  return true;
}

function surfaceYAt(x,z){
  x=Math.round(x);z=Math.round(z);
  for(let y=30;y>-15;y--){
    const t=blocks[key(x,y,z)];
    if(t&&SOLID.has(t)&&!blocks[key(x,y+1,z)]&&!blocks[key(x,y+2,z)])return y;
  }
  return null;
}

function findSafeSpawn(preferred){
  // Prefer saved position only if it is still inside the generated populated world.
  const sx=Number(preferred?.[0]),sz=Number(preferred?.[2]);
  const candidates=[];
  if(Number.isFinite(sx)&&Number.isFinite(sz)&&Math.abs(sx)<=40&&Math.abs(sz)<=40){
    candidates.push([Math.round(sx),Math.round(sz)]);
  }
  candidates.push([0,0]);

  for(const [ox,oz] of candidates){
    for(let radius=0;radius<=16;radius++){
      for(let dz=-radius;dz<=radius;dz++){
        for(let dx=-radius;dx<=radius;dx++){
          if(radius&&Math.abs(dx)!==radius&&Math.abs(dz)!==radius)continue;
          const x=ox+dx,z=oz+dz,y=surfaceYAt(x,z);
          if(y!==null)return [x,y+2.15,z];
        }
      }
    }
  }
  return [0,8,0];
}

function recoverCameraIfInvalid(){
  const p=camera.position;
  const invalid=
    !Number.isFinite(p.x)||!Number.isFinite(p.y)||!Number.isFinite(p.z)||
    p.y<-12||p.y>40||collides(playerBox(p.x,p.y,p.z));

  if(invalid){
    const safe=findSafeSpawn([p.x,p.y,p.z]);
    camera.position.fromArray(safe);
    velY=0;
  }
}

function materialFor(t){
  // Entity/drop fallback; terrain uses the cached detailed materials above.
  return new THREE.MeshBasicMaterial({color:COLORS[t]||0xb0b0b0});
}
function spriteText(text,color="#fff"){
  const c=document.createElement("canvas"),ctx=c.getContext("2d");c.width=512;c.height=128;ctx.font="bold 40px Arial";ctx.textAlign="center";ctx.fillStyle="rgba(0,0,0,.45)";ctx.fillRect(0,32,512,64);ctx.fillStyle=color;ctx.fillText(text,256,78);
  const tex=new THREE.CanvasTexture(c),mat=new THREE.SpriteMaterial({map:tex,transparent:true}),s=new THREE.Sprite(mat);s.scale.set(4,1,1);return s;
}
function addOther(p){
  const g=new THREE.Group(),body=new THREE.Mesh(new THREE.BoxGeometry(.7,1.3,.45),new THREE.MeshStandardMaterial({color:0x4a7ec7})),head=new THREE.Mesh(new THREE.BoxGeometry(.65,.65,.65),new THREE.MeshStandardMaterial({color:0xd9aa7d}));
  body.position.y=.65;head.position.y=1.65;g.add(body,head);const tag=spriteText(p.name);tag.position.y=2.35;g.add(tag);g.position.fromArray(p.pos);scene.add(g);otherPlayers.set(p.id,{group:g,tag,speech:null,target:new THREE.Vector3(...p.pos)});
}
function speech(id,text){
  const o=otherPlayers.get(id);if(!o)return;if(o.speech)o.group.remove(o.speech);o.speech=spriteText(text,"#ffe68a");o.speech.position.y=2.9;o.group.add(o.speech);setTimeout(()=>{if(o.speech){o.group.remove(o.speech);o.speech=null}},5000);
}
function syncEntities(newEnt){
  entities=newEnt;
  const px=camera.position.x,pz=camera.position.z,maxD2=ENTITY_DISTANCE*ENTITY_DISTANCE;
  for(const [id,m] of entityMeshes){
    const e=entities[id];
    if(!e||e.dimension!==dimension||((e.pos[0]-px)**2+(e.pos[2]-pz)**2>maxD2)){scene.remove(m);entityMeshes.delete(id)}
  }
  for(const [id,e] of Object.entries(entities)){
    if(e.dimension!==dimension||((e.pos[0]-px)**2+(e.pos[2]-pz)**2>maxD2))continue;
    let m=entityMeshes.get(id);
    if(!m){
      if(e.type==="drop"){m=new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),materialFor(e.item))}
      else if(e.type==="projectile"){m=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,.7),new THREE.MeshStandardMaterial({color:0xeeeecc}))}
      else if(e.type==="boat"){m=new THREE.Mesh(new THREE.BoxGeometry(1.6,.35,.8),new THREE.MeshStandardMaterial({color:0x7b4c28,roughness:.7}))}
      else if(e.type==="minecart"){m=new THREE.Mesh(new THREE.BoxGeometry(1.2,.6,.8),new THREE.MeshStandardMaterial({color:0x555555,metalness:.35,roughness:.55}))}
      else {const color=e.type==="hostile"?0x5f9d4a:e.type==="cow"?0x6c4b35:e.type==="sheep"?0xe8e8e8:e.type==="villager"?0xb98c68:e.type==="boss"?0x7a2d91:0xffffff;m=new THREE.Mesh(new THREE.BoxGeometry(e.type==="boss"?2.5:.9,e.type==="boss"?3:1.4,e.type==="boss"?2.5:.9),new THREE.MeshStandardMaterial({color,roughness:.8}))}
      m.userData={entityId:id,type:e.type,target:new THREE.Vector3(...e.pos)};m.position.fromArray(e.pos);m.castShadow=e.type!=="drop";scene.add(m);entityMeshes.set(id,m);
    }else m.userData.target.set(...e.pos);
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
  me=d.self;
  dimension=me.dimension;
  blocks=(d.dimensions?.[dimension]?.blocks)||{};
  entities=d.entities||{};
  crops=d.crops||{};
  automation=d.automation||{};
  joined=true;

  indexWorld();
  const safe=findSafeSpawn(me.pos);
  camera.position.fromArray(safe);
  me.pos=[...safe];

  // Known deterministic starting orientation: toward -Z and clearly downward.
  yaw=0;
  pitch=-0.38;
  camera.rotation.order="YXZ";
  camera.rotation.set(pitch,yaw,0);

  clearChunks();
  indexWorld();
  lastPlayerChunk=chunkForPos(camera.position.x,camera.position.z);

  // Build a 5x5 square synchronously around spawn. This guarantees terrain
  // exists before the login overlay is hidden.
  for(let dz=-2;dz<=2;dz++){
    for(let dx=-2;dx<=2;dx++){
      buildChunk(lastPlayerChunk[0]+dx,lastPlayerChunk[1]+dz);
    }
  }
  updateVisibleChunks(true);

  login.classList.add("hidden");
  hud.classList.remove("hidden");
  chatWrap.classList.remove("hidden");
  help.classList.remove("hidden");

  syncEntities(entities);
  (d.players||[]).filter(p=>p.dimension===dimension).forEach(addOther);
  ui();
  updateRenderDebug();

  renderer.render(scene,camera);
  renderer.domElement.requestPointerLock();
});
socket.on("playerState",p=>{me=p;ui();if(!$("#inventoryScreen").classList.contains("hidden"))inventoryUI()});
socket.on("playerJoin",p=>{if(p.dimension===dimension&&!otherPlayers.has(p.id))addOther(p)});
socket.on("playerLeave",({id})=>{const o=otherPlayers.get(id);if(o){scene.remove(o.group);otherPlayers.delete(id)}});
socket.on("playerMove",d=>{const o=otherPlayers.get(d.id);if(o)o.target.set(...d.pos)});
socket.on("blockUpdate",d=>{
  const kk=key(d.x,d.y,d.z);
  if(d.type)blocks[kk]=d.type;else delete blocks[kk];
  updateBlockIndex(d.x,d.y,d.z,d.type);markBlockDirty(d.x,d.z);
});
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
function rayHit(){
  ray.setFromCamera(new THREE.Vector2(0,0),camera);
  const terrain=[];
  for(const rec of chunkMeshes.values())terrain.push(...rec.meshes);
  const h=ray.intersectObjects([...terrain,...entityMeshes.values()],false)[0]||null;

  if(h&&!h.object.userData.entityId&&h.object.isInstancedMesh&&Number.isInteger(h.instanceId)){
    const pos=h.object.userData.instanceBlocks?.[h.instanceId];
    if(pos){
      const [x,y,z]=pos;
      const n=(h.face?.normal||new THREE.Vector3(0,1,0)).clone();
      h.blockData={x,y,z,type:blocks[key(x,y,z)],normal:n};
    }
  }
  return h;
}
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
  const d=h.blockData;if(!d||!d.type)return;
  const id=key(d.x,d.y,d.z);if(mineTarget!==id){mineTarget=id;mineProgress=0}
  mineProgress+=dt*miningSpeed(d.type);$("#mineFill").style.width=Math.min(100,mineProgress*100)+"%";
  if(mineProgress>=1){socket.emit("block",{action:"break",x:d.x,y:d.y,z:d.z});socket.emit("achievement",{id:"first_block"});mineProgress=0}
}
function rightAction(){
  const h=rayHit();if(!h)return;
  if(h.object.userData.entityId){
    const e=entities[h.object.userData.entityId];if(e&&e.type==="drop")socket.emit("pickup",{id:e.id});return;
  }
  const d=h.blockData;if(!d)return; const type=d.type;
  if(type==="chest"||type==="furnace"){socket.emit("openContainer",{x:d.x,y:d.y,z:d.z});return}
  if(type==="portal"){socket.emit("usePortal",{target:dimension==="overworld"?"ember":dimension==="ember"?"void":"overworld"});socket.emit("achievement",{id:"dimension_hopper"});return}
  if(type==="grass"&&(me.inventory.seed||0)>0){
    socket.emit("block",{action:"break",x:d.x,y:d.y,z:d.z});setTimeout(()=>socket.emit("block",{action:"place",x:d.x,y:d.y,z:d.z,type:"farmland"}),80);return;
  }
  if(type==="farmland"&&(me.inventory.seed||0)>0){socket.emit("plant",{x:d.x,y:d.y,z:d.z});socket.emit("achievement",{id:"farmer"});return}
  const place=me.hotbar[selected];if(!COLORS[place])return;
  const n=d.normal,x=d.x+Math.round(n.x),y=d.y+Math.round(n.y),z=d.z+Math.round(n.z);
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
  updateVisibleChunks();
  const now=performance.now();
  if(now-lastMoveSend>80){lastMoveSend=now;socket.volatile.emit("move",{pos:[camera.position.x,camera.position.y,camera.position.z],yaw,pitch});}
}
function updateSky(time,weather){
  const a=time*Math.PI*2;
  const daylight=Math.max(.18,Math.sin(a)*.65+.42);
  const dayc=new THREE.Color(0x79a8c6);
  const night=new THREE.Color(0x162434);
  const sky=night.clone().lerp(dayc,daylight);

  if(weather==="rain")sky.lerp(new THREE.Color(0x596976),.35);
  if(weather==="storm")sky.lerp(new THREE.Color(0x3b4650),.5);

  scene.background.copy(sky);
  scene.fog.color.copy(sky);
  scene.fog.near=48;
  scene.fog.far=120;

  // Lighting remains for players/entities only.
  sun.intensity=.5+daylight*1.8;
  hemi.intensity=.7+daylight*.6;
  sun.position.set(camera.position.x+30,38,camera.position.z+18);

  if(dimension==="ember"){
    scene.background.set(0x4a1d14);
    scene.fog.color.set(0x4a1d14);
  }
  if(dimension==="void"){
    scene.background.set(0x120c1b);
    scene.fog.color.set(0x120c1b);
  }
  $("#weatherLabel").textContent=weather.toUpperCase();
}
let audioCtx=null;
function sound(freq=220,d=.06){if(!audioCtx)audioCtx=new AudioContext();const o=audioCtx.createOscillator(),g=audioCtx.createGain();o.frequency.value=freq;g.gain.value=.025;o.connect(g).connect(audioCtx.destination);o.start();g.gain.exponentialRampToValueAtTime(.0001,audioCtx.currentTime+d);o.stop(audioCtx.currentTime+d)}
renderer.domElement.addEventListener("click",()=>sound(180,.03));

function animate(){
  requestAnimationFrame(animate);
  const dt=Math.min(clock.getDelta(),.05);
  move(dt);recoverCameraIfInvalid();updateVisibleChunks();mineTick(dt);processChunkQueue();
  for(const o of otherPlayers.values())o.group.position.lerp(o.target,Math.min(1,dt*12));
  for(const [id,m] of entityMeshes){
    const e=entities[id];
    if(e&&m.userData.target)m.position.lerp(m.userData.target,Math.min(1,dt*9));
    if(e&&e.type==="drop")m.rotation.y+=dt*2.2;
  }
  for(const [id,e] of Object.entries(entities)){
    if(e.type==="drop"&&e.dimension===dimension){
      const dx=e.pos[0]-camera.position.x,dy=e.pos[1]-camera.position.y,dz=e.pos[2]-camera.position.z;
      if(dx*dx+dy*dy+dz*dz<2.4)socket.emit("pickup",{id});
    }
  }
  // Adaptive internal resolution preserves texture detail but avoids GPU overload.
  frameAccumulator+=dt;frameCounter++;adaptiveTimer+=dt;
  if(adaptiveTimer>1.0){
    updateRenderDebug();
    const fps=frameCounter/Math.max(.001,frameAccumulator);
    let next=renderRatio;
    if(fps<42)next=Math.max(.85,renderRatio-.12);
    else if(fps>57)next=Math.min(Math.min(devicePixelRatio,1.5),renderRatio+.08);
    if(Math.abs(next-renderRatio)>.03){renderRatio=next;renderer.setPixelRatio(renderRatio);renderer.setSize(innerWidth,innerHeight,false)}
    adaptiveTimer=0;frameAccumulator=0;frameCounter=0;
  }
  renderer.render(scene,camera);
}
window.addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});

