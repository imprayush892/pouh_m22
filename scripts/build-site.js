// Builds the default trial site (Manek Chowk → Nagbhudar ni pol, Ahmedabad
// walled city) from the real OSM street network plus a deterministic
// procedural pol fabric.
//
// Why procedural buildings: in this part of OSM, most building polygons are a
// schematic grid of identical 14 × 14 m squares (247 of 428 in the crop), which
// would misrepresent the metrics that depend on morphology. Streets and names
// are real; plots follow the documented pol typology: narrow row houses
// (4–8 m frontage, 8–16 m deep) lining streets, mostly 3 storeys (Matsuda et
// al. 2002; Negami et al. 2000), commercial frontage on main roads (POUH p. 10).
//
// usage: node scripts/build-site.js  → public/data/site-manek-chowk.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hashString, mulberry32 } from '../src/engine/rng.js';
import { convexHull, polygonArea, pointInPolygon } from '../src/engine/geom.js';

const osm = JSON.parse(readFileSync(new URL('../data/osm_streets_manek_chowk.json', import.meta.url)));
const WIN = { minX: -170, minY: -150, maxX: 250, maxY: 180 };
const RES = 1; // m, occupancy raster resolution
const nx = (WIN.maxX - WIN.minX) / RES, ny = (WIN.maxY - WIN.minY) / RES;
const occ = new Uint8Array(nx * ny); // 0 free, 1 road, 2 plot
const rand = mulberry32(20220);

const roads = osm.R.map(([line, width, main, name], i) => ({ id: `r${i}`, line, width, main: !!main, name }));
const inWin = (x, y) => x >= WIN.minX && y >= WIN.minY && x < WIN.maxX && y < WIN.maxY;
const cell = (x, y) => Math.floor((y - WIN.minY) / RES) * nx + Math.floor((x - WIN.minX) / RES);

// 1. Road mask.
for (const r of roads) {
  const hw = r.width / 2 + 0.5;
  for (let s = 0; s < r.line.length - 1; s++) {
    const [x1, y1] = r.line[s], [x2, y2] = r.line[s + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    for (let t = 0; t <= len; t += 0.5) {
      const px = x1 + ((x2 - x1) * t) / len, py = y1 + ((y2 - y1) * t) / len;
      for (let dy = -hw; dy <= hw; dy += 0.5) for (let dx = -hw; dx <= hw; dx += 0.5) {
        if (dx * dx + dy * dy > hw * hw) continue;
        const x = px + dx, y = py + dy;
        if (inWin(x, y)) occ[cell(x, y)] = 1;
      }
    }
  }
}

// 2. Voronoi parcels: seeds along street fronts (4–8 m apart), back rows and
// a jittered interior grid; each land cell joins its nearest seed within
// 11 m. Adjacent seeds along a street give party-wall row houses whose side
// walls are perpendicular to the street.
function storeys(id) {
  const h = hashString(id) % 100; // Matsuda et al.: ~50 % 3-storey, 20 % 2, 20 % 4
  return h < 5 ? 1 : h < 25 ? 2 : h < 75 ? 3 : h < 95 ? 4 : 5;
}
const seeds = [];
const landOK = (x, y) => inWin(x, y) && occ[cell(x, y)] === 0;
for (const r of roads) {
  for (let s = 0; s < r.line.length - 1; s++) {
    const [x1, y1] = r.line[s], [x2, y2] = r.line[s + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 2) continue;
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    for (const side of [1, -1]) {
      const nxv = -uy * side, nyv = ux * side;
      for (let t = 2 + rand() * 3; t < len - 1; t += 4 + rand() * 4) {
        [[r.width / 2 + 6, 0], [r.width / 2 + 18, 1], [r.width / 2 + 30, 2]].forEach(([o, row]) => {
          const x = x1 + ux * t + nxv * o, y = y1 + uy * t + nyv * o;
          if (landOK(x, y)) seeds.push({ x, y, row, road: r });
        });
      }
    }
  }
}
// Interior grid for deep blocks.
for (let y = WIN.minY + 4; y < WIN.maxY; y += 9) {
  for (let x = WIN.minX + 4; x < WIN.maxX; x += 9) {
    const jx = x + (rand() - 0.5) * 4, jy = y + (rand() - 0.5) * 4;
    if (landOK(jx, jy)) seeds.push({ x: jx, y: jy, row: 3, road: null });
  }
}
// Spatial hash; nearest seed per land cell.
const HB = 12;
const bucket = new Map();
seeds.forEach((sd, i) => {
  const key = `${Math.floor(sd.x / HB)},${Math.floor(sd.y / HB)}`;
  if (!bucket.has(key)) bucket.set(key, []);
  bucket.get(key).push(i);
});
const owner = new Int32Array(nx * ny).fill(-1);
for (let j = 0; j < ny; j++) {
  for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (occ[k]) continue;
    const x = WIN.minX + i + 0.5, y = WIN.minY + j + 0.5;
    const bx = Math.floor(x / HB), by = Math.floor(y / HB);
    let best = -1, bd = 121; // 11 m cap
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const si of bucket.get(`${bx + dx},${by + dy}`) || []) {
        const d = (seeds[si].x - x) ** 2 + (seeds[si].y - y) ** 2;
        // Front-row seeds win ties so street walls stay continuous.
        const dd = d - (seeds[si].row === 0 ? 6 : 0);
        if (dd < bd) { bd = dd; best = si; }
      }
    }
    owner[k] = best;
  }
}
// A seed with too few cells, or ~7 % of back/interior seeds, stays open (chowk).
const cellsOf = new Map();
for (let k = 0; k < nx * ny; k++) {
  if (owner[k] < 0) continue;
  if (!cellsOf.has(owner[k])) cellsOf.set(owner[k], []);
  cellsOf.get(owner[k]).push(k);
}
const buildings = [];
for (const [si, cells] of [...cellsOf.entries()].sort((a, b) => a[0] - b[0])) {
  const sd = seeds[si];
  const openPlot = cells.length < 18 || (sd.row > 0 && hashString(`s${si}`) % 100 < 7);
  if (openPlot) { for (const k of cells) owner[k] = -1; continue; }
  for (const k of cells) occ[k] = 2;
  const pts = cells.map((k) => [WIN.minX + (k % nx) + 0.5, WIN.minY + Math.floor(k / nx) + 0.5]);
  const hull = convexHull(pts.flatMap(([x, y]) => [[x - 0.45, y - 0.45], [x + 0.45, y - 0.45], [x + 0.45, y + 0.45], [x - 0.45, y + 0.45]]));
  const id = `b${buildings.length}`;
  buildings.push({
    id,
    footprint: hull.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]),
    height: storeys(id) * 3.2,
    active: sd.row === 0 && !!sd.road?.main,
    street: sd.row === 0 ? sd.road?.name || undefined : undefined,
  });
}

