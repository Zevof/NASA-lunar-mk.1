// Navigation mathematics, camera UX, search, breadcrumbs, and state management.
// Moon-fixed axes: +X at lat=0 lon=0, +Y at lat=0 lon=90E, +Z north pole.
export const MOON_R_KM = 1737.4;
export const MOON_MU = 4902.800118; // km^3/s^2, JPL DE440
export const RAD = Math.PI / 180;
export const dot = (a,b) => a.reduce((t,x,i)=>t+x*b[i],0);
export const add = (a,b) => a.map((x,i)=>x+b[i]);
export const sub = (a,b) => a.map((x,i)=>x-b[i]);
export const mul = (a,s) => a.map(x=>x*s);
export const mag = a => Math.hypot(...a);
export const unit = a => { const l=mag(a); if(!(l>0))throw Error('Zero-length direction');return mul(a,1/l);};
export const normal = (lat,lon) => [Math.cos(lat*RAD)*Math.cos(lon*RAD), Math.cos(lat*RAD)*Math.sin(lon*RAD), Math.sin(lat*RAD)];
export const clamp = (n,lo,hi)=>Math.min(hi,Math.max(lo,n));
export function tangentFrame(lat,lon){
  const a=lat*RAD,b=lon*RAD;
  return {up:normal(lat,lon),east:[-Math.sin(b),Math.cos(b),0],north:[-Math.sin(a)*Math.cos(b),-Math.sin(a)*Math.sin(b),Math.cos(a)]};
}
export function directionFromAzEl(lat,lon,az,el){
  const {up,east,north}=tangentFrame(lat,lon),a=az*RAD,e=el*RAD;
  return unit(add(mul(up,Math.sin(e)),add(mul(north,Math.cos(e)*Math.cos(a)),mul(east,Math.cos(e)*Math.sin(a)))));
}
export function azElToTarget(lat,lon,p){
  const {up,east,north}=tangentFrame(lat,lon), from=mul(up,MOON_R_KM),d=unit(sub(p,from));
  return {az:(Math.atan2(dot(d,east),dot(d,north))/RAD+360)%360,el:Math.asin(clamp(dot(d,up),-1,1))/RAD};
}
function solve3(matrix,rhs){
  const a=matrix.map((r,i)=>[...r,rhs[i]]);
  for(let c=0;c<3;c++){
    let k=c;for(let r=c+1;r<3;r++)if(Math.abs(a[r][c])>Math.abs(a[k][c]))k=r;
    if(Math.abs(a[k][c])<1e-7)throw Error('Bearings are parallel or nearly parallel; use wider station separation.');
    [a[k],a[c]]=[a[c],a[k]];
    for(let r=c+1;r<3;r++){const scale=a[r][c]/a[c][c];for(let j=c;j<4;j++)a[r][j]-=scale*a[c][j];}
  }
  const x=[0,0,0];
  for(let r=2;r>=0;r--){let s=a[r][3];for(let j=r+1;j<3;j++)s-=a[r][j]*x[j];x[r]=s/a[r][r];}
  return x;
}
export function triangulate(bearings){
  if(bearings.length<2)throw Error('At least two stations with independent bearings are required.');
  const M=[[0,0,0],[0,0,0],[0,0,0]],v=[0,0,0],rays=[];
  for(const b of bearings){
    if([b.lat,b.lon,b.az,b.el].some(x=>!Number.isFinite(x)))throw Error('Each station needs numerical lat, lon, azimuth and elevation.');
    if(Math.abs(b.lat)>90||Math.abs(b.lon)>180||b.el>90||b.el< -90)throw Error('Station coordinates or elevation outside valid ranges.');
    const p=mul(normal(b.lat,b.lon),MOON_R_KM),d=directionFromAzEl(b.lat,b.lon,b.az,b.el);
    rays.push({p,d});
    for(let i=0;i<3;i++)for(let j=0;j<3;j++){
      const a=(i===j?1:0)-d[i]*d[j];M[i][j]+=a;v[i]+=a*p[j];
    }
  }
  const p=solve3(M,v),radius=mag(p);
  const residuals=rays.map(({p:origin,d})=>{
    const delta=sub(p,origin),t=dot(delta,d);return {crossTrackKm:mag(sub(delta,mul(d,t))),forwardKm:t};
  });
  const lat=Math.asin(clamp(p[2]/radius,-1,1))/RAD,lon=Math.atan2(p[1],p[0])/RAD;
  const rmsKm=Math.sqrt(residuals.reduce((s,r)=>s+r.crossTrackKm**2,0)/rays.length);
  return {positionKm:p,lat,lon,altKm:radius-MOON_R_KM,rmsKm,residuals,rays};
}
export function hohmannTransfer(startAltKm,endAltKm,inclinationDeg=0,nodeDeg=0,phaseDeg=0,n=160){
  const r1=MOON_R_KM+startAltKm,r2=MOON_R_KM+endAltKm;
  if(!Number.isFinite(r1)||!Number.isFinite(r2)||r1<MOON_R_KM+20||r2<MOON_R_KM+20||r1>MOON_R_KM+50000||r2>MOON_R_KM+50000)
    throw Error('Enter circular orbit altitudes between 20 and 50,000 km.');
  if(Math.abs(inclinationDeg)>180||!Number.isFinite(inclinationDeg)||!Number.isFinite(nodeDeg))throw Error('Invalid orbit plane angle.');
  if(Math.abs(r1-r2)<.01)throw Error('Start and destination circular orbit altitudes must differ.');
  const a=(r1+r2)/2,e=Math.abs(r2-r1)/(r1+r2),tSeconds=Math.PI*Math.sqrt(a**3/MOON_MU);
  const v1=Math.sqrt(MOON_MU/r1),v2=Math.sqrt(MOON_MU/r2);
  const vt1=Math.sqrt(MOON_MU*(2/r1-1/a)),vt2=Math.sqrt(MOON_MU*(2/r2-1/a));
  const dv1=Math.abs(vt1-v1),dv2=Math.abs(v2-vt2);
  const f0=r1<=r2?0:Math.PI;
  const inc=inclinationDeg*RAD,node=nodeDeg*RAD,phase=phaseDeg*RAD;
  const samples=[];
  for(let k=0;k<=n;k++){
    const f=f0+Math.PI*k/n;
    const r=a*(1-e*e)/(1+e*Math.cos(f));
    const theta=f-f0+phase;
    const x=r*Math.cos(theta),y=r*Math.sin(theta)*Math.cos(inc),z=r*Math.sin(theta)*Math.sin(inc);
    const p=[x*Math.cos(node)-y*Math.sin(node),x*Math.sin(node)+y*Math.cos(node),z];
    let E=2*Math.atan2(Math.sqrt(1-e)*Math.sin(f/2),Math.sqrt(1+e)*Math.cos(f/2));
    if(E<0)E+=2*Math.PI;
    const M=E-e*Math.sin(E),M0=f0===0?0:Math.PI;
    const timeSeconds=clamp((M-M0)/(Math.PI)*tSeconds,0,tSeconds);
    samples.push({posKm:p,seconds:timeSeconds});
  }
  return {aKm:a,e,dv1KmS:dv1,dv2KmS:dv2,totalDvKmS:dv1+dv2,transferSeconds:tSeconds,samples,inclinationDeg,nodeDeg,phaseDeg};
}
export function clearLineToBody(pointKm,bodyDirection,bodyRangeKm=384400){
  const destination=mul(unit(bodyDirection),bodyRangeKm),d=sub(destination,pointKm);
  const t=clamp(-dot(pointKm,d)/dot(d,d),0,1),near=add(pointKm,mul(d,t));
  return mag(near)>=MOON_R_KM-1e-7;
}
export function rateTransfer(route,earthDirection,sunDirection,earthRangeKm=384400){
  if(!earthDirection||!sunDirection)return {earthFraction:null,sunFraction:null,poweredFraction:null};
  let earth=0,sun=0,both=0;
  for(const p of route.samples){
    const e=clearLineToBody(p.posKm,earthDirection,earthRangeKm);
    const s=clearLineToBody(p.posKm,sunDirection,1.496e8);
    earth+=+e;sun+=+s;both+=+(e&&s);
  }
  return {earthFraction:earth/route.samples.length,sunFraction:sun/route.samples.length,poweredFraction:both/route.samples.length};
}
export function candidateTransfers(startAltKm,endAltKm,inclinationDeg,nodeDeg,phaseDeg,earthDir=null,sunDir=null,earthRangeKm=384400){
  const offsets=[0,90,180];
  return offsets.map((offset,index)=>{
    const route=hohmannTransfer(startAltKm,endAltKm,inclinationDeg,nodeDeg+offset,phaseDeg);
    return {id:index+1,label:['Selected node','Node +90°','Node +180°'][index],...route,...rateTransfer(route,earthDir,sunDir,earthRangeKm)};
  }).sort((a,b)=>((b.earthFraction??-1)-(a.earthFraction??-1))||((b.sunFraction??-1)-(a.sunFraction??-1))||a.id-b.id);
}

