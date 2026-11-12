/**
 * Official planetary digital elevation model (DEM) source catalogue.
 *
 * This module contains metadata only. It does not download or decode raster
 * files, reproject coordinates, create terrain geometry or make network calls.
 *
 * Distances are kilometres per equatorial pixel; heights are metres.
 * All height ranges are approximate scientific visualization envelopes,
 * not calibrated pixel normalization intervals.
 *
 * Georeferenced TIFF rasters require a GeoTIFF decoder and possibly reprojection
 * or conversion to tiled formats before they can be used in a browser.
 * Do not download multi-gigabyte global rasters on every page load.
 *
 * Data sources: NASA, USGS Astrogeology, NOAA NCEI.
 * Consult each product's original metadata and citation before redistribution.
 *
 * @module planet-data-sources
 */

/**
 * @typedef {'tiff'|'png16'|'jpg'|'schematic'} DemType
 */

/**
 * @typedef {Object} DemSource
 * @property {string} name - Official product or descriptive schematic name.
 * @property {string} url - Direct raster download URL or 'schematic'.
 * @property {string} license - Applicable reuse terms and credit requirements.
 * @property {string} citation - Original institution, product and reference.
 * @property {number|null} resolutionKmPerPx - Approximate equatorial pixel size.
 * @property {[number, number]|null} heightRangeM - Approximate [minimum,maximum].
 * @property {DemType} type - Raster format or schematic classification.
 * @property {'global'|'regional'|'none'} coverage - Geographic coverage.
 * @property {string} [note] - Interpretation and implementation warnings.
 * @property {number} [scale] - Pixel-to-height multiplier if applicable.
 * @property {string} [referenceUrl] - Additional mission or metadata reference.
 */

/**
 * Official DEM sources for all eight planets and Earth's Moon.
 *
 * The primary source is the highest-resolution preferred global dataset.
 * Fallbacks may provide lower resolutions of the same physical quantity.
 * A visual albedo image, radar backscatter map or colourized relief map
 * MUST NOT be decoded or described as measured elevation.
 *
 * Jupiter, Saturn, Uranus and Neptune do not have a mapped solid planetary
 * surface. Their entries are explicitly schematics; cloud-top imagery and
 * gravity measurements cannot be converted into a physical ground DEM.
 *
 * @type {Record<string,{primary:DemSource,fallbacks:DemSource[]}>}
 */
