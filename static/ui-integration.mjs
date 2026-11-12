/**
 * ui-integration.mjs
 * Connects all UI panels and modules with robust lazy imports and event forwarding.
 */

let siteCompareInstance = null;
let sunEarthHorizonInstance = null;
let routeVisualizerInstance = null;
let hohmannDiagramInstance = null;
let planetInspectorInstance = null;

// Lazy load modules with try/catch
import('./site-compare-ui.mjs')
  .then(m => {
    if (typeof m.mountSiteCompareUI === 'function') {
      siteCompareInstance = m.mountSiteCompareUI(
        document.getElementById('site-compare-mount'),
        { getCurrentDate: () => new Date() }
      );
    }
  })
  .catch(e => console.warn('[ui-integration] site-compare', e));

import('./sun-earth-horizon.mjs')
  .then(m => {
    if (typeof m.mountSunEarthHorizon === 'function') {
      sunEarthHorizonInstance = m.mountSunEarthHorizon(
        document.getElementById('horizon-canvas'),
        { lat: 0, lon: 0, dateUTC: new Date() }
      );
    }
  })
  .catch(e => console.warn('[ui-integration] sun-earth-horizon', e));

import('./route-visualizer.mjs')
  .then(m => {
    if (typeof m.mountTemporalTimeline === 'function') {
      routeVisualizerInstance = m.mountTemporalTimeline(
        document.getElementById('temporal-mount'),
        { lat: 0, lon: 0, startUTC: new Date(Date.now() - 86400000), endUTC: new Date(Date.now() + 86400000) }
      );
    }
  })
  .catch(e => console.warn('[ui-integration] route-visualizer', e));

import('./hohmann-diagram.mjs')
  .then(m => {
    if (typeof m.mountHohmannDiagram === 'function') {
      hohmannDiagramInstance = m.mountHohmannDiagram(
        document.getElementById('hohmann-mount'),
        { getTransferResult: () => null, getRelativisticDrift: () => null }
      );
    }
  })
  .catch(e => console.warn('[ui-integration] hohmann-diagram', e));

import('./planet-real-controls.mjs')
  .then(m => {
    if (typeof m.createPlanetInspector === 'function') {
      planetInspectorInstance = m.createPlanetInspector(
        document.getElementById('planet-inspector'),
        (n, i) => console.log(n, i)
      );
    }
  })
  .catch(e => console.warn('[ui-integration] planet-real-controls', e));

// Global compare route handler
window.__onCompareRoute = function(siteIds) {
  console.log('compare route', siteIds);
};

// Forward 'datetimechange' event to all panels if update methods exist
window.addEventListener('datetimechange', e => {
  const dt = e.detail?.date || new Date();

  if (siteCompareInstance && typeof siteCompareInstance.update === 'function') {
    try { siteCompareInstance.update(dt); } catch (err) { console.warn(err); }
  }
  if (sunEarthHorizonInstance && typeof sunEarthHorizonInstance.update === 'function') {
    try { sunEarthHorizonInstance.update(dt); } catch (err) { console.warn(err); }
  }
  if (routeVisualizerInstance && typeof routeVisualizerInstance.update === 'function') {
    try { routeVisualizerInstance.update(dt); } catch (err) { console.warn(err); }
  }
  if (hohmannDiagramInstance && typeof hohmannDiagramInstance.update === 'function') {
    try { hohmannDiagramInstance.update(dt); } catch (err) { console.warn(err); }
  }
  if (planetInspectorInstance && typeof planetInspectorInstance.update === 'function') {
    try { planetInspectorInstance.update(dt); } catch (err) { console.warn(err); }
  }
});