// --- NEW NAVIGATION & CAMERA UX API ---

export const PLANETS = [
  { id: 'sun', name: 'Sun', radiusKm: 696340 },
  { id: 'mercury', name: 'Mercury', radiusKm: 2439.7 },
  { id: 'venus', name: 'Venus', radiusKm: 6051.8 },
  { id: 'earth', name: 'Earth', radiusKm: 6371.0 },
  { id: 'moon', name: 'Moon', radiusKm: MOON_R_KM },
  { id: 'mars', name: 'Mars', radiusKm: 3389.5 },
  { id: 'jupiter', name: 'Jupiter', radiusKm: 69911 },
  { id: 'saturn', name: 'Saturn', radiusKm: 58232 },
  { id: 'uranus', name: 'Uranus', radiusKm: 25362 },
  { id: 'neptune', name: 'Neptune', radiusKm: 24622 }
];

export const ALIASES = {
  'sol': 'sun',
  'sun': 'sun',
  'mercury': 'mercury',
  'venus': 'venus',
  'earth': 'earth',
  'tierra': 'earth',
  'terra': 'earth',
  'moon': 'moon',
  'luna': 'moon',
  'lune': 'moon',
  'mars': 'mars',
  'red planet': 'mars',
  'jupiter': 'jupiter',
  'saturn': 'saturn',
  'uranus': 'uranus',
  'neptune': 'neptune',
  'pluto': 'pluto',
  'ksc': 'kennedy',
  'kennedy': 'kennedy',
  'es': 'earth'
};

