// Quantitative spatial parameters, computed per sample point by ray marching the
// 2.5D raster. Each metric follows a published operationalisation (see
// research/RESEARCH.md for the source list); the implementation is a fast,
// deterministic approximation meant for design exploration, not code compliance.

import { CLS, cellCenter } from './raster.js';

export const EYE = 1.6; // m, eye height
export const DEG = Math.PI / 180;

// Site climate defaults: Ahmedabad (23.03 N), hot semi-arid (BSh).
export const CLIMATE = {
  lat: 23.03,
  day: 111, // 21 April, pre-monsoon design day
  hours: [9, 12, 15, 17], // local solar time
  airTemp: 40, // °C, typical April afternoon
  windDir: 225, // deg, prevailing SW (meteorological: wind FROM)
  windRef: 4.0, // m/s at 10 m
};

// Feature vector definition: order matters for the tree model.
export const FEATURES = [
  { key: 'isovistArea', label: 'Isovist area', unit: 'm²', range: [0, 8000] },
  { key: 'openness', label: 'Isovist openness', unit: '0–1', range: [0, 1] },
  { key: 'roundness', label: 'Isovist roundness', unit: '0–1', range: [0, 1] },
  { key: 'jaggedness', label: 'Isovist jaggedness P²/A', unit: '', range: [12, 200] },
  { key: 'occlusions', label: 'Occluding edges (vistas)', unit: 'count', range: [0, 30] },
  { key: 'enclosureHW', label: 'Enclosure H/W', unit: 'ratio', range: [0, 5] },
  { key: 'svf', label: 'Sky view factor', unit: '0–1', range: [0, 1] },
  { key: 'gvi', label: 'Green view index', unit: '0–1', range: [0, 0.6] },
  { key: 'shade', label: 'Solar shade (design day)', unit: '0–1', range: [0, 1] },
  { key: 'utci', label: 'UTCI estimate', unit: '°C', range: [25, 55] },
  { key: 'wind', label: 'Pedestrian wind (mean)', unit: 'm/s', range: [0, 6] },
  { key: 'bcr', label: 'Ground coverage (50 m)', unit: '0–1', range: [0, 1] },
  { key: 'meanHeight', label: 'Mean building height (50 m)', unit: 'm', range: [0, 40] },
  { key: 'edgeDist', label: 'Distance to nearest edge', unit: 'm', range: [0, 50] },
  { key: 'activeFrontage', label: 'Visible active frontage', unit: '0–1', range: [0, 1] },
  { key: 'seating', label: 'Seats within 15 m', unit: 'count', range: [0, 30] },
  { key: 'waterView', label: 'Water in view', unit: '0–1', range: [0, 1] },
  { key: 'skylineVar', label: 'Skyline variation', unit: 'deg', range: [0, 30] },
  { key: 'roadDist', label: 'Distance to carriageway', unit: 'm', range: [0, 60] },
];
export const FEATURE_KEYS = FEATURES.map((f) => f.key);

// ---------------------------------------------------------------------------
// Sun position (NOAA simplified) for solar time.
export function sunPosition(lat, day, solarHour) {
  const decl = 23.45 * Math.sin(DEG * (360 / 365) * (284 + day)) * DEG;
  const hourAngle = (solarHour - 12) * 15 * DEG;
  const phi = lat * DEG;
  const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(hourAngle);
  const alt = Math.asin(sinAlt);
  let az = Math.acos(Math.max(-1, Math.min(1, (Math.sin(decl) - Math.sin(alt) * Math.sin(phi)) / (Math.cos(alt) * Math.cos(phi)))));
  if (hourAngle > 0) az = 2 * Math.PI - az; // azimuth from north, clockwise
  return { alt, az };
}

// ---------------------------------------------------------------------------
// Ray march helpers