export const DEM_SOURCES = {
  mercury: {
    primary: {
      name: 'USGS MESSENGER MDIS Global Digital Elevation Model v2',
      url: 'https://planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif',
      license: 'NASA/USGS public-access planetary data; cite original authors',
      citation: 'USGS Astrogeology, MESSENGER Global DEM 665m (2016), https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m',
      resolutionKmPerPx: 0.665243,
      heightRangeM: [-10000, 11000],
      type: 'tiff',
      coverage: 'global',
      note: 'MDIS stereo-derived global DEM, signed 16-bit pixels; positive-east longitude 0..360. Rewrap longitudes to -180..180. MESSENGER MLA laser altimetry supplies independent regional measurements.'
    },
    fallbacks: []
  },
  venus: {
    primary: {
      name: 'USGS Magellan Global Topographic Data Record v02',
      url: 'https://planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif',
      license: 'Public domain; please cite Magellan Team and USGS',
      citation: 'Magellan Team, Global Topographic Data Record, https://astrogeology.usgs.gov/search/map/venus_magellan_global_topography_4641m',
      resolutionKmPerPx: 4.641,
      heightRangeM: [-4000, 12000],
      type: 'tiff',
      coverage: 'global',
      note: 'Radar altimeter-derived planetary topography, not SAR intensity. Source coordinates are in the planetary 0..360 longitude domain.'
    },
    fallbacks: []
  },
  earth: {
    primary: {
      name: 'NOAA NCEI ETOPO 2022 Global Surface Elevation 30 arcseconds',
      url: 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/30s/30s_surface_elev_gtif/ETOPO_2022_v1_30s_N90W180_surface.tif',
      license: 'US Government public-access data; credit NOAA NCEI and ETOPO contributors',
      citation: 'NOAA National Centers for Environmental Information, ETOPO 2022 Global Relief Model, https://www.ncei.noaa.gov/products/etopo-global-relief-model',
      resolutionKmPerPx: 0.9277,
      heightRangeM: [-11000, 9000],
      type: 'tiff',
      coverage: 'global',
      note: 'Combined land and seafloor elevation; the chosen surface product includes ice-surface heights. ETOPO is preferred over SRTM where whole-Earth coverage including oceans and high latitudes is required.'
    },
    fallbacks: [{
      name: 'NOAA NCEI ETOPO 2022 Global Surface Elevation 60 arcseconds',
      url: 'https://www.ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/60s_surface_elev_gtif/ETOPO_2022_v1_60s_N90W180_surface.tif',
      license: 'US Government public-access data; credit NOAA NCEI and ETOPO contributors',
      citation: 'NOAA NCEI ETOPO 2022, https://www.ncei.noaa.gov/products/etopo-global-relief-model',
      resolutionKmPerPx: 1.8553,
      heightRangeM: [-11000, 9000],
      type: 'tiff',
      coverage: 'global',
      note: 'Lower-resolution global elevation product for preview. NASA Blue Marble is albedo imagery, not elevation data.'
    }]
  },
  moon: {
    primary: {
      name: 'NASA LRO LOLA Global Lunar Digital Elevation Model, March 2014',
      url: 'https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif',
      license: 'Public domain; cite LOLA Science Team and USGS',
      citation: 'NASA LRO LOLA Science Team, USGS Astrogeology, https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m',
      resolutionKmPerPx: 0.1184506,
      heightRangeM: [-10000, 11000],
      type: 'tiff',
      coverage: 'global',
      scale: 0.5,
      note: 'Approximately 8 GB signed-16-bit GeoTIFF. Physical height in metres equals stored digital number times 0.5, unless the GeoTIFF decoder has already applied the embedded scale. Do not scale twice.'
    },
    fallbacks: []
  },
  mars: {
    primary: {
      name: 'NASA Mars Global Surveyor MOLA Global DEM',
      url: 'https://planetarymaps.usgs.gov/mosaic/Mars_MGS_MOLA_DEM_mosaic_global_463m.tif',
      license: 'CC0/public domain; credit the MOLA Science Team',
      citation: 'USGS Astrogeology, MGS MOLA DEM 463m, https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m',
      resolutionKmPerPx: 0.463084,
      heightRangeM: [-9000, 22000],
      type: 'tiff',
      coverage: 'global',
      note: 'MOLA laser-altimeter DEM relative to a Mars areoid. HiRISE stereo-derived digital terrain models offer much higher resolution in selected local regions, not global coverage.'
    },
    fallbacks: []
  },
  jupiter: {
    primary: {
      name: 'Juno MWR / JunoCam cloud-top and gravity-field based schematic',
      url: 'schematic',
      license: 'NASA science reference; credit original image creators for any reused imagery',
      citation: 'NASA Juno mission, https://science.nasa.gov/mission/juno/',
      resolutionKmPerPx: null,
      heightRangeM: null,
      type: 'schematic',
      coverage: 'none',
      referenceUrl: 'https://science.nasa.gov/jupiter/facts/',
      note: 'Gas giant: no solid mapped surface. Microwave sounding and cloud patterns cannot be used as solid-surface height values.'
    },
    fallbacks: []
  },
  saturn: {
    primary: {
      name: 'Cassini cloud-top imaging and gravity-field based schematic',
      url: 'schematic',
      license: 'NASA science reference; check attribution for specific Cassini imagery',
      citation: 'NASA Cassini mission, https://science.nasa.gov/mission/cassini/',
      resolutionKmPerPx: null,
      heightRangeM: null,
      type: 'schematic',
      coverage: 'none',
      referenceUrl: 'https://science.nasa.gov/saturn/facts/',
      note: 'Gas giant without mapped solid terrain. Clouds and rings are separate visual structures, not DEM features.'
    },
    fallbacks: []
  },
  uranus: {
    primary: {
      name: 'Voyager 2 / Hubble OPAL cloud-top schematic',
      url: 'schematic',
      license: 'NASA/ESA science reference; credit specific imagery providers when applicable',
      citation: 'NASA Uranus overview, https://science.nasa.gov/uranus/',
      resolutionKmPerPx: null,
      heightRangeM: null,
      type: 'schematic',
      coverage: 'none',
      referenceUrl: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-opal/',
      note: 'Ice giant: no available global solid-surface DEM. Atmospheric bands are variable and cannot represent surface slopes.'
    },
    fallbacks: []
  },
  neptune: {
    primary: {
      name: 'Voyager 2 / Hubble OPAL cloud-top schematic',
      url: 'schematic',
      license: 'NASA/ESA science reference; credit specific imagery providers when applicable',
      citation: 'NASA Neptune overview, https://science.nasa.gov/neptune/',
      resolutionKmPerPx: null,
      heightRangeM: null,
      type: 'schematic',
      coverage: 'none',
      referenceUrl: 'https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-opal/',
      note: 'Ice giant with time-varying atmospheric features; cloud patterns are schematic, not measured planetary ground topography.'
    },
    fallbacks: []
  }
};

/**
 * Select the most suitable available DEM source for the requested quality.
 *
 * Selection uses existing measured raster resolution rather than inventing
 * quality-dependent URLs:
 *
 * - preview: the lowest-resolution available raster.
 * - standard: a middle-resolution raster when multiple rasters are available.
 * - high: the highest-resolution available raster.
 *
 * When only one measured raster exists, all quality levels select that raster;
 * the rendering system must resample it or request appropriately sized tiles.
 * Gas and ice giants always select their schematic source.
 *
 * Metadata is returned as a shallow copy, including a separate height range
 * array, to reduce accidental mutation of the global source catalogue.
 *
 * @param {string} planetId - One of nine lowercase celestial body identifiers.
 * @param {'preview'|'standard'|'high'} [quality='standard'] - Resolution level.
 * @returns {DemSource} Source metadata; never decoded terrain pixels.
 * @throws {TypeError} If an argument has an invalid type.
 * @throws {RangeError} If the ID or requested quality is unknown.
 */
