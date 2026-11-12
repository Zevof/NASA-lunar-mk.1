import * as THREE from 'three';
import {enable as enableControls, update as updateControls, setMode as setControlMode, focusBody as focusControlBody, getCamera as getControlCamera, reset as resetControls, zoom as zoomControls, setExternalTarget, setSuspended as setControlsSuspended} from './controls-core.mjs';
import {parseLolaTiff,sampleHeightKm,surfacePointKm,makeHorizonProfile,lightingAndContact,maxDisplacementFor,loadHeightmap,buildDisplacement,setThree as setTerrainThree,generateProceduralHeightmap} from './terrain-core.mjs';
import {planRoute,getActiveRoute,setActiveRoute,loadCityOptions,findCity,searchCities,PLANET_OPTIONS} from './route-core.mjs';
import {MOON_R_KM,RAD,dot,mag,unit,mul,normal,clamp,azElToTarget,triangulate,candidateTransfers,clearLineToBody} from './nav-core.mjs';
import {previewFrames,surveyTransfers,earthSiteDirectionECI,moonFrame,lerpFrame} from './earth-route-core.mjs';
// Side-effect import: publishes window.LLP.DataSources (PLANET_DATA + MOON_DATA
// with every official moon texture) so solar-system-core can merge it in.
import './planet-data-sources.mjs';
// Planets registry: publishes window.LLP.Planets (get/list/PLANETS) used by
// route-core for richer planet specs than its internal fallback table.
import * as PlanetsRegistry from './planets-core.mjs';
PlanetsRegistry.loadAll().catch(err => console.warn('[app] planet registry load failed:', err && err.message));
import {MOON_RADIUS_KM as M_RADIUS,EARTH_RADIUS_KM,SUN_RADIUS_KM,KM_TO_VIEW,bodyRadius,scenePositions,heightFromEarthImageByte,fuzzyCityPresets} from './scale-core.mjs';
import {SOLAR_BODIES,ORBIT_PERIOD_DAYS,ROTATION_MODELS,AU_KM,planetPositionKm,displayPlanetVector,rotationAngleDeg,shiftUTCYears,pickIsClick,rankRoutes} from './solar-system-core.mjs';
import {planLunarSurfaceRoute,wrapLongitude} from './moon-surface-core.mjs';
import {LANDING_SITES,getSite,normaliseCoordinates,siteMetrics,compareSites,siteTimeSeries} from './landing-sites-core.mjs';
import {tweenCamera} from './scene-tween.mjs';
import {sunlightDirectionFromPositions} from './sunlight-core.mjs';
const $=id=>document.getElementById(id);
const elevation=(n,d)=>Math.asin(clamp(dot(n,d),-1,1))/RAD;
const vec=d=>new THREE.Vector3(d[0],d[2],d[1]); // Moon +X,+Z,+Y => Three.js x,y,z
const kmVec=p=>vec(mul(p,2.5/MOON_R_KM));
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(37,1,.1,650000);
camera.position.set(0,2.5,9);
// 3D-Routen-Layer früh deklarieren, damit frühe Render-Aufrufe (TDZ) nicht crashen.
const routeDrawLayer = new THREE.Group(); routeDrawLayer.name = 'Active route (city/planet)'; scene.add(routeDrawLayer);
let drawRoute3D = true;
// Early-declared world-space centres so early render calls cannot hit the
// temporal dead zone (these are populated once orbital frames are computed).
let earthCentre=new THREE.Vector3(),sunCentre=new THREE.Vector3();
let sunlightTargetBody='moon';
const renderer=new THREE.WebGLRenderer({canvas:$('moonCanvas'),antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
// Verwende controls-core anstelle von Three.js OrbitControls
// A lightweight controls façade over controls-core. `target` is a REAL
// THREE.Vector3 so all callers (copy/set/lerp/clone/distanceTo/sub/add/
// multiplyScalar) behave exactly like OrbitControls.target.
// Every mutation of `target` (or an explicit update()) forwards the new
// look-at point to controls-core, so programmatic camera moves (view
// switching, focusBody, planet focus, tweens) are honoured instead of being
// overwritten by the controls' own orbit state on the next frame.
const controlsTarget = new THREE.Vector3(0, 0, 0);
function publishControlsTarget() {
  if (typeof setExternalTarget === 'function') {
    setExternalTarget({ x: controlsTarget.x, y: controlsTarget.y, z: controlsTarget.z });
  }
}
for (const m of ['set', 'copy', 'lerp', 'add', 'addScaledVector', 'sub', 'multiplyScalar', 'setScalar']) {
  const orig = controlsTarget[m];
  if (typeof orig === 'function') {
    controlsTarget[m] = function (...args) {
      const r = orig.apply(this, args);
      publishControlsTarget();
      return r;
    };
  }
}
const controls = {
  target: controlsTarget,
  update() { publishControlsTarget(); }
};
enableControls(camera, scene);
window.LLP = window.LLP || {};
window.LLP.camera = camera;
window.LLP.scene = scene;
// The Sun is the ONLY light source. One directional light (id="sunLight")
// feeds every lit mesh in the scene: planets, Earth (layer 1), Moon (layer 2),
// and any body added later. No ambient/hemisphere/point light exists.
// Per-frame position comes from sunlightDirectionFromPositions(sunWorld, bodyWorld).
const sunLight=new THREE.DirectionalLight(0xffffff,2.1);
sunLight.name='sunLight';
sunLight.id='sunLight';
sunLight.castShadow=true;
sunLight.shadow.mapSize.set(2048,2048);
sunLight.shadow.bias=-.00015;
sunLight.shadow.camera.near=0.01;
sunLight.shadow.camera.far=650000;
sunLight.layers.enableAll();
sunLight.target.position.set(0,0,0);
scene.add(sunLight,sunLight.target);
window.LLP.sunLight=sunLight;
// Backwards-compatible aliases: all point at the SAME sunLight instance.
const moonSunlight=sunLight, earthSunlight=sunLight, solarKeyLight=sunLight;
camera.layers.enable(1);camera.layers.enable(2);
// Real NASA LOLA elevations: a displaced mesh, not just a color texture.
let terrain=null,terrainProfile=null,terrainLoaded=false,terrainRequest=0;
let visualHeightScale=1,moon,moonGeometry,localPatch=null;
function visualRadius(lat,lon,additional=.0){return 2.5*(MOON_R_KM+sampleHeightKm(terrain,lat,lon)*visualHeightScale)/MOON_R_KM+additional;}
function heightColor(height){
 if(height<0){const t=clamp((height+10)/10,0,1);return [.18+.12*t,.29+.15*t,.49+.18*t];}
 const t=clamp(height/10,0,1);return [.30+.39*t,.56+.29*t,.58+.27*t];
}
function newMoonGeometry(slices,stacks){
 const vertices=[],uvs=[],colors=[],indices=[];
 for(let j=0;j<=stacks;j++){
  const lat=90-j*180/stacks,latr=lat*RAD;
  for(let i=0;i<=slices;i++){
   const lon=-180+360*i/slices,lonr=lon*RAD;
   const h=sampleHeightKm(terrain,lat,lon),r=2.5*(MOON_R_KM+h*visualHeightScale)/MOON_R_KM;
   vertices.push(r*Math.cos(latr)*Math.cos(lonr),r*Math.sin(latr),r*Math.cos(latr)*Math.sin(lonr));
   uvs.push(i/slices,1-j/stacks);
   const c=heightColor(h);colors.push(...c);
  }
 }
 for(let j=0;j<stacks;j++)for(let i=0;i<slices;i++){
  const a=j*(slices+1)+i,b=a+slices+1;indices.push(a,a+1,b,b,a+1,b+1);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
moonGeometry=newMoonGeometry(360,180);
// Local texture (downloaded from NASA LRO CGI Moon Kit) — avoids a
// NASA-server CORS block that would otherwise leave the Moon untextured.
const texture=new THREE.TextureLoader().load('/textures/moon.jpg',undefined,undefined,()=>{
 $('terrainStatus').textContent+=' · Lunar color texture could not be loaded.';
});texture.colorSpace=THREE.SRGBColorSpace;
const moonBump=new THREE.TextureLoader().load('/textures/moon_bump.jpg');
const moonMaterial=new THREE.MeshStandardMaterial({map:texture,roughness:1,metalness:0,side:THREE.DoubleSide,bumpMap:moonBump,bumpScale:0.04});
moon=new THREE.Mesh(moonGeometry,moonMaterial);moon.castShadow=true;moon.receiveShadow=true;moon.layers.set(2);scene.add(moon);
// In the grid mode, blue/cyan lines are displaced to measured surface heights.
// Vertical struts lead back to the reference radius (zero elevation), showing
// positive elevations, negative depths, and the middle/reference sphere.
// Layer visibility flags — declared early so setView() can read them on the
// very first call (before wireLayerPanel runs). Must be a `var`/early `const`.
const layerVisibility = { planets: true, orbits: true, labels: true, grid: true };
const gridLayer=new THREE.Group();gridLayer.name='LOLA 3D altitude/depth grid';scene.add(gridLayer);
function gridLine(points,color,opacity=.65){
 const g=new THREE.BufferGeometry().setFromPoints(points);
 const mat=new THREE.LineBasicMaterial({color,transparent:true,opacity,depthTest:true,depthWrite:false});
 gridLayer.add(new THREE.Line(g,mat));
}
function surfaceNormalPoint(lat,lon,r){return vec(mul(normal(lat,lon),r));}
function rebuildGrid(){
 while(gridLayer.children.length){const obj=gridLayer.children[0];gridLayer.remove(obj);obj.geometry.dispose();obj.material.dispose();}
 const isGrid=$('groundMode').value==='grid3d',step=Number($('gridStep').value),alpha=Number($('gridOpacity').value)/100;
 gridLayer.visible=isGrid;
 moonMaterial.map=isGrid?null:texture;
 moonMaterial.vertexColors=isGrid;
 moonMaterial.color.set(0xffffff);moonMaterial.needsUpdate=true;
 if(!isGrid)return;
 for(let lat=-90+step;lat<90;lat+=step){
  const topo=[],zero=[];
  for(let lon=-180;lon<=180;lon+=1){topo.push(surfaceNormalPoint(lat,lon,visualRadius(lat,lon,.007)));zero.push(surfaceNormalPoint(lat,lon,2.5));}
  gridLine(topo,0x95f3ff,alpha);gridLine(zero,0x426a9e,alpha*.35);
 }
 for(let lon=-180;lon<180;lon+=step){
  const topo=[],zero=[];
  for(let lat=-90;lat<=90;lat+=1){topo.push(surfaceNormalPoint(lat,lon,visualRadius(lat,lon,.007)));zero.push(surfaceNormalPoint(lat,lon,2.5));}
  gridLine(topo,0x95f3ff,alpha);gridLine(zero,0x426a9e,alpha*.35);
 }
 const ups=[],downs=[];
 for(let lat=-90+step;lat<90;lat+=step)for(let lon=-180;lon<180;lon+=step){
  const h=sampleHeightKm(terrain,lat,lon),end=surfaceNormalPoint(lat,lon,visualRadius(lat,lon,.008)),base=surfaceNormalPoint(lat,lon,2.5);
  (h>=0?ups:downs).push(base,end);
 }
 for(const [points,color] of [[ups,0x75ebc5],[downs,0xffa38c]]){
  if(!points.length)continue;
  const g=new THREE.BufferGeometry().setFromPoints(points);
  gridLayer.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,transparent:true,opacity:alpha,depthWrite:false})));
 }
}
function rebuildMoon(){
 const resolution=$('meshDensity').value;const divisions=resolution==='high'?720:resolution==='medium'?360:180;
 const next=newMoonGeometry(divisions,divisions/2);
 const old=moon.geometry;moon.geometry=next;if(moonWire){moonWire.geometry=next;}old.dispose();
 rebuildGrid();updateMarker();
 if(localPatch){removeLocalPatch();createLocalPatch();}
}
function removeLocalPatch(){
 if(!localPatch)return;scene.remove(localPatch);localPatch.geometry.dispose();localPatch.material.dispose();localPatch=null;
}
function createLocalPatch(){
 removeLocalPatch();if(!terrain)return;
 const lat=clamp(Number($('lat').value),-90,90),lon=Number($('lon').value);
 const dlat=5,dlon=Math.min(50,5/Math.max(.15,Math.cos(lat*RAD)));
 const samplePerDegree=terrain.width/360;const slices=Math.min(300,Math.ceil(2*dlon*samplePerDegree)),stacks=Math.min(300,Math.ceil(2*dlat*samplePerDegree));
 const pos=[],uv=[],ids=[];
 for(let j=0;j<=stacks;j++){
  const la=clamp(lat+dlat-2*dlat*j/stacks,-90,90);
  for(let i=0;i<=slices;i++){
   const lo=lon-dlon+2*dlon*i/slices;
   const n=normal(la,lo),r=visualRadius(la,lo,.0025);
   pos.push(r*n[0],r*n[2],r*n[1]);uv.push((((lo+180)/360)%1+1)%1,(la+90)/180);
  }
 }
 for(let j=0;j<stacks;j++)for(let i=0;i<slices;i++){
  const a=j*(slices+1)+i,b=a+slices+1;ids.push(a,a+1,b,b,a+1,b+1);
 }
 const geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geom.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geom.setIndex(ids);geom.computeVertexNormals();
 localPatch=new THREE.Mesh(geom,new THREE.MeshStandardMaterial({map:texture,roughness:1,side:THREE.DoubleSide}));
 localPatch.castShadow=true;localPatch.receiveShadow=true;localPatch.layers.set(2);localPatch.visible=$('groundMode').value==='relief'&&$('viewMode').value==='moon';scene.add(localPatch);
}
function focusSite(){
 $('viewMode').value='moon';setView();createLocalPatch();
 const loc=vec(site()),r=visualRadius(Number($('lat').value),Number($('lon').value));
 controls.target.copy(loc.clone().multiplyScalar(r));camera.position.copy(loc.clone().multiplyScalar(r+.64));
 camera.position.add(new THREE.Vector3(.12,.08,.11));controls.update();
}
function resetCamera(){removeLocalPatch();$('viewMode').value='moon';setView();controls.target.set(0,0,0);camera.position.set(0,2.5,9);controls.update();}
async function loadTerrain(){
 const thisRequest=++terrainRequest,res=$('terrainResolution').value;
 $('terrainStatus').textContent='Downloading NASA LOLA elevation data ('+(res==='coarse'?'2 MB':'32 MB')+') …';
 try{
  const resp=await fetch('/api/terrain?resolution='+res);
  if(!resp.ok)throw Error('HTTP '+resp.status+': '+(await resp.text()).slice(0,160));
  const dem=parseLolaTiff(await resp.arrayBuffer());
  if(thisRequest!==terrainRequest)return;
  terrain=dem;terrainLoaded=true;
  $('terrainStatus').textContent=`LOLA loaded: ${dem.width} × ${dem.height} elevation samples · heights in km relative to the 1737.4 km reference sphere.`;
  rebuildMoon();refreshHorizon();if(typeof renderSurfaceRoute==='function')renderSurfaceRoute();if(typeof drawMoonSurfaceMap==='function')drawMoonSurfaceMap();if(frames.length){show(selected);windows();}
 }catch(err){if(thisRequest!==terrainRequest)return;
  terrain=null;terrainLoaded=false;rebuildMoon();refreshHorizon();
  $('terrainStatus').textContent='NASA terrain unavailable: '+err.message+'. Using a spherical Moon without invented craters.';
 }
}
function refreshHorizon(){
 const lat=clamp(Number($('lat').value),-90,90),lon=clamp(Number($('lon').value),-180,180);
 terrainProfile=terrain?makeHorizonProfile(terrain,lat,lon,5):null;
 $('terrainHorizonLabel').textContent=terrain?'NASA LOLA · terrain-aware':'No elevation data · spherical horizon';
}
$('groundMode').addEventListener('change',()=>{rebuildGrid();updateMeshDisplay();if(localPatch)localPatch.visible=$('groundMode').value==='relief'&&$('viewMode').value==='moon';});
$('gridStep').addEventListener('change',rebuildGrid);
$('gridOpacity').addEventListener('input',rebuildGrid);
$('meshDensity').addEventListener('change',()=>{rebuildMoon();rebuildPlanetMeshes();if(frames.length)updateSolarSystem(frames[selected].utc);});
$('heightExaggeration').addEventListener('input',()=>{$('heightValue').textContent=$('heightExaggeration').value+'×';});
$('heightExaggeration').addEventListener('change',()=>{visualHeightScale=Number($('heightExaggeration').value);rebuildMoon();});
$('terrainResolution').addEventListener('change',loadTerrain);
$('focusSite').addEventListener('click',focusSite);
$('resetCamera').addEventListener('click',resetCamera);
rebuildGrid();
// Two coordinate regimes: true physical radii and JPL centre-to-centre ranges,
// or a clearly labelled schematic overview. Moon radius is always 2.5 units.
// Earth's DEM is NASA Visible Earth topography + bathymetry (CMG Lee composite,
// public-domain derivative). Sun granulation is PROCEDURAL: not solar DEM.
const systemLayer=new THREE.Group();scene.add(systemLayer);
const earthMaterial=new THREE.MeshStandardMaterial({color:0x2470ae,metalness:0,roughness:.94});
const earthNormal=new THREE.TextureLoader().load('/textures/earth_normal.jpg');
earthMaterial.normalMap=earthNormal;earthMaterial.normalScale=new THREE.Vector2(0.8,0.8);
// Earth colour map. The local server sends Access-Control-Allow-Origin so a
// crossOrigin texture load succeeds; a failure keeps the blue base colour and
// reports it once instead of appending to every later status message.
const earthTextureLoader=new THREE.TextureLoader();
earthTextureLoader.setCrossOrigin('anonymous');
const earthTexture=earthTextureLoader.load('/textures/earth_daymap.jpg',loaded=>{
 loaded.colorSpace=THREE.SRGBColorSpace;earthMaterial.map=loaded;earthMaterial.color.set(0xffffff);earthMaterial.needsUpdate=true;
},undefined,()=>{
 const status=$('planetMeshStatus');
 if(status&&!status.dataset.earthTextureError){status.dataset.earthTextureError='1';status.textContent+=' · Earth color texture unavailable.';}
});
let earthElevation=null,earthGeometry=null,sunGeometry=null;
const earthIcon=new THREE.Mesh(new THREE.SphereGeometry(1,128,64),earthMaterial);
earthIcon.castShadow=true;earthIcon.receiveShadow=true;
const earthAtmosphere=new THREE.Mesh(new THREE.SphereGeometry(1.018,96,48),new THREE.MeshBasicMaterial({color:0x72bcff,transparent:true,opacity:.10,side:THREE.BackSide,depthWrite:false}));
earthIcon.add(earthAtmosphere);
const cloudTexture=new THREE.TextureLoader().load('/textures/earth_clouds.png',t=>{t.colorSpace=THREE.SRGBColorSpace;},undefined,()=>{});
const earthClouds=new THREE.Mesh(new THREE.SphereGeometry(1.012,128,64),new THREE.MeshBasicMaterial({map:cloudTexture,transparent:true,opacity:.31,depthWrite:false}));earthIcon.add(earthClouds);
earthIcon.traverse(obj=>obj.layers.set(1));
// Sun: real NASA SDO-style photosphere map (sun.jpg) instead of a flat colour.
const sunTexture=new THREE.TextureLoader().load('/textures/sun.jpg',t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;},undefined,()=>{});
const sunIcon=new THREE.Mesh(new THREE.SphereGeometry(1,128,64),new THREE.MeshBasicMaterial({color:0xffffff,map:sunTexture}));
const sunGlow=new THREE.Mesh(new THREE.SphereGeometry(1.055,72,48),new THREE.MeshBasicMaterial({color:0xff8c2e,transparent:true,opacity:.13,depthWrite:false,side:THREE.BackSide}));sunIcon.add(sunGlow);
const sunCorona=new THREE.Mesh(new THREE.SphereGeometry(1.10,64,32),new THREE.MeshBasicMaterial({color:0xffb45e,transparent:true,opacity:.038,depthWrite:false,side:THREE.BackSide}));sunIcon.add(sunCorona);
systemLayer.add(earthIcon,sunIcon);
let earthWire=null,sunWire=null,moonWire=null;
function createDisplacedSphere(slices,stacks,radius,altitudeFn,colorFn){
 const position=[],uv=[],color=[],index=[];
 for(let j=0;j<=stacks;j++){
  const latitude=90-180*j/stacks,lat=latitude*RAD;
  for(let i=0;i<=slices;i++){
   const longitude=-180+360*i/slices,lon=longitude*RAD;
   const altitude=altitudeFn(latitude,longitude),r=radius+altitude;
   position.push(r*Math.cos(lat)*Math.cos(lon),r*Math.sin(lat),r*Math.cos(lat)*Math.sin(lon));
   uv.push(i/slices,1-j/stacks);
   if(colorFn)color.push(...colorFn(latitude,longitude,altitude));
  }
 }
 for(let j=0;j<stacks;j++)for(let i=0;i<slices;i++){
  const a=j*(slices+1)+i,b=a+slices+1;index.push(a,a+1,b,b,a+1,b+1);
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(position,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
 if(colorFn)geometry.setAttribute('color',new THREE.Float32BufferAttribute(color,3));
 geometry.setIndex(index);geometry.computeVertexNormals();return geometry;
}
function earthHeightKm(lat,lon){
 if(!earthElevation)return 0;
 const {pixels,w,h}=earthElevation,x=Math.min(w-1,Math.max(0,Math.round(((((lon+180)/360)%1)+1)%1*(w-1)))),y=Math.min(h-1,Math.max(0,Math.round((90-lat)/180*(h-1))));
 const height=heightFromEarthImageByte(pixels[(y*w+x)*4]);
 return $('earthSeafloor').checked?height:Math.max(0,height);
}
function solarPattern(lat,lon){
 const a=lat*RAD,b=lon*RAD;
 // A reproducible approximation of granular photospheric structure (NOT NASA topography).
 const n=.43*Math.sin(71*b+6*Math.sin(17*a))*Math.cos(83*a-3*b)
          +.28*Math.sin(123*b+19*a)*Math.cos(94*a+7*b)
          +.21*Math.sin(21*a+31*b)*Math.cos(48*b-13*a)
          +.08*Math.sin(265*b)*Math.sin(179*a);
 return n;
}
function buildWire(parent,old,geometry,tint){
 if(old){parent.remove(old);old.material.dispose();}
 const wire=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:tint,wireframe:true,transparent:true,opacity:.20,depthWrite:false,depthTest:true}));
 wire.scale.setScalar(1.0008);parent.add(wire);return wire;
}
function rebuildPlanetMeshes(){
 const q=$('meshDensity').value;
 const slices=q==='high'?480:q==='medium'?300:144,stacks=slices/2;
 const relief=Number($('earthRelief').value);
 const nextEarth=createDisplacedSphere(slices,stacks,1,(lat,lon)=>earthHeightKm(lat,lon)*relief/EARTH_RADIUS_KM);
 const priorEarth=earthIcon.geometry;earthIcon.geometry=nextEarth;earthGeometry=nextEarth;
 earthWire=buildWire(earthIcon,earthWire,nextEarth,0x98e9ff);priorEarth.dispose();
 const solarStrength=Number($('sunDetail').value);
 const nextSun=createDisplacedSphere(slices,stacks,1,(lat,lon)=>solarPattern(lat,lon)*160*solarStrength/SUN_RADIUS_KM,(lat,lon)=>{
  const n=solarPattern(lat,lon);
  return [.94+.05*n,.43+.17*n,.10+.10*n];
 });
 const priorSun=sunIcon.geometry;sunIcon.geometry=nextSun;sunGeometry=nextSun;
 // Keep the real NASA photosphere map and let the per-vertex granulation
 // colours modulate it (Three.js multiplies map × vertexColors), so the Sun
 // shows both the observed surface and the animated granulation detail.
 sunIcon.material.dispose();sunIcon.material=new THREE.MeshBasicMaterial({color:0xffffff,map:sunTexture,vertexColors:true});
 sunWire=buildWire(sunIcon,sunWire,nextSun,0xffdd91);priorSun.dispose();
 if(moonWire){moon.remove(moonWire);moonWire.material.dispose();}
 moonWire=buildWire(moon,moonWire,moon.geometry,0x92e5ff);
 updateMeshDisplay();
}
function updateMeshDisplay(){
 const wire=$('meshSurface').value==='wire';
 if(earthWire)earthWire.visible=wire;
 if(sunWire)sunWire.visible=wire;
 if(moonWire)moonWire.visible=wire&&$('groundMode').value!=='grid3d';
}
$('meshSurface').addEventListener('change',()=>{updateMeshDisplay();if(frames.length)updateSolarSystem(frames[selected].utc);});
$('earthSeafloor').addEventListener('change',()=>{rebuildPlanetMeshes();if(frames.length)updateSolarSystem(frames[selected].utc);});
$('earthRelief').addEventListener('input',()=>{$('earthReliefValue').textContent=$('earthRelief').value+'×';});
$('earthRelief').addEventListener('change',()=>{rebuildPlanetMeshes();if(frames.length)updateSolarSystem(frames[selected].utc);});
$('sunDetail').addEventListener('input',()=>{$('sunDetailValue').textContent=$('sunDetail').value+'×';});
$('sunDetail').addEventListener('change',()=>{rebuildPlanetMeshes();if(frames.length)updateSolarSystem(frames[selected].utc);});
function loadEarthElevation(){
 const im=new Image();im.crossOrigin='anonymous';
 im.onload=()=>{
  try{const cvs=document.createElement('canvas');cvs.width=im.naturalWidth;cvs.height=im.naturalHeight;
   const c=cvs.getContext('2d',{willReadFrequently:true});c.drawImage(im,0,0);earthElevation={pixels:c.getImageData(0,0,cvs.width,cvs.height).data,w:cvs.width,h:cvs.height};
   $('planetMeshStatus').textContent=`Earth DEM loaded: ${cvs.width} × ${cvs.height} NASA-derived global topography/bathymetry; solar detail is procedural.`;
   rebuildPlanetMeshes();
  }catch(err){$('planetMeshStatus').textContent='Earth elevation map could not be read (cross-origin restriction); showing smooth Earth. '+err.message;}
 };
 im.onerror=()=>{$('planetMeshStatus').textContent='Earth elevation image unavailable; showing a smooth Earth. Sun detail is procedural.';};
 im.src='/api/earth-dem';
}
rebuildPlanetMeshes();loadEarthElevation();
// Whole-Solar-System scene: 8 3D planets, Sun, Moon, orbital traces, dated axial spins.
// Positions: JPL approximate Keplerian elements; NOT a precision SPICE attitude model.
const solarLayer=new THREE.Group();solarLayer.visible=false;scene.add(solarLayer);
const solarObjects=new Map(),solarOrbitLines=new THREE.Group();solarLayer.add(solarOrbitLines);
// True scale: 1 scene unit = 1,000 km (matches scale-core bodyRadius), so the
// Sun, Earth, Moon and every orbit share ONE consistent physical scale.
const solarKmPerUnit=1000;let solarOrbitsYear=NaN,showOrbitLines=true;
function proceduralPlanetGeometry(id,slices=132,stacks=66){
 const body=SOLAR_BODIES.find(p=>p.id===id),kind=body.kind;
 const textureBands=(lat,lon)=>{
  const x=lat*RAD,z=lon*RAD;
  if(kind==='gas'||kind==='ice')return .018*Math.sin(22*x+1.3*Math.sin(9*z))+.006*Math.sin(83*x+7*z);
  return .018*Math.sin(11*x+7*z)*Math.cos(19*x-3*z)+.009*Math.sin(47*x+13*z)*Math.cos(31*z);
 };
 return createDisplacedSphere(slices,stacks,1,(lat,lon)=>textureBands(lat,lon),(lat,lon,h)=>{
  const c=new THREE.Color(body.color),stripe=.81+.12*Math.sin(lat*RAD*35+6*Math.sin(lon*RAD*2))+.07*Math.sin(lon*RAD*24);
  if(kind==='gas'||kind==='ice')c.multiplyScalar(stripe);else c.multiplyScalar(.85+.65*h);
  return [c.r,c.g,c.b];
 });
}
function addSolarBody(id,color,radiusKm,mesh){
 const root=new THREE.Group(),tilt=new THREE.Group();root.add(tilt);
 const ob=mesh??new THREE.Mesh(new THREE.SphereGeometry(1,90,45),new THREE.MeshStandardMaterial({color}));
 tilt.add(ob);ob.castShadow=true;ob.receiveShadow=true;
 const model=ROTATION_MODELS[id];if(model)tilt.rotation.z=model.tiltDeg*RAD;
 solarLayer.add(root);
 const wire=new THREE.Mesh(ob.geometry,new THREE.MeshBasicMaterial({color:0xbbe9ff,wireframe:true,transparent:true,opacity:.23,depthTest:true,depthWrite:false}));wire.scale.setScalar(1.0018);ob.add(wire);
 const item={id,root,tilt,mesh:ob,radiusKm,spin:ob,wire};solarObjects.set(id,item);
 // A very fine transparent shell adds atmosphere depth but does not claim mapped terrain.
 if(id==='venus'||id==='uranus'||id==='neptune'){
  const glow=new THREE.Mesh(new THREE.SphereGeometry(1.028,70,36),new THREE.MeshBasicMaterial({color:color,opacity:.14,transparent:true,depthWrite:false,side:THREE.BackSide}));tilt.add(glow);
 }
 if(id==='saturn'){
  // Ring system with the real NASA ring-particle alpha map. RingGeometry's
  // default UVs are unsuitable for a radial strip, so remap them to
  // (radial 0..1, angular 0..1) to sample saturn_ring_alpha.png correctly.
  const ringGeo=new THREE.RingGeometry(1.24,2.32,256,1);
  const rp=ringGeo.attributes.position, ruv=ringGeo.attributes.uv;
  const inner=1.24, outer=2.32, span=outer-inner;
  for(let i=0;i<rp.count;i++){
    const x=rp.getX(i),y=rp.getY(i);
    const rr=Math.sqrt(x*x+y*y);
    ruv.setXY(i,(rr-inner)/span,0.5);
  }
  ruv.needsUpdate=true;
  const ringTex=new THREE.TextureLoader().load('/textures/saturn_ring_alpha.png',t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;},undefined,()=>{});
  const rings=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:0xd8c49a,map:ringTex,transparent:true,opacity:.92,side:THREE.DoubleSide,depthWrite:false}));
  rings.rotation.x=-Math.PI/2;tilt.add(rings);
 }
 return item;
}
const sol=addSolarBody('sun',0xffbb52,SUN_RADIUS_KM,new THREE.Mesh(sunIcon.geometry,sunIcon.material));
sol.mesh.add(new THREE.Mesh(new THREE.SphereGeometry(1.09,64,32),new THREE.MeshBasicMaterial({color:0xffb76e,transparent:true,opacity:.08,depthWrite:false,side:THREE.BackSide})));
// Real NASA textures for every planet. Each body gets its official map from
// planet-data-sources.mjs (textureUrl) instead of a procedural colour band.
const PLANET_TEXTURE_URLS = {
  mercury: '/textures/mercury.jpg',
  venus: '/textures/venus_surface.jpg',
  earth: '/textures/earth_daymap.jpg',
  mars: '/textures/mars.jpg',
  jupiter: '/textures/jupiter.jpg',
  saturn: '/textures/saturn.jpg',
  uranus: '/textures/uranus.jpg',
  neptune: '/textures/neptune.jpg'
};
const planetTextureLoader = new THREE.TextureLoader();
planetTextureLoader.setCrossOrigin('anonymous');
// Height / bump maps for bodies whose NASA albedo already encodes relief.
// Mars: grayscale luminance derived from mars.jpg (PIL: blur + 2/98 percentile
// contrast stretch) — NOT the albedo itself, which would double-shade colour.
const PLANET_BUMP_URLS = {
  mars: '/textures/mars_bump.jpg'
};
for(const body of SOLAR_BODIES){
  const texUrl = PLANET_TEXTURE_URLS[body.id];
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .92, metalness: 0 });
  if(texUrl){
    const tex = planetTextureLoader.load(texUrl, (t) => {
      t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
      mat.map = t; mat.needsUpdate = true;
    }, undefined, () => { /* keep white fallback */ });
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    mat.map = tex;
  }
  const bumpUrl = PLANET_BUMP_URLS[body.id];
  if(bumpUrl){
    const bump = planetTextureLoader.load(bumpUrl, (t) => {
      t.anisotropy = 8;
      mat.bumpMap = t; mat.needsUpdate = true;
    }, undefined, () => { /* keep flat */ });
    bump.anisotropy = 8;
    mat.bumpMap = bump;
    mat.bumpScale = 0.03;
  }
  const geo = body.id === 'earth' ? earthIcon.geometry : new THREE.SphereGeometry(1, 96, 48);
  const mesh = new THREE.Mesh(geo, mat);
  addSolarBody(body.id, new THREE.Color(body.color).getHex(), body.radiusKm, mesh);
}
// Pluto: dwarf planet, kept OUT of SOLAR_BODIES (the visible-planet list stays
// the eight IAU planets) but added as a real scene body so its five moons have
// a valid parent. Uses the New Horizons global mosaic (pluto.jpg) for a real
// surface rather than a flat colour.
const plutoTexture=new THREE.TextureLoader().load('/textures/pluto.jpg',t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;},undefined,()=>{});
addSolarBody('pluto',0xb9a58c,1188,new THREE.Mesh(new THREE.SphereGeometry(1,96,48),new THREE.MeshStandardMaterial({color:0xffffff,map:plutoTexture,roughness:.95,metalness:.02})));
// The Solar-System Moon must use a UNIT-radius sphere like every other solar
// body: its mesh is scaled by solarRadius('moon'). The globe scene's moon
// geometry has radius 2.5, so sharing it would make Luna 2.5× too large.
addSolarBody('moon',0xc8c9d2,MOON_R_KM,new THREE.Mesh(new THREE.SphereGeometry(1,96,48),moonMaterial));
// ---------------------------------------------------------------------------
// Every named moon of every planet. Luna keeps the high-resolution NASA map
// already applied above; all other moons use their low-resolution NASA map (or
// a plain colour sphere when no map exists) so weak hardware stays comfortable.
// ---------------------------------------------------------------------------
const moonTextureLoader = new THREE.TextureLoader();
moonTextureLoader.setCrossOrigin('anonymous');
const solarMoons = [];
function addSolarMoon(spec){
try{
const parent = solarObjects.get(spec.parent);
if(!parent) return;
const radiusKm = spec.radiusKm || 100;
const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(spec.color || '#9a9a9a'), roughness: .96, metalness: .02 });
// Luna is already a separate high-res body; skip it here.
if(spec.id === 'moon') return;
if(spec.textureUrl){
const tex = moonTextureLoader.load(spec.textureUrl, (t) => {
t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
mat.map = t; mat.color.set(0xffffff); mat.needsUpdate = true;
}, undefined, () => { /* colour fallback */ });
tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
mat.map = tex; mat.color.set(0xffffff);
}
// Low-resolution geometry for non-Luna moons (hardware friendly).
const geo = new THREE.SphereGeometry(1, 20, 12);
const mesh = new THREE.Mesh(geo, mat);
const root = new THREE.Group();
root.add(mesh);
const item = { id: spec.id, root, tilt: new THREE.Group(), mesh, radiusKm, spin: mesh, wire: null, isMoon: true, parentId: spec.parent, orbitRadiusKm: spec.orbitRadiusKm || 100000, periodDays: spec.periodDays || 1 };
root.add(item.tilt);
item.tilt.add(mesh);
solarLayer.add(root);
solarObjects.set(spec.id, item);
solarMoons.push(item);
}catch(e){ void e; }
}
// Pull the official catalogue when available, otherwise use the static table.
(function buildAllMoons(){
try{
const ds = window.LLP && window.LLP.DataSources;
const list = ds && Array.isArray(ds.MOON_DATA) ? ds.MOON_DATA : [];
if(list.length){
for(const m of list) addSolarMoon(m);
}
}catch(e){ void e; }
})();