function rayIsovist(g, x, y, ang, maxR) {
  // 2D eye-level isovist ray: stops at opaque obstacles taller than eye.
  const step = g.cell * 0.5;
  const dx = Math.sin(ang), dy = Math.cos(ang);
  const out = { dist: maxR, hitK: -1, hitH: 0, green: 0, water: false };
  let lastCanopy = -1;
  for (let d = step; d <= maxR; d += step) {
    const px = x + dx * d, py = y + dy * d;
    const i = Math.floor((px - g.x0) / g.cell), j = Math.floor((py - g.y0) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) { out.dist = d; out.edge = true; return out; }
    const k = j * g.nx + i;
    if (g.h[k] > EYE) { out.dist = d; out.hitK = k; out.hitH = g.h[k]; return out; }
    if (g.canopyTop[k] > 0 && g.cls[k] === CLS.TREE && k !== lastCanopy) {
      // Vertical angular extent of the crown inside a -10°..+60° field of view,
      // i.e. the share of this viewing direction filled by foliage (GVI, Li et al. 2015).
      const top = Math.min(Math.atan2(g.canopyTop[k] - EYE, d), 60 * DEG);
      const bot = Math.max(Math.atan2(g.canopyBase[k] - EYE, d), -10 * DEG);
      const cov = Math.max(0, top - bot) / (70 * DEG);
      if (cov > out.green) out.green = cov;
      lastCanopy = k;
    }
    if (g.cls[k] === CLS.GREEN && d < 20) out.green = Math.max(out.green, 0.08 * (1 - d / 20));
    if (g.cls[k] === CLS.WATER && d < 60) out.water = true;
  }
  return out;
}

function horizonAngle(g, x, y, ang, maxR, canopyWeight = 0.6) {
  const step = g.cell * 0.75;
  const dx = Math.sin(ang), dy = Math.cos(ang);
  let best = 0;
  for (let d = step; d <= maxR; d += step) {
    const px = x + dx * d, py = y + dy * d;
    const i = Math.floor((px - g.x0) / g.cell), j = Math.floor((py - g.y0) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) break;
    const k = j * g.nx + i;
    let top = g.h[k];
    if (g.canopyTop[k] > top) top = Math.max(top, g.canopyTop[k] * canopyWeight + top * (1 - canopyWeight));
    if (top > EYE) {
      const a = Math.atan2(top - EYE, d);
      if (a > best) best = a;
    }
  }
  return best;
}

function sunBlocked(g, x, y, sun) {
  // Returns transmissivity along the sun ray (1 = full sun).
  if (sun.alt <= 0) return 0;
  const step = g.cell * 0.5;
  const dx = Math.sin(sun.az), dy = Math.cos(sun.az);
  const tanAlt = Math.tan(sun.alt);
  let trans = 1;
  let lastK = -1;
  for (let d = 0; d <= 120; d += step) {
    const z = EYE + d * tanAlt;
    if (z > 60) break;
    const px = x + dx * d, py = y + dy * d;
    const i = Math.floor((px - g.x0) / g.cell), j = Math.floor((py - g.y0) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) break;
    const k = j * g.nx + i;
    if (k === lastK) continue;
    lastK = k;
    if (g.h[k] >= z) return 0;
    if (g.canopyTop[k] >= z && g.canopyBase[k] <= z + step * tanAlt) trans *= g.canopyTrans[k];
    if (trans < 0.05) return trans;
  }
  return trans;
}

function windAt(g, x, y, climate) {
  // Sheltering model: an obstacle of height H sheds a wake ~ 5H long (Oke 1988;
  // Hunter et al. 1992 skimming/wake interference). Speed at pedestrian height
  // from the log/power profile (alpha ~ 0.3 for dense urban terrain).
  const uPed = climate.windRef * Math.pow(EYE / 10, 0.3);
  const from = climate.windDir * DEG; // direction wind comes FROM
  const dx = Math.sin(from), dy = Math.cos(from);
  let shelter = 0;
  const step = g.cell;
  for (let d = step; d <= 150; d += step) {
    const px = x + dx * d, py = y + dy * d;
    const i = Math.floor((px - g.x0) / g.cell), j = Math.floor((py - g.y0) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) break;
    const k = j * g.nx + i;
    const H = g.h[k];
    if (H > 0.5) shelter = Math.max(shelter, 1 - d / (5 * H));
    if (g.canopyTop[k] > 2) shelter = Math.max(shelter, 0.4 * (1 - d / (5 * g.canopyTop[k])));
  }
  // Channelling: narrow gap perpendicular to the wind accelerates flow (Venturi).
  const px = Math.cos(from), py = -Math.sin(from);
  let left = 0, right = 0;
  for (let d = step; d < 40; d += step) {
    const k = cellAt(g, x + px * d, y + py * d);
    if (k < 0 || g.h[k] > EYE) { left = d; break; }
  }
  for (let d = step; d < 40; d += step) {
    const k = cellAt(g, x - px * d, y - py * d);
    if (k < 0 || g.h[k] > EYE) { right = d; break; }
  }
  const gap = (left || 40) + (right || 40);
  const channel = gap < 30 && left && right ? 1 + 0.3 * (1 - gap / 30) : 1;
  return uPed * (1 - 0.85 * shelter) * channel;
}