export function resolveDemSource(planetId, quality = 'standard') {
  if (typeof planetId !== 'string' || typeof quality !== 'string') {
    throw new TypeError('planetId and quality must be strings');
  }

  if (!Object.prototype.hasOwnProperty.call(DEM_SOURCES, planetId)) {
    throw new RangeError(`Unknown planetId: ${planetId}`);
  }

  if (!['preview', 'standard', 'high'].includes(quality)) {
    throw new RangeError(`Unknown DEM quality: ${quality}`);
  }

  const entry = DEM_SOURCES[planetId];
  const candidates = [entry.primary, ...entry.fallbacks]
    .filter(source => (
      source.type !== 'schematic'
      ? Number.isFinite(source.resolutionKmPerPx)
        ? source.resolutionKmPerPx > 0
        : false
      : false
    ))
    .sort((a, b) => a.resolutionKmPerPx - b.resolutionKmPerPx);

  const chosen = candidates.length === 0
    ? entry.primary
    : quality === 'high'
      ? candidates[0]
      : quality === 'preview'
        ? candidates[candidates.length - 1]
        : candidates[Math.floor((candidates.length - 1) / 2)];

  return {
    ...chosen,
    heightRangeM: chosen.heightRangeM === null
      ? null
      : [...chosen.heightRangeM]
  };
}

/**
 * Identify gas and ice giants without measured solid-surface terrain.
 *
 * This function is a scientific classification, not a check of network
 * availability. It returns true for Jupiter, Saturn, Uranus and Neptune.
 *
 * @param {string} planetId - Lowercase celestial body identifier.
 * @returns {boolean} Whether the source is intentionally schematic.
 * @throws {TypeError} If planetId is not a string.
 * @throws {RangeError} If the planet ID is not recognized.
 */
export function isSchematic(planetId) {
  if (typeof planetId !== 'string') {
    throw new TypeError('planetId must be a string');
  }

  if (!Object.prototype.hasOwnProperty.call(DEM_SOURCES, planetId)) {
    throw new RangeError(`Unknown planetId: ${planetId}`);
  }

  return DEM_SOURCES[planetId].primary.type === 'schematic';
}
/**
 * NASA planetary fact sheet values, with 2025 moon counts as published.
 * Planet radii correspond to half the equatorial diameters in the NASA
 * comparative sheet, except for Sun (volumetric mean radius).
 * The Moon's semi-major axis is EARTH-CENTRED, not heliocentric.
 * Temperatures are degrees Celsius; masses are kilograms.
 * Texture endpoints are public third-party assets, not NASA products.
 * NASA mission-derived GeoTIFF sources remain in DEM_SOURCES above.
 */
const FACT_SHEET_URL = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/';
const SUN_SHEET_URL = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html';
const MOON_SHEET_URL = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html';
const TEXTURE_ROOT = 'https://www.solarsystemscope.com/textures/download/';

export const SOURCES = [
  {
    label: 'NASA NSSDCA Planetary Fact Sheet, metric, updated March 18, 2025 (all planet comparative statistics; moon counts are date-sensitive)',
    url: FACT_SHEET_URL,
    license: 'NASA government reference; attribution recommended'
  },
  {
    label: 'NASA NSSDCA Sun Fact Sheet (mean radius, rotation, obliquity, gravity, mass and effective temperature)',
    url: SUN_SHEET_URL,
    license: 'NASA government reference; attribution recommended'
  },
  {
    label: 'NASA NSSDCA Moon Fact Sheet (Earth-centred orbit and lunar obliquity)',
    url: MOON_SHEET_URL,
    license: 'NASA government reference; attribution recommended'
  },
  {
    label: 'NASA/JPL Planetary Physical Parameters (independent mass, radius and sidereal rotation reference)',
    url: 'https://ssd.jpl.nasa.gov/planets/phys_par.html',
    license: 'NASA/JPL scientific reference'
  },
  {
    label: 'NASA NSSDCA planetary atmospheric composition and exosphere detail sheets',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/planetfact.html',
    license: 'NASA government reference'
  },
  {
    label: 'Solar System Scope planetary maps and attribution requirements',
    url: 'https://www.solarsystemscope.com/textures/',
    license: 'CC BY 4.0; attribution Solar System Scope required; verify each individual asset'
  },
  {
    label: 'USGS Astrogeology and NASA planetary elevation products',
    url: 'https://planetarymaps.usgs.gov/',
    license: 'US government mission data; inspect original product metadata and credit authors'
  },
  {
    label: 'NOAA NCEI ETOPO 2022 global relief model',
    url: 'https://www.ncei.noaa.gov/products/etopo-global-relief-model',
    license: 'US government source; acknowledge NOAA and third-party ETOPO contributors'
  },
  {
    label: 'NASA LRO LOLA lunar altimetry',
    url: 'https://science.nasa.gov/mission/lro/',
    license: 'NASA mission reference; cite LOLA data product'
  },
  {
    label: 'NASA Mars Global Surveyor MOLA altimetry',
    url: 'https://science.nasa.gov/mission/mars-global-surveyor/',
    license: 'NASA mission reference; cite MOLA data product'
  }
];

/**
 * Textures are photographic or synthesized global colour maps, not DEMs.
 * Only published Solar System Scope file naming is listed as candidates;
 * direct file availability/CORS must be checked in deployment.
 * No fictional Pluto heightmap or solid gas giant terrain is supplied.
 */
