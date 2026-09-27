// 2.5D analysis raster. Every quantitative metric is computed by marching rays
// through this grid, which keeps the engine cheap enough for a phone and
// independent of how the model was authored (OSM polygons, glTF, OBJ ...).

import { bbox, pointInPolygon, polylineToStrips } from './geom.js';

export const CLS = {
  GROUND: 0,
  ROAD: 1,
  BUILDING: 2,
  TREE: 3,
  WATER: 4,
  GREEN: 5,
  CANOPY: 6, // shade structure / pergola: blocks sun, not eye-level view
  FURNITURE: 7,
};
export const CLS_NAMES = ['ground', 'road', 'building', 'tree', 'water', 'green', 'canopy', 'furniture'];

export function createGrid(bounds, cell = 2) {
  const x0 = Math.floor(bounds.minX / cell) * cell;
  const y0 = Math.floor(bounds.minY / cell) * cell;
  const nx = Math.ceil((bounds.maxX - x0) / cell);
  const ny = Math.ceil((bounds.maxY - y0) / cell);
  const n = nx * ny;
  return {
    x0, y0, cell, nx, ny,
    cls: new Uint8Array(n),
    h: new Float32Array(n), // opaque obstacle top (buildings, walls, kiosks)
    canopyTop: new Float32Array(n), // tree crowns / shade structures
    canopyBase: new Float32Array(n),
    canopyTrans: new Float32Array(n).fill(1), // solar transmissivity through canopy
    active: new Uint8Array(n), // 1 = active ground-floor frontage
    bid: new Int32Array(n).fill(-1), // building index
    seat: new Uint8Array(n), // seating elements
  };
}

export function cloneGrid(g) {
  return {
    ...g,
    cls: g.cls.slice(), h: g.h.slice(), canopyTop: g.canopyTop.slice(), canopyBase: g.canopyBase.slice(),
    canopyTrans: g.canopyTrans.slice(), active: g.active.slice(), bid: g.bid.slice(), seat: g.seat.slice(),
  };
}

export const idx = (g, i, j) => j * g.nx + i;
export const cellCenter = (g, i, j) => [g.x0 + (i + 0.5) * g.cell, g.y0 + (j + 0.5) * g.cell];
export function cellOf(g, x, y) {
  const i = Math.floor((x - g.x0) / g.cell), j = Math.floor((y - g.y0) / g.cell);
  if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return -1;
  return j * g.nx + i;
}

// Visit every cell whose centre is inside poly.
export function forEachCellInPolygon(g, poly, fn) {
  const b = bbox(poly);
  const i0 = Math.max(0, Math.floor((b.minX - g.x0) / g.cell));
  const i1 = Math.min(g.nx - 1, Math.floor((b.maxX - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((b.minY - g.y0) / g.cell));
  const j1 = Math.min(g.ny - 1, Math.floor((b.maxY - g.y0) / g.cell));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const [cx, cy] = cellCenter(g, i, j);
      if (pointInPolygon(cx, cy, poly)) fn(j * g.nx + i, i, j);
    }
  }
}

export function forEachCellInDisc(g, x, y, r, fn) {
  const i0 = Math.max(0, Math.floor((x - r - g.x0) / g.cell));
  const i1 = Math.min(g.nx - 1, Math.floor((x + r - g.x0) / g.cell));
  const j0 = Math.max(0, Math.floor((y - r - g.y0) / g.cell));
  const j1 = Math.min(g.ny - 1, Math.floor((y + r - g.y0) / g.cell));
  let hit = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const [cx, cy] = cellCenter(g, i, j);
      if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) { fn(j * g.nx + i); hit = true; }
    }
  }
  if (!hit) { const k = cellOf(g, x, y); if (k >= 0) fn(k); }
}

