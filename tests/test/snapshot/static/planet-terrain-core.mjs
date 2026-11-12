// @module planet-terrain-core
// Pure, DOM-free terrain math for scaled 3D planets (Lunar Link Planner v7).
// A height grid is a row-major Float32Array of METERS, north (-90 lat) first row,
// west (-180 lon) first column, equirectangular. u in [0,1] = longitude (wraps),
// v in [0,1] = latitude, 0 = north pole, 1 = south pole (clamped).
//
// MINI SELF-TEST (example calls, run standalone with node):
//   import {buildHeightGrid,sampleHeight,computeSlopeDeg,gridToNormalMap,
//           computeLocalRelief,computeHillshade,computeAspectRad,
//           sampleBilinear,TERRAIN_CONSTANTS} from './planet-terrain-core.mjs';
//   const raw=new Uint8Array([0,128,255, 64,192,10, 255,0,128]);       // 3x3, 8-bit
//   const g=buildHeightGrid(raw,{width:3,height:3,bitsPerSample:8,minElevationM:-100,maxElevationM:100});
//   sampleHeight(g,3,3,0,0);          // -> -100 (north-west corner pixel)
//   sampleHeight(g,3,3,0.5,0.5);      // -> ~50.6 (center pixel = raw192, pixel-center bilinear)
//   sampleHeight(g,3,3,1.5,0.25);     // wraps in u -> same as u=0.5
//   computeSlopeDeg([0,0,0, 0,0,0, 0,0,-3],1); // corner drop 3 -> ~35.26 deg
//   computeSlopeDeg([0,0,0, 0,0,0, 0,0,0],1);  // flat -> 0
//   gridToNormalMap(g,3,3,1);         // Uint8Array RGBA, flat = (128,128,255)
//   computeLocalRelief(g,3,3);        // {minM:-100,maxM:100,meanM,stdevM}
//   computeHillshade(g,3,3,1);        // Uint8Array RGBA grayscale (default 315/45)
//   computeAspectRad([0,0,0,0,0,0,0,0,-3],1); // downslope aspect in radians
//   TERRAIN_CONSTANTS.MAX_EXAGGERATION; // 8

/**
 * Shared terrain constants (frozen). METERS_PER_UNIT relates grid meters to
 * scene units; exaggeration scales vertical relief for visualization only.
 */
export const TERRAIN_CONSTANTS=Object.freeze({
  DEFAULT_EXAGGERATION:1.0,
  MAX_EXAGGERATION:8.0,
  METERS_PER_UNIT:1,
  HILLSHADE_AZIMUTH:315,
  HILLSHADE_ALTITUDE:45
});

const clamp01=(x)=>x<0?0:x>1?1:x;
const clamp=(x,lo,hi)=>x<lo?lo:x>hi?hi:x;

/**
 * Convert a raw DEM sample buffer into a height grid of meters.
 * @param {ArrayBuffer|TypedArray|number[]} raw - raw samples (row-major, single band).
 *   A TypedArray of a different width than the sample size is interpreted
 *   little-endian, matching the common DEM byte order.
 * @param {object} opts
 * @param {number} opts.width - grid width in samples (>0).
 * @param {number} opts.height - grid height in samples (>0).
 * @param {number} [opts.bitsPerSample=16] - 8, 16 (unsigned linear) or 32 (raw Float32).
 * @param {number} opts.minElevationM - elevation mapped from raw 0 (8/16-bit).
 * @param {number} opts.maxElevationM - elevation mapped from raw max (255/65535).
 * @returns {Float32Array} length width*height in meters; non-finite samples -> minElevationM.
 */
export function buildHeightGrid(raw,{width,height,bitsPerSample=16,minElevationM=0,maxElevationM=1}={}){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1){
    throw new Error('buildHeightGrid: width and height must be positive numbers');
  }
  const size=width*height;
  const out=new Float32Array(size);
  const finite=(x)=>Number.isFinite(x)?x:minElevationM;
  if(bitsPerSample===32||bitsPerSample==='float32'){
    const src=raw instanceof Float32Array?raw:raw instanceof ArrayBuffer?new Float32Array(raw):Float32Array.from(raw);
    for(let i=0;i<size;i++)out[i]=finite(src[i]);
    return out;
  }
  const scale=bitsPerSample===8?255:65535;
  const src=raw instanceof ArrayBuffer?new Uint8Array(raw):raw;
  const read=(i)=>{
    if(bitsPerSample===8)return Number(src[i]);
    const b=i*2;
    return Number(src[b])|(Number(src[b+1])<<8); // little-endian
  };
  const span=maxElevationM-minElevationM;
  for(let i=0;i<size;i++){
    const s=read(i);
    out[i]=finite(minElevationM+(clamp01(s/scale))*span);
  }
  return out;
}