const TEXTURE_CANDIDATES = {
  sun: [`${TEXTURE_ROOT}2k_sun.jpg`],
  mercury: [`${TEXTURE_ROOT}2k_mercury.jpg`],
  venus: [`${TEXTURE_ROOT}2k_venus_surface.jpg`, `${TEXTURE_ROOT}2k_venus_atmosphere.jpg`],
  earth: [`${TEXTURE_ROOT}2k_earth_daymap.jpg`, `${TEXTURE_ROOT}2k_earth_nightmap.jpg`, `${TEXTURE_ROOT}2k_earth_clouds.jpg`],
  moon: [`${TEXTURE_ROOT}2k_moon.jpg`],
  mars: [`${TEXTURE_ROOT}2k_mars.jpg`],
  jupiter: [`${TEXTURE_ROOT}2k_jupiter.jpg`],
  saturn: [`${TEXTURE_ROOT}2k_saturn.jpg`],
  uranus: [`${TEXTURE_ROOT}2k_uranus.jpg`],
  neptune: [`${TEXTURE_ROOT}2k_neptune.jpg`],
  pluto: []
};

/**
 * Return candidate equirectangular albedo maps (not verified for uptime).
 * @param {string} id - Lowercase Solar System body identifier.
 * @returns {string[]} A defensive copy, empty for unsupported IDs.
 */
export function getTextureCandidates(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(TEXTURE_CANDIDATES, id)
    ? [...TEXTURE_CANDIDATES[id]]
    : [];
}
/**

- @typedef {Object} PlanetTextureSlots

- @property {string|null} diffuse      - Base-colour / albedo map filename.

- @property {string|null} normal       - Tangent-space normal map filename.

- @property {string|null} atmosphere   - Separate atmosphere/cloud shell map.

- @property {string|null} rings        - Ring alpha map filename (only Saturn).

- @property {string|null} bump         - Visual bump/relief map filename.

- @property {string|null} heightmap    - Quantized elevation visualization.

- @property {string|null} photosphere  - Photosphere map (Sun only).

- @property {string|null} corona       - Corona / glare map (Sun only).
*/

/**

- Per-body local texture slot catalogue.

-

- Every value is either a filename that exists verbatim inside

- static/textures/ (verified with the filesystem listing) or `
null
`.

- Filenames are bare names, not paths: consumers such as the texture

- loader join them with their configured texture root.

-

- Bodies without a mapped solid surface (Jupiter, Saturn, Uranus,

- Neptune, Sun) still carry their available cloud/photosphere albedo

- maps. `
normal
`/`
heightmap
` stay null where no local asset exists — a

- luminance-derived artistic bump is never reported as a heightmap.

-

- `
rings
` is populated only for Saturn because it is the only body with a

- ring alpha texture in static/textures/saturn_ring_alpha.png.

-

- @type {Record<string, PlanetTextureSlots>}
*/
export const PLANET_TEXTURE_SOURCES = Object.freeze({
mercury: Object.freeze({
diffuse: 'mercury.jpg',
normal: null,
atmosphere: null,
rings: null,
bump: null,
heightmap: null,
photosphere: null,
corona: null
}),
venus: Object.freeze({
diffuse: 'venus_surface.jpg',
normal: null,
atmosphere: 'venus_atmosphere.jpg',
rings: null,
bump: null,
heightmap: null,
photosphere: null,
corona: null
}),
earth: Object.freeze({
diffuse: 'earth_daymap.jpg',
normal: 'earth_normal.jpg',
atmosphere: 'earth_clouds.png',
rings: null,
bump: null,
heightmap: null,
photosphere: null,
corona: null
}),
mars: Object.freeze({
diffuse: 'mars.jpg',
normal: null,
atmosphere: null,
rings: null,
bump: 'mars_bump.jpg',
heightmap: null,
photosphere: null,
corona: null
}),
jupiter: Object.freeze({
diffuse: 'jupiter.jpg',
normal: null,
atmosphere: null,
rings: null,
bump: null,
heightmap: null,
photosphere: null,
corona: null
}),
saturn: Object.freeze({
diffuse: 'saturn.jpg',
normal: null,
atmosphere: null,
rings: 'saturn_ring_alpha.png',
bump: null,
heightmap: null,
photosphere: null,
corona: null
}),
uranus: Object.freeze({
diffuse: 'uranus.jpg',
normal: null,
atmosphere: null,
rings: null,
bump: null,
heightmap: null,
photosphere: null,
corona: null
}),
neptune: Object.freeze({
diffuse: 'neptune.jpg',
normal: null,
atmosphere: null,
rings: null,
bump: null,
heightmap: null,
photosphere: null,
corona: null
}),
sun: Object.freeze({
diffuse: 'sun.jpg',
normal: null,
atmosphere: null,
rings: null,
bump: null,
heightmap: null,
// The single sun.jpg is used both as the photosphere albedo and as the
// corona/glare source; no dedicated corona PNG exists locally.
photosphere: 'sun.jpg',
corona: 'sun.jpg'
}),
moon: Object.freeze({
diffuse: 'moon_nasa.jpg',
normal: null,
atmosphere: null,
rings: null,
bump: 'moon_bump.jpg',
heightmap: 'moon_nasa_lola_height.jpg',
photosphere: null,
corona: null
})
});

/**

- Return the texture slot object for a single planet, restricted to the

- four slots renderers consume most often: diffuse, normal, atmosphere

- and rings. Each field is the verified local filename or `
null
` when the

- asset does not exist in static/textures/.

-

- @param {string} name - Lowercase celestial body identifier.

- @returns {{diffuse:string|null, normal:string|null, atmosphere:string|null, rings:string|null}}

- A fresh object; unknown bodies receive all-null fields rather than

- throwing so callers can probe speculatively.
*/
export function getAvailableTexturesForPlanet(name) {
const source = typeof name === 'string'
&& Object.prototype.hasOwnProperty.call(PLANET_TEXTURE_SOURCES, name.toLowerCase())
? PLANET_TEXTURE_SOURCES[name.toLowerCase()]
: null;
return {
diffuse: source && source.diffuse ? source.diffuse : null,
normal: source && source.normal ? source.normal : null,
atmosphere: source && source.atmosphere ? source.atmosphere : null,
rings: source && source.rings ? source.rings : null
};
}


