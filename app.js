import * as THREE from 'three';
import { animate } from './vendor/anime.js';
import { createPiece,createBoard,openingPosition,squarePosition } from './models.js?v=16';
import { categories } from './content.js?v=25';
import { createDesignGallery } from './design-gallery.js?v=31';
let designGallery;
import { createSelectiveBlur } from './selective-blur.js?v=44';
let selectiveBlur;
const $=s=>document.querySelector(s);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const duration=n=>reduced.matches?1:n;
let renderer,scene,camera,board,selected=null,state='board',hovered=null,transition=null;
let pieces=[],active=[],lastTime=0,ready=false;
let openingStage='intro';
let openingTimer=0,boardTimer=0;
function setOpeningStage(stage){openingStage=stage;document.body.dataset.opening=stage;$('#opening-gate').hidden=stage==='active';}

let ambientLight,keyLight,rimLight,fillLight;
const BOARD_ANGLE=.62;
const GLOW_SQUARES=new Set(['c6','c4','e5']);
const INTERACTIVE_SQUARES=new Set(['c6','c4','e5','f3']);
const completedCollections=new Set();
let currentCollection=null;
const contactUnlocked=()=>['design','taste','experiment'].every(key=>completedCollections.has(key));
categories.contact={title:'Contact',line:'Contact',kicker:'',description:'',piece:'KNIGHT',items:[]};
function refreshContact(){const p=pieces.find(p=>p.square==='f3');if(p&&contactUnlocked()&&!p.glow){makeGlow(p);p.button.dataset.glowing='true';p.button.setAttribute('aria-label','백 나이트 f3 — Contact');}}
const CAMERA_DISTANCE=28;
const lighting={focus:0};
const view={angle:BOARD_ANGLE,azimuth:0,height:14.2,targetX:0,targetY:0,targetZ:0,fade:1};
const introEls=[$('#intro'),$('#board-note'),$('#board-instruction')];
const mobile=()=>innerWidth<=650;
const announce=text=>$('#announcement').textContent=text;
function topHeight(){if(openingStage==='active')return mobile()?7.8:7.5;return mobile()?8.16/(innerWidth/innerHeight)*1.22:Math.max(12.4,8.16/(innerWidth/innerHeight)*1.5)}
function frameCamera(){
 const a=innerWidth/innerHeight,h=view.height;
 // Match the previous framing at the target plane, with restrained perspective.
 camera.aspect=a;camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(h/(2*CAMERA_DISTANCE)));camera.updateProjectionMatrix();
 camera.position.set(view.targetX+Math.sin(view.angle)*Math.sin(view.azimuth)*CAMERA_DISTANCE,view.targetY+Math.cos(view.angle)*CAMERA_DISTANCE,view.targetZ+Math.sin(view.angle)*Math.cos(view.azimuth)*CAMERA_DISTANCE);
 camera.lookAt(view.targetX,view.targetY,view.targetZ);camera.updateMatrixWorld();
}
function opacity(group,value){group.visible=value>.003;group.userData.materials.forEach(m=>{m.opacity=value;m.depthWrite=value>.98});}
function applyFade(){opacity(board,view.fade);pieces.forEach(p=>{if(p!==selected)opacity(p.model,view.fade);if(p.glow)p.glow.visible=state==='board'||(state==='transition'&&view.fade>.65)});}
function updateLighting(t){
 lighting.focus=t;ambientLight.intensity=THREE.MathUtils.lerp(.8,.35,t);keyLight.intensity=THREE.MathUtils.lerp(2.8,.8,t);rimLight.intensity=THREE.MathUtils.lerp(2.1,7,t);fillLight.intensity=THREE.MathUtils.lerp(.8,1.1,t);
}
function makeGlow(p){
 const glow=new THREE.Group();
 const strength={value:.48};
 const meshes=[...p.model.children];
 // Back-facing shells are depth-tested against the solid model: only the
 // silhouette's exterior is visible, without brightening its surface.
 for(let layer=0;layer<6;layer++){
  const material=new THREE.ShaderMaterial({
   uniforms:{strength,spread:{value:.025+layer*.024},falloff:{value:(1-layer/7)*.30}},
   vertexShader:`uniform float spread;void main(){vec3 expanded=position+normal*spread;gl_Position=projectionMatrix*modelViewMatrix*vec4(expanded,1.);}`,
   fragmentShader:`uniform float strength;uniform float falloff;void main(){gl_FragColor=vec4(vec3(.97),strength*falloff);}`,
   transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,side:THREE.BackSide
  });
  for(const mesh of meshes){const shell=new THREE.Mesh(mesh.geometry,material);shell.position.copy(mesh.position);shell.rotation.copy(mesh.rotation);shell.renderOrder=2;shell.raycast=()=>{};glow.add(shell)}
  if(layer===0)p.glowMaterial=material;
 }
 p.model.add(glow);p.glow=glow;
 for(const material of p.model.userData.materials){material.emissive.set(0x000000);material.emissiveIntensity=0;}
}

