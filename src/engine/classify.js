// Deterministic classification of imported 3D geometry into urban classes.
// Input objects carry world-space triangles (Y up, as in glTF/three.js).
// Rules are ordered and each decision records its reason, so the user can see
// *why* an object was labelled and override it.
//
// Pipeline: (1) split merged meshes into connected components, (2) estimate
// ground level, (3) per-object features, (4) ordered rules, (5) build the
// engine site model (plan coordinates: x = X, y = −Z).

import { convexHull, polygonArea, minAreaRect, bbox } from './geom.js';

export const CLASSES = ['ground', 'building', 'road', 'tree', 'water', 'green', 'furniture'];

const NAME_RULES = [
  [/water|pond|lake|river|pool|fountain/i, 'water'],
  [/tree|plant|veg|foliage|leaf|leaves|canopy|shrub|bush|palm/i, 'tree'],
  [/road|street|lane|asphalt|carriage|highway|path|sidewalk|footpath/i, 'road'],
  [/lawn|grass|green|park|garden/i, 'green'],
  [/bench|seat|lamp|pole|bollard|kiosk|furniture|sign/i, 'furniture'],
  [/build|bldg|house|block|tower|facade|roof|wall|mass/i, 'building'],
  [/ground|terrain|land|site|plane|base|floor|topo|plot/i, 'ground'],
];

// Split one triangle soup into connected components (shared quantised vertices).
export function connectedComponents(pos, tol = 0.01) {
  const nTri = pos.length / 9;
  const key = (i) => `${Math.round(pos[i] / tol)},${Math.round(pos[i + 1] / tol)},${Math.round(pos[i + 2] / tol)}`;
  const parent = Int32Array.from({ length: nTri }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  const owner = new Map();
  for (let t = 0; t < nTri; t++) {
    for (let v = 0; v < 3; v++) {
      const k = key(t * 9 + v * 3);
      if (owner.has(k)) union(t, owner.get(k)); else owner.set(k, t);
    }
  }
  const groups = new Map();
  for (let t = 0; t < nTri; t++) {
    const r = find(t);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(t);
  }
  return [...groups.values()].map((tris) => {
    const out = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => out.set(pos.subarray(t * 9, t * 9 + 9), i * 9));
    return out;
  });
}

function objectFeatures(pos, groundY) {
  let minY = Infinity, maxY = -Infinity, area = 0, horiz = 0, up = 0, nEntropyBins = new Float64Array(8);
  const plan = [];
  for (let t = 0; t < pos.length; t += 9) {
    const ax = pos[t], ay = pos[t + 1], az = pos[t + 2];
    const bx = pos[t + 3], by = pos[t + 4], bz = pos[t + 5];
    const cx = pos[t + 6], cy = pos[t + 7], cz = pos[t + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const a = Math.hypot(nx, ny, nz) / 2;
    area += a;
    const ay_ = Math.abs(ny) / (2 * a || 1);
    if (ay_ > 0.9) { horiz += a; if (ny > 0) up += a; }
    // Normal direction histogram (azimuth octants) → entropy; foliage is isotropic.
    const oct = Math.floor(((Math.atan2(nz, nx) + Math.PI) / (2 * Math.PI)) * 8) % 8;
    nEntropyBins[oct] += a;
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      plan.push([x, -z]);
    }
  }
  let ent = 0;
  for (const v of nEntropyBins) if (v > 0) { const p = v / area; ent -= p * Math.log2(p); }
  const hull = convexHull(plan);
  const hullArea = polygonArea(hull);
  const rect = minAreaRect(plan);
  const perim = hull.reduce((s, p, i) => s + Math.hypot(hull[(i + 1) % hull.length][0] - p[0], hull[(i + 1) % hull.length][1] - p[1]), 0);
  return {
    minY, maxY,
    height: maxY - minY,
    base: minY - groundY,
    top: maxY - groundY,
    area, hull, hullArea,
    horizontalFrac: area ? horiz / area : 0,
    normalEntropy: ent, // 0..3 bits
    elongation: rect.length / Math.max(rect.width, 0.01),
    width: rect.width,
    circularity: perim ? (4 * Math.PI * hullArea) / (perim * perim) : 0,
    triCount: pos.length / 9,
    bbox: bbox(plan),
  };
}