function levenshtein(a, b) {
  const an = a.length, bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({length: bn + 1}, (_, i) => Array(an + 1).fill(0));
  for (let i = 0; i <= bn; i++) matrix[i][0] = i;
  for (let j = 0; j <= an; j++) matrix[0][j] = j;
  for (let i = 1; i <= bn; i++) {
    for (let j = 1; j <= an; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[bn][an];
}

export function searchBodies(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const resolvedAliasTarget = ALIASES[q];

  const prefixes = [];
  const substrings = [];
  const aliases = [];
  const fuzzies = [];

  for (const p of PLANETS) {
    const nameL = p.name.toLowerCase();
    const idL = p.id.toLowerCase();
    if (resolvedAliasTarget === idL) {
      aliases.push(p);
      continue;
    }
    if (nameL.startsWith(q) || idL.startsWith(q)) {
      prefixes.push(p);
    } else if (nameL.includes(q) || idL.includes(q)) {
      substrings.push(p);
    } else if (q.length <= nameL.length && nameL.length - q.length <= 2) {
      // Tightened fuzzy match: the query must be a near-prefix of the name
      // (up to 1 edit) and must not be longer than the name. This rejects
      // invalid tails like 'marsx' while still accepting 'mercur', 'jupitr',
      // 'satun', etc.
      const subName = nameL.slice(0, q.length);
      if (levenshtein(subName, q) <= 1) {
        fuzzies.push(p);
      }
    }
  }

  const combined = [...prefixes, ...substrings, ...aliases, ...fuzzies];
  const seen = new Set();
  const results = [];
  for (const item of combined) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      results.push(item);
    }
  }
  return results;
}

