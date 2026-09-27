// OpenStreetMap (Overpass JSON) → engine site model, in local metres around
// a centre point. Used for the study-site pipeline (measuring the physical
// condition of places researched in the corpus) and reusable for importing
// any real place.
//
// Heights: `height` tag, else `building:levels` × 3.2 m (+ `roof:levels`),
// else an estimate (3 storeys; 1 for sheds/garages/kiosks) flagged as such.

const LEVEL_H = 3.2;
const LOW = new Set(['garage', 'garages', 'shed', 'kiosk', 'hut', 'carport', 'roof', 'service', 'toilets']);
const WIDTH = { motorway: 20, trunk: 16, primary: 14, secondary: 12, tertiary: 10, unclassified: 7, residential: 6, living_street: 4, service: 4, pedestrian: 6, footway: 3, path: 2.5, cycleway: 2.5, steps: 2.5 };
const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const GREEN = { leisure: ['park', 'garden', 'playground', 'pitch'], landuse: ['grass', 'meadow', 'recreation_ground', 'village_green', 'forest'], natural: ['wood', 'scrub', 'grassland'] };
const ACTIVE_BUILDING = new Set(['retail', 'commercial', 'shop', 'kiosk', 'supermarket']);

function num(v) {
  if (v === undefined || v === null) return NaN;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

export function buildingHeight(tags = {}) {
  const h = num(tags.height) || num(tags['building:height']);
  if (h > 0) return { h, estimated: false };
  const lv = num(tags['building:levels']);
  if (lv > 0) return { h: (lv + (num(tags['roof:levels']) || 0) * 0.5) * LEVEL_H, estimated: false };
  if (LOW.has(tags.building)) return { h: LEVEL_H, estimated: true };
  return { h: 3 * LEVEL_H, estimated: true };
}

export function siteFromOverpass(json, { lat, lon, radius = 200, name = 'OSM site' } = {}) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  const P = (la, lo) => [+((lo - lon) * kx).toFixed(2), +((la - lat) * ky).toFixed(2)];
  const nodes = new Map();
  const ways = new Map();
  for (const e of json.elements || []) {
    if (e.type === 'node') nodes.set(e.id, e);
    else if (e.type === 'way') ways.set(e.id, e);
  }
  const ring = (w) => {
    const pts = [];
    for (const id of w.nodes || []) { const n = nodes.get(id); if (n) pts.push(P(n.lat, n.lon)); }
    if (pts.length > 3 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    return pts;
  };
  const activePts = [];
  for (const n of nodes.values()) if (n.tags && (n.tags.shop || ['restaurant', 'cafe', 'fast_food', 'bar', 'marketplace', 'bank', 'pharmacy'].includes(n.tags.amenity))) activePts.push(P(n.lat, n.lon));

  const site = { name, origin: { lat, lon }, buildings: [], roads: [], trees: [], water: [], green: [], woods: [], openSpaces: [], places: [] };
  let tagged = 0;
  const addPoly = (tags, pts, id) => {
    if (pts.length < 3) return;
    if (tags.building && tags.building !== 'no') {
      const { h, estimated } = buildingHeight(tags);
      if (!estimated) tagged++;
      site.buildings.push({ id: `w${id}`, footprint: pts, height: h, heightEstimated: estimated, active: ACTIVE_BUILDING.has(tags.building) || !!tags.shop || !!tags.amenity });
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank' || tags.water) site.water.push({ polygon: pts });
    else if (tags.natural === 'wood' || tags.landuse === 'forest') site.woods.push({ polygon: pts });
    else if (Object.entries(GREEN).some(([k, vals]) => vals.includes(tags[k]))) site.green.push({ polygon: pts, kind: tags.leisure || tags.landuse || tags.natural });
  };
  for (const w of ways.values()) {
    const tags = w.tags || {};
    if (tags.natural === 'tree_row') {
      // Tree rows: one tree every 8 m along the line.
      const line = (w.nodes || []).map((id) => nodes.get(id)).filter(Boolean).map((n) => P(n.lat, n.lon));
      for (let i = 0; i < line.length - 1; i++) {
        const [x1, y1] = line[i], [x2, y2] = line[i + 1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        for (let t = 0; t < len; t += 8) site.trees.push({ x: x1 + ((x2 - x1) * t) / len, y: y1 + ((y2 - y1) * t) / len, r: 3, h: 8 });
      }
      continue;
    }
    if (tags.highway) {
      const line = [];
      for (const id of w.nodes || []) { const n = nodes.get(id); if (n) line.push(P(n.lat, n.lon)); }
      if (line.length > 1) site.roads.push({ id: `w${w.id}`, line, width: num(tags.width) || WIDTH[tags.highway] || 5, main: MAIN.has(tags.highway), name: tags.name });
    } else addPoly(tags, ring(w), w.id);
  }
  for (const e of json.elements || []) {
    if (e.type !== 'relation' || !e.tags) continue;
    // Multipolygon buildings / parks: use the outer members.
    for (const m of e.members || []) {
      if (m.type !== 'way' || m.role !== 'outer') continue;
      const w = ways.get(m.ref);
      if (w) addPoly(e.tags, ring(w), `${e.id}_${m.ref}`);
    }
  }
  for (const n of nodes.values()) {
    if (n.tags?.natural === 'tree') { const [x, y] = P(n.lat, n.lon); site.trees.push({ x, y, r: 3, h: num(n.tags.height) || 8 }); }
  }
  // Point POIs mark the nearest building (within 6 m) as active frontage.
  for (const [x, y] of activePts) {
    let best = null, bd = 36;
    for (const b of site.buildings) {
      const [bx, by] = b.footprint[0];
      const d = (bx - x) ** 2 + (by - y) ** 2;
      if (d < bd * 10) {
        for (const [px, py] of b.footprint) { const dd = (px - x) ** 2 + (py - y) ** 2; if (dd < bd) { bd = dd; best = b; } }
      }
    }
    if (best) best.active = true;
  }
  site.bounds = { minX: -radius, minY: -radius, maxX: radius, maxY: radius };
  site.quality = {
    buildings: site.buildings.length,
    heightTagged: site.buildings.length ? tagged / site.buildings.length : 0,
    trees: site.trees.length,
    greenPolygons: site.green.length,
    woods: site.woods.length,
    roads: site.roads.length,
  };
  return site;
}

export function overpassQuery(lat, lon, radius = 200) {
  const a = `(around:${radius},${lat},${lon})`;
  return `[out:json][timeout:60];(way["natural"="tree_row"]${a};way["building"]${a};relation["building"]${a};way["highway"]${a};node["natural"="tree"]${a};` +
    `way["leisure"]${a};way["landuse"]${a};way["natural"]${a};relation["leisure"]${a};node["shop"]${a};node["amenity"]${a};);out body;>;out skel qt;`;
}
