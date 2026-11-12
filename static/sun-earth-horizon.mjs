/**
 * sun-earth-horizon.mjs
 * Renders a 180-degree panorama semi-circle canvas showing Sun and Earth elevation/azimuth,
 * horizon grid (0, 30, 60, 90 deg), and countdown/status info below the canvas.
 */

let currentCanvas = null;
let currentCtx = null;
let currentConfig = null;

export function mountSunEarthHorizon(canvasEl, { lat, lon, dateUTC, terrain } = {}) {
  currentCanvas = canvasEl;
  if (!currentCanvas) return;

  if (!currentCanvas.width || currentCanvas.width === 300) {
    currentCanvas.width = 600;
  }
  if (!currentCanvas.height || currentCanvas.height === 150) {
    currentCanvas.height = 200;
  }

  currentCtx = currentCanvas.getContext("2d");
  currentConfig = { lat: lat || 0, lon: lon || 0, dateUTC: dateUTC ? new Date(dateUTC) : new Date(), terrain: terrain || null };

  let statusDiv = document.getElementById("horizon-status");
  if (!statusDiv) {
    statusDiv = document.createElement("div");
    statusDiv.id = "horizon-status";
    statusDiv.style.cssText = "font-family: monospace; font-size: 12px; color: #a0aec0; margin-top: 4px; text-align: center;";
    if (currentCanvas.parentNode) {
      currentCanvas.parentNode.insertBefore(statusDiv, currentCanvas.nextSibling);
    }
  }

  renderHorizon();
}

export function updateSunEarthHorizon({ lat, lon, dateUTC } = {}) {
  if (lat !== undefined) currentConfig.lat = lat;
  if (lon !== undefined) currentConfig.lon = lon;
  if (dateUTC !== undefined) currentConfig.dateUTC = new Date(dateUTC);
  renderHorizon();
}

export function destroySunEarthHorizon() {
  currentCanvas = null;
  currentCtx = null;
  currentConfig = null;
  const statusDiv = document.getElementById("horizon-status");
  if (statusDiv) {
    statusDiv.remove();
  }
}

function calculateCelestialBody(time, lat, lon, bodyType) {
  const hours = time.getUTCHours() + time.getUTCMinutes() / 60;
  const dayOfYear = Math.floor((time - new Date(time.getUTCFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));

  let baseAzimuth = 0;
  let baseElevation = 0;

  if (bodyType === "sun") {
    baseAzimuth = (hours / 24) * 360 + lon;
    const declination = 23.44 * Math.sin(((dayOfYear - 80) / 365) * 2 * Math.PI);
    baseElevation = Math.max(-90, Math.min(90, 45 + declination - Math.abs(lat) + 30 * Math.cos((hours / 24) * 2 * Math.PI)));
  } else {
    baseAzimuth = ((hours / 24) * 360 + lon + 180) % 360;
    baseElevation = Math.max(-90, Math.min(90, 60 - Math.abs(lat) * 0.5 + 15 * Math.sin((hours / 12) * 2 * Math.PI)));
  }

  return { azimuth: baseAzimuth % 360, elevation: baseElevation };
}

function findEventTime(currentTime, lat, lon, bodyType) {
  let testTime = new Date(currentTime.getTime());
  const startEval = calculateCelestialBody(testTime, lat, lon, bodyType).elevation;
  const isCircumpolar = startEval > 0;

  if (isCircumpolar) {
    let sets = false;
    for (let m = 1; m <= 2880; m++) {
      const t = new Date(currentTime.getTime() + m * 60000);
      if (calculateCelestialBody(t, lat, lon, bodyType).elevation < 0) {
        sets = true;
        break;
      }
    }
    if (!sets) return { zirkumpolar: true };
  }

  for (let m = 1; m <= 2880; m++) {
    const t = new Date(currentTime.getTime() + m * 60000);
    const el = calculateCelestialBody(t, lat, lon, bodyType).elevation;
    if (el <= 0) {
      return { hours: Math.floor(m / 60), minutes: m % 60 };
    }
  }
  return { zirkumpolar: true };
}

function renderHorizon() {
  if (!currentCanvas || !currentCtx || !currentConfig) return;

  const width = currentCanvas.width;
  const height = currentCanvas.height;
  const ctx = currentCtx;

  ctx.clearRect(0, 0, width, height);

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, "#0a0e17");
  grad.addColorStop(1, "#1b2a4a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  const centerX = width / 2;
  const centerY = height - 20;
  const radius = Math.min(width * 0.45, height - 30);

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, Math.PI, 2 * Math.PI, false);
  ctx.closePath();
  ctx.clip();

  [0, 30, 60, 90].forEach(deg => {
    const r = radius * (1 - deg / 90);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = deg === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, r, Math.PI, 2 * Math.PI, false);
    ctx.stroke();

    if (deg > 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = "10px monospace";
      ctx.fillText(deg + "°", centerX + 5, centerY - r);
    }
  });

  [-90, -45, 0, 45, 90].forEach(azOffset => {
    const angle = Math.PI + (azOffset + 90) * (Math.PI / 180);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
    ctx.stroke();
  });

  const sun = calculateCelestialBody(currentConfig.dateUTC, currentConfig.lat, currentConfig.lon, "sun");
  const earth = calculateCelestialBody(currentConfig.dateUTC, currentConfig.lat, currentConfig.lon, "earth");

  if (sun.elevation >= 0) {
    const sunR = radius * (1 - sun.elevation / 90);
    const sunAngle = Math.PI + ((sun.azimuth % 180) / 180) * Math.PI;
    const sx = centerX + sunR * Math.cos(sunAngle);
    const sy = centerY + sunR * Math.sin(sunAngle);

    ctx.fillStyle = "#f5c542";
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "11px monospace";
    ctx.fillText("Sonne (" + sun.elevation.toFixed(1) + "°)", sx + 8, sy - 4);
  }

  if (earth.elevation >= 0) {
    const earthR = radius * (1 - earth.elevation / 90);
    const earthAngle = Math.PI + ((earth.azimuth % 180) / 180) * Math.PI;
    const ex = centerX + earthR * Math.cos(earthAngle);
    const ey = centerY + earthR * Math.sin(earthAngle);

    ctx.fillStyle = "#4a90d9";
    ctx.beginPath();
    ctx.arc(ex, ey, 6, 0, 2 * Math.PI);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "11px monospace";
    ctx.fillText("Erde (" + earth.elevation.toFixed(1) + "°)", ex + 8, ey - 4);
  }

  ctx.restore();

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(centerX - radius - 10, centerY);
  ctx.lineTo(centerX + radius + 10, centerY);
  ctx.stroke();

  const sunEvent = findEventTime(currentConfig.dateUTC, currentConfig.lat, currentConfig.lon, "sun");
  const earthEvent = findEventTime(currentConfig.dateUTC, currentConfig.lat, currentConfig.lon, "earth");

  const sunText = sunEvent.zirkumpolar ? "Sonne zirkumpolar (kein Untergang in 48 h)" : "Sonnenuntergang in " + sunEvent.hours + " h " + sunEvent.minutes + " m";
  const earthText = earthEvent.zirkumpolar ? "Erde zirkumpolar (kein Earthset in 48 h)" : "Earthset in " + earthEvent.hours + " h " + earthEvent.minutes + " m";

  const statusDiv = document.getElementById("horizon-status");
  if (statusDiv) {
    statusDiv.textContent = sunText + " | " + earthText + " | Aktuelle Sonnenhöhe: " + sun.elevation.toFixed(1) + "°";
  }
}