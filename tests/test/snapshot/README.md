# Lunar Link Planner v7 — Solar System timeline & lunar surface routes

An **English-language Windows planning and visualization application** with a 3D Solar System, Moon topography, selectable destinations and waypoint routing, date-based axial spins, sunlight and geometric lunar-Earth communication estimates, and preliminary spacecraft-transfer comparisons.

> **Important:** This is a visualization and first-order analysis tool, not a certified spacecraft trajectory solver, launch site optimizer, radio-link budget, or rover navigation system. The 3D scene is only as accurate as its selected data source and display mode.

## Quick start

1. On Windows 10/11, start the local server:

   ```powershell
   python serve.py
   ```

   Then open <http://127.0.0.1:8765/index.html> in your browser. Keep the console window open while using the app.

2. The initial **Entire Solar System** view is an intentionally compressed **Overview — NOT TO SCALE**, so all eight planets, Earth's Moon, and the Sun can be inspected. To use physical body radii and orbital distances, select **True scale — km from NASA/JPL**. At true scale, the planets are mostly tiny points when showing Neptune and the Sun together; choose a body under **Planet / body** and click **Focus selected body**.

3. Change the UTC date and drag the timeline slider; use **−10 years**, **+10 years**, **+100 years** or **Jump by years** to inspect later or earlier planetary positions and approximate axial rotation phases. You can select dates from **1800 through 2999**. The position calculations update without requesting a new ephemeris; precise lunar visibility/contact timing requires **Load precise NASA ephemerides** at that date.

4. Use **3D scene → Moon terrain / craters** to inspect 3D LOLA elevation and **Terrain rendering → 3D elevation grid** to see hills, depths and a reference level. You can increase visual relief exaggeration (not a physical change). Select **Pick Moon** and click the surface to choose a landing site; for a Moon surface route select **Add Moon stop** and click consecutive waypoints.

5. In **Moon surface navigation**, place at least two stops (3D picks, 2D terrain map clicks or `Add current Moon coordinate`). Zoom/center the 2D local map, select a route type and a slope limit, then click **Calculate Moon surface route**. The planner shows a light-blue path, distance, sampled ascent/descent, maximum sampled slope and travel-time estimate. Export CSV or lunar-coordinate GPX (generic GPX map programs may incorrectly locate these coordinates on Earth).

6. For an illustrative Earth–Moon spacecraft transfer, choose Earth coordinates via typo-tolerant **city search** or the 3D Earth globe, choose a Moon destination, set the departure date, choose **What matters most?**, and click **Calculate best Earth–Moon route**. Compare candidate departure orbit injection delta-V, transfer duration, sunlight and geometric Earth visibility. The cyan line is a sampled approximate two-body trajectory, NOT a flyable launch, lunar capture or landing solution.

7. To inspect lunar **sunlight and potential direct-to-Earth contact** windows, choose a Moon point, local Earth elevation threshold and date range; request real **JPL Horizons** ephemerides. Without NASA data, the controls show a clearly marked **PREVIEW** with simplified Sun/Moon motion. Actual received signal quality, relays and ground station scheduling are not computed.

## Sunlight and shadows

Earth and Moon are lit from the same distant Sun. At Solar System distances, their incoming sunlight directions are therefore nearly parallel; a tiny direction difference is physically expected rather than a lighting bug. Visible differences in surface illumination arise mainly from each body’s orientation, axial tilt and rotation at the selected time.

The Moon view shows the Sun direction and resulting illumination geometry. It is intended to make clear that the Sun—not a separate local light source—drives both Earth and Moon lighting.

## New in v7