/**
 * Bilinear sample of a row-major grid at fractional indices (x=column, y=row).
 * Wraps in x (longitude), clamps in y (latitude). NaN-safe.
 * @param {Float32Array|number[]} grid - height grid in meters.
 * @param {number} width
 * @param {number} height
 * @param {number} x - fractional column coordinate.
 * @param {number} y - fractional row coordinate.
 * @returns {number} interpolated value (meters).
 */
export function sampleBilinear(grid,width,height,x,y){
  if(!grid||!(width>0)||!(height>0))return 0;
  // x/y are fractional PIXEL indices (pixel i has its center at integer i).
  // The pixel-center offset is applied once, by the caller (see sampleHeight).
  const yy=clamp(y,0,height-1);
  const y0=clamp(Math.floor(yy),0,height-1);
  const y1=Math.min(height-1,y0+1);
  const fy=clamp(yy-y0,0,1);
  const x0=Math.floor(x);
  const fx=x-x0;
  const wx0=((x0%width)+width)%width,wx1=(wx0+1)%width;
  const a=grid[y0*width+wx0],b=grid[y0*width+wx1];
  const c=grid[y1*width+wx0],d=grid[y1*width+wx1];
  const top=a+(b-a)*fx,bottom=c+(d-c)*fx;
  return top+(bottom-top)*fy;
}

/**
 * Sample height in meters at normalized surface coordinates.
 * @param {Float32Array} grid - height grid (meters).
 * @param {number} width
 * @param {number} height
 * @param {number} u - normalized longitude in [0,1], wraps (u=1.5 == u=0.5).
 * @param {number} v - normalized latitude in [0,1], 0=north pole, clamped at poles.
 * @returns {number} height in meters.
 */
export function sampleHeight(grid,width,height,u,v){
  return sampleBilinear(grid,width,height,u*width-0.5,v*height-0.5);
}

/**
 * Slope in degrees from a 3x3 neighborhood (row-major, center = index 4).
 * Uses central differences (Zevenbergen-Thorne); falls back to the center
 * value for non-finite neighbors. Caps at 90 degrees.
 * @param {number[]} samples - nine values [z0..z8], center index 4.
 * @param {number} spacingMeters - distance between neighboring samples (>0).
 * @returns {number} slope in degrees, 0..90.
 */
export function computeSlopeDeg(samples,spacingMeters){
  if(!samples||samples.length!==9)return 0;
  if(!(spacingMeters>0))return 0;
  const g=(i)=>Number.isFinite(samples[i])?samples[i]:samples[4];
  const dzdx=(g(2)+g(5)+g(8)-g(0)-g(3)-g(6))/(6*spacingMeters);
  const dzdy=(g(6)+g(7)+g(8)-g(0)-g(1)-g(2))/(6*spacingMeters);
  return clamp(Math.atan(Math.hypot(dzdx,dzdy))*180/Math.PI,0,90);
}

/**
 * Compute per-pixel surface normal map as RGBA Uint8Array (sRGB-encoded).
 * Flat upward-facing areas encode to roughly (128,128,255). Edges: horizontal
 * wrap, vertical clamp. Uses the Sobel operator for gradient estimation.
 * @param {Float32Array} grid - height grid (meters).
 * @param {number} width
 * @param {number} height
 * @param {number} meterPerPixel - horizontal spacing between grid cells (>0).
 * @returns {Uint8Array} RGBA, length width*height*4.
 */
export function gridToNormalMap(grid,width,height,meterPerPixel){
  const out=new Uint8Array(width*height*4);
  if(!grid||!(width>0)||!(height>1)||!(meterPerPixel>0))return out;
  const at=(x,y)=>grid[clamp(y,0,height-1)*width+(((x%width)+width)%width)];
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const tl=at(x-1,y-1),t=at(x,y-1),tr=at(x+1,y-1);
      const l=at(x-1,y),r=at(x+1,y);
      const bl=at(x-1,y+1),b=at(x,y+1),br=at(x+1,y+1);
      const dzdx=(tr+2*r+br-tl-2*l-bl)/(4*meterPerPixel);
      const dzdy=(bl+2*b+br-tl-2*t-tr)/(4*meterPerPixel);
      const len=Math.hypot(dzdx,dzdy,1)||1;
      // normal = normalize(-dzdx, -dzdy, 1); image +y (south) maps to -G.
      const nx=-dzdx/len,ny=-dzdy/len,nz=1/len;
      const lin=(c)=>Math.pow(clamp01(c),1/2.2); // linear -> sRGB
      const o=(y*width+x)*4;
      out[o]=Math.round(lin(nx*0.5+0.5)*255);
      out[o+1]=Math.round(lin(ny*0.5+0.5)*255);
      out[o+2]=Math.round(lin(nz*0.5+0.5)*255);
      out[o+3]=255;
    }
  }
  return out;
}

/**
 * Local relief statistics of a grid (meters). Non-finite cells are ignored.
 * @param {Float32Array} grid
 * @param {number} width
 * @param {number} height
 * @returns {{minM:number,maxM:number,meanM:number,stdevM:number}}
 */