function cellAt(g, x, y) {
  const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return -1;
  return j * g.nx + i;
}

// Simplified UTCI screening estimate for hot-dry conditions.
// Direct sun raises UTCI by ~10 K over shade in Indian field studies
// (e.g. Mehta, Rawal & Shukla 2024, Ahmedabad CBD; Kumar & Sharma 2021).
// Long-wave exposure scales with SVF; each m/s of breeze above 0.5 m/s gives
// ~1.2 K relief, saturating at 4 m/s (Bröde et al. 2012 UTCI regression shape).
export function utciEstimate(airTemp, shade, svf, wind) {
  const sun = 10 * (1 - shade);
  const lw = 2.5 * svf;
  const w = Math.min(Math.max(wind - 0.5, 0), 3.5) * 1.2;
  return airTemp - 6 + sun + lw - w; // -6: shaded, sheltered reference offset (Tmrt≈Ta)
}

// ---------------------------------------------------------------------------

export function pointMetrics(g, x, y, opts = {}) {
  const rays = opts.rays || 48;
  const maxR = opts.maxR || 100;
  const climate = opts.climate || CLIMATE;
  const sunPos = opts.sun || CLIMATE.hours.map((h) => sunPosition(climate.lat, climate.day, h));

  const dists = new Float32Array(rays);
  let area = 0, green = 0, water = 0, openRays = 0, activeHits = 0, bldHits = 0;
  const hitH = new Float32Array(rays);
  const dTheta = (2 * Math.PI) / rays;
  for (let r = 0; r < rays; r++) {
    const ang = r * dTheta;
    const res = rayIsovist(g, x, y, ang, maxR);
    dists[r] = res.dist;
    hitH[r] = res.hitH;
    area += 0.5 * res.dist * res.dist * dTheta;
    green += res.green;
    if (res.water) water++;
    if (res.hitK < 0) openRays++;
    else if (res.dist < 40) {
      bldHits++;
      if (g.active[res.hitK]) activeHits++;
    }
  }
  let perim = 0, occl = 0, minD = Infinity;
  for (let r = 0; r < rays; r++) {
    const a = dists[r], b = dists[(r + 1) % rays];
    perim += Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(dTheta));
    if (Math.abs(a - b) > Math.max(4, 0.35 * Math.min(a, b))) occl++;
    if (a < minD) minD = a;
  }

  // Enclosure H/W across the narrowest cross-section (Ewing & Handy 2009;
  // Yilmaz et al. 2025 use H/W 0.5–4). Width = d(θ)+d(θ+π); H = mean of hits.
  let hw = 0;
  let minW = Infinity;
  for (let r = 0; r < rays / 2; r++) {
    const w = dists[r] + dists[r + rays / 2];
    if (w < minW) {
      minW = w;
      const hs = [hitH[r], hitH[r + rays / 2]].filter((v) => v > 0);
      hw = hs.length ? hs.reduce((s, v) => s + v, 0) / hs.length / Math.max(w, 1) : 0;
    }
  }

  // Sky view factor from 16 horizon angles: SVF = 1 - mean(sin² β).
  const nH = 16;
  let svfSum = 0;
  const hor = [];
  for (let r = 0; r < nH; r++) {
    const b = horizonAngle(g, x, y, (r * 2 * Math.PI) / nH, 100);
    hor.push(b / DEG);
    svfSum += Math.sin(b) ** 2;
  }
  const svf = 1 - svfSum / nH;
  const horMean = hor.reduce((s, v) => s + v, 0) / nH;
  const skylineVar = Math.sqrt(hor.reduce((s, v) => s + (v - horMean) ** 2, 0) / nH);

  let sunTrans = 0;
  for (const s of sunPos) sunTrans += sunBlocked(g, x, y, s);
  const shade = 1 - sunTrans / sunPos.length;

  const wind = windAt(g, x, y, climate);
  const utci = utciEstimate(climate.airTemp, shade, svf, wind);

  // Neighbourhood density within 50 m, seats within 15 m, road distance.
  const R = 50, R2 = R * R;
  const ci = Math.floor((x - g.x0) / g.cell), cj = Math.floor((y - g.y0) / g.cell);
  const rc = Math.ceil(R / g.cell);
  let cells = 0, bcells = 0, hsum = 0, seats = 0, roadD2 = Infinity;
  for (let j = cj - rc; j <= cj + rc; j++) {
    if (j < 0 || j >= g.ny) continue;
    for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || i >= g.nx) continue;
      const [cx, cy] = cellCenter(g, i, j);
      const d2 = (cx - x) ** 2 + (cy - y) ** 2;
      if (d2 > R2) continue;
      const k = j * g.nx + i;
      cells++;
      if (g.cls[k] === CLS.BUILDING) { bcells++; hsum += g.h[k]; }
      if (g.seat[k] && d2 <= 225) seats += g.seat[k];
      if (g.cls[k] === CLS.ROAD && d2 < roadD2) roadD2 = d2;
    }
  }

  return {
    isovistArea: area,
    openness: openRays / rays,
    roundness: Math.min(1, (4 * Math.PI * area) / (perim * perim || 1)),
    jaggedness: (perim * perim) / Math.max(area, 1),
    occlusions: occl,
    enclosureHW: Math.min(hw, 5),
    svf,
    gvi: Math.min(0.6, (green / rays) * 0.85), // 0.85 foliage density
    shade,
    utci,
    wind,
    bcr: cells ? bcells / cells : 0,
    meanHeight: bcells ? hsum / bcells : 0,
    edgeDist: Math.min(minD, 50),
    activeFrontage: bldHits ? activeHits / bldHits : 0,
    seating: seats,
    waterView: water / rays,
    skylineVar,
    roadDist: Math.min(Math.sqrt(roadD2), 60),
  };
}