const BODY_FACTS = [
  // id, name, radiusKm, orbital semimajor axis km, orbital period days,
  // axial tilt degrees, sidereal rotation hours, solar day hours, mass kg,
  // equatorial gravity m/s², representative temperature °C, satellites.
  ['sun', 'Sun', 695700, 0, null, 7.25, 609.12, null, 1.9884e30, 274, 5499, 0],
  ['mercury', 'Mercury', 2439.5, 57.9e6, 88, 0.034, 1407.6, 4222.6, 0.330e24, 3.7, 167, 0],
  ['venus', 'Venus', 6052, 108.2e6, 224.7, 177.4, -5832.5, 2802, 4.87e24, 8.9, 464, 0],
  ['earth', 'Earth', 6378, 149.6e6, 365.2, 23.4, 23.9, 24, 5.97e24, 9.8, 15, 1],
  ['moon', 'Moon', 1737.5, 384400, 27.3217, 6.68, 655.720, 708.7, 0.07346e24, 1.62, -20, 0],
  ['mars', 'Mars', 3396, 228e6, 687, 25.2, 24.6, 24.7, 0.642e24, 3.7, -65, 2],
  ['jupiter', 'Jupiter', 71492, 778.5e6, 4331, 3.1, 9.9, 9.9, 1898e24, 23.1, -110, 95],
  ['saturn', 'Saturn', 60268, 1432e6, 10747, 26.7, 10.7, 10.7, 568e24, 9, -140, 274],
  ['uranus', 'Uranus', 25559, 2867e6, 30589, 97.8, -17.2, 17.2, 86.8e24, 8.7, -195, 28],
  ['neptune', 'Neptune', 24764, 4515e6, 59800, 28.3, 16.1, 16.1, 102e24, 11, -200, 16],
  ['pluto', 'Pluto', 1188, 5906.4e6, 90560, 119.5, -153.3, 153.3, 0.013e24, 0.7, -225, 5]
];

// Top-three constituents are approximate labels, not numerical mixing ratios.
// Mercury and Moon possess tenuous exospheres rather than true atmospheres.
const ATMOSPHERES = {
  sun: ['Hydrogen', 'Helium', 'Oxygen (trace)'],
  mercury: ['Oxygen (exosphere)', 'Sodium (exosphere)', 'Hydrogen (exosphere)'],
  venus: ['Carbon dioxide', 'Nitrogen', 'Sulfur dioxide'],
  earth: ['Nitrogen', 'Oxygen', 'Argon'],
  moon: ['Helium (exosphere)', 'Neon (exosphere)', 'Argon (exosphere)'],
  mars: ['Carbon dioxide', 'Nitrogen', 'Argon'],
  jupiter: ['Hydrogen', 'Helium', 'Methane'],
  saturn: ['Hydrogen', 'Helium', 'Methane'],
  uranus: ['Hydrogen', 'Helium', 'Methane'],
  neptune: ['Hydrogen', 'Helium', 'Methane'],
  pluto: ['Nitrogen', 'Methane', 'Carbon monoxide']
};

const COLORS = {
  sun: ['#fff3b0', '#ffb934', '#ec6f16'],
  mercury: ['#b1a99e', '#6c665f', '#d6d0c4'],
  venus: ['#e1be83', '#b77844', '#f4ddae'],
  earth: ['#3479b9', '#4e9f62', '#edf4f8'],
  moon: ['#99958e', '#514e4b', '#d4d0c9'],
  mars: ['#be6942', '#803b2b', '#dfaa71'],
  jupiter: ['#cfaa8c', '#8a5d4b', '#eee0c2'],
  saturn: ['#dacaa2', '#a99869', '#f0dfb6'],
  uranus: ['#90d9d6', '#6daeb4', '#beeae5'],
  neptune: ['#4c6ed1', '#294897', '#85a8f0'],
  pluto: ['#b9a58c', '#786559', '#e2d3bf']
};

/**
 * Ring specs. The renderer reads `inner`/`outer` as multiples of the planet
 * radius (solar-system-core RING_BODIES handling), so those ratios drive
 * rendering. Saturn additionally carries physical `innerRadiusKm`/
 * `outerRadiusKm` (D-ring inner edge to A-ring outer edge) and an alpha-map
 * texture. Jupiter, Uranus and Neptune keep their faint rings so they still
 * render; they only need the ratios.
 */
const RING_SPECS = {
  jupiter: { inner: 1.4, outer: 1.8, color: '#9e8e80' },
  saturn: {
    innerRadiusKm: 74500,
    outerRadiusKm: 140220,
    inner: 74500 / 58232,
    outer: 140220 / 58232,
    color: '#c8b894',
    textureUrl: '/textures/saturn_ring_alpha.png'
  },
  uranus: { inner: 1.5, outer: 2.0, color: '#7eafaf' },
  neptune: { inner: 1.6, outer: 2.3, color: '#6477a3' }
};