// solarKeyLight is a plain alias for sunLight (see line ~67). No extra light.
const solarLabels=new Map();
function createSolarLabel(text,clr){
 const c=document.createElement('canvas');c.width=256;c.height=56;const ctx=c.getContext('2d');ctx.font='bold 35px system-ui';ctx.fillStyle=clr;ctx.fillText(text,7,40);
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,depthTest:false}));
 solarLayer.add(sprite);return sprite;
}
for(const body of [{id:'sun',name:'Sun',color:'#ffe3a7'},...SOLAR_BODIES.map(b=>({...b,color:'#b8d7f0'})),{id:'pluto',name:'Pluto',color:'#c9b8a3'},{id:'moon',name:'Moon',color:'#e3e0d8'}])solarLabels.set(body.id,createSolarLabel(body.name,body.color));
function solarRadius(id){
 const km=solarObjects.get(id).radiusKm;
 // True scale: 1 scene unit = 1,000 km (matches scale-core), so the Sun is
 // 695.7 units, Earth 6.37, Moon 1.74 — physically exact relative sizes.
 if(scaleMode()==='true')return km/1000;
 // Overview keeps the *relative* sizes physically exact (Sun ≈ 109× Earth,
 // Earth ≈ 3.7× Moon) but applies one global shrink factor so the Sun still
 // fits inside Mercury's compressed orbit (~9.7 units). Earth ends up tiny,
 // which is the honest consequence of true proportions in a compressed scene.
 return (km/6371)*0.06;
}
function solarPoint(id,utc){return vec(displayPlanetVector(planetPositionKm(id,utc),scaleMode(),1/solarKmPerUnit));}
function solarViewDate(){return frames.length?frames[selected].utc:new Date().toISOString();}
function rebuildSolarOrbits(utc){
 clearLayer(solarOrbitLines);const year=new Date(utc).getUTCFullYear();solarOrbitsYear=year;
 const center=Date.parse(utc);
 for(const body of [...SOLAR_BODIES,{id:'pluto',color:'#c9b8a3'}]){
  const pts=[],period=ORBIT_PERIOD_DAYS[body.id];
  for(let k=0;k<=120;k++){
   const t=center-(1-k/120)*period*86400000;
   try{pts.push(solarPoint(body.id,new Date(t).toISOString()));}catch{continue;}
  }
  if(pts.length<2)continue;
  const geom=new THREE.BufferGeometry().setFromPoints(pts),line=new THREE.Line(geom,new THREE.LineBasicMaterial({color:body.color,transparent:true,opacity:.23,depthWrite:false}));
  line.visible=showOrbitLines;solarOrbitLines.add(line);
 }
}
function updateSolarSystem(utc){
 try{
  if(solarOrbitsYear!==new Date(utc).getUTCFullYear())rebuildSolarOrbits(utc);
  const earth=solarPoint('earth',utc);
 for(const body of [{id:'sun'},...SOLAR_BODIES,{id:'pluto'},{id:'moon'}]){
   const obj=solarObjects.get(body.id);
   let pos;if(body.id==='sun')pos=new THREE.Vector3();
   else if(body.id==='moon'){
    const moonFixed=previewFrames(utc.slice(0,10),1,24)[0]?.moon_eci_km??[384400,0,0];
    const offset=scaleMode()==='true'?vec(moonFixed.map(x=>x/solarKmPerUnit)):vec(moonFixed).normalize().multiplyScalar(.85);
    pos=earth.clone().add(offset);
   }else pos=solarPoint(body.id,utc);
   obj.root.position.copy(pos);obj.root.scale.setScalar(solarRadius(body.id));
   obj.spin.rotation.y=rotationAngleDeg(body.id,utc)*RAD;
   // Source meshes are rebuilt when the NASA-derived Earth DEM changes.
   if(body.id==='earth'){obj.mesh.geometry=earthIcon.geometry;obj.mesh.material=earthIcon.material;}
   if(body.id==='sun'){obj.mesh.geometry=sunIcon.geometry;obj.mesh.material=sunIcon.material;}
   // The solar Moon keeps its own unit-radius geometry (created once above);
   // per-frame geometry swaps here used to fight the root.scale sizing. The
   // shared moonMaterial is enough to carry the Luna texture.
   if(body.id==='moon')obj.mesh.material=moonMaterial;
   obj.wire.geometry=obj.mesh.geometry;obj.wire.visible=$('meshSurface').value==='wire';
   const l=solarLabels.get(body.id);if(l){l.position.copy(pos).add(new THREE.Vector3(0,Math.max(solarRadius(body.id)*1.65,scaleMode()==='true'?.18:1.25),0));
   l.scale.set(scaleMode()==='true'?1.4:2.1,scaleMode()==='true'?.34:.5,1);}
  }
  // Moons are positioned AFTER their parents above, so parentObj.root.position
  // and .scale are already current for this epoch (fixes stale moon positions
  // after time jumps). True scale uses the same 1e7 km/unit divisor as planets.
  for(const moonItem of solarMoons){
   try{
     const parentObj = solarObjects.get(moonItem.parentId);
     if(!parentObj) continue;
     const parentPos = parentObj.root.position;
     const days = (Date.parse(utc) - Date.UTC(2000,0,1,12)) / 86400000;
     const phase = (days / (moonItem.periodDays || 1)) * Math.PI * 2;
     const orbitUnits = scaleMode() === 'true'
       ? (moonItem.orbitRadiusKm || 1) / solarKmPerUnit
       : parentObj.root.scale.x * 2.2 + 0.4 + Math.log10(1 + (moonItem.orbitRadiusKm||1) / 10000) * 0.8;
     const x = Math.cos(phase) * orbitUnits;
     const z = Math.sin(phase) * orbitUnits * 0.98;
     moonItem.root.position.set(parentPos.x + x, parentPos.y + z * 0.08, parentPos.z + z);
     const r = scaleMode() === 'true' ? (moonItem.radiusKm || 1) / solarKmPerUnit : Math.max(0.002, ((moonItem.radiusKm || 100) / 6371) * 0.06);
     moonItem.root.scale.setScalar(r);
     moonItem.mesh.rotation.y = phase;
   }catch(e){ void e; }
  }
  const id=$('planetFocus').value,selectedObj=solarObjects.get(id);if(selectedObj){
   const km=selectedObj.radiusKm;
   let dist;
   try{ dist=id==='sun'?0:Math.hypot(...planetPositionKm(id==='moon'?'earth':id,utc))/AU_KM; }
   catch{ dist=NaN; }
   const spin=rotationAngleDeg(id,utc);
   const rm=ROTATION_MODELS[id];
   const spinTxt=rm&&Number.isFinite(rm.hours)?rm.hours.toFixed(2):'n/a';
   const distTxt=Number.isFinite(dist)?dist.toFixed(3)+' AU from Sun':'distance out of range';
   $('planetStatus').textContent=`${id.toUpperCase()} · radius ${km.toLocaleString('en-GB')} km · ${distTxt} · mean axial phase ${spin.toFixed(1)}° · approx spin ${spinTxt} h/revolution. Date: ${utc.slice(0,16)} UTC. JPL position approximations (1800–2999); axial tilt/spin are mean-rate illustrations.`;
  }
 }catch(err){$('planetStatus').textContent='Solar System calculation: '+err.message;}
}
function focusSolarBody(id){
 if(!solarObjects.has(id))return;
 $('viewMode').value='solar';setView();
 const ob=solarObjects.get(id),r=solarRadius(id);
 updateSolarSystem(solarViewDate());
 const target=ob.root.position.clone();
 // Frame the body so it fills a comfortable part of the view: ~4.2 radii
 // away along a slight diagonal. Keep it purely proportional to the body
 // radius (true-scale planets are tiny) with only a numeric floor for r≈0.
 const focusDist=Math.max(r*4.2, 1e-4);
 const endPos=target.clone().add(new THREE.Vector3(focusDist*.30, focusDist*.34, focusDist));
 // Suspend the per-frame controls while our own tween drives the camera;
 // otherwise the two writers fight and the camera freezes mid-way. lockFraming
 // publishes the final target AND framing distance, then re-enables controls.
 const lockFraming=()=>{
  controls.target.copy(target);
  if(typeof setControlsSuspended==='function')setControlsSuspended(false);
  if(typeof setExternalTarget==='function')setExternalTarget({x:target.x,y:target.y,z:target.z},focusDist);
  camera.position.copy(endPos);
  camera.lookAt(target.x,target.y,target.z);
  controls.update();
 };
 // Short smooth fly-in, then a hard, idempotent lock so nothing drifts.
 try{
  if(typeof setControlsSuspended==='function')setControlsSuspended(true);
  tweenCamera(camera,camera.position.clone(),endPos,controls.target.clone(),target,650,lockFraming);
  setTimeout(lockFraming,700);
 }catch(e){ lockFraming(); }
 $('planetFocus').value=id;
 const zoomSel=$('planet-zoom-select');if(zoomSel)zoomSel.value=id;
}
function frameSolarSystem(){
 const box=new THREE.Box3();
 for(const item of solarObjects.values()){
  box.expandByPoint(item.root.position.clone().addScalar(solarRadius(item.id)));
  box.expandByPoint(item.root.position.clone().addScalar(-solarRadius(item.id)));
 }
 const sphere=box.getBoundingSphere(new THREE.Sphere());
 const distance=Math.max(12,sphere.radius/Math.sin(THREE.MathUtils.degToRad(camera.fov)/2)*1.17);
 controls.target.copy(sphere.center);camera.position.copy(sphere.center).add(new THREE.Vector3(.15,.24,1).normalize().multiplyScalar(distance));controls.update();
}
function showSolarSystem(){
 $('viewMode').value='solar';setView();
 frameSolarSystem();
 $('pickFeedback').textContent=scaleMode()==='true'?'Solar System physical-scale mode: small planets are not visible at full extent; use Focus selected body.':'Solar System overview: distances compressed; select or click a planet to focus.';
 updateSolarPickerVisibility();
}
function updateSolarPickerVisibility(){
 const picker=$('solarPicker');if(!picker)return;
 picker.hidden=$('viewMode').value!=='solar';
}
$('focusPlanet').addEventListener('click',()=>focusSolarBody($('planetFocus').value));
$('planetFocus').addEventListener('change',()=>{updateSolarSystem(solarViewDate());updateSunlight();});
// Floating "Go to body" picker: click a planet to fly the camera toward it.
(function wireSolarPicker(){
 const picker=$('solarPicker');if(!picker)return;
 picker.addEventListener('click',(e)=>{
  const btn=e.target.closest('button[data-body]');if(!btn)return;
  e.preventDefault();
  const id=btn.getAttribute('data-body');
  if(solarObjects.has(id)){
   $('planetFocus').value=id;
   const zs=$('planet-zoom-select');if(zs)zs.value=id;
   focusSolarBody(id);
  }
 });
})();
$('showSolar').addEventListener('click',showSolarSystem);
$('showSolarOrbits').addEventListener('click',()=>{showOrbitLines=!showOrbitLines;solarOrbitLines.visible=showOrbitLines;$('showSolarOrbits').textContent='Orbital trails: '+(showOrbitLines?'ON':'OFF');$('showSolarOrbits').setAttribute('aria-pressed',String(showOrbitLines));});

