// Layers system stub – replaced by Layers lead.
const LAYER_DEFS=[
  {id:'terrain',name:'Surface Elevation (DEM)',defaultOn:true,group:'Surface'},
  {id:'craters',name:'Impact Craters',defaultOn:false,group:'Surface'},
  {id:'mountains',name:'Mountain Highlights',defaultOn:false,group:'Surface'},
  {id:'atmosphere',name:'Atmospheric Halo',defaultOn:true,group:'Atmosphere'},
  {id:'clouds',name:'Cloud Cover',defaultOn:false,group:'Atmosphere'},
  {id:'orbits',name:'Orbital Trajectories',defaultOn:true,group:'Orbits'},
  {id:'labels',name:'Object Labels',defaultOn:true,group:'Overlay'},
  {id:'grid',name:'Reference Grid',defaultOn:false,group:'Overlay'},
  {id:'rings',name:'Ring Systems',defaultOn:true,group:'Surface'}
];
const KEY='llp.layers.state';
const state={};
for(const d of LAYER_DEFS) state[d.id]=d.defaultOn;
try{const raw=globalThis.localStorage?.getItem(KEY);if(raw)Object.assign(state,JSON.parse(raw));}catch(e){}
const listeners=[];
function isOn(id){return !!state[id];}
function toggle(id,on){state[id]=(on===undefined)?!state[id]:!!on;listeners.forEach(fn=>{try{fn(id,state[id]);}catch(e){}});}
function setMany(obj){for(const k in obj)toggle(k,obj[k]);}
function getState(){return {...state};}
function saveState(){try{globalThis.localStorage?.setItem(KEY,JSON.stringify(state));}catch(e){}}
function loadState(){try{const raw=globalThis.localStorage?.getItem(KEY);if(raw)Object.assign(state,JSON.parse(raw));}catch(e){}}
function bindUI(){if(typeof document==='undefined')return;document.querySelectorAll('.llp-toggle[data-layer]').forEach(btn=>{const id=btn.dataset.layer;btn.setAttribute('aria-pressed',String(isOn(id)));btn.classList.toggle('active',isOn(id));btn.addEventListener('click',()=>{toggle(id);btn.setAttribute('aria-pressed',String(isOn(id)));btn.classList.toggle('active',isOn(id));saveState();});});}
function onChange(cb){listeners.push(cb);}
const Layers={LAYER_DEFS,isOn,toggle,setMany,getState,saveState,loadState,bindUI,onChange};
if(typeof window!=='undefined'){window.LLP=window.LLP||{};window.LLP.Layers=Layers;}
export {LAYER_DEFS,isOn,toggle,setMany,getState,saveState,loadState,bindUI,onChange};
export default Layers;
