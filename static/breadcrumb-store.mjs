// Breadcrumb store stub – replaced by nav/UI owner if needed.
const KEY='llp.nav.breadcrumb';
const MAX=8;
let items=[];
try{const raw=(typeof localStorage!=='undefined')?localStorage.getItem(KEY):null;if(raw)items=JSON.parse(raw);}catch(e){}
function get(){return items.slice();}
function push(label){items.push(String(label));if(items.length>MAX)items=items.slice(-MAX);persist();return get();}
function pop(){const v=items.pop()||null;persist();return v;}
function clear(){items=[];persist();}
function persist(){try{if(typeof localStorage!=='undefined')localStorage.setItem(KEY,JSON.stringify(items));}catch(e){}}
const BreadcrumbStore={get,push,pop,clear};
if(typeof window!=='undefined'){window.LLP=window.LLP||{};window.LLP.BreadcrumbStore=BreadcrumbStore;}
export {get,push,pop,clear};
export default BreadcrumbStore;