function systemLine(color){const geometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(1,0,0)]);const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,opacity:.32,transparent:true,depthWrite:false}));systemLayer.add(line);return line;}
const earthVectorLine=systemLine(0x67c4ff),sunVectorLine=systemLine(0xffdb8c);
function labelSprite(str,color){const c=document.createElement('canvas');c.width=300;c.height=70;const ctx=c.getContext('2d');ctx.font='bold 37px system-ui';ctx.fillStyle=color;ctx.fillText(str,12,48);const t=new THREE.CanvasTexture(c);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false}));sp.scale.set(2.2,.5,1);systemLayer.add(sp);return sp;}
const earthLabel=labelSprite('EARTH','#8ad6ff'),sunLabel=labelSprite('SUN','#ffe4ab'),moonLabel=labelSprite('MOON','#eee8e2');
moonLabel.position.set(0,3.15,0);
const earthDepartureMarker=new THREE.Mesh(new THREE.SphereGeometry(.13,16,10),new THREE.MeshBasicMaterial({color:0x7de4ff,depthTest:false}));
systemLayer.add(earthDepartureMarker);
// earthCentre/sunCentre are declared near the top (with routeDrawLayer) to
// avoid the temporal dead zone during early render calls.
const earthMoonRouteLayer=new THREE.Group();scene.add(earthMoonRouteLayer);
let plannedTransfers=[],chosenTransfer=null,plannedEpochUTC=null;
function earthStartCoordinates(){return {lat:clamp(Number($('earthLat').value),-90,90),lon:clamp(Number($('earthLon').value),-180,180)};}
function moonDestinationCoordinates(){return {lat:clamp(Number($('lat').value),-90,90),lon:clamp(Number($('lon').value),-180,180)};}
function scaleMode(){return $('scaleMode').value;}
function radius(body){return bodyRadius(body,scaleMode());}
function updateSystem(f){
 const p=scenePositions(f,scaleMode());const earth=vec(p.earth),sun=vec(p.sun);
 earthCentre.copy(earth);sunCentre.copy(sun);
 earthIcon.position.copy(earth);sunIcon.position.copy(sun);
 earthIcon.scale.setScalar(radius('earth'));sunIcon.scale.setScalar(radius('sun'));
 const earthLabelRise=radius('earth')*1.2,sunLabelRise=radius('sun')*1.14;
 earthLabel.position.copy(earth).add(new THREE.Vector3(0,earthLabelRise,0));
 sunLabel.position.copy(sun).add(new THREE.Vector3(0,sunLabelRise,0));
 earthLabel.scale.setScalar(Math.max(1,Math.min(260,radius('earth')*.5)));
 sunLabel.scale.setScalar(Math.max(1,Math.min(850,radius('sun')*.007)));
 earthVectorLine.geometry.setFromPoints([new THREE.Vector3(),earth]);sunVectorLine.geometry.setFromPoints([new THREE.Vector3(),sun]);
 earthVectorLine.visible=scaleMode()==='diagram';sunVectorLine.visible=scaleMode()==='diagram';
 const moonAxes=moonFrame(f.earth_moon_fixed,f.moon_eci_km);
 const gmst=earthSiteDirectionECI(f.utc,0,0),east=earthSiteDirectionECI(f.utc,0,90),north=[0,0,1];
 const ex=vec(moonAxes.toFixed(gmst)),ey=vec(moonAxes.toFixed(north)),ez=vec(moonAxes.toFixed(east));
 earthIcon.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex,ey,ez));
 const start=earthStartCoordinates();const eciSite=earthSiteDirectionECI(f.utc,start.lat,start.lon);
 const worldSite=vec(moonAxes.toFixed(eciSite));
 earthDepartureMarker.position.copy(earth).addScaledVector(worldSite,radius('earth')*1.004);
 earthDepartureMarker.scale.setScalar(Math.max(.8,radius('earth')*.013));
 if(chosenTransfer)renderEarthMoonPath();
 // Keep a drawn city route glued to the rotating Earth-fixed frame.
 if(typeof renderRoute3D==='function'&&typeof updateRouteDrawVisibility==='function'){renderRoute3D();updateRouteDrawVisibility();}
}
// ---------------------------------------------------------------------------
// Sun lighting. The Sun is the ONLY light source.
//
// For any body the incoming sunlight direction is the unit vector from the
// Sun real world position to that body real world position. A directional
// light is used (parallel rays), the physical model for a Sun far away
// compared with every body we render.
//
// This replaces two real bugs:
//  1. The solar key light was re-aimed at only ONE selected body, so every
//     other planet was lit from the wrong side.
//  2. The Earth and Moon lights were placed only a few body radii away instead
//     of along the true Sun direction. Earth and Moon shadows then looked
//     constructed the same way even though the Sun reaches them from different
//     directions. Both lights now follow the real Sun-to-body direction, so the
//     terminator and shadow differ exactly as the real geometry differs, also
//     in the Moon-only view, where hiding the Earth must not flip the Moon day
//     and night side.
// ---------------------------------------------------------------------------

/**
 * Aim a shadow-casting directional light from the real Sun at one body.
 *
 * The light is placed a large fixed multiple of the body radius away along the
 * true Sun-to-body direction. Rays stay parallel (physical for a distant Sun)
 * while the shadow camera still gets a usable frustum.
 *
 * @param {THREE.DirectionalLight} light
 * @param {THREE.Vector3} bodyWorldPos
 * @param {THREE.Vector3} sunWorldPos
 * @param {number} bodyRadius scene units
 * @returns {THREE.Vector3} Sun-to-body unit direction
 */
function aimSunlightAtBody(light,bodyWorldPos,sunWorldPos,bodyRadius){
 const d=sunlightDirectionFromPositions(
  {x:sunWorldPos.x,y:sunWorldPos.y,z:sunWorldPos.z},
  {x:bodyWorldPos.x,y:bodyWorldPos.y,z:bodyWorldPos.z});
 const sunToBody=new THREE.Vector3(d.x,d.y,d.z);
 const backoff=Math.max(bodyRadius*60,1e-3);
 light.position.copy(bodyWorldPos).addScaledVector(sunToBody,-backoff);
 light.target.position.copy(bodyWorldPos);
 light.target.updateMatrixWorld();
 light.updateMatrixWorld();
 const extent=Math.max(3.5,bodyRadius*6);
 light.shadow.camera.left=-extent;
 light.shadow.camera.right=extent;
 light.shadow.camera.top=extent;
 light.shadow.camera.bottom=-extent;
 light.shadow.camera.near=Math.max(backoff*0.4,1e-4);
 light.shadow.camera.far=backoff+extent*4;
 light.shadow.camera.updateProjectionMatrix();
 light.userData.sunDirection=sunToBody;
 return sunToBody;
}

function updateSunlight(){
 const isSolar=$('viewMode').value==='solar';
 if(isSolar){
  const sunObj=solarObjects.get('sun');
  const selectedId=$('planetFocus')&&$('planetFocus').value;
  const selectedObj=(selectedId&&solarObjects.get(selectedId))||solarObjects.get('earth');
  if(sunObj&&selectedObj){
   const sunPos=sunObj.root.getWorldPosition(new THREE.Vector3());
   const bodyPos=selectedObj.root.getWorldPosition(new THREE.Vector3());
   aimSunlightAtBody(sunLight,bodyPos,sunPos,solarRadius(selectedObj.id));
  }
  return;
 }
 const moonPos=moon.getWorldPosition(new THREE.Vector3());
 const earthPos=earthIcon.getWorldPosition(new THREE.Vector3());
 const sunPos=sunIcon.getWorldPosition(new THREE.Vector3());
 // ONE light, ONE aim per frame: target the Earth-Moon barycentre so both
 // bodies receive exactly the same incoming Sun direction (physical: the Sun
 // is effectively parallel at Earth and Moon). This also keeps the Moon-only
 // view identical to the full Earth-Moon scene.
 const bary=new THREE.Vector3().addVectors(earthPos,moonPos).multiplyScalar(0.5);
 const maxR=Math.max(radius('moon'),radius('earth'));
 aimSunlightAtBody(sunLight,bary,sunPos,maxR);
 const status=$('sunlightStatus');
 if(status){
  const d=sunlightDirectionFromPositions(
   {x:sunPos.x,y:sunPos.y,z:sunPos.z},{x:moonPos.x,y:moonPos.y,z:moonPos.z});
  status.textContent='Sunlight physics: the Sun is the only light source. '
   +'Moon illumination direction (Sun to Moon): '
   +d.x.toFixed(3)+', '+d.y.toFixed(3)+', '+d.z.toFixed(3)
   +'. Earth is lit from the same Sun at its own position, so their shadows and day and night sides differ.';
 }
}

