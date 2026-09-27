// three.js viewer: site rendering, picking, zone drawing, design overlay and
// metric heat maps. Plan (x, y) maps to world (x, height, −y).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { boxPolygon } from '../engine/generator.js';

const P = (x, y, h = 0) => new THREE.Vector3(x, h, -y);

export const COLORS = {
  ground: 0xe9e4da,
  road: 0xcfc9bd,
  mainRoad: 0xc4b39a,
  building: 0xf4f1ea,
  buildingActive: 0xf1c27d,
  buildingSelected: 0x6c8cff,
  buildingCleared: 0xff7a6b,
  openSpace: 0x7bc47f,
  openSelected: 0x2f9e44,
  zone: 0x2f9e44,
  tree: 0x4c9a53,
  trunk: 0x7a5c3e,
  water: 0x5aa9e6,
  lawn: 0x8fd18f,
  steps: 0xd9c7a3,
  plinth: 0xcdbb95,
  kiosk: 0xf08c5a,
  corridor: 0xb07cc6,
  mound: 0x6fbf73,
  seat: 0x8a5a44,
};

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f4ef);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.camera.position.set(-180, 260, 260);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    const hemi = new THREE.HemisphereLight(0xffffff, 0xb9ad98, 1.4);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.sun, this.sun.target);

    this.groups = {};
    for (const k of ['site', 'open', 'zones', 'design', 'heat', 'draft', 'markers']) {
      this.groups[k] = new THREE.Group();
      this.scene.add(this.groups[k]);
    }
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.mode = 'orbit';
    this.draft = [];
    this.handlers = {};
    this._bindEvents();
    this._resize();
    new ResizeObserver(() => this._resize()).observe(container);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  on(evt, fn) { this.handlers[evt] = fn; }
  _emit(evt, ...a) { this.handlers[evt]?.(...a); }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear(name) {
    const g = this.groups[name];
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse?.((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose(); m.dispose(); }); });
    }
  }

  // ------------------------------------------------------------------ site
  setSite(site) {
    this.site = site;
    this._origPos = null;
    this.bMesh = null;
    ['site', 'open', 'zones', 'design', 'heat', 'draft', 'markers'].forEach((n) => this.clear(n));
    const b = site.bounds;
    const w = b.maxX - b.minX, d = b.maxY - b.minY;
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    this.center = [cx, cy];

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color: COLORS.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, -cy);
    ground.receiveShadow = true;
    ground.userData.kind = 'ground';
    this.ground = ground;
    this.groups.site.add(ground);

    // Roads: flat ribbons.
    const roadGeo = [];
    for (const r of site.roads || []) {
      const polys = r.polygon ? [r.polygon] : stripPolys(r.line, r.width || 6);
      for (const poly of polys) {
        const g = flatPoly(poly, 0.05);
        if (g) { tint(g, r.main ? COLORS.mainRoad : COLORS.road); roadGeo.push(g); }
      }
    }
    for (const wtr of site.water || []) { const g = flatPoly(wtr.polygon, 0.06); if (g) { tint(g, COLORS.water); roadGeo.push(g); } }
    for (const gr of site.green || []) { const g = flatPoly(gr.polygon, 0.04); if (g) { tint(g, COLORS.lawn); roadGeo.push(g); } }
    if (roadGeo.length) this.groups.site.add(new THREE.Mesh(mergeGeometries(roadGeo), new THREE.MeshLambertMaterial({ vertexColors: true })));

    // Buildings: one merged mesh; per-building vertex ranges for recolouring.
    const geos = [];
    this.bRanges = [];
    let offset = 0;
    site.buildings.forEach((bd, i) => {
      const g = bd.tris ? trisGeometry(bd.tris) : extrude(bd.footprint, bd.height);
      if (!g) { this.bRanges.push(null); return; }
      const n = g.attributes.position.count;
      tint(g, bd.active ? COLORS.buildingActive : COLORS.building);
      g.setAttribute('bid', new THREE.Float32BufferAttribute(new Float32Array(n).fill(i), 1));
      this.bRanges.push([offset, n]);
      offset += n;
      geos.push(g);
    });
    if (geos.length) {
      const merged = mergeGeometries(geos); // all non-indexed, so ranges stay valid
      this.bMesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
      this.bMesh.castShadow = true;
      this.bMesh.receiveShadow = true;
      this.bMesh.userData.kind = 'buildings';
      this.groups.site.add(this.bMesh);
    }
    this._addTrees(site.trees || [], this.groups.site);
    this.frame(site.bounds);
    this._placeSun();
  }

  frame(b) {
    const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
    const r = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    this.controls.target.set(cx, 0, -cy);
    this.camera.position.set(cx - r * 0.45, r * 0.75, -cy + r * 0.75);
    this.camera.far = r * 10;
    this.camera.updateProjectionMatrix();
  }

  _placeSun(alt = 60, az = 150) {
    const [cx, cy] = this.center;
    const r = 400;
    const a = (alt * Math.PI) / 180, z = (az * Math.PI) / 180;
    this.sun.position.set(cx + r * Math.cos(a) * Math.sin(z), r * Math.sin(a), -(cy + r * Math.cos(a) * Math.cos(z)));
    this.sun.target.position.set(cx, 0, -cy);
    const b = this.site.bounds, s = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 1200 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  setSunAngles(altDeg, azDeg) { this._placeSun(altDeg, azDeg); }

  colorBuilding(i, hex) {
    const r = this.bRanges?.[i];
    if (!r) return;
    const col = this.bMesh.geometry.attributes.color;
    const c = new THREE.Color(hex);
    for (let v = r[0]; v < r[0] + r[1]; v++) col.setXYZ(v, c.r, c.g, c.b);
    col.needsUpdate = true;
  }

  resetBuildingColors(selected = new Set(), cleared = new Set(), overrides = {}) {
    this.site.buildings.forEach((b, i) => {
      const active = overrides[i]?.active ?? b.active;
      let c = active ? COLORS.buildingActive : COLORS.building;
      if (selected.has(i)) c = COLORS.buildingSelected;
      if (cleared.has(i)) c = COLORS.buildingCleared;
      this.colorBuilding(i, c);
    });
  }

  // Hide cleared buildings (demolished) by collapsing their vertices.
  setBuildingHeights(edits) {
    if (!this.bMesh) return;
    if (!this._origPos) this._origPos = this.bMesh.geometry.attributes.position.array.slice();
    const pos = this.bMesh.geometry.attributes.position;
    pos.array.set(this._origPos);
    for (const e of edits || []) {
      const r = this.bRanges[e.index];
      if (!r) continue;
      const orig = this.site.buildings[e.index].height;
      for (let v = r[0]; v < r[0] + r[1]; v++) {
        const y = this._origPos[v * 3 + 1];
        pos.array[v * 3 + 1] = e.demolish ? Math.min(y, 0.02) : y > 0.1 ? (y / orig) * e.height : y;
      }
    }
    pos.needsUpdate = true;
    this.bMesh.geometry.computeVertexNormals();
    this.bMesh.geometry.computeBoundingSphere();
  }

  _addTrees(trees, group, opacity = 1) {
    if (!trees.length) return;
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial({ color: COLORS.tree, transparent: opacity < 1, opacity }), trees.length);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.2, 0.3, 1, 6), new THREE.MeshLambertMaterial({ color: COLORS.trunk }), trees.length);
    const m = new THREE.Matrix4();
    trees.forEach((t, i) => {
      const base = t.base ?? t.h * 0.35;
      const ch = t.h - base;
      m.compose(P(t.x, t.y, base + ch / 2), new THREE.Quaternion(), new THREE.Vector3(t.r, ch / 2, t.r));
      crown.setMatrixAt(i, m);
      m.compose(P(t.x, t.y, base / 2), new THREE.Quaternion(), new THREE.Vector3(1, base, 1));
      trunk.setMatrixAt(i, m);
    });
    crown.castShadow = trunk.castShadow = true;
    group.add(crown, trunk);
  }

  // ------------------------------------------------------------ open spaces
  showOpenSpaces(list, selected = new Set()) {
    this.clear('open');
    list.forEach((o, i) => {
      const g = flatPoly(o.polygon, 0.12);
      if (!g) return;
      const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: selected.has(i) ? COLORS.openSelected : COLORS.openSpace, transparent: true, opacity: selected.has(i) ? 0.85 : 0.45, depthWrite: false }));
      mesh.userData = { kind: 'open', index: i };
      this.groups.open.add(mesh);
    });
  }

  showZones(zones) {
    this.clear('zones');
    for (const z of zones) {
      const pts = z.polygon.map(([x, y]) => P(x, y, 0.3));
      pts.push(pts[0]);
      this.groups.zones.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: COLORS.zone })));
    }
  }

  // ------------------------------------------------------------ design
  showDesign(design) {
    this.clear('design');
    if (!design) { this.setBuildingHeights([]); return; }
    this.setBuildingHeights(design.buildingEdits);
    const byKind = {};
    for (const b of design.boxes) (byKind[b.kind] ||= []).push(b);
    for (const [kind, list] of Object.entries(byKind)) {
      const geos = list.map((b) => {
        const poly = boxPolygon(b);
        if (b.canopy) return extrude(poly, 0.25, b.h);
        return extrude(poly, Math.max(b.h, 0.08));
      }).filter(Boolean);
      if (!geos.length) continue;
      const mat = new THREE.MeshLambertMaterial({ color: COLORS[kind] ?? 0xcccccc, transparent: kind === 'corridor', opacity: kind === 'corridor' ? 0.85 : 1 });
      const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.groups.design.add(mesh);
      if (kind === 'corridor') {
        // posts
        const posts = list.flatMap((b) => boxPolygon(b).map(([x, y]) => { const g = new THREE.CylinderGeometry(0.08, 0.08, b.h, 5); g.translate(x, b.h / 2, -y); return g; }));
        this.groups.design.add(new THREE.Mesh(mergeGeometries(posts), new THREE.MeshLambertMaterial({ color: 0x555555 })));
      }
    }
    this._addTrees(design.trees, this.groups.design);
    if (design.seats.length) {
      const seats = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.45, 0.5), new THREE.MeshLambertMaterial({ color: COLORS.seat }), design.seats.length);
      const m = new THREE.Matrix4();
      design.seats.forEach((s, i) => { m.makeTranslation(s.x, 0.22, -s.y); seats.setMatrixAt(i, m); });
      this.groups.design.add(seats);
    }
  }

  // Heat map of a metric at sample points (cell squares, diverging palette).
  showHeat(points, key, range, cell = 2) {
    this.clear('heat');
    if (!points?.length) return;
    const [lo, hi] = range;
    const geo = new THREE.PlaneGeometry(cell * 2, cell * 2);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, depthWrite: false }), points.length);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    points.forEach((p, i) => {
      m.makeTranslation(p.x, 0.35, -p.y);
      mesh.setMatrixAt(i, m);
      const t = Math.max(0, Math.min(1, (p.m[key] - lo) / (hi - lo || 1)));
      mesh.setColorAt(i, heatColor(t, c));
    });
    mesh.instanceColor.needsUpdate = true;
    this.groups.heat.add(mesh);
  }

  // ------------------------------------------------------------ interaction
  setMode(mode) {
    this.mode = mode;
    this.draft = [];
    this.clear('draft');
    this.controls.enableRotate = mode === 'orbit' || mode === 'pick';
  }

  _bindEvents() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return; // drag, not click
      this._click(e);
    });
    el.addEventListener('dblclick', () => { if (this.mode === 'draw') this.finishDraft(); });
  }

  _hit(e, objects) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, false)[0];
  }

  _click(e) {
    if (!this.site) return;
    if (this.mode === 'draw') {
      const hit = this._hit(e, [this.ground]);
      if (!hit) return;
      this.draft.push([hit.point.x, -hit.point.z]);
      this._drawDraft();
      return;
    }
    const targets = [...this.groups.open.children, this.bMesh].filter(Boolean);
    const hit = this._hit(e, targets);
    if (!hit) return;
    if (hit.object.userData.kind === 'open') this._emit('pickOpen', hit.object.userData.index);
    else if (hit.object === this.bMesh) {
      const bid = this.bMesh.geometry.attributes.bid.getX(hit.face.a);
      this._emit('pickBuilding', bid, e);
    }
  }

  _drawDraft() {
    this.clear('draft');
    const pts = this.draft.map(([x, y]) => P(x, y, 0.4));
    if (pts.length > 1) this.groups.draft.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]), new THREE.LineBasicMaterial({ color: 0x1f6feb })));
    for (const p of pts) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1f6feb }));
      s.position.copy(p);
      this.groups.draft.add(s);
    }
  }

  finishDraft() {
    if (this.draft.length >= 3) this._emit('zoneDrawn', this.draft.slice());
    this.draft = [];
    this.clear('draft');
  }

  snapshot() { return this.renderer.domElement.toDataURL('image/png'); }
}