// Rasterise projected triangles ([x,y,z] * 3) keeping the max z per cell.
export function rasterizeTriangles(g, tris, fn) {
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t], ay = tris[t + 1], az = tris[t + 2];
    const bx = tris[t + 3], by = tris[t + 4], bz = tris[t + 5];
    const cx = tris[t + 6], cy = tris[t + 7], cz = tris[t + 8];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx);
    const minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    const i0 = Math.max(0, Math.floor((minX - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.floor((maxX - g.x0) / g.cell));
    const j0 = Math.max(0, Math.floor((minY - g.y0) / g.cell)), j1 = Math.min(g.ny - 1, Math.floor((maxY - g.y0) / g.cell));
    if (Math.abs(det) < 1e-9) {
      // Vertical (wall) triangle: mark the cells it passes through with its top.
      const top = Math.max(az, bz, cz);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * g.nx + i, top);
      continue;
    }
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = g.x0 + (i + 0.5) * g.cell, py = g.y0 + (j + 0.5) * g.cell;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det;
        const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) fn(j * g.nx + i, l1 * az + l2 * bz + l3 * cz);
      }
    }
  }
}

export function stampBuilding(g, b, index) {
  const set = (k, top) => {
    const hTop = top ?? b.height;
    if (hTop > g.h[k]) {
      g.h[k] = hTop;
      g.cls[k] = CLS.BUILDING;
      g.bid[k] = index;
      g.active[k] = b.active ? 1 : 0;
    }
  };
  if (b.tris) rasterizeTriangles(g, b.tris, (k, z) => set(k, Math.max(z, 0.1)));
  else forEachCellInPolygon(g, b.footprint, (k) => set(k));
}

export function stampTree(g, t) {
  const base = t.base ?? t.h * 0.35;
  forEachCellInDisc(g, t.x, t.y, t.r, (k) => {
    if (g.cls[k] === CLS.BUILDING) return;
    g.cls[k] = CLS.TREE;
    g.canopyTop[k] = Math.max(g.canopyTop[k], t.h);
    g.canopyBase[k] = g.canopyBase[k] > 0 ? Math.min(g.canopyBase[k], base) : base;
    g.canopyTrans[k] = Math.min(g.canopyTrans[k], 0.25); // dense tropical crown (Neem/Peepal)
  });
}

export function stampCanopy(g, poly, height = 3.6, trans = 0.1) {
  forEachCellInPolygon(g, poly, (k) => {
    if (g.cls[k] === CLS.BUILDING) return;
    if (g.cls[k] !== CLS.TREE) g.cls[k] = CLS.CANOPY;
    g.canopyTop[k] = Math.max(g.canopyTop[k], height + 0.2);
    g.canopyBase[k] = g.canopyBase[k] > 0 ? Math.min(g.canopyBase[k], height) : height;
    g.canopyTrans[k] = Math.min(g.canopyTrans[k], trans);
  });
}

export function buildGrid(site, cell = 2) {
  const g = createGrid(site.bounds, cell);
  for (const r of site.roads || []) {
    const polys = r.polygon ? [r.polygon] : polylineToStrips(r.line, r.width || 6);
    for (const p of polys) forEachCellInPolygon(g, p, (k) => { if (g.cls[k] === CLS.GROUND) g.cls[k] = CLS.ROAD; });
  }
  for (const w of site.water || []) forEachCellInPolygon(g, w.polygon, (k) => { g.cls[k] = CLS.WATER; });
  for (const gr of site.green || []) forEachCellInPolygon(g, gr.polygon, (k) => { if (g.cls[k] === CLS.GROUND) g.cls[k] = CLS.GREEN; });
  site.buildings.forEach((b, i) => { if (!b.removed) stampBuilding(g, b, i); });
  for (const t of site.trees || []) stampTree(g, t);
  // Mapped woodland (OSM natural=wood / landuse=forest) as continuous canopy.
  for (const wd of site.woods || []) {
    forEachCellInPolygon(g, wd.polygon, (k) => {
      if (g.cls[k] === CLS.BUILDING) return;
      g.cls[k] = CLS.TREE;
      g.canopyTop[k] = Math.max(g.canopyTop[k], 12);
      g.canopyBase[k] = g.canopyBase[k] > 0 ? Math.min(g.canopyBase[k], 3) : 3;
      g.canopyTrans[k] = Math.min(g.canopyTrans[k], 0.25);
    });
  }
  for (const c of site.canopies || []) stampCanopy(g, c.polygon, c.height, c.trans);
  for (const f of site.furniture || []) {
    const k = cellOf(g, f.x, f.y);
    if (k >= 0 && g.cls[k] !== CLS.BUILDING) g.seat[k] = Math.min(255, g.seat[k] + 1);
  }
  return g;
}