- **Eight 3D planets**, 3D Sun and Moon; Saturn has rings, and planetary surfaces have selectable triangular wireframe overlays. Earth inherits the NASA-derived topography/bathymetry height mesh. Moon uses NASA LOLA terrain. **Other rocky, gas and ice planet surface undulations are procedural illustration, NOT measured NASA DEM elevations**. The Sun has a simulated photosphere/corona, **not a rocky elevation model**.
- **Planet orbits years ahead** from the [JPL approximate planetary elements](https://ssd.jpl.nasa.gov/planets/approx_pos.html) (Table 2a/2b). These positions are **approximate** and are published for 3000 BC through AD 3000; the date UI intentionally bounds use to AD 1800–2999. For precision use [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) or [NAIF/SPICE](https://naif.jpl.nasa.gov/naif/).
- **Time-dependent rotations** using approximate sidereal rotation periods and fixed axis tilts. These display *relative rotation* from an arbitrary J2000 phase; the actual absolute prime meridian, precession, lunar libration, gas-giant differential rotation, and evolving spin-axis orientation are **not modelled**. Earth's position in the approximate orbital model represents the Earth–Moon barycentre approximately; the Moon's distant-view orbit is simplified.
- **2-pixel click-versus-drag tolerance** for choosing bodies and map locations, helping avoid accidental selections when rotating the scene.
- **Lunar terrain routing** uses sampled LOLA altitudes and A* search over a local projected grid, comparing gentler slopes, shorter paths and direct great-circle reference lines. Multi-stop routes are limited to 750 km per leg; near the poles the solver uses a direct reference rather than misrepresenting a distorted projection. The data resolution is shown (e.g. global 4 px/degree ≈ 7.6 km/pixel at the lunar equator, or 16 px/degree ≈ 1.9 km/pixel). **No obstacles/rocks, soil or traction modelling**. All routes should be independently verified.
- **Maps-like 2D view** with local elevation shading, waypoint placement, zoom, centre and route overlay, alongside the original 3D route.
- **Guided Earth–Moon route choices**: balanced, fastest, least departure delta-V, and lighting. The model is still an Earth-centred two-body Lambert transfer with an approximate lunar orientation and arbitrary parking-orbit departure geometry; launch from the chosen city is not simulated.

## Accuracy, scale and long time spans

In the Earth–Moon–Sun True scale scene, a Moon radius of 1737.4 km maps to 2.5 scene units; the Earth mean radius is 6371 km and the Sun radius is 695700 km. In the whole Solar System True scale scene, 1 scene unit corresponds to **10 million km** for every body radius and distance; this is a separate scale to accommodate Neptune's orbit. In both true-scale scenes, visible apparent dimensions are affected by camera focus. Overview mode deliberately compresses distances and inflates the small objects: **never measure distances from Overview pixels**.

At a given UTC epoch, JPL approximate planetary elements provide long-range approximate planet positions and mean sidereal periods provide *illustrative* axial spins. For Moon-relative sunlight, libration and Earth contact estimates, use the locally requested JPL Horizons ephemerides for the selected short window. The PREVIEW fallback is a highly simplified periodic model; *neither future flight dates nor communication windows should be accepted from PREVIEW*. Horizons has additional error sources and limited accuracy outside its validated ephemeris ranges, so long-range dates need independent checking.

Lunar LOLA height surfaces are a 16-bit raster of ellipsoid/reference sphere deviations and are finite resolution. Contact at a Moon site is assessed by comparing NASA-based Sun/Earth azimuth/elevation against a sampled local horizon. It does NOT include actual communication link strength or scheduling. Surface route slope and travel times are similarly estimates from sampled terrain, not navigation guarantees.

## Source structure

| File | Role |
|---|---|
| `serve.py` | Local Python server: static files, NASA/USGS raster proxy and JPL Horizons endpoint |
| `static/index.html` | UI with bounded 3D canvas, 2D Moon map, route/planet/time controls |
| `static/app.js` | Three.js meshes, camera, scene selection, date updates, map route overlays |
| `static/solar-system-core.mjs` | NASA/JPL approximate planet elements; sidereal rotations; date jumps; route preferences |
| `static/moon-surface-core.mjs` | Lunar great-circle distances; multi-waypoint slope-weighted A*; estimates |
| `static/terrain-core.mjs` | NASA LOLA TIFF elevations, local horizon and illumination/contact estimates |
| `static/earth-route-core.mjs` | Preview Moon/Sun motion; approximate Moon orientation; Lambert flight-path survey |
| `static/route-core.mjs` | Route planning state, city/planet destinations, active route and route preferences |
| `static/mission-transfer-core.mjs` | Hohmann, bi-elliptic, Lambert and patched-conic swing-by transfer calculations |
| `static/sunlight-core.mjs` | Shared Sun-to-body light-direction geometry; documents the effectively parallel illumination at Earth and Moon |
| `static/scale-core.mjs` | Physical radii/scale; fuzzy city name matching |
| `tests/*.test.mjs` | Numerical tests, solar year jumps/rotations, terrain, route, transfer and sunlight-direction calculations |
| `browsertest/*.mjs` | Puppeteer-based browser integration checks |

## Development and tests

```powershell
# Start the local server
python serve.py

# Run JavaScript numerical and integration tests
npm.cmd run test:unit

# Run browser integration checks
npm.cmd run test:browser
```

The 3D viewer loads Three.js from a CDN and fetches LOLA, Earth imagery, DEM and JPL data over the internet. It **will not show the interactive 3D scene without access to the Three.js CDN**. All work stays on a localhost server; city search requests go to Nominatim/Photon through the local proxy.

## Test status

- Automated numerical tests for planetary positions/rotation, transfers and multi-stop surface route planning: **passed** (11/11).
- Browser integration checks for overview focus, route UI and the Three.js scene: **passed**.
- Chromium checks confirmed that all eight planet textures are requested and served successfully.
- Layout stability in Chromium at desktop, tablet and mobile widths: **passed**; the left control panel scrolls within its bounded desktop column.
- Native Windows operation and real-time NASA downloads still require checking on the target machine.

## Source acknowledgments

NASA [CGI Moon Kit / LOLA](https://svs.gsfc.nasa.gov/4720/), NASA [Blue Marble](https://svs.gsfc.nasa.gov/2915/), [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), [JPL approximate positions](https://ssd.jpl.nasa.gov/planets/approx_pos.html), [OpenStreetMap](https://www.openstreetmap.org/copyright), [Nominatim](https://nominatim.com/) and [Photon](https://github.com/komoot/photon).