export function computeLocalRelief(grid,width,height){
  if(!grid||!(width>0)||!(height>0))return {minM:0,maxM:0,meanM:0,stdevM:0};
  let min=Infinity,max=-Infinity,sum=0,n=0;
  for(let i=0;i<width*height;i++){
    const v=grid[i];
    if(!Number.isFinite(v))continue;
    if(v<min)min=v;
    if(v>max)max=v;
    sum+=v;n++;
  }
  if(!n)return {minM:0,maxM:0,meanM:0,stdevM:0};
  const mean=sum/n;
  let acc=0;
  for(let i=0;i<width*height;i++){
    const v=grid[i];
    if(!Number.isFinite(v))continue;
    acc+=(v-mean)*(v-mean);
  }
  return {minM:min,maxM:max,meanM:mean,stdevM:Math.sqrt(acc/n)};
}

/**
 * Aspect angle in radians of the steepest DOWNSLOPE at a 3x3 neighborhood
 * (center index 4), measured clockwise from north (0 = north-facing,
 * pi/2 = east, pi = south, 3*pi/2 = west). With dzdx = dZ/dEast and
 * dzdy = dZ/dSouth the descent direction is (-dzdx, +dzdy) in
 * (east, north), so aspect = atan2(-dzdx, dzdy), normalized to [0, 2*pi).
 * Returns NaN when the cell is flat (no gradient).
 * @param {number[]} samples - nine values [z0..z8], center index 4.
 * @param {number} spacingMeters - cell spacing (>0).
 * @returns {number} downslope aspect in radians [0, 2*pi), or NaN if flat.
 */
export function computeAspectRad(samples,spacingMeters){
  if(!samples||samples.length!==9||!(spacingMeters>0))return NaN;
  const g=(i)=>Number.isFinite(samples[i])?samples[i]:samples[4];
  const dzdx=(g(2)+g(5)+g(8)-g(0)-g(3)-g(6))/(6*spacingMeters);
  const dzdy=(g(6)+g(7)+g(8)-g(0)-g(1)-g(2))/(6*spacingMeters);
  if(dzdx===0&&dzdy===0)return NaN;
  let a=Math.atan2(-dzdx,dzdy);
  if(a<0)a+=2*Math.PI;
  return a;
}

/**
 * Hillshade raster as RGBA Uint8Array (grayscale, alpha 255). Lambertian
 * shading from a directional light; values 0 (shadow) .. 255 (full light).
 * Horizontal wrap, vertical clamp. Defaults: azimuth 315, altitude 45 deg.
 * @param {Float32Array} grid - height grid (meters).
 * @param {number} width
 * @param {number} height
 * @param {number} meterPerPixel - horizontal spacing (>0).
 * @param {object} [opts]
 * @param {number} [opts.azimuthDeg=315] - light direction, 0=N, clockwise.
 * @param {number} [opts.altitudeDeg=45] - light elevation above horizon.
 * @returns {Uint8Array} RGBA hillshade, length width*height*4.
 */
export function computeHillshade(grid,width,height,meterPerPixel,{azimuthDeg=TERRAIN_CONSTANTS.HILLSHADE_AZIMUTH,altitudeDeg=TERRAIN_CONSTANTS.HILLSHADE_ALTITUDE}={}){
  const out=new Uint8Array(width*height*4);
  if(!grid||!(width>0)||!(height>1)||!(meterPerPixel>0))return out;
  const az=azimuthDeg*Math.PI/180,zen=(90-altitudeDeg)*Math.PI/180;
  const cosZ=Math.cos(zen),sinZ=Math.sin(zen);
  const at=(x,y)=>grid[clamp(y,0,height-1)*width+(((x%width)+width)%width)];
  for(let y=0;y<height;y++){
    for(let x=0;x<width;x++){
      const tl=at(x-1,y-1),t=at(x,y-1),tr=at(x+1,y-1);
      const l=at(x-1,y),r=at(x+1,y);
      const bl=at(x-1,y+1),b=at(x,y+1),br=at(x+1,y+1);
      // rows increase southward, so dzdy = dZ/dSouth
      const dzdx=(tr+2*r+br-tl-2*l-bl)/(4*meterPerPixel);
      const dzdy=(bl+2*b+br-tl-2*t-tr)/(4*meterPerPixel);
      const slope=Math.atan(Math.hypot(dzdx,dzdy));
      // Downslope aspect, clockwise from north (see computeAspectRad).
      let aspect=Math.atan2(-dzdx,dzdy);
      if(!Number.isFinite(aspect))aspect=az;
      // ESRI-style Lambertian hillshade.
      let shade=cosZ*Math.cos(slope)+sinZ*Math.sin(slope)*Math.cos(az-aspect);
      if(!Number.isFinite(shade))shade=0;
      const v=Math.round(clamp01(shade)*255);
      const o=(y*width+x)*4;
      out[o]=v;out[o+1]=v;out[o+2]=v;out[o+3]=255;
    }
  }
  return out;
}