// Sample points: open (walkable) cells inside a mask, on a stride.
export function samplePoints(g, mask, stride = 2) {
  const pts = [];
  for (let j = 0; j < g.ny; j += stride) {
    for (let i = 0; i < g.nx; i += stride) {
      const k = j * g.nx + i;
      if (mask && !mask[k]) continue;
      const c = g.cls[k];
      if (c === CLS.BUILDING || c === CLS.WATER || g.h[k] > EYE) continue;
      const [x, y] = cellCenter(g, i, j);
      pts.push({ k, x, y });
    }
  }
  return pts;
}

export function aggregate(list) {
  const out = {};
  for (const key of FEATURE_KEYS) {
    let s = 0;
    for (const m of list) s += m[key];
    out[key] = list.length ? s / list.length : 0;
  }
  return out;
}

export function toVector(m) {
  return FEATURE_KEYS.map((k) => m[k]);
}

export function lawsonClass(meanWind) {
  // Lawson (2001) thresholds apply to 5 % exceedance speeds; for a Weibull
  // climate U5% ≈ 1.8 × mean (assumption, documented in RESEARCH.md).
  const u5 = meanWind * 1.8;
  if (u5 < 4) return 'sitting';
  if (u5 < 6) return 'standing';
  if (u5 < 8) return 'strolling';
  if (u5 < 10) return 'walking';
  return 'uncomfortable';
}

export function utciClass(t) {
  if (t > 46) return 'extreme heat stress';
  if (t > 38) return 'very strong heat stress';
  if (t > 32) return 'strong heat stress';
  if (t > 26) return 'moderate heat stress';
  if (t >= 9) return 'no thermal stress';
  return 'cold stress';
}
