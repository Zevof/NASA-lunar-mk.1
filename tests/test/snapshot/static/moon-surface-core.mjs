// Research-only lunar surface routing over NASA LOLA height samples.
// A* on a local equirectangular tangent grid (NOT an obstacle-level rover navigator).
//
// There is NO distance cap: routes may be arbitrarily long. Long legs are split
// into great-circle sub-segments (so the local tangent plane stays valid, even
// at the poles), the search is kept finite by a wall-clock budget (default 15 s)
// and by adaptively coarsening each segment grid.
import {sampleHeightKm} from './terrain-core.mjs';
import {MOON_R_KM,RAD,clamp} from './nav-core.mjs';
const PI=Math.PI;
const nowMs=()=>(typeof performance!=='undefined'&&performance&&typeof performance.now==='function')?performance.now():Date.now();
export function wrapLongitude(deg){return ((deg+180)%360+360)%360-180;}
export function shortestLongitudeDelta(from,to){return wrapLongitude(to-from);}
export function greatCircleKm(a,b){
 const x=a.lat*RAD,y=b.lat*RAD,dl=shortestLongitudeDelta(a.lon,b.lon)*RAD;
 return 2*MOON_R_KM*Math.asin(clamp(Math.sqrt(Math.sin((y-x)/2)**2+Math.cos(x)*Math.cos(y)*Math.sin(dl/2)**2),0,1));
}
export function interpolateSurface(a,b,t){
 const phi1=a.lat*RAD,phi2=b.lat*RAD,dl=shortestLongitudeDelta(a.lon,b.lon)*RAD;
 const u=[Math.cos(phi1),0,Math.sin(phi1)],v=[Math.cos(phi2)*Math.cos(dl),Math.cos(phi2)*Math.sin(dl),Math.sin(phi2)];
 const angle=Math.acos(clamp(u.reduce((s,x,i)=>s+x*v[i],0),-1,1));
 // Degenerate cases: identical points (angle~0) and exact antipodes (angle~pi,
 // where sin(angle)=0 makes the slerp divide by zero). In both, linear lat/lon
 // interpolation along the prime great circle is the correct, well-defined limit.
 if(angle<1e-8||Math.abs(Math.PI-angle)<1e-8)return {lat:a.lat+(b.lat-a.lat)*t,lon:wrapLongitude(a.lon+shortestLongitudeDelta(a.lon,b.lon)*t)};
 const p=Math.sin((1-t)*angle)/Math.sin(angle),q=Math.sin(t*angle)/Math.sin(angle);
 const w=u.map((x,i)=>x*p+v[i]*q);
 return {lat:Math.atan2(w[2],Math.hypot(w[0],w[1]))/RAD,lon:wrapLongitude(a.lon+Math.atan2(w[1],w[0])/RAD)};
}
class Heap{
 constructor(){this.items=[];}
 push(cost,node){let a=this.items,i=a.length;a.push({cost,node});while(i>0){let p=(i-1)>>1;if(a[p].cost<=cost)break;a[i]=a[p];i=p;}a[i]={cost,node};}
 pop(){let a=this.items;if(!a.length)return null;let head=a[0],last=a.pop();if(a.length){let i=0;while(true){const l=i*2+1,r=l+1;if(l>=a.length)break;let k=r<a.length&&a[r].cost<a[l].cost?r:l;if(a[k].cost>=last.cost)break;a[i]=a[k];i=k;}a[i]=last;}return head;}
 get size(){return this.items.length;}
}
function terrainHeight(terrain,lat,lon){
 // `sampleHeightKm` reads dem.data/dem.width; tolerate lightweight stubs that
 // only provide a sample() function (used by unit tests / headless planners).
 if(terrain&&typeof terrain.sample==='function'){
  const v=terrain.sample(lat,lon);
  return Number.isFinite(v)?v:0;
 }
 if(terrain&&terrain.data&&terrain.width)return sampleHeightKm(terrain,lat,lon);
 return 0;
}
function details(points,terrain,speed,method,resolutionKm,extra){
 let distanceKm=0,ascentKm=0,descentKm=0,maxSlopeDeg=0;
 for(let i=1;i<points.length;i++){
  const horiz=greatCircleKm(points[i-1],points[i]);
  const dz=terrainHeight(terrain,points[i].lat,points[i].lon)-terrainHeight(terrain,points[i-1].lat,points[i-1].lon);
  distanceKm+=Math.hypot(horiz,dz);if(dz>0)ascentKm+=dz;else descentKm-=dz;
  maxSlopeDeg=Math.max(maxSlopeDeg,Math.atan2(Math.abs(dz),Math.max(.001,horiz))/RAD);
 }
 return Object.assign({points,distanceKm,ascentKm,descentKm,maxSlopeDeg,
  timeHours:distanceKm/Math.max(.001,speed),method,resolutionKm},extra||{});
}
function directRoute(terrain,a,b,speed,step,extra){
 const count=Math.max(2,Math.min(1200,Math.ceil(greatCircleKm(a,b)/Math.max(.25,step))));
 const points=Array.from({length:count+1},(_,i)=>interpolateSurface(a,b,i/count));
 return details(points,terrain,speed,'great-circle reference',step,extra);
}
// True when a straight surface line a->b stays below maxSlope everywhere. This is
// the line-of-sight test used to smooth away redundant A* waypoints.
function lineOfSight(terrain,a,b,maxSlope,samples=48){
 if(!terrain)return true;
 const chord=terrainHeight(terrain,a.lat,a.lon),rise=terrainHeight(terrain,b.lat,b.lon);
 for(let j=1;j<samples;j++){
  const t=j/samples,p=interpolateSurface(a,b,t);
  const horiz=greatCircleKm(a,p);
  const ground=terrainHeight(terrain,p.lat,p.lon);
  const chordZ=chord+(rise-chord)*t;
  const grade=Math.abs(ground-chordZ)/Math.max(.001,horiz);
  if(grade>Math.tan(maxSlope*RAD))return false;
 }
 return true;
}
// Douglas-Peucker style smoothing: keep endpoints, drop any interior point that
// is (a) collinear with its neighbours and (b) has clear line-of-sight across.
function smoothPoints(points,terrain,maxSlope,step){
 if(points.length<3)return {points,smoothed:false};
 // A waypoint is redundant when the detour through it versus a straight chord to
 // the next survivor is within `slack` AND the chord has clear line-of-sight.
 const slack=Math.max(step*0.25,0.25);
 const keep=new Uint8Array(points.length);keep[0]=1;keep[points.length-1]=1;
 let lastKept=0,removed=0;
 for(let i=1;i<points.length-1;i++){
  let j=i+1;
  while(j<points.length-1&&!keep[j])j++;
  if(j>=points.length)break;
  const a=points[lastKept],m=points[i],b=points[j];
  const chord=greatCircleKm(a,b);
  const detour=greatCircleKm(a,m)+greatCircleKm(m,b);
  if(detour-chord<slack&&lineOfSight(terrain,a,b,maxSlope)){keep[i]=0;removed++;}
  else lastKept=i;
 }
 if(!removed)return {points,smoothed:false};
 const out=[];for(let i=0;i<points.length;i++)if(keep[i])out.push(points[i]);
 return {points:out,smoothed:true};
}
// Slope cost: gentle grades are nearly free, steep grades near the limit are
// punished hard (quadratic + cubic knee), so routes prefer rolling terrain over
// hugging the slope ceiling.
function slopePenalty(strategy,grade){
 const base=strategy==='shortest'?1.4:9;
 const knee=Math.min(1,grade/0.6);
 return base*grade*grade+6*grade*grade*grade*knee;
}
// Split one leg into great-circle sub-segments no longer than maxSegKm so the
// local equirectangular tangent plane used by A* stays valid even across the
// poles and on near-antipodal legs.
function subdivide(a,b,dist,maxSegKm){
 const n=Math.max(1,Math.ceil(dist/maxSegKm));
 const out=[];
 for(let i=0;i<n;i++)out.push([interpolateSurface(a,b,i/n),interpolateSurface(a,b,(i+1)/n)]);
 return out;
}
// Plan one short sub-segment (a->b) on a local tangent grid via A*.
function astarSegment(terrain,a,b,dist,strategy,maxSlope,step,minX,maxX,minY,maxY,width,height,cosLat,ctx){
 const {timeBudgetMs,maxGridNodes}=ctx;
 const nx=Math.ceil((maxX-minX)/step)+1,ny=Math.ceil((maxY-minY)/step)+1,nodes=nx*ny;
 const xyToLatLon=(x,y)=>({lat:clamp(a.lat+y/(MOON_R_KM*RAD),-90,90),lon:wrapLongitude(a.lon+x/(MOON_R_KM*RAD*cosLat))});
 const toNode=(x,y)=>{const ix=clamp(Math.round((x-minX)/step),0,nx-1),iy=clamp(Math.round((y-minY)/step),0,ny-1);return iy*nx+ix;};
 const start=toNode(0,0),goal=toNode(width,height);
 const latlon=Array.from({length:nodes},(_,id)=>xyToLatLon(minX+(id%nx)*step,minY+Math.floor(id/nx)*step));
 const heights=Float64Array.from(latlon,p=>terrainHeight(terrain,p.lat,p.lon));
 const scores=new Float64Array(nodes);scores.fill(Infinity);scores[start]=0;
 const prev=new Int32Array(nodes);prev.fill(-1);
 const offset=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
 // Great-circle heuristic divided by the diagonal step stays admissible
 // (never overestimates) even on padded, non-square tangent grids.
 const heuristicScale=step*Math.SQRT2;
 const heuristicOf=id=>greatCircleKm(latlon[id],latlon[goal])/heuristicScale;
 const heap=new Heap();heap.push(heuristicOf(start),start);
 let expansions=0;
 while(heap.size){
  const item=heap.pop(),u=item.node,x=u%nx,y=Math.floor(u/nx);
  const lower=scores[u]+heuristicOf(u);
  if(item.cost>lower+1e-7)continue;
  if(u===goal)break;
  if(++expansions%256===0&&nowMs()>ctx.deadline){
   throw Error(`Route computation timed out after ${(timeBudgetMs/1000).toFixed(0)} s; add intermediate waypoints.`);
  }
  for(const [dx,dy] of offset){
   const xx=x+dx,yy=y+dy;if(xx<0||xx>=nx||yy<0||yy>=ny)continue;
   const v=yy*nx+xx,horizontal=step*Math.hypot(dx,dy),rise=heights[v]-heights[u];
   const angle=Math.atan2(Math.abs(rise),horizontal)/RAD;
   if(angle>maxSlope)continue;
   const grade=Math.abs(rise)/horizontal;
   const candidate=scores[u]+Math.hypot(horizontal,rise)*(1+slopePenalty(strategy,grade));
   if(candidate+1e-8<scores[v]){
    scores[v]=candidate;prev[v]=u;
    heap.push(candidate+heuristicOf(v),v);
   }
  }
 }
 if(!Number.isFinite(scores[goal]))return null;
 const ids=[];for(let u=goal;u!==-1;u=prev[u]){ids.push(u);if(ids.length>nodes+1)throw Error('Invalid route graph.');}ids.reverse();
 const points=[a,...ids.slice(1,-1).map(i=>latlon[i]),b];
 const smoothedResult=smoothPoints(points,terrain,maxSlope,step);
 return details(smoothedResult.points,terrain,ctx.speed,'slope-aware sampled A*',step,
  {smoothed:smoothedResult.smoothed,expansions});
}
// Input: waypoints [{lat,lon}] (Moon, east-positive longitude); choices: safest/shortest/direct.
export function planLunarSurfaceRoute(terrain,waypoints,options={}){
 if(!Array.isArray(waypoints)||waypoints.length<2||waypoints.length>50)throw Error('Choose 2 to 50 lunar waypoints.');
 for(const w of waypoints)if(!Number.isFinite(w.lat)||!Number.isFinite(w.lon)||Math.abs(w.lat)>90)throw Error('Waypoints need valid Moon latitude/longitude.');
 const strategy=options.strategy??'safest',maxSlope=Number(options.maxSlopeDeg??20),speed=Number(options.speedKmH??2);
 if(!(maxSlope>=1&&maxSlope<=85&&speed>.01&&speed<=100))throw Error('Enter a slope limit from 1–85° and speed from 0.01–100 km/h.');
 const timeBudgetMs=Math.max(0,Number(options.timeBudgetMs??15000)||0);
 const maxGridNodes=Math.max(4096,Number(options.maxGridNodes??400000)||400000);
 const warnings=[],legs=[];
 const resolutionKm=terrain&&terrain.width?2*PI*MOON_R_KM/terrain.width:8;
 if(!terrain)warnings.push('No NASA LOLA DEM loaded: the route is a spherical great-circle illustration without terrain avoidance.');
 else warnings.push(`Global elevation sampling ≈ ${resolutionKm.toFixed(1)} km per equatorial pixel; small rocks, craters and cliffs are not represented.`);
 const ctx={timeBudgetMs,maxGridNodes,speed,deadline:nowMs()+timeBudgetMs};
 // Long legs are split into sub-segments so the local tangent plane stays valid
 // (a single plane cannot represent a >~90° arc or a pole-crossing leg).
 const MAX_SEG_KM=1500;
 for(let leg=0;leg<waypoints.length-1;leg++){
  const a=waypoints[leg],b=waypoints[leg+1],dist=greatCircleKm(a,b);
  if(dist<.01){continue;}
  // No distance cap: long legs are handled by sub-segmenting, grid coarsening
  // and the wall-clock budget instead of an error.
  if(strategy==='direct'||!terrain){
   legs.push(directRoute(terrain,a,b,speed,Math.max(.3,resolutionKm/2)));continue;
  }
  const segs=subdivide(a,b,dist,MAX_SEG_KM);
  for(let s=0;s<segs.length;s++){
   const [sa,sb]=segs[s],sdist=greatCircleKm(sa,sb);
   if(sdist<.01)continue;
   // Tangent plane is anchored at the sub-segment start and oriented toward the
   // sub-segment end, so it is always a locally valid projection of the arc.
   const midLat=(sa.lat+sb.lat)/2,cosLat=Math.max(.15,Math.cos(midLat*RAD));
   const halfLon=shortestLongitudeDelta(sa.lon,sb.lon);
   const width=MOON_R_KM*halfLon*RAD*cosLat,height=MOON_R_KM*(sb.lat-sa.lat)*RAD;
   const pad=Math.max(10,sdist*.35);
   const midX=width/2,midY=height/2;
   const minX=midX-pad,maxX=midX+pad,minY=midY-pad,maxY=midY+pad;
   let step=Math.max(0.75,resolutionKm*.60,sdist/95);
   const gridCells=()=>((maxX-minX)/step+1)*((maxY-minY)/step+1);
   let coarsened=false;
   while(gridCells()>maxGridNodes){step*=1.7;coarsened=true;if(step>4000)break;}
   if(coarsened)warnings.push(`Leg ${leg+1} spans ${dist.toFixed(0)} km: the terrain grid was coarsened to ≈${step.toFixed(1)} km cells to stay within the compute budget. Insert intermediate waypoints for full-resolution terrain avoidance.`);
   let result=astarSegment(terrain,sa,sb,sdist,strategy,maxSlope,step,minX,maxX,minY,maxY,width,height,cosLat,ctx);
   if(!result){
    // Retry with a wider slope-tolerant pass is not allowed to exceed maxSlope;
    // instead report clearly which leg has no path.
    throw Error(`No path in leg ${leg+1} below ${maxSlope}° using sampled LOLA heights. Increase slope tolerance or add waypoints.`);
   }
   legs.push(result);
  }
 }
 if(!legs.length)throw Error('Waypoints are coincident.');
 const all=legs.flatMap((l,i)=>i?l.points.slice(1):l.points);
 const sum=k=>legs.reduce((n,l)=>n+l[k],0);
 return {legs,points:all,distanceKm:sum('distanceKm'),ascentKm:sum('ascentKm'),descentKm:sum('descentKm'),
  timeHours:sum('timeHours'),maxSlopeDeg:Math.max(...legs.map(x=>x.maxSlopeDeg)),
  smoothed:legs.some(l=>l.smoothed),expansions:legs.reduce((n,l)=>n+(l.expansions||0),0),
  resolutionKm,warnings,strategy,hasTerrain:!!terrain};
}