function setView(){
 const sys=$('viewMode').value==='system',isSolar=$('viewMode').value==='solar',real=scaleMode()==='true';
 // Respect the layer checkboxes when deciding visibility.
 const layerPlanets = (typeof layerVisibility === 'undefined') || layerVisibility.planets;
 const layerOrbits = (typeof layerVisibility === 'undefined') || layerVisibility.orbits;
 const layerLabels = (typeof layerVisibility === 'undefined') || layerVisibility.labels;
 const layerGrid = (typeof layerVisibility === 'undefined') || layerVisibility.grid;
 solarLayer.visible=isSolar&&layerPlanets;
 solarOrbitLines.visible=isSolar&&showOrbitLines&&layerOrbits;
 for(const sprite of solarLabels.values()){ if(sprite) sprite.visible = layerLabels; }
 moon.visible=!isSolar;
 systemLayer.visible=sys;earthMoonRouteLayer.visible=sys&&$('routeVisible').value==='yes';
 gridLayer.visible=!sys&&!isSolar&&$('groundMode').value==='grid3d'&&layerGrid;
 routesLayer.visible=!sys&&!isSolar;triLayer.visible=!sys&&!isSolar;marker.visible=!isSolar;markerStem.visible=!sys&&!isSolar;
 earthDir.visible=!sys&&!isSolar&&frames.length>0;sunDir.visible=!sys&&!isSolar&&frames.length>0;
 if(localPatch)localPatch.visible=!sys&&!isSolar&&$('groundMode').value==='relief';
 if(typeof surfaceRouteLayer!=='undefined')surfaceRouteLayer.visible=!sys&&!isSolar&&$('surfaceShow').value==='yes';
 if(isSolar){controls.target.set(0,0,0);camera.position.set(0,real?350:45,real?1150:150);}
 else if(sys&&real&&frames.length){
  controls.target.copy(earthCentre).multiplyScalar(.5);
  camera.position.copy(controls.target).add(new THREE.Vector3(0,Math.max(30,earthCentre.length()*.2),Math.max(35,earthCentre.length()*1.6)));
 }else{
  controls.target.set(0,0,0);camera.position.set(sys?6:0,sys?12:2.5,sys?48:9);
 }
 // Solar far plane must cover the whole system. True scale reaches ~4.5 million
// units (Neptune 4.5e9 km / 1000), overview compresses to a few hundred.
const solarFar=isSolar?(real?6000000:6000):650000;
camera.far=solarFar;camera.near=isSolar?Math.max(1e-6,solarFar/1e7):.03;camera.updateProjectionMatrix();
 // Solar zoom limits must follow the active scale: overview spans a few
 // hundred units, true scale spans millions (Neptune 4.5e9 km / 1000).
 const solarMax=isSolar?(real?12000000:4000):real?460000:115;
 controls.maxDistance=solarMax;controls.minDistance=isSolar?.0001:sys?real?.25:3:.12;controls.update();
 if(isSolar){updateSolarSystem(solarViewDate());frameSolarSystem();updateSunlight();}
 $('scaleStatus').textContent=real?'TRUE SCALE: radii and distances use NASA/JPL values. At full scale the Sun is ~150 million km away and cannot share a detailed view with the Moon. Use Focus Sun, Focus Earth, or Overview for inspection. Relief sliders change local height only.':'OVERVIEW: body sizes are physically correct relative to each other (Sun ≈ 109× Earth, Earth ≈ 3.7× Moon); only the orbital distances are logarithmically compressed so the whole system fits. Switch to True scale for real distances.';
 $('moonCanvas').title=real?'NASA/JPL centre distances and physical body radii, local relief may be exaggerated':'Overview: physical relative body sizes, compressed orbital distances';
 updateMeshDisplay();
 if(typeof updateRouteDrawVisibility==='function')updateRouteDrawVisibility();
}
function focusBody(body,mode){
 $('viewMode').value='system';if(frames.length)updateSystem(frames[selected]);setView();
 const centre=body==='earth'?earthCentre:sunCentre,r=radius(body);
 controls.target.copy(centre);camera.position.copy(centre).add(new THREE.Vector3(r*.25,r*.35,r*3.3));
 controls.update();setPickMode(mode);
}
$('scaleMode').addEventListener('change',()=>{solarOrbitsYear=NaN;if(frames.length)updateSystem(frames[selected]);setView();});
$('viewMode').addEventListener('change',()=>{setView();if(pickMode==='earth'&&$('viewMode').value==='moon')setPickMode('auto');if($('viewMode').value==='solar')setPickMode('auto');});
$('focusEarth').addEventListener('click',()=>focusBody('earth','earth'));
$('focusSun').addEventListener('click',()=>focusBody('sun','auto'));
$('focusAll').addEventListener('click',()=>{
 $('viewMode').value='system';if(frames.length)updateSystem(frames[selected]);setView();setPickMode('auto');
 if(scaleMode()==='true'){
  const center=sunCentre.clone().multiplyScalar(.5),dist=sunCentre.length()*.75+radius('sun')*2;
  controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(0,dist*.22,dist*1.4));
  $('pickFeedback').textContent='True scale: Earth and Moon are too small to see alongside the Sun. Focus Earth or use Overview to pick a surface.';
 }else{
  const box=new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(),new THREE.Vector3(5,5,5));
  box.expandByPoint(earthCentre.clone().addScalar(radius('earth')*1.3));box.expandByPoint(earthCentre.clone().addScalar(-radius('earth')*1.3));
  box.expandByPoint(sunCentre.clone().addScalar(radius('sun')*1.3));box.expandByPoint(sunCentre.clone().addScalar(-radius('sun')*1.3));
  const sphere=box.getBoundingSphere(new THREE.Sphere());controls.target.copy(sphere.center);
  const v=THREE.MathUtils.degToRad(camera.fov),aspect=Math.max(.45,camera.aspect);
  const distance=sphere.radius/Math.sin(Math.min(v,2*Math.atan(Math.tan(v/2)*aspect))/2)*1.12;
  camera.position.copy(sphere.center).add(new THREE.Vector3(.2,.27,1).normalize().multiplyScalar(distance));
 }
 controls.update();
});
const marker=new THREE.Mesh(new THREE.SphereGeometry(.05,16,12),new THREE.MeshBasicMaterial({color:'#63f5cf'}));scene.add(marker);
const markerStem=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(),.45,0x63f5cf,.12,.08);scene.add(markerStem);
const earthDir=new THREE.ArrowHelper(new THREE.Vector3(1,0,0),new THREE.Vector3(),4,0x55b5ff,.24,.12);scene.add(earthDir);
const sunDir=new THREE.ArrowHelper(new THREE.Vector3(-1,0,0),new THREE.Vector3(),4.5,0xffd58a,.26,.13);scene.add(sunDir);
earthDir.visible=false;sunDir.visible=false;
const routesLayer=new THREE.Group(),triLayer=new THREE.Group();scene.add(routesLayer,triLayer);
function clearLayer(layer){
 while(layer.children.length){const obj=layer.children[0];layer.remove(obj);if(obj.geometry)obj.geometry.dispose();if(obj.material)obj.material.dispose();}
}
function pointMarker(layer,p,color,rad=.08){const obj=new THREE.Mesh(new THREE.SphereGeometry(rad,16,12),new THREE.MeshBasicMaterial({color}));obj.position.copy(kmVec(p));layer.add(obj);return obj;}
function addPolyline(layer,positions,color,opacity=1){const g=new THREE.BufferGeometry().setFromPoints(positions.map(kmVec));const l=new THREE.Line(g,new THREE.LineBasicMaterial({color,transparent:true,opacity,depthTest:true,depthWrite:false}));layer.add(l);return l;}
let frames=[],selected=0,transferCandidates=[],chosenRouteId=null,lastTriangulation=null,framesArePreview=true;
function site(){return normal(clamp(Number($('lat').value),-90,90),clamp(Number($('lon').value),-180,180));}
let renderedViewportWidth=0,renderedViewportHeight=0;
function resize(){
 // Observe the fixed-size parent, not the WebGL canvas: the canvas has a large
 // internal pixel buffer, and observing it can create an unbounded resize loop.
 const host=$('sceneViewport');
 const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
 if(w===renderedViewportWidth&&h===renderedViewportHeight)return;
 renderedViewportWidth=w;renderedViewportHeight=h;
 renderer.setSize(w,h,false);
 camera.aspect=w/h;camera.updateProjectionMatrix();
}
if(typeof ResizeObserver!=='undefined')new ResizeObserver(resize).observe($('sceneViewport'));
window.addEventListener('resize',resize);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)resize();});
let lastFrameTime = performance.now();
function animate(){
 requestAnimationFrame(animate);
 const now = performance.now();
 const dt = now - lastFrameTime;
 lastFrameTime = now;
 updateControls(dt);
 // Keep z-buffer precision usable when jumping from a 1,000-unit Sun to a
 // 2.5-unit Moon: fixed 3-cm near / 650,000-unit far causes z-fighting.
 const focusDistance=camera.position.distanceTo(controls.target);
 const near=$('viewMode').value==='solar'?Math.max(0.000001,Math.min(3,focusDistance*.003)):Math.max(.008,Math.min(1000,focusDistance*.004));
 if(Math.abs(camera.near-near)/Math.max(.01,camera.near)>.12){camera.near=near;camera.updateProjectionMatrix();}
 if($('viewMode').value==='solar')for(const [id,ob] of solarObjects){
  // Moons live in solarObjects too but have no text label; guard so the
  // render loop never dereferences an undefined label (per-frame crash).
  const label=solarLabels.get(id);
  if(!label)continue;
  const r=solarRadius(id),d=camera.position.distanceTo(ob.root.position);
  const w=scaleMode()==='true'?Math.max(r*1.8,Math.min(1.8,d*.022)):2.1;
  label.scale.set(w,w*.25,1);label.position.copy(ob.root.position).add(new THREE.Vector3(0,Math.max(r*1.55,w*.4),0));
 }
 renderer.render(scene,camera);
}animate();
function updateMarker(){const n=vec(site());const r=visualRadius(Number($('lat').value),Number($('lon').value));marker.position.copy(n).multiplyScalar(r+.047);markerStem.position.copy(n.clone().multiplyScalar(r+.048));markerStem.setDirection(n);}
function metrics(f){return lightingAndContact(f,clamp(Number($('lat').value),-90,90),clamp(Number($('lon').value),-180,180),terrain,terrainProfile,Number($('minEl').value),$('requireSun').checked);}
function show(i){
 if(!frames.length)return;
 selected=clamp(i,0,frames.length-1);
 const f=frames[selected],m=metrics(f);
 if(chosenTransfer&&plannedEpochUTC!==f.utc)resetEarthMoonRoute('Time changed. Recalculate the route for the new departure epoch.');
 $('scrub').value=selected;$('dateLabel').textContent=new Date(f.utc).toLocaleString('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'short'})+' UTC';
 $('frameCount').textContent=`${selected+1} / ${frames.length}`;
 $('earthElevation').textContent=m.e.toFixed(2)+'°';$('earthElevation').className=m.earthVisible?'positive':'negative';
 $('earthStatus').textContent=terrain?`Terrain horizon ${m.eh.toFixed(2)}°, clearance ${m.eclear.toFixed(2)}°`:'Spherical horizon (no elevation data)';
 $('solarElevation').textContent=m.s.toFixed(2)+'°';$('solarElevation').className=m.sunlit?'positive':'negative';
 $('lightStatus').textContent=m.sunlit?`Sun above local horizon ${m.sh.toFixed(2)}°`:`Sun obstructed · terrain horizon ${m.sh.toFixed(2)}°`;
 $('quality').textContent=m.valid?'Line of sight possible':'No direct line of sight';$('quality').className=m.valid?'positive':'negative';
 $('linkExplanation').textContent=m.earthVisible?`Earth line of sight · ${m.eclear.toFixed(1)}° terrain clearance`:'Earth is below the local horizon';
 $('distance').textContent=Math.round(mag(f.moon_eci_km)).toLocaleString('en-GB')+' km';
 $('terrainHeight').textContent=terrain?`${m.siteElevKm>=0?'+':''}${m.siteElevKm.toFixed(2)} km`:'—';
 $('terrainHorizon').textContent=terrain?`${m.eh.toFixed(1)}° / ${m.sh.toFixed(1)}°`:'0° / 0°';
 const sDir=unit(f.sun_moon_fixed),eDir=unit(f.earth_moon_fixed);
 const slat=Math.asin(clamp(sDir[2],-1,1))/RAD,slon=Math.atan2(sDir[1],sDir[0])/RAD;
 $('subSolar').textContent=`${slat.toFixed(2)}° N / ${slon.toFixed(2)}° E`;
 $('phaseLabel').textContent=`Estimated Moon illuminated fraction from Earth ≈ ${(50*(1+dot(sDir,eDir))).toFixed(1)}%`; 
 const sun=vec(sDir).normalize(),earth=vec(eDir).normalize();
 earthDir.visible=$('viewMode').value==='moon';sunDir.visible=$('viewMode').value==='moon';
 earthDir.setDirection(earth);sunDir.setDirection(sun);updateMarker();updateSystem(f);updateSolarSystem(f.utc);paintOrbit(f);
 updateSunlight();
 if(transferCandidates.length)calculatePaths(false);
 try{updateSiteMetrics();renderCompareTable();}catch(e){/* explorer not ready yet */}
}
function windows(){
 const contact=[],solar=[];let currentContact=null,currentSun=null;
 function push(slot,target){if(slot)target.push(slot);}
 frames.forEach((f,i)=>{
  const m=metrics(f);
  const update=(enabled,current,target,score)=>{
   if(!enabled){push(current,target);return null;}
   const w=current??{begin:i,end:i,peak:i,best:-90};w.end=i;
   if(score>w.best){w.best=score;w.peak=i;}return w;
  };
  currentContact=update(m.valid,currentContact,contact,m.eclear);
  currentSun=update(m.sunlit,currentSun,solar,m.sclear);
 });
 push(currentContact,contact);push(currentSun,solar);
 function fill(id,items,word){
  items.sort((a,b)=>b.best-a.best);$(id).replaceChildren();
  if(!items.length){$(id).textContent=`No ${word} in the sampled period.`;return;}
  for(const w of items.slice(0,12)){
   const el=document.createElement('div');el.className='window';
   const first=new Date(frames[w.begin].utc),last=new Date(frames[w.end].utc);
   const strong=document.createElement('strong');strong.textContent=`${first.toISOString().slice(0,16).replace('T',' ')} – ${last.toISOString().slice(0,16).replace('T',' ')} UTC`;
   const detail=document.createTextNode(`Peak clearance above terrain horizon ${w.best.toFixed(1)}° · ${w.end-w.begin+1} time samples`);
   el.append(strong,detail);el.style.cursor='pointer';el.addEventListener('click',()=>show(w.peak));$(id).append(el);
  }
 }
 fill('windows',contact,'Earth contact windows');fill('sunWindows',solar,'sunlight windows');
}
const orbitCanvas=$('orbitCanvas'),ctx=orbitCanvas.getContext('2d');
function paintOrbit(f){
 const w=orbitCanvas.clientWidth,h=orbitCanvas.clientHeight,px=window.devicePixelRatio||1;
 orbitCanvas.width=Math.round(w*px);orbitCanvas.height=Math.round(h*px);ctx.setTransform(px,0,0,px,0,0);ctx.clearRect(0,0,w,h);
 const cx=w*.48,cy=h*.50,R=Math.min(h*.35,w*.27);
 ctx.strokeStyle='#33465d';ctx.lineWidth=1;ctx.beginPath();ctx.arc(cx,cy,R,0,Math.PI*2);ctx.stroke();
 ctx.fillStyle='#77baff';ctx.beginPath();ctx.arc(cx,cy,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#cad5e3';ctx.font='12px system-ui';ctx.fillText('Earth',cx+16,cy+4);
 const m=unit(f.moon_eci_km),mx=cx+m[0]*R,my=cy-m[1]*R;
 ctx.fillStyle='#d8dbdc';ctx.beginPath();ctx.arc(mx,my,6,0,2*Math.PI);ctx.fill();ctx.fillText('Moon',mx+10,my-8);
 const sd=unit(f.sun_eci_km),sx=cx+sd[0]*R*1.6,sy=cy-sd[1]*R*1.6;
 ctx.strokeStyle='#ffc36b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(sx,sy);ctx.stroke();ctx.fillStyle='#ffdb8c';ctx.fillText('Sun direction',clamp(sx+5,5,w-90),clamp(sy-5,12,h-5));ctx.fillStyle='#8298b3';ctx.fillText('ICRF XY projection — schematic, not to scale',8,h-6);
}
async function load(){
 if(typeof stopPlayback==='function')stopPlayback();
 const start=$('start').value,days=Number($('days').value),step=Number($('step').value);
 $('status').textContent='Fetching four JPL Horizons datasets…';$('load').disabled=true;
 try{
  const r=await fetch(`/api/ephemeris?start=${encodeURIComponent(start)}&days=${days}&step_hours=${step}`);
  const data=await r.json().catch(()=>null);
  if(!r.ok)throw Error(typeof data==='string'?data:JSON.stringify(data)||r.statusText);
  if(!data.frames?.length)throw Error('No ephemeris samples returned');
  frames=data.frames;framesArePreview=false;$('scrub').max=frames.length-1;show(0);windows();updateSourceBadge();plannedTransfers=[];chosenTransfer=null;clearLayer(earthMoonRouteLayer);$('earthMoonResult').textContent='NASA timeline loaded. Click Calculate to plan using NASA/JPL geometry.';
  $('status').textContent=`${frames.length} NASA/JPL epochs loaded. Site visibility uses ${terrain?'LOLA terrain horizon':'spherical horizon'}; radio quality is not predicted.`;
 }catch(err){$('status').textContent='NASA request failed; time slider remains available in approximate PREVIEW mode if not already loaded. '+err.message;}
 finally{$('load').disabled=false;}
}
$('start').value=new Date().toISOString().slice(0,10);
function updateSourceBadge(){$('ephemerisBadge').textContent=framesArePreview?'PREVIEW — approximate built-in orbits; load NASA/JPL for real ephemerides':'NASA/JPL HORIZONS — sampled orbital ephemerides';}
function buildPreview(){
 stopPlayback();
 const days=clamp(Number($('days').value)||9,1,365),step=clamp(Number($('step').value)||3,1,24);
 const newFrames=previewFrames($('start').value,days,step);
 if(!newFrames.length)return;
 frames=newFrames;selected=0;framesArePreview=true;$('scrub').max=frames.length-1;$('scrub').value=0;updateSourceBadge();
 plannedTransfers=[];chosenTransfer=null;clearLayer(earthMoonRouteLayer);
 show(0);windows();
 $('status').textContent='Preview ready: time slider, 3D planets and site illumination work without downloading NASA data. Click Load precise NASA ephemerides for accurate geometry.';
}
function jumpYears(amount){
 try{
  stopPlayback();const t=frames.length?frames[selected].utc:$('start').value+'T00:00:00Z';
  const shifted=shiftUTCYears(t,amount);$('start').value=shifted.slice(0,10);buildPreview();
  if(frames.length){const h=new Date(shifted).getUTCHours()+new Date(shifted).getUTCMinutes()/60;show(Math.round(h/Number($('step').value)));}
  $('yearStatus').textContent=`Jumped ${amount>0?'+':''}${amount} years to ${shifted.slice(0,10)}. Planet positions and mean axial rotations recalculated for selected UTC epoch. NASA precise data must be reloaded for Moon contact and actual orbital event timing.`;
 }catch(err){$('yearStatus').textContent='Year jump: '+err.message;}
}
$('minusTen').addEventListener('click',()=>jumpYears(-10));$('plusTen').addEventListener('click',()=>jumpYears(10));$('plusHundred').addEventListener('click',()=>jumpYears(100));
$('applyYearJump').addEventListener('click',()=>jumpYears(Number($('yearJump').value)));
$('load').addEventListener('click',load);
for(const field of ['start','days','step'])$(field).addEventListener('change',buildPreview);
let pendingScrub=null;
$('scrub').addEventListener('input',e=>{
 stopPlayback();const index=Number(e.target.value);
 if(pendingScrub!==null)cancelAnimationFrame(pendingScrub);
 pendingScrub=requestAnimationFrame(()=>{pendingScrub=null;show(index);});
});
let playbackTimer=null;
function stopPlayback(){if(playbackTimer!==null){clearInterval(playbackTimer);playbackTimer=null;}$('play').textContent='▶ Play';}
$('play').addEventListener('click',()=>{
 if(playbackTimer!==null){stopPlayback();return;}
 if(!frames.length)return;
 if(selected>=frames.length-1)show(0);
 $('play').textContent='❚❚ Pause';
 playbackTimer=setInterval(()=>{if(selected>=frames.length-1)stopPlayback();else show(selected+1);},350);
});
$('now').addEventListener('click',async()=>{
 stopPlayback();$('start').value=new Date().toISOString().slice(0,10);buildPreview();await load();
 if(frames.length){const now=Date.now();let best=0;for(let i=1;i<frames.length;i++)if(Math.abs(Date.parse(frames[i].utc)-now)<Math.abs(Date.parse(frames[best].utc)-now))best=i;show(best);}
});
$('back').addEventListener('click',()=>show(selected-1));$('forward').addEventListener('click',()=>show(selected+1));
$('south').addEventListener('click',()=>{$('lat').value=-89.5;$('lon').value=0;changed();});
$('apollo').addEventListener('click',()=>{$('lat').value=.6741;$('lon').value=23.4729;changed();});
function changed(){updateMarker();if(localPatch)createLocalPatch();refreshHorizon();if(frames.length){show(selected);windows();}if(chosenTransfer){chosenTransfer=null;plannedTransfers=[];clearLayer(earthMoonRouteLayer);$('earthMoonResult').textContent='Destination changed. Recalculate the Earth–Moon route.';}}
for(const id of ['lat','lon','minEl','requireSun'])$(id).addEventListener('change',changed);
// Explicit Earth/Moon selection with a small drag threshold and visible feedback.
// Keep the controls usable even if a small click misses the model.
const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
raycaster.layers.enableAll();
let downPos=null,pickMode='auto';
function setPickMode(mode){
 pickMode=mode;
 for(const [id,choice] of [['pickMoon','moon'],['pickEarth','earth'],['pickAuto','auto'],['pickWaypoint','waypoint']])$(id).setAttribute('aria-pressed',String(mode===choice));
 $('pickFeedback').textContent=mode==='moon'?'Moon selection: click the visible lunar surface.':mode==='earth'?'Earth selection: click the blue Earth globe.':mode==='waypoint'?'Moon surface waypoints: click to add consecutive route stops.':'Auto selection: click Moon or Earth to set coordinates.';
}
$('pickMoon').addEventListener('click',()=>{
 $('viewMode').value='moon';setView();setPickMode('moon');
});
$('pickEarth').addEventListener('click',()=>focusBody('earth','earth')); 
$('pickAuto').addEventListener('click',()=>setPickMode('auto'));
$('pickWaypoint').addEventListener('click',()=>{$('viewMode').value='moon';setView();setPickMode('waypoint');});
function selectSurfaceAt(clientX,clientY){
 const rect=renderer.domElement.getBoundingClientRect();
 if(rect.width<=0||rect.height<=0)return;
 pointer.set(((clientX-rect.left)/rect.width)*2-1,-((clientY-rect.top)/rect.height)*2+1);
 camera.updateMatrixWorld();scene.updateMatrixWorld(true);raycaster.setFromCamera(pointer,camera);
 const inSystem=$('viewMode').value==='system';
 if($('viewMode').value==='solar'){const hits=raycaster.intersectObjects([...solarObjects.values()].map(o=>o.mesh),false);if(hits.length){const found=[...solarObjects.values()].find(o=>o.mesh===hits[0].object);if(found){$('planetFocus').value=found.id;focusSolarBody(found.id);$('pickFeedback').textContent='Selected '+found.id+' · focus camera moved to the 3D body.';}}else $('pickFeedback').textContent='Select a visible planet or use the planet dropdown.';return;}
 const moonHits=pickMode==='earth'?[]:raycaster.intersectObject(moon,false);
 const earthHits=pickMode==='moon'||!inSystem?[]:raycaster.intersectObject(earthIcon,false);
 const choice=earthHits.length&&(!moonHits.length||earthHits[0].distance<moonHits[0].distance)?'earth':moonHits.length?'moon':null;
 if(!choice){$('pickFeedback').textContent=pickMode==='earth'&&!inSystem?'Switch to the Earth + Moon + Sun scene to select Earth.':'No surface selected. Click the visible Moon/Earth sphere, or enter coordinates in the left panel.';return;}
 if(choice==='earth'){
  const local=earthIcon.worldToLocal(earthHits[0].point.clone()).normalize();
  const lat=Math.asin(clamp(local.y,-1,1))/RAD,lon=Math.atan2(local.z,local.x)/RAD;
  setEarthPoint(lat,lon,'Selected on 3D Earth');
  $('pickFeedback').textContent=`Earth start selected: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
 }else{
  // Raycaster intersections are world-space; Moon is centred at (0,0,0).
  const p=moon.worldToLocal(moonHits[0].point.clone()).normalize();
  const lat=Math.asin(clamp(p.y,-1,1))/RAD,lon=Math.atan2(p.z,p.x)/RAD;
  if(pickMode==='waypoint'){addSurfaceWaypoint(lat,lon);$('pickFeedback').textContent=`Moon stop ${surfaceWaypoints.length}: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;return;}
  $('lat').value=lat.toFixed(4);$('lon').value=lon.toFixed(4);changed();
  $('pickFeedback').textContent=`Moon destination selected: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
 }
}
renderer.domElement.addEventListener('pointerdown',e=>{
 if(e.button!==0)return;
 downPos={x:e.clientX,y:e.clientY,id:e.pointerId};
},true);
renderer.domElement.addEventListener('pointerup',e=>{
 if(!downPos||e.pointerId!==downPos.id)return;
 const original=downPos;downPos=null;
 if(!pickIsClick(e.clientX-original.x,e.clientY-original.y,2))return;
 selectSurfaceAt(e.clientX,e.clientY);
},true);
renderer.domElement.addEventListener('pointercancel',()=>{downPos=null;});
renderer.domElement.addEventListener('lostpointercapture',()=>{downPos=null;});

// 3D multi-station azimuth/elevation triangulation.
const demoTarget=mul(normal(7,20),MOON_R_KM+120),demoStations=[[6,13],[13,26],[0,27]];
function makeStationInputs(){
 $('triStations').replaceChildren();
 for(let i=0;i<3;i++){
  const row=document.createElement('div');row.className='station';row.innerHTML=`<div class="station-title">Station ${i+1} · Moon-fixed</div><div class="two small-fields"><div class="field"><label for="st${i}lat">Latitude °</label><input id="st${i}lat" type="number" step="any"></div><div class="field"><label for="st${i}lon">Longitude °</label><input id="st${i}lon" type="number" step="any"></div><div class="field"><label for="st${i}az">Azimuth °</label><input id="st${i}az" type="number" step="any"></div><div class="field"><label for="st${i}el">Elevation °</label><input id="st${i}el" type="number" step="any"></div></div>`;
  $('triStations').append(row);
 }
}
function fillDemo(){
 demoStations.forEach(([lat,lon],i)=>{
  const ang=azElToTarget(lat,lon,demoTarget);
  for(const [key,value] of Object.entries({lat,lon,az:ang.az,el:ang.el}))$(`st${i}${key}`).value=Number(value.toFixed(8));
 });
 $('triResult').textContent='Example: three ground stations observing a spacecraft at about 120 km altitude. Click Triangulate.';
}
function solveBearings(){
 try{
  const bearings=[0,1,2].map(i=>Object.fromEntries(['lat','lon','az','el'].map(key=>[key,Number($(`st${i}${key}`).value)])));
  if([0,1,2].some(i=>['lat','lon','az','el'].some(key=>$(`st${i}${key}`).value.trim()==='')))throw Error('Fill every station field.');
  const result=triangulate(bearings);lastTriangulation=result;$('useTriForOrbit').disabled=!(result.altKm>=20&&result.altKm<=50000);renderTriangulation();
  const negative=result.residuals.some(x=>x.forwardKm<0);
  $('triResult').textContent=`Best-fit lunar position: ${result.lat.toFixed(4)}° N, ${result.lon.toFixed(4)}° E; altitude ${result.altKm.toFixed(2)} km.\nCross-track RMS: ${result.rmsKm.toFixed(4)} km.${negative?' WARNING: one or more bearings point away from the solution.':''}${result.altKm<0?' WARNING: best fit lies inside the Moon.':''}\nNo uncertainty covariance or terrain corrections applied.`;
 }catch(err){lastTriangulation=null;$('useTriForOrbit').disabled=true;clearLayer(triLayer);$('triResult').textContent='Triangulation error: '+err.message;}
}
function renderTriangulation(){
 clearLayer(triLayer);if(!lastTriangulation)return;
 const result=lastTriangulation;
 for(const ray of result.rays){
  pointMarker(triLayer,ray.p,0x7cc7ff,.06);
  addPolyline(triLayer,[ray.p,result.positionKm],0x7cc7ff,.75);
 }
 pointMarker(triLayer,result.positionKm,0xff67c8,.10);
}
makeStationInputs();fillDemo();
$('demoBearings').addEventListener('click',fillDemo);$('solveBearings').addEventListener('click',solveBearings);
$('useTriForOrbit').addEventListener('click',()=>{
 if(!lastTriangulation)return;
 const {altKm,lat,lon}=lastTriangulation;
 if(altKm<20||altKm>50000){$('triResult').textContent='Orbit departure requires an altitude between 20 and 50,000 km.';return;}
 const positive=lat>=0;
 $('orbitFrom').value=altKm.toFixed(4);
 $('orbitIncl').value=Math.abs(lat).toFixed(4);
 $('orbitPhase').value=positive?90:-90;
 $('orbitNode').value=(positive?lon-90:lon+90).toFixed(4);
 calculatePaths(false);
 $('triResult').textContent+='\nDeparture point aligned to best-fit position in a chosen idealized orbit plane. A full velocity state and targeting optimization are still required.';
});
// Two-body lunar Hohmann transfer and candidate node-orientation comparison.
function calculatePaths(preserveSelection=true){
 try{
  const f=frames[selected];
  const p=Number($('orbitFrom').value),q=Number($('orbitTo').value);
  const inc=Number($('orbitIncl').value),node=Number($('orbitNode').value),phase=Number($('orbitPhase').value);
  if([p,q,inc,node,phase].some(x=>!Number.isFinite(x)))throw Error('All orbit parameters must be numeric.');
  const previous=chosenRouteId;
  transferCandidates=candidateTransfers(p,q,inc,node,phase,f?.earth_moon_fixed,f?.sun_moon_fixed,f?mag(f.moon_eci_km):384400);
  chosenRouteId=preserveSelection&&transferCandidates.some(r=>r.id===previous)?previous:transferCandidates[0].id;
  const best=transferCandidates[0];
  $('orbitResult').textContent=`Ideal Δv: ${best.totalDvKmS.toFixed(5)} km/s (${(best.totalDvKmS*1000).toFixed(1)} m/s). Transfer time: ${(best.transferSeconds/60).toFixed(1)} min.\n${f?'Snapshot Earth visibility evaluated from the selected NASA frame.':'Load NASA data to rank node orientations by current Earth/Sun visibility.'}`;
  $('exportOrbit').disabled=false;
  renderRouteOptions();renderRoutes();
 }catch(err){transferCandidates=[];chosenRouteId=null;clearLayer(routesLayer);$('exportOrbit').disabled=true;$('orbitOptions').replaceChildren();$('orbitResult').textContent='Path error: '+err.message;}
}
function renderRouteOptions(){
 $('orbitOptions').replaceChildren();
 const haveEarth=frames.length>0;
 for(const r of transferCandidates){
  const box=document.createElement('div');box.className='orbit-option'+(r.id===chosenRouteId?' active':'');
  const title=document.createElement('strong');title.textContent=`Path ${r.id}: ${r.label} (node ${(((r.nodeDeg+180)%360+360)%360-180).toFixed(0)}°)`;
  const desc=document.createElement('div');
  desc.textContent=haveEarth?`Earth LOS: ${(r.earthFraction*100).toFixed(1)}% · sunlight: ${(r.sunFraction*100).toFixed(1)}% (snapshot only)`:'NASA snapshot not loaded — geometry preview only';
  box.append(title,desc);box.addEventListener('click',()=>{chosenRouteId=r.id;renderRouteOptions();renderRoutes();});$('orbitOptions').append(box);
 }
}
function renderRoutes(){
 clearLayer(routesLayer);
 for(const r of transferCandidates){
  const chosen=r.id===chosenRouteId,colors=[0xffbb62,0x8b9ffb,0x7ddfd5];
  addPolyline(routesLayer,r.samples.map(x=>x.posKm),colors[r.id-1],chosen?1:.32);
  if(chosen){pointMarker(routesLayer,r.samples[0].posKm,0xffedab,.083);pointMarker(routesLayer,r.samples.at(-1).posKm,0xff9d74,.083);}
 }
}
function exportRoute(){
 const selectedRoute=transferCandidates.find(r=>r.id===chosenRouteId);if(!selectedRoute)return;
 const f=frames[selected];
 const rows=[['time_from_departure_s','moon_x_km','moon_y_km','moon_z_km','radius_km','earth_visible_at_snapshot','sunlit_at_snapshot']];
 for(const sample of selectedRoute.samples){
  const p=sample.posKm,earth=f?clearLineToBody(p,f.earth_moon_fixed,mag(f.moon_eci_km)):'',sun=f?clearLineToBody(p,f.sun_moon_fixed,1.496e8):'';
  rows.push([sample.seconds.toFixed(2),...p.map(v=>v.toFixed(5)),mag(p).toFixed(5),earth,sun]);
 }
 const blob=new Blob([rows.map(row=>row.join(',')).join('\n')+'\n'],{type:'text/csv;charset=utf-8'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`lunar-transfer-path-${selectedRoute.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
$('planOrbit').addEventListener('click',()=>calculatePaths(false));$('exportOrbit').addEventListener('click',exportRoute);

// Explicit city search, never background autocomplete. Nominatim is proxied by
// the local server with a descriptive User-Agent and a one-request/s limit.
const CITIES=[
 {name:'Cape Canaveral, Florida, USA',lat:28.3922,lon:-80.6077},
 {name:'Munich / München, Germany',lat:48.1372,lon:11.5756},
 {name:'München, Germany',lat:48.1372,lon:11.5756},
 {name:'Berlin, Germany',lat:52.5200,lon:13.4050},
 {name:'Houston, Texas, USA',lat:29.7604,lon:-95.3698},
 {name:'Tokyo, Japan',lat:35.6762,lon:139.6503},
 {name:'Sydney, Australia',lat:-33.8688,lon:151.2093}
];
function resetEarthMoonRoute(message='Coordinates changed. Recalculate the Earth–Moon route.'){
 chosenTransfer=null;plannedTransfers=[];clearLayer(earthMoonRouteLayer);
 $('earthMoonOptions').replaceChildren();$('earthMoonResult').textContent=message;
}
function setEarthPoint(lat,lon,label='Manual Earth coordinates'){
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Earth latitude/longitude are outside valid ranges.');
 $('earthLat').value=lat.toFixed(4);$('earthLon').value=lon.toFixed(4);
 $('departureLabel').textContent=`Starting point: ${label} · ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
 if(frames.length)updateSystem(frames[selected]);resetEarthMoonRoute();
}
async function searchCity(){
 const q=$('citySearch').value.trim();const target=$('cityResults');target.replaceChildren();
 if(q.length<2){target.textContent='Enter at least two characters.';return;}
 $('searchCity').disabled=true;target.textContent='Searching city / location…';
 try{
  const presets=fuzzyCityPresets(q,CITIES);
  const results=presets.length?presets:(await (async()=>{
   const response=await fetch('/api/geocode?q='+encodeURIComponent(q));
   const data=await response.json();if(!response.ok)throw Error(data.error||'Geocoding service unavailable');
   return data.results;
  })());
  target.replaceChildren();if(!results.length){target.textContent='No matching city found. Enter coordinates manually.';return;}
  const info=document.createElement('small');info.textContent='Choose one result:';target.append(info);
  for(const city of results.slice(0,5)){
   const btn=document.createElement('button');btn.className='city-hit';btn.textContent=`${city.approximate?'Did you mean: ':''}${city.name} (${Number(city.lat).toFixed(4)}°, ${Number(city.lon).toFixed(4)}°)`;
   btn.addEventListener('click',()=>{setEarthPoint(Number(city.lat),Number(city.lon),city.name);target.textContent='Selected '+city.name+'.';});
   target.append(btn);
  }
 }catch(err){target.textContent=`City search failed: ${err.message}. Enter latitude/longitude directly.`;}
 finally{$('searchCity').disabled=false;}
}
$('searchCity').addEventListener('click',searchCity);
$('citySearch').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchCity();}});
for(const id of ['earthLat','earthLon'])$(id).addEventListener('change',()=>{
 const p=earthStartCoordinates();setEarthPoint(p.lat,p.lon);
});
$('routeVisible').addEventListener('change',()=>{earthMoonRouteLayer.visible=$('routeVisible').value==='yes'&&$('viewMode').value==='system';});
function renderEarthMoonPath(){
 clearLayer(earthMoonRouteLayer);
 if(!chosenTransfer||!frames.length)return;
 // Project the numerically propagated Lambert samples into the display's
 // shortened Earth–Moon separation. All 3D curvature comes from the
 // computed two-body orbit, not an arbitrary decorative Bézier spline.
 // The resulting orientation/scale is only a visualization transform.
 const start=earthDepartureMarker.position.clone();
 const target=vec(normal(moonDestinationCoordinates().lat,moonDestinationCoordinates().lon)).multiplyScalar(visualRadius(Number($('lat').value),Number($('lon').value),.08));
 const displayChord=new THREE.Vector3().subVectors(target,start),displayLength=displayChord.length(),displayAxis=displayChord.clone().normalize();
 const displaySide=new THREE.Vector3().crossVectors(displayAxis,new THREE.Vector3(0,1,0));
 if(displaySide.lengthSq()<.0001)displaySide.set(1,0,0);displaySide.normalize();
 const displayUp=new THREE.Vector3().crossVectors(displayAxis,displaySide).normalize();
 const orbit=chosenTransfer.trajectory;
 if(scaleMode()==='true'){
  const startMs=Date.parse(frames[selected].utc);
  const points=orbit.samples.map((pos,i)=>{
   const at=lerpFrame(frames,startMs+orbit.transferSeconds*1000*i/(orbit.samples.length-1));
   if(!at)return null;
   const moonBasis=moonFrame(at.earth_moon_fixed,at.moon_eci_km);
   const relative=pos.map((x,k)=>x-at.moon_eci_km[k]);
   return kmVec(moonBasis.toFixed(relative));
  }).filter(Boolean);
  if(points.length>=2){
   const geometry=new THREE.BufferGeometry().setFromPoints(points);
   const path=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x9ce8ff,transparent:true,opacity:.85,depthWrite:false}));
   earthMoonRouteLayer.add(path);
   const tubes=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),points.length*2,Math.max(.045,radius('moon')*.018),6,false),new THREE.MeshBasicMaterial({color:0x7edfff,transparent:true,opacity:.20,depthWrite:false}));earthMoonRouteLayer.add(tubes);
   earthMoonRouteLayer.visible=$('routeVisible').value==='yes'&&$('viewMode').value==='system';return;
  }
 }
 const r1=vec(orbit.departureKm),r2=vec(orbit.arrivalKm),realChord=new THREE.Vector3().subVectors(r2,r1),realLength=realChord.length();
 const realAxis=realChord.clone().normalize();
 const realSide=new THREE.Vector3().crossVectors(realAxis,new THREE.Vector3(0,1,0));
 if(realSide.lengthSq()<.0001)realSide.set(1,0,0);realSide.normalize();
 const realUp=new THREE.Vector3().crossVectors(realAxis,realSide).normalize();
 const points=orbit.samples.map((pos,i)=>{
  const d=vec(pos).sub(r1),along=d.dot(realAxis)/realLength;
  const side=d.dot(realSide)/realLength,up=d.dot(realUp)/realLength;
  const result=start.clone().addScaledVector(displayAxis,along*displayLength)
    .addScaledVector(displaySide,side*displayLength).addScaledVector(displayUp,up*displayLength);
  return result;
 });
 const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');
 const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,130,.054,7,false),new THREE.MeshBasicMaterial({color:0x7edfff,transparent:true,opacity:.34,depthWrite:false}));
 earthMoonRouteLayer.add(tube);
 const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(130)),new THREE.LineBasicMaterial({color:0xb8eeff,transparent:true,opacity:.83,depthWrite:false}));earthMoonRouteLayer.add(line);
 const arrive=new THREE.Mesh(new THREE.SphereGeometry(.14,18,10),new THREE.MeshBasicMaterial({color:0x9affb8,depthTest:false}));arrive.position.copy(target);earthMoonRouteLayer.add(arrive);
 earthMoonRouteLayer.visible=$('routeVisible').value==='yes'&&$('viewMode').value==='system';
}
function planEarthMoonRoute(){
 try{
  if(!frames.length)throw Error('Timeline is empty.');
  const earth=earthStartCoordinates(),moon=moonDestinationCoordinates();
  if([earth.lat,earth.lon,moon.lat,moon.lon].some(v=>!Number.isFinite(v)))throw Error('Earth and Moon coordinates must be numerical.');
  const hours=Number($('parkingAlt').value);
  if(!Number.isFinite(hours)||hours<160||hours>2000)throw Error('Parking-orbit altitude must be 160–2000 km.');
  const siteHeight=terrain?sampleHeightKm(terrain,moon.lat,moon.lon):0;
  const routes=surveyTransfers(frames,selected,earth,moon,siteHeight,{parkingAltKm:hours});
  // Prefer higher Sun and direct-to-Earth visibility at the lunar destination,
  // including the loaded NASA terrain horizon when available.
  for(const r of routes){
   const m=lightingAndContact(r.arrivalFrame,moon.lat,moon.lon,terrain,terrainProfile,0,false);
   r.terrainSunClear=m.sclear;r.terrainEarthClear=m.eclear;
   r.score=-r.deltaVkmS+(m.sunlit?.25:0)+(m.earthVisible?.15:0)-Math.abs(r.hours-108)*.0008;
  }
  routes.splice(0,routes.length,...rankRoutes(routes,$('routePreference').value));
  plannedTransfers=routes;chosenTransfer=routes[0];plannedEpochUTC=frames[selected].utc;
  $('viewMode').value='system';setView();renderEarthMoonPath();showRouteChoices();
  const best=routes[0];
  $('earthMoonResult').textContent=`BEST OF ${routes.length} SURVEYED OPTIONS: ${best.hours} h (~${(best.hours/24).toFixed(2)} days) · approximate parking-orbit injection Δv ${best.deltaVkmS.toFixed(3)} km/s · arrival ${new Date(best.arrivalUTC).toUTCString()} · Earth clearance ${best.terrainEarthClear.toFixed(1)}° · Sun clearance ${best.terrainSunClear.toFixed(1)}°.\n${framesArePreview?'WARNING: Approximate preview, not real NASA ephemerides. ':'NASA/JPL epoch samples used. '}This is a preliminary Earth-only Lambert transfer from a parking orbit, NOT a feasible launch or landing trajectory. In true-scale mode, the 3D curve samples are placed in a changing Moon-fixed frame with physically scaled distances; in Overview it is compressed. Neither is a landing solution.`;
 }catch(err){resetEarthMoonRoute('Route calculation unavailable: '+err.message);}
}
function showRouteChoices(){
 $('earthMoonOptions').replaceChildren();
 for(const r of plannedTransfers.slice(0,7)){
  const btn=document.createElement('div');btn.className='route-choice'+(r===chosenTransfer?' active':'');
  btn.setAttribute('role','button');btn.tabIndex=0;
  const heading=document.createElement('strong');heading.textContent=`${r.hours}-hour candidate · Δv ${r.deltaVkmS.toFixed(3)} km/s`;
  const sub=document.createElement('span');sub.textContent=`At lunar site: Sun clearance ${r.terrainSunClear.toFixed(1)}°, Earth clearance ${r.terrainEarthClear.toFixed(1)}°`;
  btn.append(heading,sub);
  const choose=()=>{chosenTransfer=r;showRouteChoices();renderEarthMoonPath();$('earthMoonResult').textContent=`Selected ${r.hours}-hour candidate · approximate departure Δv ${r.deltaVkmS.toFixed(3)} km/s · arrival ${new Date(r.arrivalUTC).toUTCString()}. Light-blue line is a scaled 3D projection of the computed two-body orbit, not a flyable trajectory.`;};
  btn.addEventListener('click',choose);btn.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});
  $('earthMoonOptions').append(btn);
 }
}
$('planEarthMoon').addEventListener('click',planEarthMoonRoute);
$('routePreference').addEventListener('change',()=>{if(plannedTransfers.length){plannedTransfers.splice(0,plannedTransfers.length,...rankRoutes(plannedTransfers,$('routePreference').value));chosenTransfer=plannedTransfers[0];showRouteChoices();renderEarthMoonPath();}});

// Moon surface maps-style point-to-point navigation (NASA LOLA sampled A*).
const surfaceRouteLayer=new THREE.Group();scene.add(surfaceRouteLayer);
let surfaceWaypoints=[],surfaceRoute=null;let surfaceMapZoom=12,surfaceMapCentre={lat:Number($('lat').value),lon:Number($('lon').value)};
function renderSurfaceStops(){
 $('waypointList').replaceChildren();
 if(!surfaceWaypoints.length){$('waypointList').textContent='No stops yet. Click Add Moon stop and choose points on the 3D Moon.';drawMoonSurfaceMap();return;}
 for(let i=0;i<surfaceWaypoints.length;i++){
  const p=surfaceWaypoints[i],item=document.createElement('div');item.className='waypoint';
  const badge=document.createElement('b');badge.textContent=`${i===0?'START':i===surfaceWaypoints.length-1?'STOP':'VIA'} ${i+1} `;
  item.append(badge,document.createTextNode(`${p.lat.toFixed(4)}° N · ${p.lon.toFixed(4)}° E`));$('waypointList').append(item);
 }
 drawMoonSurfaceMap();
}
function addSurfaceWaypoint(lat,lon){
 surfaceWaypoints.push({lat:clamp(Number(lat),-90,90),lon:wrapLongitude(Number(lon))});
 surfaceRoute=null;renderSurfaceRoute();renderSurfaceStops();
 surfaceMapCentre={lat,lon};drawMoonSurfaceMap();
 $('surfaceResult').textContent=`${surfaceWaypoints.length} stops selected. ${surfaceWaypoints.length>=2?'Click Calculate Moon surface route.':'Add one more stop.'}`;
}
function surfaceScenePoint(p){const n=normal(p.lat,p.lon),r=visualRadius(p.lat,p.lon,.027);return vec(n.map(x=>x*r));}
function renderSurfaceRoute(){
 clearLayer(surfaceRouteLayer);surfaceRouteLayer.visible=$('viewMode').value==='moon'&&$('surfaceShow').value==='yes';
 const nodes=surfaceRoute?.points??surfaceWaypoints;
 if(nodes.length>=2){
  const geom=new THREE.BufferGeometry().setFromPoints(nodes.map(surfaceScenePoint));
  surfaceRouteLayer.add(new THREE.Line(geom,new THREE.LineBasicMaterial({color:0x78e9ff,transparent:true,opacity:.87,depthWrite:false})));
 }
 for(let i=0;i<surfaceWaypoints.length;i++){
  const p=surfaceWaypoints[i],ball=new THREE.Mesh(new THREE.SphereGeometry(.062,14,10),new THREE.MeshBasicMaterial({color:i===0?0x88ffa1:i===surfaceWaypoints.length-1?0xffdf8f:0x80dfff,depthTest:true}));
  ball.position.copy(surfaceScenePoint(p));surfaceRouteLayer.add(ball);
 }
}
function calculateSurfaceRoute(){
 try{
  const candidate=planLunarSurfaceRoute(terrain,surfaceWaypoints,{strategy:$('surfaceStrategy').value,maxSlopeDeg:Number($('surfaceSlope').value),speedKmH:Number($('surfaceSpeed').value)});
  surfaceRoute=candidate;renderSurfaceRoute();drawMoonSurfaceMap();$('exportSurfaceCSV').disabled=false;$('exportSurfaceGPX').disabled=false;
  $('viewMode').value='moon';setView();
  $('surfaceResult').textContent=`ROUTE: ${candidate.legs.length} legs · ${candidate.distanceKm.toFixed(2)} km · gain ${Math.round(candidate.ascentKm*1000)} m · descent ${Math.round(candidate.descentKm*1000)} m · sampled max slope ${candidate.maxSlopeDeg.toFixed(1)}° · ~${candidate.timeHours.toFixed(1)} h at selected nominal speed.\n${candidate.warnings.join('\n')}\nThis is a sampled terrain estimate, NOT safe rover navigation.`;
 }catch(err){surfaceRoute=null;renderSurfaceRoute();drawMoonSurfaceMap();$('exportSurfaceCSV').disabled=true;$('exportSurfaceGPX').disabled=true;$('surfaceResult').textContent='Surface route unavailable: '+err.message;}
}
function saveTextFile(name,text,mime){const blob=new Blob([text],{type:mime});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('startMoonRoute').addEventListener('click',()=>{$('viewMode').value='moon';setView();setPickMode('waypoint');$('surfaceResult').textContent='Click Moon locations to add consecutive route stops. Click + current coordinate if easier.';});
$('addWaypoint').addEventListener('click',()=>addSurfaceWaypoint(Number($('lat').value),Number($('lon').value)));
$('undoWaypoint').addEventListener('click',()=>{surfaceWaypoints.pop();surfaceRoute=null;renderSurfaceStops();renderSurfaceRoute();$('exportSurfaceCSV').disabled=true;$('exportSurfaceGPX').disabled=true;});
$('clearWaypoints').addEventListener('click',()=>{surfaceWaypoints=[];surfaceRoute=null;renderSurfaceStops();renderSurfaceRoute();$('exportSurfaceCSV').disabled=true;$('exportSurfaceGPX').disabled=true;});
$('surfaceShow').addEventListener('change',renderSurfaceRoute);
$('planSurface').addEventListener('click',calculateSurfaceRoute);
$('exportSurfaceCSV').addEventListener('click',()=>{if(!surfaceRoute)return;saveTextFile('moon-surface-route.csv','latitude_deg,longitude_deg,height_km\n'+surfaceRoute.points.map(p=>`${p.lat.toFixed(6)},${p.lon.toFixed(6)},${sampleHeightKm(terrain,p.lat,p.lon).toFixed(6)}`).join('\n'),'text/csv');});
$('exportSurfaceGPX').addEventListener('click',()=>{if(!surfaceRoute)return;const trk=surfaceRoute.points.map(p=>`<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><ele>${(sampleHeightKm(terrain,p.lat,p.lon)*1000).toFixed(2)}</ele></trkpt>`).join('');saveTextFile('moon-surface-route.gpx',`<?xml version="1.0"?><gpx version="1.1" creator="Lunar Link Planner" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Moon route; NOT Earth WGS84 coordinates</name></metadata><trk><name>Moon surface route (lunar lat/lon; GPX viewer may render on Earth incorrectly)</name><trkseg>${trk}</trkseg></trk></gpx>`,'application/gpx+xml');});
// Terrain-shaded equirectangular local map. Moon latitude/longitude is NOT Earth WGS84.
const mapCanvas=$('surfaceMap'),mapCtx=mapCanvas.getContext('2d');
function surfaceMapCoords(){
 const width=mapCanvas.clientWidth||310,height=mapCanvas.clientHeight||200;
 const latSpan=surfaceMapZoom,lonSpan=Math.min(180,latSpan/Math.max(.20,Math.cos(surfaceMapCentre.lat*RAD)));
 return {width,height,latSpan,lonSpan,toPixel:p=>({x:width/2+wrapLongitude(p.lon-surfaceMapCentre.lon)/lonSpan*width,y:height/2-(p.lat-surfaceMapCentre.lat)/latSpan*height}),fromPixel:(x,y)=>({lat:clamp(surfaceMapCentre.lat+(height/2-y)/height*latSpan,-90,90),lon:wrapLongitude(surfaceMapCentre.lon+(x-width/2)/width*lonSpan)})};
}
function drawMoonSurfaceMap(){
 const {width,height,toPixel,fromPixel}=surfaceMapCoords(),dpr=Math.min(2,window.devicePixelRatio||1);
 mapCanvas.width=Math.round(width*dpr);mapCanvas.height=Math.round(height*dpr);
 mapCtx.setTransform(dpr,0,0,dpr,0,0);mapCtx.clearRect(0,0,width,height);
 const tile=5;
 for(let y=0;y<height;y+=tile)for(let x=0;x<width;x+=tile){
  const geo=fromPixel(x,y),km=sampleHeightKm(terrain,geo.lat,geo.lon),shade=clamp(Math.round(76+km*7),25,195);
  mapCtx.fillStyle=terrain?`rgb(${Math.round(shade*.78)},${Math.round(shade*.92)},${Math.round(shade*1.02)})`:'#263850';
  mapCtx.fillRect(x,y,tile,tile);
 }
 const gap=surfaceMapZoom>15?10:surfaceMapZoom>5?2:surfaceMapZoom>1?.5:.1;
 mapCtx.strokeStyle='#d5e8ff36';mapCtx.lineWidth=1;
 const minLat=Math.floor((surfaceMapCentre.lat-surfaceMapZoom/2)/gap)*gap;
 for(let lat=minLat;lat<surfaceMapCentre.lat+surfaceMapZoom;lat+=gap){const p=toPixel({lat,lon:surfaceMapCentre.lon});if(p.y>=0&&p.y<=height){mapCtx.beginPath();mapCtx.moveTo(0,p.y);mapCtx.lineTo(width,p.y);mapCtx.stroke();}}
 const radius=surfaceMapZoom/Math.max(.2,Math.cos(surfaceMapCentre.lat*RAD));const minLon=Math.floor((surfaceMapCentre.lon-radius)/gap)*gap;
 for(let lon=minLon;lon<surfaceMapCentre.lon+radius;lon+=gap){const p=toPixel({lat:surfaceMapCentre.lat,lon:wrapLongitude(lon)});if(p.x>=0&&p.x<=width){mapCtx.beginPath();mapCtx.moveTo(p.x,0);mapCtx.lineTo(p.x,height);mapCtx.stroke();}}
 const locations=surfaceRoute?.points??surfaceWaypoints;
 if(locations.length>=2){mapCtx.strokeStyle='#89edff';mapCtx.lineWidth=2.6;mapCtx.beginPath();locations.forEach((p,i)=>{const v=toPixel(p);if(i===0)mapCtx.moveTo(v.x,v.y);else mapCtx.lineTo(v.x,v.y);});mapCtx.stroke();}
 surfaceWaypoints.forEach((p,i)=>{const v=toPixel(p);mapCtx.fillStyle=i===0?'#7fffc5':i===surfaceWaypoints.length-1?'#ffe38c':'#84d9ff';mapCtx.beginPath();mapCtx.arc(v.x,v.y,5,0,Math.PI*2);mapCtx.fill();mapCtx.fillStyle='#091323';mapCtx.font='bold 10px sans-serif';mapCtx.fillText(String(i+1),v.x+7,v.y-5);});
 mapCtx.fillStyle='#e5f7ff';mapCtx.font='11px system-ui';mapCtx.fillText(`${terrain?'LOLA elevation':'No DEM'} · ${surfaceMapZoom.toFixed(1)}° vertical span · ${surfaceMapCentre.lat.toFixed(2)}°, ${surfaceMapCentre.lon.toFixed(2)}°`,8,height-10);
}
mapCanvas.addEventListener('click',e=>{const rect=mapCanvas.getBoundingClientRect();const p=surfaceMapCoords().fromPixel((e.clientX-rect.left)*mapCanvas.clientWidth/rect.width,(e.clientY-rect.top)*mapCanvas.clientHeight/rect.height);addSurfaceWaypoint(p.lat,p.lon);});
$('mapZoomOut').addEventListener('click',()=>{surfaceMapZoom=Math.min(120,surfaceMapZoom*1.65);drawMoonSurfaceMap();});
$('mapZoomIn').addEventListener('click',()=>{surfaceMapZoom=Math.max(.3,surfaceMapZoom/1.65);drawMoonSurfaceMap();});
$('mapCenter').addEventListener('click',()=>{surfaceMapCentre=surfaceWaypoints.at(-1)??moonDestinationCoordinates();drawMoonSurfaceMap();});
window.addEventListener('resize',drawMoonSurfaceMap);
// ---------------------------------------------------------------------------
// Landing site explorer: curated sites, custom coordinates, live metrics and
// side-by-side comparison. All heavy geometry lives in landing-sites-core.mjs.
// ---------------------------------------------------------------------------
let compareList=[];
function populateSiteSelect(){
 const sel=$('siteSelect');
 if(!sel)return;
 const groups={};
 for(const s of LANDING_SITES){
  (groups[s.program]=groups[s.program]||[]).push(s);
 }
 for(const [prog,sites] of Object.entries(groups)){
  const og=document.createElement('optgroup');og.label=prog;
  for(const s of sites){
   const opt=document.createElement('option');opt.value=s.id;
   opt.textContent=`${s.name} · ${s.lat.toFixed(2)}°, ${s.lon.toFixed(2)}°${s.status==='candidate'?' (candidate)':''}`;
   og.appendChild(opt);
  }
  sel.appendChild(og);
 }
 sel.addEventListener('change',()=>{
  const s=getSite(sel.value);
  if(!s)return;
  $('customLat').value=s.lat;$('customLon').value=s.lon;
  $('lat').value=s.lat;$('lon').value=s.lon;
  $('siteFeedback').textContent=`Selected: ${s.name} (${s.program}, ${s.country})${s.year?' · '+s.year:''}${s.note?' — '+s.note:''}`;
  if(typeof changed==='function')changed();
  updateSiteMetrics();
 });
}
function currentSiteForMetrics(){
 const lat=clamp(Number($('lat').value),-90,90),lon=clamp(Number($('lon').value),-180,180);
 return {lat,lon};
}
function updateSiteMetrics(){
 const box=$('siteMetrics');
 if(!box)return;
 if(!frames.length){box.textContent='Load or preview a timeline frame to see live site metrics.';return;}
 const site=currentSiteForMetrics();
 const f=frames[selected];
 let m;
 try{m=siteMetrics(site,f,terrain,terrainProfile,Number($('minEl').value)||10);}
 catch(err){box.textContent='Metrics unavailable: '+err.message;return;}
 const sunTxt=m.sunlit?'☀ sunlit':'🌑 shadow';
 const earthTxt=m.earthVisible?'📡 Earth visible':'📡 Earth below horizon';
 const mins=(ms)=>{if(ms==null)return 'none in window';const t=Math.round(ms/60000);return t>=60?`${Math.floor(t/60)}h ${t%60}m`:`${t}m`;};
 box.textContent=`Sun elevation ${m.sunElevationDeg.toFixed(1)}° (power ${(m.sunPowerFraction*100).toFixed(0)}%) · ${sunTxt} · Earth elevation ${m.earthElevationDeg.toFixed(1)}° · ${earthTxt} · terrain clearance ${m.sunHorizonClearanceDeg.toFixed(1)}° sun / ${m.earthHorizonClearanceDeg.toFixed(1)}° Earth · site elev ${m.siteElevKm>=0?'+':''}${m.siteElevKm.toFixed(2)} km`;

 // Update operations countdown widget
 const sunsetEl=$('sunsetCountdown');
 const earthsetEl=$('earthsetCountdown');
 if(sunsetEl&&earthsetEl){
  const ts=siteTimeSeries(site,frames,terrain,Number($('minEl').value)||10);
  sunsetEl.textContent=ts.firstSunset!=null?mins(ts.firstSunset):'—';
  earthsetEl.textContent=ts.firstEarthset!=null?mins(ts.firstEarthset):'—';
 }

 // Show south pole warning if applicable
 const southPoleNote=$('southPoleNote');
 if(southPoleNote){
  const isSouthPole=site.lat<-80&&(site.name||'').toLowerCase().includes('shackleton')||
                    (site.lat<-85&&Math.abs(site.lon)<10);
  southPoleNote.style.display=isSouthPole?'block':'none';
 }

 // Render timeline visualization
 renderSiteTimeline(site);
}

function renderSiteTimeline(site){
 const canvas=$('siteTimelineCanvas');
 if(!canvas||!frames.length)return;
 const ctx=canvas.getContext('2d');
 const w=canvas.width;
 const h=canvas.height;
 ctx.clearRect(0,0,w,h);

 // Calculate time series
 const ts=siteTimeSeries(site,frames,terrain,Number($('minEl').value)||10);
 if(!ts.samples.length)return;

 // Draw horizon line
 ctx.strokeStyle='#ff4444';
 ctx.lineWidth=1;
 ctx.setLineDash([2,2]);
 ctx.beginPath();
 ctx.moveTo(0,h/2);
 ctx.lineTo(w,h/2);
 ctx.stroke();
 ctx.setLineDash([]);

 // Draw sun elevation (blue)
 ctx.strokeStyle='#4ea3ff';
 ctx.lineWidth=2;
 ctx.beginPath();
 for(let i=0;i<ts.samples.length;i++){
  const x=(i/(ts.samples.length-1))*w;
  const y=h/2-(ts.samples[i].sunElevationDeg/90)*(h/2);
  if(i===0)ctx.moveTo(x,y);
  else ctx.lineTo(x,y);
 }
 ctx.stroke();

 // Draw earth elevation (green)
 ctx.strokeStyle='#74e2b0';
 ctx.lineWidth=2;
 ctx.beginPath();
 for(let i=0;i<ts.samples.length;i++){
  const x=(i/(ts.samples.length-1))*w;
  const y=h/2-(ts.samples[i].earthElevationDeg/90)*(h/2);
  if(i===0)ctx.moveTo(x,y);
  else ctx.lineTo(x,y);
 }
 ctx.stroke();

 // Draw current time marker
 const currentX=(selected/(frames.length-1))*w;
 ctx.strokeStyle='#ffffff';
 ctx.lineWidth=1;
 ctx.beginPath();
 ctx.moveTo(currentX,0);
 ctx.lineTo(currentX,h);
 ctx.stroke();
}
function renderCompareTable(){
 const table=$('compareTable');if(!table)return;
 const tb=table.querySelector('tbody');tb.innerHTML='';
 if(!compareList.length){tb.innerHTML='<tr><td colspan="7" style="opacity:.6">Add sites to compare them side by side.</td></tr>';return;}
 if(!frames.length){tb.innerHTML='<tr><td colspan="7" style="opacity:.6">Load a timeline frame first.</td></tr>';return;}
 const f=frames[selected];
 const ranked=compareSites(compareList,f,terrain,Number($('minEl').value)||10);
 for(const r of ranked){
  const tr=document.createElement('tr');
  tr.innerHTML=`<td>${r.rank}</td><td style="text-align:left">${r.site.name||`${r.site.lat.toFixed(2)}, ${r.site.lon.toFixed(2)}`}</td><td>${r.metrics.sunElevationDeg.toFixed(1)}</td><td>${(r.metrics.sunPowerFraction*100).toFixed(0)}%</td><td>${r.metrics.earthElevationDeg.toFixed(1)}</td><td>${r.metrics.earthVisible?'✓':'✗'}</td><td>${r.score.toFixed(2)}</td>`;
  tb.appendChild(tr);
 }
}
function applySiteFromInputs(){
 const sel=getSite($('siteSelect').value);
 let lat,lon,label;
 if(sel){lat=sel.lat;lon=sel.lon;label=sel.name;}
 else{
  const n=normaliseCoordinates($('customLat').value||$('lat').value,$('customLon').value||$('lon').value);
  if(!n.valid){$('siteFeedback').textContent='Invalid coordinates: '+n.error;return;}
  lat=n.lat;lon=n.lon;label=`Custom ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
 }
 $('lat').value=lat;$('lon').value=lon;
 $('siteFeedback').textContent='Applied: '+label;
 if(typeof changed==='function')changed();
 updateSiteMetrics();renderCompareTable();
}
function addCurrentToCompare(){
 const sel=getSite($('siteSelect').value);
 const site=sel?{id:sel.id,name:sel.name,lat:sel.lat,lon:sel.lon}:(()=>{const c=currentSiteForMetrics();return {name:`Custom ${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}`,lat:c.lat,lon:c.lon};})();
 if(compareList.some(s=>s.name===site.name)){$('siteFeedback').textContent='Already in comparison: '+site.name;return;}
 if(compareList.length>=8){$('siteFeedback').textContent='Comparison is limited to 8 sites.';return;}
 compareList.push(site);$('siteFeedback').textContent='Added to comparison: '+site.name;
 renderCompareTable();
}
function scanSiteWindows(){
 if(!frames.length){$('windowResult').textContent='Load or preview a timeline frame first.';return;}
 const site=currentSiteForMetrics();
 const ts=siteTimeSeries(site,frames,terrain,Number($('minEl').value)||10);
 const fmt=ms=>{if(ms==null)return 'no transition in window';const t=Math.round(ms/60000);return t>=60?`${Math.floor(t/60)}h ${t%60}m`:`${t}m`;};
 const total=frames.length?new Date(frames[frames.length-1].utc)-new Date(frames[0].utc):0;
 const sunDur=ts.sunWindows.reduce((a,w)=>a+(w.durationMs||0),0);
 const earthDur=ts.earthWindows.reduce((a,w)=>a+(w.durationMs||0),0);
 const pct=(d)=>total>0?((d/total)*100).toFixed(0)+'%':'—';
 $('windowResult').textContent=`Site ${site.lat.toFixed(2)}°, ${site.lon.toFixed(2)}° over ${frames.length} frames (~${(total/3600000).toFixed(1)} h): sunlight ${ts.sunWindows.length} window(s), ${pct(sunDur)} of span · Earth visibility ${ts.earthWindows.length} window(s), ${pct(earthDur)} of span · time to sun state change ${fmt(ts.firstSunset)} · time to Earth state change ${fmt(ts.firstEarthset)}.`;
}
function wireSiteExplorer(){
 populateSiteSelect();
 $('applySite')?.addEventListener('click',applySiteFromInputs);
 $('addCompare')?.addEventListener('click',addCurrentToCompare);
 $('clearCompare')?.addEventListener('click',()=>{compareList=[];renderCompareTable();});
 $('scanWindows')?.addEventListener('click',scanSiteWindows);
 updateSiteMetrics();
}
renderSurfaceStops();
wireSiteExplorer();
updateMarker();resize();buildPreview();setView();calculatePaths(false);loadTerrain();
// ---------------------------------------------------------------------------
// Route planner UI (city→city / planet→planet) + layer visibility toggles.
// Wires the #route-panel and #layer-panel that index.html adds.
//
// UX model: a mode tab (City / Planet) picks the endpoint kind, two text
// fields with <datalist> suggestions give typo-tolerant autocomplete, a Swap
// button reverses direction, and the result panel shows type, distance,
// duration, waypoints and any error. A checkbox draws the route in the 3D
// scene. planRoute() is ALWAYS awaited before its result is read.
// ---------------------------------------------------------------------------
const PLANET_LABELS = {
  sun: 'Sun', mercury: 'Mercury', venus: 'Venus', earth: 'Earth', moon: 'Moon',
  mars: 'Mars', jupiter: 'Jupiter', saturn: 'Saturn', uranus: 'Uranus', neptune: 'Neptune'
};
const CITY_CRUISE_KMH = 900;
let routeMode = 'city';
let resolvedFrom = null, resolvedTo = null;

// ---- 3D route layer (world-space, drawn above the globe / solar system) ----
// routeDrawLayer ist jetzt oben (nahe Kamera-Init) deklariert, um TDZ zu vermeiden.

function earthEndpointWorld(lat, lon) {
  // Earth-fixed axes are refreshed by updateSystem() whenever the Solar view
  // runs; falling back to the current frame keeps the marker approximately
  // correct if a route is computed before the first frame is available.
  const f = frames.length ? frames[selected] : null;
  if (f) {
    const axes = moonFrame(f.earth_moon_fixed, f.moon_eci_km);
    const dir = earthSiteDirectionECI(f.utc, lat, lon);
    return earthCentre.clone().addScaledVector(vec(axes.toFixed(dir)), radius('earth') * 1.01);
  }
  return earthCentre.clone().add(new THREE.Vector3(0, radius('earth') * 1.01, 0));
}

function solarBodyWorld(id) {
  const obj = solarObjects.get(id);
  return obj ? obj.root.position.clone() : null;
}

function clearRouteDraw() {
  clearLayer(routeDrawLayer);
}

// World-space polyline: positions are already final scene coordinates, so this
// must NOT apply kmVec (which rescales physics-km vectors to Moon units).
function addRoutePolyline(points, color, opacity = 0.95) {
  if (!points || points.length < 2) return null;
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true, depthWrite: false }));
  routeDrawLayer.add(line);
  return line;
}

