// Scene tween stub – replaced by animation helper owner.
const EASINGS={
  linear:t=>t,
  easeInOutCubic:t=>t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,
  easeOutQuad:t=>1-(1-t)*(1-t),
  easeInOutQuad:t=>t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2
};
function tween({duration=800, easing='easeInOutCubic', onUpdate, onComplete}={}){
  const start=performance.now();const ease=EASINGS[easing]||EASINGS.easeInOutCubic;
  let cancelled=false;
  function frame(now){if(cancelled)return;const t=Math.min(1,(now-start)/duration);onUpdate&&onUpdate(ease(t));if(t<1)requestAnimationFrame(frame);else onComplete&&onComplete();}
  requestAnimationFrame(frame);
  return {cancel(){cancelled=true;}};
}
function tweenCamera(camera, startPos, endPos, startTarget, endTarget, durationMs, onComplete) {
  if (!camera || typeof camera.position === 'undefined') return null;

  // Helper to interpolate Vector3-like objects (x,y,z)
  const lerpV = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

  const handle = tween({
    duration: durationMs || 800,
    easing: 'easeInOutCubic',
    onUpdate: (t) => {
      const p = lerpV(startPos, endPos, t);
      const tgt = lerpV(startTarget, endTarget, t);

      // Apply to camera position
      if (camera.position && typeof camera.position.set === 'function') {
        camera.position.set(p.x, p.y, p.z);
      } else {
        camera.position = p;
      }

      // Apply lookAt target
      if (typeof camera.lookAt === 'function') {
        camera.lookAt(tgt.x, tgt.y, tgt.z);
      } else if (camera.target) {
        camera.target = tgt;
      }
    },
    onComplete: () => {
      if (onComplete) onComplete();
    }
  });
  return handle;
}

const SceneTween={tween,tweenCamera,EASINGS};
if(typeof window!=='undefined'){window.LLP=window.LLP||{};window.LLP.SceneTween=SceneTween;}
export {tween,tweenCamera,EASINGS};
export default SceneTween;