// ---------------------------------------------------------------- helpers
function tint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

function shapeOf(poly) {
  const s = new THREE.Shape();
  poly.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

// Extrude a plan polygon to height h (optionally lifted to base).
export function extrude(poly, h, base = 0) {
  if (!poly || poly.length < 3) return null;
  const g = new THREE.ExtrudeGeometry(shapeOf(poly), { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2); // shape (x, y) → (x, 0, −y); depth → +y
  if (base) g.translate(0, base, 0);
  g.deleteAttribute('uv');
  return g.toNonIndexed();
}

function flatPoly(poly, y) {
  if (!poly || poly.length < 3) return null;
  const g = new THREE.ShapeGeometry(shapeOf(poly));
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  g.deleteAttribute('uv');
  return g.toNonIndexed();
}

function trisGeometry(tris) {
  const pos = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i += 3) { pos[i] = tris[i]; pos[i + 1] = tris[i + 2]; pos[i + 2] = -tris[i + 1]; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function stripPolys(line, width) {
  const hw = width / 2, out = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [x1, y1] = line[i], [x2, y2] = line[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    const nx = (-(y2 - y1) / len) * hw, ny = ((x2 - x1) / len) * hw;
    out.push([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]]);
  }
  return out;
}

// Perceptually ordered blue → yellow → red ramp.
export function heatColor(t, c = new THREE.Color()) {
  const stops = [[0, [0.19, 0.35, 0.73]], [0.5, [0.98, 0.86, 0.35]], [1, [0.84, 0.19, 0.15]]];
  let a = stops[0], b = stops[2];
  for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; }
  const u = (t - a[0]) / (b[0] - a[0] || 1);
  return c.setRGB(a[1][0] + (b[1][0] - a[1][0]) * u, a[1][1] + (b[1][1] - a[1][1]) * u, a[1][2] + (b[1][2] - a[1][2]) * u);
}