export async function goTo(id) {
  try {
    const r = globalThis.LLP?.Renderer || (typeof window !== 'undefined' ? window.LLP?.Renderer : null);
    if (r && typeof r.focusBody === 'function') {
      await r.focusBody(id);
    }
    const found = PLANETS.find(p => p.id === id);
    if (found) {
      pushBreadcrumb(found.name);
    }
  } catch (err) {
    console.error('goTo error:', err);
  }
}

export function getBreadcrumb() {
  try {
    const ls = globalThis.localStorage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (!ls) return [];
    const val = ls.getItem('llp.nav.breadcrumb');
    if (!val) return [];
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function pushBreadcrumb(label) {
  if (!label) return;
  const list = getBreadcrumb();
  list.push(label);
  if (list.length > 8) list.shift();
  try {
    const ls = globalThis.localStorage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (ls) ls.setItem('llp.nav.breadcrumb', JSON.stringify(list));
  } catch {}
}

export function popBreadcrumb() {
  const list = getBreadcrumb();
  if (list.length === 0) return null;
  const popped = list.pop();
  try {
    const ls = globalThis.localStorage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (ls) ls.setItem('llp.nav.breadcrumb', JSON.stringify(list));
  } catch {}
  return popped;
}

export function saveState() {
  const r = globalThis.LLP?.Renderer || (typeof window !== 'undefined' ? window.LLP?.Renderer : null);
  const state = {
    bodyId: r?.currentBodyId || null,
    camDistance: r?.controls?.distance || 1000,
    camTarget: r?.controls?.target ? [r.controls.target.x, r.controls.target.y, r.controls.target.z] : [0, 0, 0],
    paused: !!navState.paused,
    mode: r?.mode || 'system'
  };
  const json = JSON.stringify(state);
  try {
    const ls = globalThis.localStorage || (typeof window !== 'undefined' ? window.localStorage : null);
    if (ls) ls.setItem('llp.nav.state', json);
  } catch {}
  return json;
}

export function restoreState(s) {
  try {
    const obj = typeof s === 'string' ? JSON.parse(s) : s;
    if (!obj) return;
    navState.paused = !!obj.paused;
    const r = globalThis.LLP?.Renderer || (typeof window !== 'undefined' ? window.LLP?.Renderer : null);
    if (r) {
      if (obj.bodyId && typeof r.focusBody === 'function') {
        r.focusBody(obj.bodyId);
      }
      if (r.controls) {
        if (typeof obj.camDistance === 'number') r.controls.distance = obj.camDistance;
        if (Array.isArray(obj.camTarget) && r.controls.target) {
          r.controls.target.set(obj.camTarget[0], obj.camTarget[1], obj.camTarget[2]);
        }
      }
    }
  } catch (err) {
    console.error('restoreState error:', err);
  }
}

export const navState = {
  paused: false
};

export function handleKey(e) {
  if (!e) return;
  const target = e.target;
  if (target) {
    const tagName = target.tagName;
    if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable) {
      return;
    }
  }

  const r = globalThis.LLP?.Renderer || (typeof window !== 'undefined' ? window.LLP?.Renderer : null);
  const key = e.key;

  if (key === 'f' || key === 'F') {
    if (r && typeof r.fitCurrentBody === 'function') r.fitCurrentBody();
  } else if (key === 'o' || key === 'O') {
    if (r && typeof r.setMode === 'function') r.setMode('orbit');
  } else if (key === 'g' || key === 'G') {
    if (r && typeof r.toggleGrid === 'function') r.toggleGrid();
  } else if (key === 'l' || key === 'L') {
    if (r && typeof r.toggleLabels === 'function') r.toggleLabels();
  } else if (key === ' ') {
    e.preventDefault();
    navState.paused = !navState.paused;
    if (r) r.paused = navState.paused;
  } else if (key === '/') {
    e.preventDefault();
    const searchInput = document.getElementById('llp-search');
    if (searchInput) searchInput.focus();
  } else if (key === 'Escape') {
    if (r && typeof r.deselect === 'function') r.deselect();
  } else if (key >= '1' && key <= '9') {
    const idx = parseInt(key, 10) - 1;
    if (PLANETS[idx]) {
      goTo(PLANETS[idx].id);
    }
  } else if (key === '0') {
    if (PLANETS[9]) {
      goTo(PLANETS[9].id);
    }
  } else if (key === 'Enter') {
    const searchInput = document.getElementById('llp-search');
    if (document.activeElement === searchInput && searchInput.value) {
      const res = searchBodies(searchInput.value);
      if (res.length > 0) goTo(res[0].id);
    }
  } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
    if (r && typeof r.pan === 'function') {
      const step = 50;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? step : key === 'ArrowDown' ? -step : 0;
      r.pan(dx, dy);
    }
  } else if (key === '+' || key === '=') {
    if (r && r.controls && typeof r.controls.zoom === 'function') r.controls.zoom(0.9);
  } else if (key === '-' || key === '_') {
    if (r && r.controls && typeof r.controls.zoom === 'function') r.controls.zoom(1.1);
  }
}