const NAMED_MOONS = {
  earth: ['Moon'],
  mars: ['Phobos', 'Deimos'],
  jupiter: ['Io', 'Europa', 'Ganymede', 'Callisto'],
  saturn: ['Mimas', 'Enceladus', 'Tethys', 'Dione', 'Rhea', 'Titan', 'Iapetus'],
  uranus: ['Miranda', 'Ariel', 'Umbriel', 'Titania', 'Oberon'],
  neptune: ['Triton', 'Nereid', 'Proteus'],
  pluto: ['Charon', 'Nix', 'Hydra', 'Kerberos', 'Styx']
};

const DEM_RENDERING_NOTE = 'A scientific GeoTIFF is not directly usable by THREE.TextureLoader: decode, normalize and resample it first.';

/**
 * Browser-loadable local planetary texture assets (served from /static).
 * The original Solar System Scope files require CC BY 4.0 attribution.
 * NASA/JPL lunar assets have separate mission-specific source credits.
 */
const LOCAL_TEXTURES = {
  sun: '/textures/sun.jpg',
  mercury: '/textures/mercury.jpg',
  venus: '/textures/venus_surface.jpg',
  earth: '/textures/earth_daymap.jpg',
  moon: '/textures/moon_nasa.jpg',
  mars: '/textures/mars.jpg',
  jupiter: '/textures/jupiter.jpg',
  saturn: '/textures/saturn.jpg',
  uranus: '/textures/uranus.jpg',
  neptune: '/textures/neptune.jpg',
  pluto: '/textures/pluto.jpg'
};

/**
 * Browser-loadable grayscale relief maps for terrain-core.loadHeightmap().
 *
 * The Moon uses the NASA LRO/LOLA 8-bit elevation visualization from
 * NASA SVS CGI Moon Kit. This is an elevation-derived, quantized JPEG
 * intended for visualization, not a substitute for the original 16-bit DEM.
 *
 * Other solid planets retain null until scientifically sourced elevation
 * rasters have been decoded, projected, normalized and converted into
 * browser-loadable textures. Albedo must never be presented as measured
 * terrain elevation. Gas giants do not have solid-surface heightmaps.
 *
 * @type {Record<string, string|null>}
 */
const LOCAL_HEIGHTMAPS = {
  sun: null,
  mercury: null,
  venus: null,
  earth: null,
  moon: '/textures/moon_nasa_lola_height.jpg',
  mars: null,
  jupiter: null,
  saturn: null,
  uranus: null,
  neptune: null
};

/**
 * Visual bump strength, enabled only for locally available elevation maps.
 * Values are renderer-relative exaggerations, not physical elevation units.
 *
 * Moon: NASA LRO/LOLA elevation visualization (a real height map).
 * Mars: a grayscale *luminance* relief derived locally from the NASA Mars
 *       albedo (static/textures/mars_bump.jpg). This is an artistic bump,
 *       NOT a MOLA DEM; the official MOLA DEM (DEM_SOURCES.mars) is a GeoTIFF
 *       that the browser cannot decode here. Hence LOCAL_HEIGHTMAPS.mars stays
 *       null — no browser-loadable Mars heightmap exists — while the visual
 *       bump is still enabled at the same strength app.js applies.
 */
const BUMP_SCALES = {
  // Rocky DISPLACEMENT_BODIES get visible relief (true DEM for the Moon, an
  // artistic luminance bump for Earth/Mercury/Mars via buildBump's procedural
  // fallback). Gas giants and the Sun stay at 0 (no solid surface).
  sun: 0, mercury: 0.02, venus: 0, earth: 0.02, moon: 0.06, mars: 0.03,
  jupiter: 0, saturn: 0, uranus: 0, neptune: 0
};

/**
 * Locally verified official NASA/JPL moon surface maps.
 *
 * The JPL maps are mission-derived equirectangular visual mosaics.
 * They represent surface appearance, NOT measured topographic relief.
 * Nereid, Proteus and Pluto's smaller moons have no substitute image.
 * Titan and Charon use documented mission maps, not elevation measurements.
 */
export const LOCAL_MOON_TEXTURES = Object.freeze({
  moon: '/textures/moon_nasa.jpg',
  phobos: '/textures/phobos_nasa.jpg',
  deimos: '/textures/deimos_nasa.jpg',
  io: '/textures/io_nasa.jpg',
  europa: '/textures/europa_nasa.jpg',
  ganymede: '/textures/ganymede_nasa.jpg',
  callisto: '/textures/callisto_nasa.jpg',
  mimas: '/textures/mimas_nasa.jpg',
  enceladus: '/textures/enceladus_nasa.jpg',
  tethys: '/textures/tethys_nasa.jpg',
  dione: '/textures/dione_nasa.jpg',
  rhea: '/textures/rhea_nasa.jpg',
  titan: '/textures/titan_nasa.jpg',
  iapetus: '/textures/iapetus_nasa.jpg',
  miranda: '/textures/miranda_nasa.jpg',
  ariel: '/textures/ariel_nasa.jpg',
  umbriel: '/textures/umbriel_nasa.jpg',
  titania: '/textures/titania_nasa.jpg',
  oberon: '/textures/oberon_nasa.jpg',
  triton: '/textures/triton_nasa.jpg',
  charon: '/textures/charon_nasa.jpg'
});

/**
 * Named moon physical parameters.
 * Radii and approximate mean orbits are in km; periods are in Earth days.
 * Negative period values indicate retrograde motion.
 * These are mean-orbit visualization parameters, not ephemerides.
 */
