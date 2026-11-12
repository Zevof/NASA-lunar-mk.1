// Texture Resolver stub – replaced by texture-cache lead.
const TextureResolver={
  async resolve(urls){if(!Array.isArray(urls)||urls.length===0)throw new Error('no urls');return urls[0];},
  async getCached(){return null;},
  async putCache(){},
  async clearCache(){},
  placeholderDataURL(color='333333'){return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';},
  CDN_MIRRORS:{'earth-albedo':['https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg'],'moon-albedo':['https://www.solarsystemscope.com/textures/download/2k_moon.jpg'],'mars-albedo':['https://www.solarsystemscope.com/textures/download/2k_mars.jpg']},
  SOLAR_SYSTEM_SCOPE_BASE:'https://www.solarsystemscope.com/textures/download/2k_'
};
if(typeof window!=='undefined'){window.LLP=window.LLP||{};window.LLP.TextureResolver=TextureResolver;}
export default TextureResolver;