function renderRoute3D() {
  clearRouteDraw();
  if (typeof drawRoute3D === 'undefined' || !drawRoute3D) return;
  const view = $('viewMode') ? $('viewMode').value : 'solar';
  const currentRoute = (typeof getActiveRoute === 'function') ? getActiveRoute() : null;
  if (!currentRoute || !currentRoute.isValid) return;
  if (currentRoute.type === 'city') {
    if (view !== 'system' || !resolvedFrom || !resolvedTo) return;
    // Great-circle arc lifted slightly above the Earth globe.
    const lift = radius('earth') * 0.012;
    const pts = (currentRoute.path || []).map((p) => earthEndpointWorld(p.lat, p.lon));
    if (pts.length < 2) return;
    const elevated = pts.map((v) => earthCentre.clone().add(v.clone().sub(earthCentre).normalize().multiplyScalar(lift)));
    addRoutePolyline(elevated, 0x7ddfff, 0.95);
    const startM = new THREE.Mesh(new THREE.SphereGeometry(radius('earth') * 0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0x74e2b0 }));
    startM.position.copy(elevated[0]); routeDrawLayer.add(startM);
    const endM = new THREE.Mesh(new THREE.SphereGeometry(radius('earth') * 0.018, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffb18c }));
    endM.position.copy(elevated[elevated.length - 1]); routeDrawLayer.add(endM);
    routeDrawLayer.visible = true;
  } else {
    if (view !== 'solar' || !resolvedFrom || !resolvedTo) return;
    const a = solarBodyWorld(resolvedFrom.id), b = solarBodyWorld(resolvedTo.id);
    if (!a || !b) return;
    if (Array.isArray(currentRoute.pathKm) && currentRoute.pathKm.length > 1) {
      const points = currentRoute.pathKm.map((positionKm) =>
        vec(displayPlanetVector(positionKm, scaleMode(), 1 / solarKmPerUnit))
      );
      addRoutePolyline(points, currentRoute.transferType === 'swingby' ? 0xb388ff : 0xffd58a, 0.92);
    } else {
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const away = mid.clone().normalize();
      const bulge = Math.max(0.6, mid.length() * 0.18);
      const control = mid.clone().add(away.multiplyScalar(bulge));
      const curve = new THREE.QuadraticBezierCurve3(a, control, b);
      addRoutePolyline(curve.getPoints(72), 0xffd58a, 0.92);
    }
    const dotA = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.12, solarRadius(resolvedFrom.id) * 0.25), 14, 10), new THREE.MeshBasicMaterial({ color: 0x74e2b0 }));
    dotA.position.copy(a); routeDrawLayer.add(dotA);
    const dotB = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.12, solarRadius(resolvedTo.id) * 0.25), 14, 10), new THREE.MeshBasicMaterial({ color: 0xffb18c }));
    dotB.position.copy(b); routeDrawLayer.add(dotB);
    routeDrawLayer.visible = true;
  }
}