const MOON_PHYSICAL_DATA = {
  moon:     [1737.4, 384400, 27.3217],
  phobos:   [11.3, 9376, 0.31891],
  deimos:   [6.2, 23463, 1.26244],
  io:       [1821.6, 421700, 1.769],
  europa:   [1560.8, 671034, 3.551],
  ganymede: [2634.1, 1070412, 7.155],
  callisto: [2410.3, 1882709, 16.689],
  mimas:    [198.2, 185539, 0.942],
  enceladus:[252.1, 238020, 1.370],
  tethys:   [531.1, 294660, 1.888],
  dione:    [561.4, 377400, 2.737],
  rhea:     [763.8, 527108, 4.518],
  titan:    [2574.7, 1221870, 15.945],
  iapetus:  [734.5, 3560820, 79.32],
  miranda:  [235.8, 129390, 1.413],
  ariel:    [578.9, 190900, 2.520],
  umbriel:  [584.7, 266000, 4.144],
  titania:  [788.4, 436300, 8.706],
  oberon:   [761.4, 583500, 13.463],
  triton:   [1353.4, 354759, -5.877],
  nereid:   [170, 5513818, 360.14],
  proteus:  [210, 117647, 1.122],
  charon:   [606, 19591, 6.387],
  // Pluto's four small moons (NASA/JHUAPL New Horizons; PDS Rings Node,
  // Showalter & Hamilton 2015). Radii = half the mean diameter; orbits are
  // mean semimajor axes about the Pluto-Charon barycentre. Previously these
  // were null, so the renderer stacked all four on one 100,000 km fallback orbit.
  styx:     [5.25, 42413, 20.1617],
  nix:      [18,   48690, 24.8548],
  kerberos: [6,    57750, 32.1679],
  hydra:    [18.5, 64721, 38.2021]
};

/**
 * Moon specifications shared with renderers and future navigation systems.
 * A missing texture is explicit; no unrelated map is substituted.
 * Pluto is retained as a dwarf-planet parent for compatibility.
 */
export const MOON_DATA = Object.freeze(
  Object.entries(NAMED_MOONS).flatMap(([parent, names]) =>
    names.map(name => {
      const id = name.toLowerCase();
      const physical = MOON_PHYSICAL_DATA[id] || [];
      return Object.freeze({
        id,
        name,
        parent,
        orbitCenterId: parent,
        radiusKm: physical[0] ?? null,
        // New Horizons albedo tints for the Pluto system (Charon grey, Nix/Hydra
        // brighter ice, Kerberos/Styx darker). Other moons fall back to '#9a9a9a'.
        color: id === 'charon' ? '#9a948c'
          : id === 'nix' ? '#c8c2b8'
          : id === 'hydra' ? '#b8b2a8'
          : id === 'kerberos' ? '#6e6862'
          : id === 'styx' ? '#5e5852'
          : undefined,
        orbitRadiusKm: physical[1] ?? null,
        semiMajorAxisKm: physical[1] ?? null,
        periodDays: physical[2] ?? null,
        orbitalPeriodDays: physical[2] ?? null,
        textureUrl: LOCAL_MOON_TEXTURES[id] || null,
        heightmapUrl: id === 'moon'
          ? '/textures/moon_nasa_lola_height.jpg'
          : null,
        bumpScale: id === 'moon' ? 0.06 : 0,
        textureSource: id === 'moon'
          ? 'NASA LRO / NASA Scientific Visualization Studio'
          : id === 'titan'
            ? 'NASA/JPL Cassini, PIA22770 (near-infrared surface mosaic)'
            : id === 'charon'
              ? 'NASA/JHUAPL/SwRI New Horizons, PIA19866 (global surface map)'
              : LOCAL_MOON_TEXTURES[id]
              ? 'NASA/JPL Solar System Simulator'
              : null,
        heightmapSource: id === 'moon'
          ? 'NASA LRO LOLA elevation visualization (8-bit)'
          : null,
        isMeasuredElevation: id === 'moon',
        textureResolution: id === 'titan'
          ? '5760x2880'
          : id === 'charon'
            ? '9520x4760'
            : id === 'moon' ? '2k' : 'low'
      });
    })
  )
);

export function getMoonData(id) {
  return typeof id === 'string'
    ? MOON_DATA.find(moon => moon.id === id.toLowerCase()) || null
    : null;
}

/** NASA mean radii in km (volumetric mean / fact-sheet equatorial values). */
const NASA_RADIUS_KM = {
  sun: 695700, mercury: 2439.7, venus: 6051.8, earth: 6371,
  moon: 1737.4, mars: 3389.5, jupiter: 69911, saturn: 58232,
  uranus: 25362, neptune: 24622
};

/** NASA orbital semi-major axes in km; the Moon's is Earth-centred. */
const NASA_SEMI_MAJOR_KM = {
  sun: 0, mercury: 57.9e6, venus: 108.2e6, earth: 149.6e6,
  moon: 384400, mars: 227.9e6, jupiter: 778.6e6, saturn: 1433.5e6,
  uranus: 2872.5e6, neptune: 4495.1e6
};


/**
 * Per-body realistic PBR / texture metadata. Kept separate from the fact rows
 * so the scientific data stays readable. Missing keys fall back in the renderer.
 * @type {Record<string,{normalMapUrl?:string|null,specularMapUrl?:string|null,roughness?:number,metalness?:number,atmosphereKind?:string,atmosphereTint?:string,albedoOverride?:string}>}
 */
