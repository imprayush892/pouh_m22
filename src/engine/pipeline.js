// Glue between site, generator, metrics and model: prepare a context once,
// then evaluate any number of designs against it.

import { buildGrid, forEachCellInPolygon, CLS } from './raster.js';
import { pointMetrics, samplePoints, aggregate, toVector, sunPosition, CLIMATE, FEATURE_KEYS } from './metrics.js';
import { decode, applyDesign, genomeLength } from './generator.js';
import { priorScore, KEYWORD_KEYS } from './keywords.js';
import { COMBINATIONS } from './pouh.js';
import { polygonCentroid, convexHull } from './geom.js';

export function prepare(site, { zones = [], buildings = [], cell = 2, buffer = 6, climate = CLIMATE, comboLock = null, seed = 1234 } = {}) {
  const baseGrid = buildGrid(site, cell);
  const mask = new Uint8Array(baseGrid.nx * baseGrid.ny);
  for (const z of zones) {
    // Mark the zone plus a buffer so edge effects of the design are measured.
    const [cx, cy] = polygonCentroid(z.polygon);
    const grown = z.polygon.map(([x, y]) => {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1;
      return [x + (dx / d) * buffer, y + (dy / d) * buffer];
    });
    forEachCellInPolygon(baseGrid, grown, (k) => { mask[k] = 1; });
  }
  const sun = climate.hours.map((h) => sunPosition(climate.lat, climate.day, h));
  return { site, zones, buildings, baseGrid, mask, climate, sun, comboLock, seed, nGenes: genomeLength(zones, buildings) };
}

export function measure(ctx, grid, { stride = 2, rays = 48 } = {}) {
  const pts = samplePoints(grid, ctx.mask, stride);
  const per = pts.map((p) => ({ ...p, m: pointMetrics(grid, p.x, p.y, { rays, climate: ctx.climate, sun: ctx.sun }) }));
  return { points: per, agg: aggregate(per.map((p) => p.m)) };
}

export function evaluateGenome(ctx, genome, model, opts = {}) {
  const design = decode(genome, ctx);
  const grid = applyDesign(ctx.baseGrid, ctx.site, design);
  const { points, agg } = measure(ctx, grid, opts);
  const scores = scoreAll(agg, model);
  return { design, grid, points, agg, scores, compliance: pouhCompliance(design, agg) };
}

export function scoreAll(agg, model) {
  const x = toVector(agg);
  const out = {};
  for (const k of KEYWORD_KEYS) {
    const prior = priorScore(k, agg);
    const m = model?.keywords?.[k];
    out[k] = { prior, predicted: m ? Math.max(0, Math.min(100, predictWith(m, x))) : prior };
  }
  return out;
}

function predictWith(m, x) {
  let s = m.base;
  for (const t of m.trees) {
    let n = t;
    while (n.v === undefined) n = x[n.f] <= n.t ? n.l : n.r;
    s += n.v;
  }
  return s;
}

// How well the design meets the POUH strategy bands of its combination.
export function pouhCompliance(design, agg) {
  const c = COMBINATIONS[design.combo];
  if (!c) return null;
  const within = (v, [lo, hi]) => v >= lo && v <= hi;
  const rows = [
    { key: 'sunHours', label: 'Sun hours', value: agg.sunHours, band: c.sunHours, unit: 'h' },
    { key: 'isovistPct', label: 'Isovist', value: agg.isovistPct, band: c.isovistPct, unit: '%' },
    { key: 'shade', label: 'Shading mask', value: agg.shade, band: c.shadingMask, unit: '' },
  ];
  for (const z of design.zones.filter((q) => q.used)) {
    rows.push({ key: `road${z.index}`, label: `Zone ${z.index + 1} distance to main road`, value: z.distMainRoad, band: c.distFromMainRoad, unit: 'm', site: true });
    if (Number.isFinite(z.distNearestUnit)) rows.push({ key: `gap${z.index}`, label: `Zone ${z.index + 1} distance to next unit`, value: z.distNearestUnit, band: c.distBetweenUnits, unit: 'm', site: true });
    rows.push({ key: `area${z.index}`, label: `Zone ${z.index + 1} intervention area`, value: z.interventionArea, band: c.area, unit: 'm²', site: true });
  }
  for (const r of rows) r.ok = within(r.value, r.band);
  return { combo: design.combo, label: c.label, rows, score: rows.filter((r) => r.ok).length / rows.length };
}

// Open cells that could host an intervention (used to suggest zones).
export function openCellsMask(grid) {
  const m = new Uint8Array(grid.nx * grid.ny);
  for (let k = 0; k < m.length; k++) if (grid.cls[k] === CLS.GROUND || grid.cls[k] === CLS.GREEN) m[k] = 1;
  return m;
}

export { FEATURE_KEYS };

// Candidate intervention zones on any site: connected components of open
// ground (not road/building/water) between minArea and maxArea m².
export function findOpenSpaces(grid, { minArea = 60, maxArea = 6000 } = {}) {
  const open = openCellsMask(grid);
  const seen = new Uint8Array(open.length);
  const out = [];
  const cellA = grid.cell * grid.cell;
  for (let k0 = 0; k0 < open.length; k0++) {
    if (!open[k0] || seen[k0]) continue;
    const stack = [k0], comp = [];
    seen[k0] = 1;
    while (stack.length) {
      const k = stack.pop();
      comp.push(k);
      const i = k % grid.nx, j = (k / grid.nx) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= grid.nx || jj >= grid.ny) continue;
        const kk = jj * grid.nx + ii;
        if (open[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
      }
    }
    const area = comp.length * cellA;
    if (area < minArea) continue;
    if (area > maxArea) {
      // Large open ground (plazas, open imported sites): tile into ~30 × 30 m
      // candidates, about one POUH programme (650–855 m²).
      out.push(...tileComponent(grid, comp, 30));
      continue;
    }
    const pts = comp.map((k) => [grid.x0 + ((k % grid.nx) + 0.5) * grid.cell, grid.y0 + (((k / grid.nx) | 0) + 0.5) * grid.cell]);
    out.push({ id: `z${out.length}`, polygon: convexHull(pts), area });
  }
  return out.sort((a, b) => b.area - a.area);
}

function tileComponent(grid, comp, T) {
  const set = new Set(comp);
  const n = Math.max(1, Math.round(T / grid.cell));
  let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
  for (const k of comp) {
    const i = k % grid.nx, j = (k / grid.nx) | 0;
    if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
  }
  const tiles = [];
  for (let j = j0; j + n - 1 <= j1; j += n) {
    for (let i = i0; i + n - 1 <= i1; i += n) {
      let c = 0;
      for (let jj = j; jj < j + n; jj++) for (let ii = i; ii < i + n; ii++) if (set.has(jj * grid.nx + ii)) c++;
      if (c < 0.85 * n * n) continue;
      const x0 = grid.x0 + i * grid.cell, y0 = grid.y0 + j * grid.cell, s = n * grid.cell;
      tiles.push({ id: `t${i}_${j}`, polygon: [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]], area: c * grid.cell * grid.cell, tile: true });
    }
  }
  return tiles;
}
