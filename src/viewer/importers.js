// File importers → classifier input ({ name, positions: Float32Array world
// triangles, Y up }) or, for GeoJSON, a site model directly.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { bbox } from '../engine/geom.js';

function objectsFromThree(root, zUp = false) {
  root.updateMatrixWorld(true);
  const out = [];
  const rot = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (zUp) g.applyMatrix4(rot);
    const pos = g.attributes.position.array;
    out.push({ name: o.name || o.parent?.name || o.material?.name || 'mesh', positions: Float32Array.from(pos) });
  });
  return out;
}

// Heuristic: CAD exports (Rhino/SketchUp OBJ, STL) are often Z-up. If the
// vertical (Y) extent is much larger than the Z extent, rotate.
function looksZUp(objects) {
  let minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const o of objects) {
    const p = o.positions;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] < minY) minY = p[i + 1]; if (p[i + 1] > maxY) maxY = p[i + 1];
      if (p[i + 2] < minZ) minZ = p[i + 2]; if (p[i + 2] > maxZ) maxZ = p[i + 2];
    }
  }
  return maxY - minY > 3 * (maxZ - minZ);
}

// Metre scale check: models in millimetres/centimetres are rescaled.
function normaliseUnits(objects) {
  let min = Infinity, max = -Infinity;
  for (const o of objects) for (let i = 0; i < o.positions.length; i += 3) { const x = o.positions[i]; if (x < min) min = x; if (x > max) max = x; }
  const span = max - min;
  const scale = span > 20000 ? 0.001 : span > 5000 ? 0.01 : 1;
  if (scale !== 1) for (const o of objects) for (let i = 0; i < o.positions.length; i++) o.positions[i] *= scale;
  return scale;
}

export async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'geojson' || ext === 'json') {
    const json = JSON.parse(await file.text());
    if (json.buildings && json.bounds) return { site: json }; // native site file
    return { site: siteFromGeoJSON(json, file.name) };
  }
  const buf = await file.arrayBuffer();
  let objects;
  if (ext === 'glb' || ext === 'gltf') {
    const gltf = await new GLTFLoader().parseAsync(buf, '');
    objects = objectsFromThree(gltf.scene);
  } else if (ext === 'obj') {
    const root = new OBJLoader().parse(new TextDecoder().decode(buf));
    objects = objectsFromThree(root);
  } else if (ext === 'stl') {
    const geo = new STLLoader().parse(buf);
    objects = objectsFromThree(new THREE.Mesh(geo));
  } else {
    throw new Error(`Unsupported file type .${ext} (use .glb, .gltf, .obj, .stl or .geojson)`);
  }
  if (looksZUp(objects)) {
    for (const o of objects) {
      const p = o.positions;
      for (let i = 0; i < p.length; i += 3) { const y = p[i + 1], z = p[i + 2]; p[i + 1] = z; p[i + 2] = -y; }
    }
  }
  const scale = normaliseUnits(objects);
  return { objects, scale };
}

// GeoJSON (OSM export, QGIS, etc.): polygons with height/levels → buildings,
// highway lines → roads, natural=tree points → trees, water/park polygons.
export function siteFromGeoJSON(gj, name = 'GeoJSON site') {
  const feats = gj.type === 'FeatureCollection' ? gj.features : [gj];
  const coords = [];
  const walk = (c) => (typeof c[0] === 'number' ? coords.push(c) : c.forEach(walk));
  feats.forEach((f) => f.geometry && walk(f.geometry.coordinates));
  const geographic = coords.every(([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90);
  const b0 = bbox(coords);
  const lat0 = (b0.minY + b0.maxY) / 2, lon0 = (b0.minX + b0.maxX) / 2;
  const kx = geographic ? 111320 * Math.cos((lat0 * Math.PI) / 180) : 1, ky = geographic ? 110540 : 1;
  const P = ([x, y]) => (geographic ? [(x - lon0) * kx, (y - lat0) * ky] : [x - lon0, y - lat0]);
  const site = { name, origin: geographic ? { lat: lat0, lon: lon0 } : null, buildings: [], roads: [], trees: [], water: [], green: [], openSpaces: [], places: [] };
  const MAIN = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
  const WIDTH = { primary: 14, secondary: 12, tertiary: 10, residential: 6, living_street: 4, service: 4, footway: 3, pedestrian: 6, path: 2.5 };
  for (const f of feats) {
    const g = f.geometry, p = f.properties || {};
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) {
      const ring = poly[0].map(P);
      if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
      if (p.building || p.height || p['building:levels']) {
        const h = Number(p.height) || (Number(p['building:levels']) || 3) * 3.2;
        site.buildings.push({ id: `g${site.buildings.length}`, footprint: ring, height: h, active: ['commercial', 'retail', 'shop'].includes(p.building) || !!p.shop });
      } else if (p.natural === 'water' || p.water) site.water.push({ polygon: ring });
      else if (['park', 'garden', 'grass'].includes(p.leisure || p.landuse)) site.green.push({ polygon: ring });
    }
    if ((g.type === 'LineString' || g.type === 'MultiLineString') && p.highway) {
      const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
      for (const l of lines) site.roads.push({ id: `r${site.roads.length}`, line: l.map(P), width: Number(p.width) || WIDTH[p.highway] || 5, main: MAIN.has(p.highway), name: p.name });
    }
    if (g.type === 'Point' && p.natural === 'tree') { const [x, y] = P(g.coordinates); site.trees.push({ x, y, r: 3, h: 8 }); }
  }
  const all = [...site.buildings.flatMap((b) => b.footprint), ...site.roads.flatMap((r) => r.line)];
  const b = bbox(all.length ? all : [[0, 0], [100, 100]]);
  site.bounds = { minX: b.minX - 10, minY: b.minY - 10, maxX: b.maxX + 10, maxY: b.maxY + 10 };
  return site;
}