const REALISM = {
  sun:     { roughness: 1.0, metalness: 0.0, atmosphereKind: 'none', atmosphereTint: '#ffcc66' },
  mercury: { normalMapUrl: null, roughness: 0.95, metalness: 0.0, atmosphereKind: 'none' },
  venus:   { normalMapUrl: null, roughness: 1.0, metalness: 0.0, atmosphereKind: 'haze', atmosphereTint: '#f2e2c0', albedoOverride: '/textures/venus_atmosphere.jpg' },
  earth:   { normalMapUrl: '/textures/earth_normal.jpg', roughness: 0.55, metalness: 0.0, atmosphereKind: 'rayleigh', atmosphereTint: '#7ec0ff' },
  moon:    { normalMapUrl: null, roughness: 0.95, metalness: 0.0, atmosphereKind: 'none' },
  mars:    { normalMapUrl: null, roughness: 0.85, metalness: 0.0, atmosphereKind: 'haze', atmosphereTint: '#d98a5a' },
  jupiter: { normalMapUrl: null, roughness: 1.0, metalness: 0.0, atmosphereKind: 'haze', atmosphereTint: '#cfaa8c' },
  saturn:  { normalMapUrl: null, roughness: 1.0, metalness: 0.0, atmosphereKind: 'haze', atmosphereTint: '#dacaa2' },
  uranus:  { normalMapUrl: null, roughness: 1.0, metalness: 0.0, atmosphereKind: 'haze', atmosphereTint: '#90d9d6' },
  neptune: { normalMapUrl: null, roughness: 1.0, metalness: 0.0, atmosphereKind: 'haze', atmosphereTint: '#4c6ed1' },
  pluto:   { normalMapUrl: null, roughness: 0.9, metalness: 0.0, atmosphereKind: 'none' }
};

function createPlanetSpec(row) {
  const [
    id, name, radiusKm, semiMajorAxisKm, orbitalPeriodDays, axialTiltDeg,
    rotationPeriodHours, dayLength, mass, gravity, meanTemp, moonsCount
  ] = row;
  const r = REALISM[id] || {};
  const textureUrl = r.albedoOverride || LOCAL_TEXTURES[id] || null;
  const heightmapUrl = Object.prototype.hasOwnProperty.call(LOCAL_HEIGHTMAPS, id)
    ? LOCAL_HEIGHTMAPS[id]
    : null;
  const source = DEM_SOURCES[id]?.primary;
  const hasSolidDem = Boolean(source && source.type !== 'schematic');
  const moons = MOON_DATA.filter(moon => moon.parent === id);
  return {
    id,
    name,
    normalMapUrl: r.normalMapUrl || null,
    roughnessMapUrl: null,
    specularMapUrl: null,
    roughness: Number.isFinite(r.roughness) ? r.roughness : 0.95,
    metalness: Number.isFinite(r.metalness) ? r.metalness : 0.0,
    atmosphereKind: r.atmosphereKind || 'none',
    atmosphereTint: r.atmosphereTint || COLORS[id][0],
    radiusKm: Object.prototype.hasOwnProperty.call(NASA_RADIUS_KM, id)
      ? NASA_RADIUS_KM[id]
      : radiusKm,
    semiMajorAxisKm: Object.prototype.hasOwnProperty.call(NASA_SEMI_MAJOR_KM, id)
      ? NASA_SEMI_MAJOR_KM[id]
      : semiMajorAxisKm,
    orbitalPeriodDays,
    axialTiltDeg,
    rotationPeriodHours,
    textureUrl,
    heightmapUrl,
    bumpScale: BUMP_SCALES[id] || 0,
    atmosphereColor: COLORS[id][0],
    atmosphereOpacity: ['venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].includes(id) ? 0.17 : 0,
    moons,
    rings: RING_SPECS[id] ? { ...RING_SPECS[id] } : null,
    colorPalette: COLORS[id],
    dayLength,
    mass,
    gravity,
    meanTemp,
    atmosphereComposition: ATMOSPHERES[id],
    moonsCount,
    demSourceUrl: hasSolidDem ? source.url : null,
    demSourceFormat: hasSolidDem ? source.type : null,
    demNote: hasSolidDem ? DEM_RENDERING_NOTE : 'No browser-loadable global solid-surface heightmap',
    orbitCenterId: id === 'moon' ? 'earth' : id === 'sun' ? null : 'sun',
    temperatureUnit: id === 'sun' ? 'C (effective photosphere, converted from 5772 K)' : 'C',
    sourceUrl: id === 'sun' ? SUN_SHEET_URL : id === 'moon' ? MOON_SHEET_URL : FACT_SHEET_URL
  };
}

/** @type {Array<Object>} PlanetSpec-compatible scientific body catalogue. */
export const PLANET_DATA = [];



PLANET_DATA.push(...BODY_FACTS.map(createPlanetSpec));

if (typeof window !== 'undefined') {
  window.LLP = window.LLP || {};
  window.LLP.DataSources = {
    PLANET_DATA,
    MOON_DATA,
    LOCAL_MOON_TEXTURES,
    getMoonData,
    SOURCES,
    getTextureCandidates,
    DEM_SOURCES,
    resolveDemSource,
    isSchematic
  };
}