export function classifyObjects(objects, opts = {}) {
  // (1) split merged meshes
  let items = [];
  for (const o of objects) {
    const comps = (opts.split ?? true) ? connectedComponents(o.positions) : [o.positions];
    comps.forEach((p, i) => items.push({ name: comps.length > 1 ? `${o.name}#${i}` : o.name, sourceName: o.name, positions: p }));
  }
  items = items.filter((it) => it.positions.length >= 9);

  // (2) ground level: area-weighted 5th percentile of vertex heights of
  // near-horizontal upward faces (robust to basements and plinths).
  const samples = [];
  for (const it of items) {
    const p = it.positions;
    for (let t = 0; t < p.length; t += 9) samples.push(Math.min(p[t + 1], p[t + 4], p[t + 7]));
  }
  samples.sort((a, b) => a - b);
  const groundY = samples.length ? samples[Math.floor(samples.length * 0.05)] : 0;

  // (3) features
  for (const it of items) it.f = objectFeatures(it.positions, groundY);
  const siteArea = polygonArea(convexHull(items.flatMap((it) => it.f.hull))) || 1;

  // (4) ordered rules
  for (const it of items) {
    const f = it.f;
    const byName = NAME_RULES.find(([re]) => re.test(it.sourceName || ''));
    let cls, reason, conf;
    if (f.height < 0.6 && f.hullArea > 0.25 * siteArea) {
      cls = 'ground'; reason = `flat (Δh ${f.height.toFixed(2)} m) and covers ${(100 * f.hullArea / siteArea).toFixed(0)} % of the site`; conf = 0.95;
    } else if (byName) {
      cls = byName[1]; reason = `name "${it.sourceName}" matches ${byName[1]}`; conf = 0.9;
    } else if (f.height < 0.6 && f.base < 1) {
      if (f.elongation > 3 && f.width < 30) { cls = 'road'; reason = `flat strip, elongation ${f.elongation.toFixed(1)}, width ${f.width.toFixed(1)} m`; conf = 0.75; }
      else { cls = 'ground'; reason = 'flat surface near ground level'; conf = 0.7; }
    } else if (f.top > 2.5 && f.hullArea < 200 && f.circularity > 0.55 && f.normalEntropy > 2.4 && f.horizontalFrac < 0.35) {
      cls = 'tree'; reason = `compact round crown (circularity ${f.circularity.toFixed(2)}), isotropic normals (${f.normalEntropy.toFixed(2)} bits)`; conf = 0.7;
    } else if (f.top >= 2.5) {
      cls = 'building'; reason = `solid ${f.top.toFixed(1)} m tall, footprint ${f.hullArea.toFixed(0)} m²`; conf = 0.8;
    } else {
      cls = 'furniture'; reason = `low object (${f.top.toFixed(1)} m)`; conf = 0.6;
    }
    Object.assign(it, { cls, reason, confidence: conf });
  }
  return { items, groundY };
}

// (5) Engine site model from classified items (class overrides allowed).
export function siteFromClassified({ items, groundY }, name = 'Imported model') {
  const site = { name, buildings: [], trees: [], roads: [], water: [], green: [], furniture: [], openSpaces: [], places: [] };
  const all = [];
  items.forEach((it, idx) => {
    const f = it.f;
    all.push(...f.hull);
    if (it.cls === 'building') {
      const tris = new Float32Array(it.positions.length);
      for (let i = 0; i < it.positions.length; i += 3) {
        tris[i] = it.positions[i];
        tris[i + 1] = -it.positions[i + 2];
        tris[i + 2] = it.positions[i + 1] - groundY;
      }
      site.buildings.push({ id: `m${idx}`, footprint: f.hull, height: f.top, tris, active: false, source: it.name });
    } else if (it.cls === 'tree') {
      const cx = (f.bbox.minX + f.bbox.maxX) / 2, cy = (f.bbox.minY + f.bbox.maxY) / 2;
      site.trees.push({ x: cx, y: cy, r: Math.max(1, Math.sqrt(f.hullArea / Math.PI)), h: f.top, base: Math.max(1.5, f.base), source: it.name });
    } else if (it.cls === 'road') site.roads.push({ id: `m${idx}`, polygon: f.hull });
    else if (it.cls === 'water') site.water.push({ id: `m${idx}`, polygon: f.hull });
    else if (it.cls === 'green') site.green.push({ id: `m${idx}`, polygon: f.hull });
    else if (it.cls === 'furniture') {
      const cx = (f.bbox.minX + f.bbox.maxX) / 2, cy = (f.bbox.minY + f.bbox.maxY) / 2;
      site.furniture.push({ x: cx, y: cy, kind: 'furniture' });
    }
  });
  const b = bbox(all.length ? all : [[0, 0], [1, 1]]);
  const pad = 10;
  site.bounds = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
  return site;
}