function projectControls(){
 const marker=$('#contact-unlocked-marker'),knight=pieces.find(p=>p.square==='f3');
 marker.hidden=!(knight&&contactUnlocked()&&state==='board'&&openingStage==='active');
 if(!marker.hidden){const head=new THREE.Vector3(0,1.82,0);knight.model.updateWorldMatrix(true,false);head.applyMatrix4(knight.model.matrixWorld).project(camera);marker.style.left=((head.x+1)*innerWidth/2)+'px';marker.style.top=((-head.y+1)*innerHeight/2)+'px';}
 for(const p of active){
  const show=(state==='board'&&openingStage==='active')||(state==='focus'&&p===selected);
  p.button.hidden=!show;
  if(!show)continue;
  const v=new THREE.Vector3(p.model.position.x,p.model.position.y+(state==='focus'?.7:.75),p.model.position.z).project(camera);
  p.button.style.left=((v.x+1)*innerWidth/2)+'px';p.button.style.top=((-v.y+1)*innerHeight/2)+'px';
 }
}
function init(){
 window.setLoadingStage?.('3D 공간 준비');
 scene=new THREE.Scene();
 camera=new THREE.PerspectiveCamera(25,innerWidth/innerHeight,.1,100);
 renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.setClearColor(0x000000,0);
 renderer.domElement.setAttribute('aria-label','살짝 측면에서 내려다본 이탈리안 오프닝 3D 체스판');
 $('#canvas-container').append(renderer.domElement);
 ambientLight=new THREE.HemisphereLight(0xffffff,0x292929,.8);scene.add(ambientLight);
 keyLight=new THREE.DirectionalLight(0xffffff,2.8);keyLight.position.set(-5,8,3);keyLight.castShadow=true;keyLight.shadow.mapSize.set(2048,2048);Object.assign(keyLight.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.5,far:35});keyLight.shadow.bias=-.0004;keyLight.shadow.normalBias=.025;keyLight.shadow.radius=4;scene.add(keyLight);
 rimLight=new THREE.DirectionalLight(0xffffff,2.1);rimLight.position.set(1.5,3.5,-5);scene.add(rimLight);
 fillLight=new THREE.DirectionalLight(0xffffff,.8);fillLight.position.set(-5,2,1);scene.add(fillLight);
 board=createBoard();scene.add(board);
 window.setLoadingStage?.('32개 기물 배치');
 pieces=openingPosition().map(data=>{
  const model=createPiece(data.type,data.color);model.position.copy(squarePosition(data.square));
  if(data.type==='knight')model.rotation.y=data.color==='white'?-.35:Math.PI+.35;
  if(data.type==='bishop')model.rotation.y=.25;
  scene.add(model);return {...data,active:INTERACTIVE_SQUARES.has(data.square),category:data.square==='f3'?'contact':data.category,model,origin:model.position.clone(),originRotation:model.rotation.y};
 });
 active=pieces.filter(p=>p.active);
 for(const p of active){
  if(GLOW_SQUARES.has(p.square))makeGlow(p);
  const b=document.createElement('button');b.className='piece-hotspot';b.dataset.square=p.square;b.dataset.glowing=String(GLOW_SQUARES.has(p.square));b.setAttribute('aria-label',`${p.color==='white'?'백':'흑'} ${p.type} ${p.square} — ${categories[p.category].title}`);
  b.innerHTML=`<span class="tooltip">${categories[p.category].title} ↗</span>`;
  b.addEventListener('click',()=>activate(p));
  b.addEventListener('pointerenter',()=>hovered=p);b.addEventListener('pointerleave',()=>hovered=null);
  b.addEventListener('focus',()=>hovered=p);b.addEventListener('blur',()=>hovered=null);
  $('#piece-controls').append(b);p.button=b;
 }
 view.height=topHeight();view.targetZ=mobile()?-.85:0;
 selectiveBlur=createSelectiveBlur(renderer,scene,pieces,board);
 frameCamera();selectiveBlur.render(camera);projectControls();
 ready=true;window.finishLoading?.();
 animate('#loading',{opacity:0,duration:duration(650),onComplete:()=>$('#loading').hidden=true});
 animate(introEls,{opacity:[0,1],duration:duration(1100),ease:'outCubic'});
 animate(board.position,{y:[-.25,0],duration:duration(1400),ease:'outQuint'});
 renderer.setAnimationLoop(tick);
 renderer.domElement.addEventListener('pointermove',pointerMove);
 renderer.domElement.addEventListener('pointerleave',()=>{hovered=null;renderer.domElement.style.cursor='default'});
 renderer.domElement.addEventListener('click',canvasClick);
 renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();showFallback('3D 연결이 끊어졌습니다. 컬렉션은 계속 탐색할 수 있습니다.');});
 setOpeningStage('intro');
 const initial=location.hash.slice(1);if(categories[initial])openCollection(initial,false);
}
const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
function hit(e){
 if(!ready||(state!=='board'&&state!=='focus')||(state==='board'&&openingStage!=='active'))return null;
 pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(pointer,camera);
 const choices=state==='focus'?[selected]:active;
 const hits=ray.intersectObjects(choices.map(p=>p.model),true);
 if(!hits.length)return null;
 return choices.find(p=>{let obj=hits[0].object;while(obj){if(obj===p.model)return true;obj=obj.parent}return false});
}
function pointerMove(e){hovered=hit(e);renderer.domElement.style.cursor=hovered?'pointer':state==='focus'?'zoom-out':'default'}
function canvasClick(e){if(state==='board'&&openingStage==='preview'){pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(pointer,camera);if(ray.intersectObjects([board,...pieces.map(p=>p.model)],true).length)enterOpeningBoard();return}const p=hit(e);if(p)activate(p);else if(state==='focus')returnToBoard();else if(state==='board'&&openingStage==='active'){pointer.set(e.clientX/innerWidth*2-1,-e.clientY/innerHeight*2+1);ray.setFromCamera(pointer,camera);if(!ray.intersectObjects([board,...pieces.map(p=>p.model)],true).length)restartOpening();}}
function activate(p){if(state==='board'&&openingStage==='active')focusPiece(p);else if(state==='focus'&&p===selected)openCollection(p.category)}
function revealOpening(){
 if(!ready||state!=='board'||openingStage!=='intro')return;
 clearTimeout(openingTimer);
 const phrase=$('#opening-gate>span'),before=phrase.getBoundingClientRect();
 setOpeningStage('preview');
 const after=phrase.getBoundingClientRect();
 if(!reduced.matches)phrase.animate([{transform:`translate(${before.left-after.left}px,${before.top-after.top}px) scale(${before.width/after.width})`,opacity:1},{transform:'translate(0,0) scale(1)',opacity:1}],{duration:1300,easing:'cubic-bezier(.22,1,.36,1)'});
 projectControls();
 boardTimer=setTimeout(enterOpeningBoard,reduced.matches?350:1800);
 announce('체스판으로 이동합니다.');
}
function enterOpeningBoard(){
 if(!ready||state!=='board'||openingStage!=='preview')return;
 clearTimeout(boardTimer);
 const start={...view};setOpeningStage('active');state='transition';
 const end={height:topHeight(),targetX:0,targetY:0,targetZ:0},progress={t:0};
 transition=animate(progress,{t:1,duration:duration(1600),ease:'inOutQuint',onUpdate:()=>{for(const k in end)view[k]=THREE.MathUtils.lerp(start[k],end[k],progress.t);frameCamera();},onComplete:()=>{state='board';transition=null;projectControls();announce('표시된 말을 선택해 탐색하세요.');}});
}
$('#opening-gate').addEventListener('click',revealOpening);
document.addEventListener('keydown',e=>{if(state!=='board'||!['Enter',' '].includes(e.key)||e.target.closest('button,a')&&e.target!==$('#opening-gate'))return;if(openingStage==='intro'){e.preventDefault();revealOpening();}else if(openingStage==='preview'){e.preventDefault();enterOpeningBoard();}});
function restartOpening(){
 if(state!=='board'||openingStage!=='active')return;
 clearTimeout(openingTimer);clearTimeout(boardTimer);hovered=null;closeMenu();
 state='transition';openingStage='returning';document.body.dataset.opening='returning';
 $('#opening-gate').hidden=true;projectControls();
 const start={...view},end={height:topHeight(),targetX:0,targetY:0,targetZ:mobile()?-.85:0},progress={t:0};
 transition=animate(progress,{t:1,duration:duration(1900),ease:'inOutQuint',onUpdate:()=>{for(const k in end)view[k]=THREE.MathUtils.lerp(start[k],end[k],progress.t);frameCamera();},onComplete:()=>{
  state='board';transition=null;setOpeningStage('intro');
  // Restart the opening statement even after repeated visits.
  const phrase=$('#opening-gate>span');phrase.style.animation='none';void phrase.offsetWidth;phrase.style.animation='';
  $('#opening-gate').focus({preventScroll:true});announce('시작 화면. 화면을 클릭하면 체스판으로 이동합니다.');
 }});
}
function closeMenu(){$('#index-menu').hidden=true;$('#index-toggle').setAttribute('aria-expanded','false')}
// Frame the sculpted head, keeping the body cropped below the viewport.
function focusPose(p){
 const scale=p.type==='pawn'?4.2:p.type==='bishop'?3.2:2.8;
 const rotation=new THREE.Euler(-.12,p.type==='knight'?.12:.25,.30);
 const head=new THREE.Vector3(0,p.type==='pawn'?.89:p.type==='bishop'?1.23:1.10,0).multiplyScalar(scale).applyEuler(rotation);
 const position=new THREE.Vector3(mobile()?0:-1.08,mobile()?.95:.94,0).sub(head);
 return {scale,rotation,position,view:{angle:Math.PI/2-.055,azimuth:0,height:mobile()?3.5:2.65,targetX:mobile()?0:.28,targetY:mobile()?.18:.87,targetZ:0}};
}
function focusPiece(p){
 if(!p?.active)return;
 if(!ready)return openCollection(p.category);
 if(state==='transition')return;
 if(state==='board')history.pushState({pieceFocus:true},'',location.pathname+location.search);
 closeMenu();selected=p;state='transition';document.body.dataset.view='focus';hovered=null;
 const c=categories[p.category];$('#focus-kicker').textContent=c.kicker;$('#title-link').innerHTML=c.line;$('#title-link').setAttribute('aria-label',c.title+' 컬렉션으로 이동');const locked=p.category==='contact'&&!contactUnlocked();document.body.dataset.locked=String(locked);$('#title-link').disabled=locked;$('#title-link').classList.toggle('is-locked',locked);if(locked){$('#title-link').innerHTML='<svg class=contact-lock viewBox="0 0 100 120" fill="none" aria-hidden="true"><rect x="19" y="49" width="62" height="57" rx="10" stroke="currentColor" stroke-width="4"/><path d="M31 49V32a19 19 0 0 1 38 0v17" stroke="currentColor" stroke-width="4"/><circle cx="50" cy="74" r="5" fill="currentColor"/><path d="M50 79v10" stroke="currentColor" stroke-width="4"/></svg>';$('#title-link').setAttribute('aria-label','잠김: 세 항목을 보고 체스보드로 돌아오면 열립니다.');}$('#focus-description').textContent=c.description;$('#piece-name').textContent=`${c.piece} / ${p.square.toUpperCase()} / ${p.color.toUpperCase()}`;
 $('#focus-copy').hidden=false;$('#focus-copy').style.opacity='0';$('#focus-meta').hidden=true;$('#back-button').hidden=true;
 animate(introEls,{opacity:0,duration:duration(350)});
 const m={progress:0},start={...view},origin=p.model.position.clone(),rot=p.model.rotation.y;
 const pose=focusPose(p),finalScale=pose.scale;
 const end=pose.view;
 transition=animate(m,{progress:1,duration:duration(1700),ease:'inOutQuint',onUpdate:()=>{
  const t=m.progress;for(const k in end)view[k]=THREE.MathUtils.lerp(start[k],end[k],t);
  view.fade=1-Math.min(1,t*2.4);p.model.position.lerpVectors(origin,pose.position,t);
  p.model.rotation.y=THREE.MathUtils.lerp(rot,pose.rotation.y,t);p.model.rotation.x=pose.rotation.x*t;p.model.rotation.z=pose.rotation.z*t;p.model.scale.setScalar(THREE.MathUtils.lerp(1,finalScale,t));updateLighting(t);
  applyFade();frameCamera();projectControls();
 },onComplete:()=>{
  state='focus';transition=null;$('#back-button').hidden=false;$('#focus-meta').hidden=false;
  p.button.classList.add('focused');p.button.setAttribute('aria-label',`${c.title} 컬렉션으로 이동`);
  animate('#focus-copy',{opacity:[0,1],translateY:[18,0],duration:duration(650),ease:'outCubic'});
  projectControls();p.button.focus({preventScroll:true});announce(locked?'잠김. School project, Taste archive, Experiment를 각각 보고 돌아오면 연락처가 열립니다.':`${c.title}. 말이나 제목을 클릭하면 컬렉션으로 이동합니다.`);
 }});
}
function returnToBoard(updateHistory=true){
 if(state==='transition')return;
 if(state==='collection'&&['design','taste','experiment'].includes(currentCollection))completedCollections.add(currentCollection);
 currentCollection=null;refreshContact();$('#contact-screen').hidden=true;
 setOpeningStage('active');
 closeMenu();if(updateHistory&&location.hash)history.pushState(null,'',location.pathname+location.search);
 designGallery?.hide();delete document.body.dataset.collection;
 $('#collection').hidden=true;$('#focus-copy').hidden=true;$('#focus-meta').hidden=true;$('#back-button').hidden=true;document.body.dataset.view='board';window.scrollTo(0,0);
 if(!ready){state='board';return}
 state='transition';hovered=null;
 const p=selected,start={...view},pos=p?.model.position.clone(),rot=p?p.originRotation+Math.atan2(Math.sin(p.model.rotation.y-p.originRotation),Math.cos(p.model.rotation.y-p.originRotation)):0,startPitch=p?.model.rotation.x||0,startRoll=p?.model.rotation.z||0,startScale=p?.model.scale.x||1,startLight=lighting.focus;
 if(p)p.button.classList.remove('focused');
 const end={angle:BOARD_ANGLE,azimuth:0,height:topHeight(),targetX:0,targetY:0,targetZ:0};
 const m={progress:0};
 transition=animate(m,{progress:1,duration:duration(1400),ease:'inOutQuint',onUpdate:()=>{
  const t=m.progress;for(const k in end)view[k]=THREE.MathUtils.lerp(start[k],end[k],t);view.fade=t;
  if(p){p.model.position.lerpVectors(pos,p.origin,t);p.model.rotation.y=THREE.MathUtils.lerp(rot,p.originRotation,t);p.model.rotation.x=THREE.MathUtils.lerp(startPitch,0,t);p.model.rotation.z=THREE.MathUtils.lerp(startRoll,0,t);p.model.scale.setScalar(THREE.MathUtils.lerp(startScale,1,t))}updateLighting(startLight*(1-t));
  applyFade();frameCamera();projectControls();
 },onComplete:()=>{
  pieces.forEach(q=>{q.model.position.copy(q.origin);q.model.rotation.set(0,q.originRotation,0);q.model.scale.setScalar(1);if(q.glow)q.glow.visible=true;opacity(q.model,1)});opacity(board,1);state='board';selected=null;transition=null;
  animate(introEls,{opacity:1,duration:duration(600)});projectControls();if(p){p.button.setAttribute('aria-label',`${p.color==='white'?'백':'흑'} ${p.type} ${p.square} — ${categories[p.category].title}`);p.button.focus({preventScroll:true})}announce('이탈리안 오프닝. 4개의 말을 선택할 수 있습니다.');
 }});
}
function openCollection(key,updateHistory=true){
 const c=categories[key];if(!c||state==='transition'||(key==='contact'&&!contactUnlocked()))return;
 currentCollection=key;$('#contact-screen').hidden=true;
 closeMenu();hovered=null;state='collection';document.body.dataset.view='collection';document.body.dataset.collection=key;
 if(key==='contact'){
 designGallery?.hide();$('#collection').hidden=true;$('#contact-screen').hidden=false;$('#contact-screen').focus({preventScroll:true});
 if(updateHistory)history.pushState(null,'','#contact');
 const contactScreen=$('#contact-screen');
 contactScreen.getAnimations({subtree:true}).forEach(a=>a.cancel());
 if(!reduced.matches){
  contactScreen.animate([{transform:'translateY(100%)'},{transform:'translateY(0)'}],{duration:1100,easing:'cubic-bezier(.22,1,.36,1)'});
  contactScreen.querySelectorAll('a,p').forEach((element,i)=>element.animate([{opacity:0,transform:'translateY(30px)',filter:'blur(5px)'},{opacity:1,transform:'translateY(0)',filter:'blur(0)'}],{duration:950,delay:720+i*200,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'}));
 }
 return;
 }
 if(key==='design'){
  $('#collection').hidden=true;
  if(!designGallery)designGallery=createDesignGallery(()=>returnToBoard());
  if(updateHistory)history.pushState(null,'','#design');
  designGallery.show();announce('School project 대시보드. 양옆 이미지를 선택하거나 드래그하여 작업을 넘겨볼 수 있습니다.');return;
 }
 designGallery?.hide();$('#collection').hidden=false;$('#collection').dataset.category=key;
 $('#collection-kicker').textContent=c.kicker+' — SELECTED COLLECTION';$('#collection-title').textContent=c.title+'.';$('#collection-description').textContent=c.description;
 $('#collection-grid').innerHTML=c.items.map((item,i)=>`<button class="work-card" data-item="${i}"><div class="work-art ${item.cls}">${item.art}</div><div class="work-caption"><div><h3>${item.title}</h3><p>${item.tag}</p></div><span>↗</span></div></button>`).join('');
 $('#collection>.placeholder-note').innerHTML=key==='taste'?'<a href="https://pin.it/35yWhKkgY" target="_blank" rel="noopener noreferrer">PINTEREST / 그래픽 디자인 보드 ↗</a> · 18 IMAGES':'CONCEPT PORTFOLIO · 현재 작업물은 전시 구성을 위한 예시입니다.';
 $('#collection-grid').querySelectorAll('button').forEach(b=>b.onclick=()=>openDetail(c.items[Number(b.dataset.item)]));
 if(updateHistory)history.pushState(null,'','#'+key);
 window.scrollTo(0,0);$('#collection').focus({preventScroll:true});
 animate('#collection',{clipPath:['inset(0 0 100% 0)','inset(0 0 0% 0)'],translateY:[-55,0],duration:duration(950),ease:'outQuint'});
 animate('.collection-heading',{opacity:[0,1],translateY:[20,0],delay:duration(300),duration:duration(700),ease:'outCubic'});
 animate('.work-card',{opacity:[0,1],translateY:[40,0],delay:(_,i)=>reduced.matches?0:520+Math.min(i,8)*65,duration:duration(900),ease:'outCubic'});
 announce(c.title+' 컬렉션');
}
function openDetail(item){
 $('#detail').classList.toggle('image-detail',item.kind==='pinterest');
 if(item.kind==='pinterest'){
  $('#detail-content').innerHTML=`<img class="archive-full-image" src="${item.image}" alt="${item.title} — 그래픽 디자인 보드 이미지"><div class="archive-image-footer"><span>${item.title}</span><a href="${item.source}" target="_blank" rel="noopener noreferrer">Pinterest 원본 보기 ↗</a></div>`;
  $('#detail').showModal();return;
 }

 $('#detail-content').innerHTML=`<div class="work-art ${item.cls}">${item.art}</div><h2>${item.title}</h2><p>${item.description}</p><dl><dt>Focus</dt><dd>${item.role}</dd><dt>Process</dt><dd>${item.process}</dd></dl><p class="placeholder-note">전시 레이아웃을 위한 예시 프로젝트입니다. 실제 작업물로 교체할 수 있습니다.</p>`;
 $('#detail').showModal();
}
function tick(now){
 if(!ready||document.hidden||state==='collection')return;
 const dt=Math.min((now-lastTime)/1000,.05)||.016;lastTime=now;
 if(state==='board')for(const p of active){const isHover=hovered===p;const target=isHover&&!reduced.matches?.12:0;p.model.position.y=THREE.MathUtils.damp(p.model.position.y,target,10,dt);if(p.glowMaterial)p.glowMaterial.uniforms.strength.value=THREE.MathUtils.damp(p.glowMaterial.uniforms.strength.value,isHover?.85:.48,7,dt)}
 if(state==='focus'&&selected){
  const responding=hovered===selected&&!reduced.matches;
  const pose=focusPose(selected);
  const baseY=pose.position.y,baseScale=pose.scale,baseRotation=pose.rotation.y;
  selected.model.position.y=THREE.MathUtils.damp(selected.model.position.y,baseY+(responding?.09:0),8,dt);
  selected.model.rotation.y=THREE.MathUtils.damp(selected.model.rotation.y,baseRotation+(responding?.075:0),7,dt);
  selected.model.rotation.x=THREE.MathUtils.damp(selected.model.rotation.x,pose.rotation.x,7,dt);
  selected.model.scale.setScalar(THREE.MathUtils.damp(selected.model.scale.x,baseScale*(responding?1.025:1),8,dt));
 }
 projectControls();selectiveBlur.render(camera,view.fade);
}
function showFallback(message){ready=false;renderer?.setAnimationLoop(null);$('#loading').hidden=true;window.finishLoading?.();$('#fallback').hidden=false;$('#piece-controls').hidden=true;if(message)announce(message)}
$('#index-toggle').onclick=()=>{const open=$('#index-menu').hidden;$('#index-menu').hidden=!open;$('#index-toggle').setAttribute('aria-expanded',String(open))};
document.addEventListener('click',e=>{if(!e.target.closest('#index-menu')&&!e.target.closest('#index-toggle'))closeMenu()});
$('#home').onclick=e=>{e.preventDefault();returnToBoard()};$('#back-button').onclick=()=>returnToBoard();$('#collection-back').onclick=()=>returnToBoard();$('#collection-opening').onclick=()=>returnToBoard();$('#contact-home').onclick=()=>returnToBoard();
function enterSelected(){if(selected&&state==='focus')openCollection(selected.category)}
$('#enter-button').onclick=enterSelected;
$('#title-link').onclick=enterSelected;
$('#detail-close').onclick=()=>$('#detail').close();
$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close()}});
$('[data-select=pawn]').onclick=()=>selectType('pawn');$('[data-select=bishop]').onclick=()=>selectType('bishop');$('[data-select=knight]').onclick=()=>selectType('knight');
function selectType(type){if(state==='transition')return;const key={pawn:'design',bishop:'taste',knight:'experiment'}[type];if(state==='board'&&ready)focusPiece(active.find(p=>p.category===key));else openCollection(key)}
document.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>openCollection(b.dataset.route));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#detail').open&&!designGallery?.isDetailOpen()){if(!$('#index-menu').hidden)closeMenu();else if(state==='focus'||state==='collection')returnToBoard()}});
window.addEventListener('popstate',()=>{if(transition){transition.complete();}const route=location.hash.slice(1);if(categories[route])openCollection(route,false);else returnToBoard(false)});
window.addEventListener('resize',()=>{if(!ready)return;renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));if(state==='board'){view.height=topHeight();view.targetZ=openingStage==='active'?0:mobile()?-.85:0}else if(state==='focus'){const pose=focusPose(selected);Object.assign(view,pose.view);selected.model.position.copy(pose.position)}frameCamera();projectControls()});
try{init()}catch(error){console.error('3D setup failed',error);showFallback()}