function updateRouteDrawVisibility() {
  const view = $('viewMode') ? $('viewMode').value : 'solar';
  const safeDraw = (typeof drawRoute3D === 'undefined') ? true : drawRoute3D;
  const route = (typeof getActiveRoute === 'function') ? getActiveRoute() : null;
  if (!route || !route.isValid) { routeDrawLayer.visible = false; return; }
  routeDrawLayer.visible = safeDraw &&
    ((route.type === 'city' && view === 'system') || (route.type === 'planet' && view === 'solar'));
}

// ---- Formatting helpers -------------------------------------------------
function formatDuration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  const days = hours / 24;
  if (days < 365) return `${days.toFixed(1)} days`;
  return `${(days / 365.25).toFixed(2)} years`;
}

function formatKm(km) {
  if (!Number.isFinite(km)) return '—';
  if (km >= 1e9) return `${(km / 1e9).toFixed(2)} billion km`;
  if (km >= 1e6) return `${(km / 1e6).toFixed(1)} million km`;
  if (km >= 1e3) return `${(km / 1e3).toFixed(1)} thousand km`;
  return `${km.toFixed(0)} km`;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// ---- Endpoint UI ---------------------------------------------------------
function routeEndpointMode(side) {
  return routeMode;
}

function fillRoutePlanetSelect(select, defaultId) {
  if (!select) return;
  select.replaceChildren();
  const options = (typeof PLANET_OPTIONS !== 'undefined' && Array.isArray(PLANET_OPTIONS))
    ? PLANET_OPTIONS
    : Object.entries(PLANET_LABELS).map(([id, name]) => ({ id, name }));
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt.id; el.textContent = opt.name;
    if (opt.id === defaultId) el.selected = true;
    select.append(el);
  }
}