// 3. Leftover pockets → open spaces (chowks), connected components of free cells.
const seen = new Uint8Array(nx * ny);
const openSpaces = [];
for (let k0 = 0; k0 < nx * ny; k0++) {
  if (occ[k0] || seen[k0]) continue;
  const stack = [k0];
  const comp = [];
  seen[k0] = 1;
  let touchesEdge = false;
  while (stack.length) {
    const k = stack.pop();
    comp.push(k);
    const i = k % nx, j = Math.floor(k / nx);
    if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) touchesEdge = true;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const kk = jj * nx + ii;
      if (!occ[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
    }
  }
  if (touchesEdge || comp.length < 40 || comp.length > 4000) continue;
  const pts = comp.map((k) => [WIN.minX + (k % nx) + 0.5, WIN.minY + Math.floor(k / nx) + 0.5]);
  const hull = convexHull(pts);
  openSpaces.push({ id: `o${openSpaces.length}`, polygon: hull.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]), area: comp.length * RES * RES, hullArea: +polygonArea(hull).toFixed(1) });
}
openSpaces.sort((a, b) => b.area - a.area);

// 4. A few existing trees in the larger pockets (POUH p. 14: "lack of green cover").
const trees = [];
for (const o of openSpaces.slice(0, 6)) {
  const xs = o.polygon.map((p) => p[0]), ys = o.polygon.map((p) => p[1]);
  const cx = xs.reduce((a, b) => a + b) / xs.length, cy = ys.reduce((a, b) => a + b) / ys.length;
  trees.push({ x: +cx.toFixed(1), y: +cy.toFixed(1), r: 3.5, h: 9 });
}

const clipRoads = roads
  .filter((r) => r.line.some(([x, y]) => inWin(x, y)))
  .map((r) => ({ ...r, name: r.name || undefined }));

const site = {
  name: 'Manek Chowk – Nagbhudar ni pol, Ahmedabad',
  note: 'Streets: OpenStreetMap (ODbL). Buildings: procedural pol fabric (see scripts/build-site.js).',
  origin: { lat: osm.o[0], lon: osm.o[1] },
  bounds: WIN,
  buildings,
  roads: clipRoads,
  trees,
  openSpaces,
  places: osm.P.map(([name, p]) => ({ name, x: p[0], y: p[1] })),
};
mkdirSync(new URL('../public/data/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/data/site-manek-chowk.json', import.meta.url), JSON.stringify(site));
const built = buildings.reduce((s, b) => s + polygonArea(b.footprint), 0);
console.log(`buildings ${buildings.length}, roads ${clipRoads.length}, open spaces ${openSpaces.length}, ` +
  `ground coverage ${(built / ((WIN.maxX - WIN.minX) * (WIN.maxY - WIN.minY))).toFixed(2)}`);