export function clickToFocus(event) {
  if (!event) return;
  const r = globalThis.LLP?.Renderer || (typeof window !== 'undefined' ? window.LLP?.Renderer : null);
  if (!r) return;
  if (event.type === 'dblclick') {
    if (typeof r.raycastBody === 'function') {
      const bodyId = r.raycastBody(event);
      if (bodyId) goTo(bodyId);
    }
  } else if (event.type === 'click') {
    if (typeof r.raycastBody === 'function') {
      const bodyId = r.raycastBody(event);
      if (bodyId) goTo(bodyId);
    }
  }
}

let searchDebounceTimer = null;

export function init() {
  if (typeof window === 'undefined') return;

  window.addEventListener('keydown', handleKey);

  const canvas = document.getElementById('moonCanvas') || document.querySelector('canvas');
  if (canvas) {
    canvas.addEventListener('click', clickToFocus);
    canvas.addEventListener('dblclick', clickToFocus);

    canvas.addEventListener('wheel', (e) => {
      const r = window.LLP?.Renderer;
      if (r && r.currentBodyId != null && r.controls && typeof r.controls.distance === 'number') {
        const body = PLANETS.find(p => p.id === r.currentBodyId);
        const radius = body ? body.radiusKm : 1737.4;
        if (r.controls.distance < 5 * radius) {
          // Adaptive zoom multiplier
        }
      }
    }, {passive: true});

    let touchStartDist = null;
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        touchStartDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, {passive: true});

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && touchStartDist != null) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const factor = touchStartDist / dist;
        const r = window.LLP?.Renderer;
        if (r && r.controls && typeof r.controls.zoom === 'function') {
          r.controls.zoom(factor);
        }
        touchStartDist = dist;
      }
    }, {passive: true});
  }

  const searchInput = document.getElementById('llp-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        const q = e.target.value;
        const results = searchBodies(q);
        const dropdown = document.getElementById('llp-search-results');
        if (dropdown) {
          dropdown.innerHTML = results.map(p => `<div data-id="${p.id}">${p.name}</div>`).join('');
        }
      }, 150);
    });
  }
}

// Attach to window.LLP.Nav
if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.Nav = {
    init,
    handleKey,
    clickToFocus,
    searchBodies,
    goTo,
    getBreadcrumb,
    pushBreadcrumb,
    popBreadcrumb,
    saveState,
    restoreState,
    ALIASES,
    PLANETS,
    MOON_R_KM,
    RAD,
    normal,
    tangentFrame,
    dot,
    mag,
    sub,
    add,
    mul,
    unit,
    clamp
  };
}