async function fillRouteSuggestions(side) {
  const input = $(side === 'from' ? 'route-from-input' : 'route-to-input');
  const list = $(side === 'from' ? 'route-from-datalist' : 'route-to-datalist');
  if (!input || !list) return;
  const query = input.value.trim();
  const matches = query ? await searchCities(query, 8) : [];
  list.replaceChildren();
  for (const city of matches) {
    const opt = document.createElement('option');
    opt.value = city.name;
    const country = city.country ? ` · ${city.country}` : '';
    const pop = city.population ? ` (pop. ${Number(city.population).toLocaleString('en-GB')})` : '';
    opt.label = `${city.name}${country}${pop}`;
    list.append(opt);
  }
}

async function resolveCityInput(side) {
  const input = $(side === 'from' ? 'route-from-input' : 'route-to-input');
  const query = input ? input.value.trim() : '';
  if (!query) return null;
  // Exact catalogue match first, then typo-tolerant best match.
  const city = await findCity(query);
  return city || null;
}

function syncRouteModeUI() {
  const cityBtn = $('route-mode-city'), planetBtn = $('route-mode-planet');
  if (cityBtn) {
    cityBtn.setAttribute('aria-pressed', String(routeMode === 'city'));
    cityBtn.classList.toggle('accent', routeMode === 'city');
    cityBtn.classList.toggle('secondary', routeMode !== 'city');
  }
  if (planetBtn) {
    planetBtn.setAttribute('aria-pressed', String(routeMode === 'planet'));
    planetBtn.classList.toggle('accent', routeMode === 'planet');
    planetBtn.classList.toggle('secondary', routeMode !== 'planet');
  }
  const showCity = routeMode === 'city';
  for (const id of ['route-city-from', 'route-city-to']) {
    const el = $(id); if (el) el.classList.toggle('hidden', !showCity);
  }
  for (const id of ['route-planet-from', 'route-planet-to']) {
    const el = $(id); if (el) el.classList.toggle('hidden', showCity);
  }
  const hint = $('route-mode-hint');
  if (hint) {
    hint.textContent = showCity
      ? 'Pick two Earth cities. Typo-tolerant suggestions appear as you type.'
      : 'Pick two planets for an ideal Hohmann transfer (Earth ↔ Moon uses an approximate geocentric coast).';
  }
}

function setRouteMode(mode) {
  routeMode = mode === 'planet' ? 'planet' : 'city';
  resolvedFrom = null; resolvedTo = null;
  clearRouteDraw();
  syncRouteModeUI();
  if (routeMode === 'planet') {
    fillRoutePlanetSelect($('route-from-select'), 'earth');
    fillRoutePlanetSelect($('route-to-select'), 'mars');
  } else {
    const fromInput = $('route-from-input'), toInput = $('route-to-input');
    if (fromInput && !fromInput.value) fromInput.value = 'Munich';
    if (toInput && !toInput.value) toInput.value = 'Berlin';
    fillRouteSuggestions('from'); fillRouteSuggestions('to');
  }
  const result = $('route-result');
  if (result) {
    result.classList.remove('ok', 'err');
    result.textContent = 'Choose a start and destination, then calculate a route.';
  }
}

function swapRouteEndpoints() {
  if (routeMode === 'city') {
    const fromInput = $('route-from-input'), toInput = $('route-to-input');
    if (fromInput && toInput) {
      const tmp = fromInput.value; fromInput.value = toInput.value; toInput.value = tmp;
      fillRouteSuggestions('from'); fillRouteSuggestions('to');
    }
  } else {
    const fromSel = $('route-from-select'), toSel = $('route-to-select');
    if (fromSel && toSel) {
      const tmp = fromSel.value; fromSel.value = toSel.value; toSel.value = tmp;
    }
  }
  const tmpR = resolvedFrom; resolvedFrom = resolvedTo; resolvedTo = tmpR;
  renderRoute3D();
}

async function computeActiveRoute() {
  const result = $('route-result');
  if (!result) return;
  const isCity = routeMode === 'city';
  const from = isCity
    ? await resolveCityInput('from')
    : { type: 'planet', id: ($('route-from-select') || {}).value, name: PLANET_LABELS[($('route-from-select') || {}).value] };
  const to = isCity
    ? await resolveCityInput('to')
    : { type: 'planet', id: ($('route-to-select') || {}).value, name: PLANET_LABELS[($('route-to-select') || {}).value] };

  if (!from || !to || !from.name || !to.name) {
    result.classList.add('err'); result.classList.remove('ok');
    result.textContent = isCity
      ? 'Enter both a start and a destination city (suggestions appear while typing).'
      : 'Choose both a start and a destination planet.';
    return;
  }

  result.classList.remove('ok', 'err');
  result.textContent = 'Calculating route…';

  const transferOptions = {
    transferType: ($('route-transfer-type') || {}).value || 'hohmann',
    timeOfFlightDays: Number(($('route-transfer-days') || {}).value) || 180,
    biellipticRadiusAu: Number(($('route-bielliptic-radius') || {}).value) || 3,
    flybyId: ($('route-flyby-select') || {}).value || '',
    flybyFraction: Number(($('route-flyby-fraction') || {}).value) || 0.5,
    departureEpoch: solarViewDate()
  };

  try {
    if (isCity) {
      from.type = 'city'; to.type = 'city';
    }
    // planRoute is async — ALWAYS await it before reading .isValid.
    const route = await planRoute(from, to, transferOptions);
    if (!route || !route.isValid) {
      throw new Error((route && route.error) ? route.error : 'Route could not be computed.');
    }
    setActiveRoute(route);
    resolvedFrom = from; resolvedTo = to;

    const isCityRoute = route.type === 'city';
    // Auto-switch to the view that can actually show this route kind.
    const wantedView = isCityRoute ? 'system' : 'solar';
    if ($('viewMode') && $('viewMode').value !== wantedView) {
      $('viewMode').value = wantedView;
      if (typeof setView === 'function') setView();
    }
    const waypointCount = Array.isArray(route.path) ? route.path.length : 0;
    const distanceText = formatKm(route.distanceKm);
    const durationText = isCityRoute
      ? `${formatDuration(route.distanceKm / CITY_CRUISE_KMH)} (at ${CITY_CRUISE_KMH} km/h)`
      : formatDuration(route.durationHours);
    const transferLabels = {
      hohmann: 'Hohmann transfer (idealised)',
      bielliptic: 'Bi-elliptic transfer (idealised)',
      lambert: 'Lambert flight path',
      swingby: 'Lambert + swing-by (patched conic)',
      'hohmann-geocentric': 'Hohmann transfer (geocentric)'
    };
    const typeText = isCityRoute ? 'Great-circle route on Earth' : (transferLabels[route.transferType] || 'Planet transfer');
    let extra = isCityRoute
      ? `${from.name} ${from.lat.toFixed(3)}°N ${from.lon.toFixed(3)}°E → ${to.name} ${to.lat.toFixed(3)}°N ${to.lon.toFixed(3)}°E`
      : `${from.name} → ${to.name}`;
    if (!isCityRoute && route.transfer) {
      const t = route.transfer;
      const parts = [];
      if (Number.isFinite(t.totalDeltaVKmS)) parts.push(`total Δv ${t.totalDeltaVKmS.toFixed(3)} km/s`);
      if (Array.isArray(t.maneuvers) && t.maneuvers.length) {
        parts.push(t.maneuvers.map((maneuver) =>
          `${maneuver.label} ${maneuver.deltaVKms.toFixed(3)} km/s`
        ).join(' · '));
      }
      if (Number.isFinite(t.departureDeltaVKmS)) parts.push(`departure Δv ${t.departureDeltaVKmS.toFixed(3)} km/s`);
      if (Number.isFinite(t.arrivalDeltaVKmS)) parts.push(`arrival Δv ${t.arrivalDeltaVKmS.toFixed(3)} km/s`);
      if (Number.isFinite(t.flybyDeltaVKmS)) parts.push(`flyby Δv ${t.flybyDeltaVKmS.toFixed(3)} km/s`);
      if (t.departureEpoch) parts.push(`depart ${new Date(t.departureEpoch).toISOString().slice(0, 10)}`);
      if (t.arrivalEpoch) parts.push(`arrive ${new Date(t.arrivalEpoch).toISOString().slice(0, 10)}`);
      if (t.type === 'swingby') parts.push(t.ballisticFlyby ? 'ballistic flyby' : 'powered flyby correction');
      if (t.relativisticCorrection && Number.isFinite(t.relativisticCorrection.deltaTMs)) {
        parts.push(`Relativistic time correction (Einstein): ${t.relativisticCorrection.deltaTMs.toFixed(4)} ms (γ=${t.relativisticCorrection.gamma.toFixed(8)}). Note: This is a precision metric only; trajectory geometry remains classical.`);
      }
      if (parts.length) extra += ' · ' + parts.join(' · ');
    }

    result.classList.add('ok'); result.classList.remove('err');
    result.innerHTML =
      `<span class="rline"><b>${esc(from.name)} → ${esc(to.name)}</b></span>` +
      `<span class="rline">Type: ${esc(typeText)}</span>` +
      `<span class="rline">Distance: ${esc(distanceText)}</span>` +
      `<span class="rline">Duration: ${esc(durationText)}</span>` +
      `<span class="rline">Waypoints: ${waypointCount}</span>` +
      `<span class="rline muted">${esc(extra)}</span>`;

    // Mirror the city route into the Earth departure coordinate fields so the
    // Earth–Moon panel and the globe marker start from the same place.
    if (isCityRoute && Array.isArray(route.path) && route.path.length) {
      if ($('earthLat') && $('earthLon')) {
        $('earthLat').value = route.path[0].lat.toFixed(4);
        $('earthLon').value = route.path[0].lon.toFixed(4);
      }
    }

    // (Re)draw the route in 3D. City routes need the Earth-fixed frame, which
    // updateSystem() provides; planet routes read live solar positions.
    if ($('viewMode').value === 'system' || $('viewMode').value === 'solar') {
      if (frames.length) {
        try { updateSystem(frames[selected]); } catch (e) { /* keep going */ }
      } else {
        try { updateSolarSystem(solarViewDate()); } catch (e) { /* keep going */ }
      }
    }
    renderRoute3D();
    updateRouteDrawVisibility();
  } catch (err) {
    result.classList.add('err'); result.classList.remove('ok');
    result.textContent = 'Route unavailable: ' + (err && err.message ? err.message : err);
    resolvedFrom = null; resolvedTo = null;
    clearRouteDraw();
  }
}

function wireRoutePanel() {
  const modeCity = $('route-mode-city'), modePlanet = $('route-mode-planet');
  if (modeCity) modeCity.addEventListener('click', () => setRouteMode('city'));
  if (modePlanet) modePlanet.addEventListener('click', () => setRouteMode('planet'));

  for (const side of ['from', 'to']) {
    const input = $(side === 'from' ? 'route-from-input' : 'route-to-input');
    if (input) {
      input.addEventListener('input', () => fillRouteSuggestions(side));
      // Keep the datalist fresh if the browser reopens it without an input event.
      input.addEventListener('focus', () => fillRouteSuggestions(side));
    }
    const select = $(side === 'from' ? 'route-from-select' : 'route-to-select');
    if (select) select.addEventListener('change', () => { resolvedFrom = null; resolvedTo = null; });
  }

  const swap = $('route-swap-btn');
  if (swap) swap.addEventListener('click', swapRouteEndpoints);

  const btn = $('route-plan-btn');
  if (btn) btn.addEventListener('click', computeActiveRoute);

  const toggle = $('route-toggle');
  if (toggle) {
    toggle.addEventListener('change', () => {
      const res = $('route-result');
      if (res) res.classList.toggle('hidden', !toggle.checked);
    });
    const res = $('route-result');
    if (res) res.classList.toggle('hidden', !toggle.checked);
  }

  const drawToggle = $('route-3d-toggle');
  if (drawToggle) {
    drawRoute3D = drawToggle.checked;
    drawToggle.addEventListener('change', () => {
      drawRoute3D = drawToggle.checked;
      if (drawRoute3D) renderRoute3D();
      updateRouteDrawVisibility();
    });
  }

  setRouteMode('city');
}




// Toggle visibility of the real Three.js layers (not placeholder divs).
// Only applies while the Solar System view is active; setView() re-asserts the
// visibility baseline every time the user changes view mode.
// (layerVisibility itself is declared near the top of the file so the first
// setView() call can already read it.)
function wireLayerPanel() {
  const bindings = [
    ['layer-planets', 'planets'],
    ['layer-orbits', 'orbits'],
    ['layer-labels', 'labels'],
    ['layer-grid', 'grid']
  ];
  for (const [checkboxId, key] of bindings) {
    const cb = $(checkboxId);
    if (!cb) continue;
    const apply = () => {
      layerVisibility[key] = cb.checked;
      if (key === 'planets' && typeof solarLayer !== 'undefined') {
        // Preserve the view-mode gate: solarLayer is only visible in Solar view.
        const isSolar = $('viewMode') && $('viewMode').value === 'solar';
        solarLayer.visible = isSolar && cb.checked;
      } else if (key === 'orbits' && typeof solarOrbitLines !== 'undefined') {
        const isSolar = $('viewMode') && $('viewMode').value === 'solar';
        showOrbitLines = cb.checked;
        solarOrbitLines.visible = isSolar && cb.checked;
        if ($('showSolarOrbits')) {
          $('showSolarOrbits').textContent = 'Orbital trails: ' + (cb.checked ? 'ON' : 'OFF');
          $('showSolarOrbits').setAttribute('aria-pressed', String(cb.checked));
        }
      } else if (key === 'labels' && typeof solarLabels !== 'undefined') {
        for (const sprite of solarLabels.values()) {
          if (sprite) sprite.visible = cb.checked;
        }
      } else if (key === 'grid' && typeof gridLayer !== 'undefined') {
        const moonView = $('viewMode') &&
          ($('viewMode').value === 'moon' || $('viewMode').value === 'system');
        gridLayer.visible = moonView && $('groundMode') && $('groundMode').value === 'grid3d' && cb.checked;
      }
    };
    cb.addEventListener('change', apply);
    // Do NOT call apply() immediately: setView() sets the correct baseline
    // based on the current view mode, and calling apply() at load time would
    // hide the solar layer before the user even switches to Solar view.
  }
}

wireRoutePanel();
wireLayerPanel();

function wireFullscreenAndZoom() {
  const fsSolar = $('fullscreen-solar');
  if (fsSolar) {
    fsSolar.addEventListener('click', () => {
      const viewport = $('sceneViewport');
      if (viewport && viewport.requestFullscreen) {
        viewport.requestFullscreen().catch(() => {});
      }
      if ($('viewMode')) {
        $('viewMode').value = 'solar';
      }
      if (typeof setView === 'function') setView();
      if (typeof frameSolarSystem === 'function') frameSolarSystem();
    });
  }

  const fsPlanet = $('fullscreen-planet');
  if (fsPlanet) {
    fsPlanet.addEventListener('click', () => {
      const viewport = $('sceneViewport');
      if (viewport && viewport.requestFullscreen) {
        viewport.requestFullscreen().catch(() => {});
      }
      const bodySelect = $('planetFocus');
      const body = bodySelect ? bodySelect.value : 'earth';
      if (typeof focusSolarBody === 'function') {
        focusSolarBody(body);
      }
    });
  }

  const zoomSelect = $('planet-zoom-select');
  if (zoomSelect) {
    zoomSelect.addEventListener('change', () => {
      const val = zoomSelect.value;
      if ($('planetFocus')) $('planetFocus').value = val;
      if (typeof focusSolarBody === 'function') focusSolarBody(val);
    });
  }

  const zoomIn = $('zoom-in');
  if (zoomIn) {
    zoomIn.addEventListener('click', () => {
      if (!controls || !camera) return;
      const dir = camera.position.clone().sub(controls.target);
      const dist = dir.length();
      const newDist = Math.max(0.000001, dist * 0.8);
      dir.normalize().multiplyScalar(newDist);
      camera.position.copy(controls.target).add(dir);
      controls.update();
    });
  }

  const zoomOut = $('zoom-out');
  if (zoomOut) {
    zoomOut.addEventListener('click', () => {
      if (!controls || !camera) return;
      const dir = camera.position.clone().sub(controls.target);
      const dist = dir.length();
      const newDist = Math.min(450000, dist * 1.2);
      dir.normalize().multiplyScalar(newDist);
      camera.position.copy(controls.target).add(dir);
      controls.update();
    });
  }

  const zoomReset = $('zoom-reset');
  if (zoomReset) {
    zoomReset.addEventListener('click', () => {
      const zoomSelect = $('planet-zoom-select');
      const val = zoomSelect ? zoomSelect.value : ($('planetFocus') ? $('planetFocus').value : 'earth');
      if (typeof focusSolarBody === 'function') {
        focusSolarBody(val);
      }
    });
  }

  // Numeric zoom: type an exact camera distance to the current target (PC + touch).
  const applyTypedZoom = () => {
    if (!controls || !camera) return;
    const input = $('zoom-input');
    if (!input) return;
    let d = Number(input.value);
    if (!Number.isFinite(d) || d <= 0) return;
    d = Math.min(650000, Math.max(0.000001, d));
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-12) dir.set(0, 0, 1);
    dir.normalize().multiplyScalar(d);
    camera.position.copy(controls.target).add(dir);
    controls.update();
    if ($('pickFeedback')) $('pickFeedback').textContent = 'Camera distance set to ' + d.toLocaleString('en-GB') + ' scene units from target.';
  };
  const zoomGo = $('zoom-go');
  if (zoomGo) zoomGo.addEventListener('click', applyTypedZoom);
  const zoomInput = $('zoom-input');
  if (zoomInput) zoomInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyTypedZoom(); } });
}

wireFullscreenAndZoom();
// Register the service worker so the app installs on Android (PWA) and its
// shell stays available offline. Registration failures are non-fatal.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}


