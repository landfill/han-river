import * as T from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seededRandom } from './spectrum.js';
const rnd = seededRandom(437);
const materials = {},
  batches = new Map();
const unitBox = new T.BoxGeometry(1, 1, 1),
  unitCylinder = new T.CylinderGeometry(1, 1, 1, 10);
const matrix = new T.Matrix4(),
  quat = new T.Quaternion(),
  scale = new T.Vector3(),
  pos = new T.Vector3();
function mat(name, color, roughness = 0.8, metalness = 0) {
  const m = new T.MeshStandardMaterial({ color, roughness, metalness });
  materials[name] = m;
  return m;
}
function addGeo(geo, m, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const g = geo.clone();
  quat.setFromAxisAngle(new T.Vector3(0, 1, 0), ry);
  matrix.compose(pos.set(x, y, z), quat, scale.set(sx, sy, sz));
  g.applyMatrix4(matrix);
  if (!batches.has(m)) batches.set(m, []);
  batches.get(m).push(g);
}
function box(m, x, y, z, w, h, d, r = 0) {
  addGeo(unitBox, m, x, y, z, w, h, d, r);
}
function cylinder(m, x, y, z, r, h) {
  addGeo(unitCylinder, m, x, y, z, r, h, r);
}
function beam(m, a, b, width, depth = width) {
  const g = unitBox.clone(),
    mid = new T.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const q = new T.Quaternion().setFromUnitVectors(
    new T.Vector3(0, 1, 0),
    new T.Vector3().subVectors(b, a).normalize(),
  );
  const mx = new T.Matrix4().compose(mid, q, new T.Vector3(width, a.distanceTo(b), depth));
  g.applyMatrix4(mx);
  if (!batches.has(m)) batches.set(m, []);
  batches.get(m).push(g);
}
function facade(night = false, gold = false) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = night ? '#101e29' : gold ? '#a39773' : '#70888f';
  ctx.fillRect(0, 0, 256, 512);
  const r = seededRandom(382);
  for (let y = 0; y < 512; y += 16)
    for (let x = 0; x < 256; x += 12) {
      const l = r();
      ctx.fillStyle = night
        ? l > 0.66
          ? `rgba(255,${190 + Math.floor(r() * 40)},125,${0.35 + r() * 0.6})`
          : '#142932'
        : gold
          ? `rgba(${165 + l * 55},${146 + l * 52},${102 + l * 45},.9)`
          : `rgba(${80 + l * 60},${106 + l * 50},${116 + l * 55},.9)`;
      ctx.fillRect(x + 1, y + 2, 10, 12);
      ctx.fillStyle = night ? '#0c1921' : '#455b6033';
      ctx.fillRect(x + 1, y + 14, 12, 2);
    }
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
const south = [
  [-7500, 1400],
  [-4500, 1000],
  [-2500, 790],
  [-1800, 650],
  [-1150, 510],
  [-500, 400],
  [200, 360],
  [900, 380],
  [1800, 540],
  [3000, 900],
  [6000, 1400],
];
const north = [
  [-7500, -1500],
  [-4500, -1230],
  [-2500, -1050],
  [-1500, -900],
  [-700, -810],
  [200, -760],
  [1200, -840],
  [2200, -1050],
  [4000, -1300],
  [6500, -1800],
];
export function bankAt(x, points) {
  for (let i = 1; i < points.length; i++)
    if (x <= points[i][0]) {
      const t = (x - points[i - 1][0]) / (points[i][0] - points[i - 1][0]);
      return T.MathUtils.lerp(points[i - 1][1], points[i][1], t);
    }
  return points.at(-1)[1];
}
export function createWorld(scene) {
  const concrete = mat('concrete', '#a9aca1'),
    edge = mat('edge', '#727d73'),
    grass = mat('grass', '#657c55'),
    path = mat('path', '#b9b5a1'),
    road = mat('road', '#505a57'),
    paint = mat('paint', '#c7c6ac'),
    steel = mat('steel', '#7c9290', 0.45, 0.55),
    red = mat('red', '#a4523e', 0.5, 0.35),
    dark = mat('dark', '#2f4549', 0.55, 0.4),
    white = mat('white', '#d5d3bf');
  const dayMap = facade(),
    nightMap = facade(true),
    goldMap = facade(false, true);
  const glass = new T.MeshStandardMaterial({
    map: dayMap,
    color: '#b7c4bd',
    roughness: 0.35,
    metalness: 0.55,
  });
  const gold = new T.MeshStandardMaterial({
    map: goldMap,
    color: '#d7bd87',
    roughness: 0.28,
    metalness: 0.75,
  });
  const apartment = new T.MeshStandardMaterial({
    map: dayMap,
    color: '#ced0bc',
    roughness: 0.65,
    metalness: 0.15,
  });
  const stone = mat('stone', '#bec1ad');
  const land = (points, isSouth) => {
    const shape = new T.Shape();
    shape.moveTo(points[0][0], -points[0][1]);
    points.slice(1).forEach((p) => shape.lineTo(p[0], -p[1]));
    shape.lineTo(points.at(-1)[0], isSouth ? -6000 : 6000);
    shape.lineTo(points[0][0], isSouth ? -6000 : 6000);
    shape.closePath();
    const ground = new T.Mesh(new T.ShapeGeometry(shape), grass);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 3;
    ground.receiveShadow = true;
    scene.add(ground);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        len = Math.hypot(b[0] - a[0], b[1] - a[1]),
        angle = -Math.atan2(b[1] - a[1], b[0] - a[0]),
        x = (a[0] + b[0]) / 2,
        z = (a[1] + b[1]) / 2,
        sign = isSouth ? 1 : -1;
      box(edge, x, 1.1, z, len, 3, 7, angle);
      box(path, x, 3.1, z + sign * 12, len, 0.4, 17, angle);
      box(road, x, 4, z + sign * 70, len, 0.5, 24, angle);
      box(paint, x, 4.3, z + sign * 70, len, 0.08, 0.35, angle);
      const steps = Math.floor(len / 19);
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        box(
          paint,
          a[0] + (b[0] - a[0]) * t,
          4.3,
          a[1] + (b[1] - a[1]) * t + sign * 66,
          5,
          0.08,
          0.35,
          angle,
        );
      }
    }
  };
  land(south, true);
  land(north, false);
  // Riverbank stones and tree belts use instancing rather than one draw per tree.
  const treeCount = 1200,
    trunks = new T.InstancedMesh(
      new T.CylinderGeometry(0.5, 0.75, 7, 5),
      new T.MeshStandardMaterial({ color: '#5d6150' }),
      treeCount,
    );
  const crownGeo = new T.IcosahedronGeometry(1, 2);
  const crownPos = crownGeo.attributes.position;
  for (let i = 0; i < crownPos.count; i++) {
    const x = crownPos.getX(i),
      y = crownPos.getY(i),
      z = crownPos.getZ(i),
      f = 1 + 0.12 * Math.sin(x * 19 + y * 23 + z * 17);
    crownPos.setXYZ(i, x * f, y * f, z * f);
  }
  crownGeo.computeVertexNormals();
  const crowns = new T.InstancedMesh(
    crownGeo,
    new T.MeshStandardMaterial({ color: '#4f704b', roughness: 1 }),
    treeCount,
  );
  for (let i = 0; i < treeCount; i++) {
    const isSouth = i % 2 === 0,
      x = -4700 + rnd() * 10000,
      bank = bankAt(x, isSouth ? south : north),
      z = bank + (isSouth ? 1 : -1) * (25 + rnd() * 140),
      h = 8 + rnd() * 8;
    matrix.makeTranslation(x, 6, z);
    trunks.setMatrixAt(i, matrix);
    matrix.compose(
      pos.set(x, h + 3, z),
      quat.setFromAxisAngle(new T.Vector3(0, 1, 0), rnd() * 6),
      scale.set(h * 0.55, h * 0.65, h * 0.5),
    );
    crowns.setMatrixAt(i, matrix);
    crowns.setColorAt(
      i,
      new T.Color().setHSL(0.22 + rnd() * 0.07, 0.14 + rnd() * 0.14, 0.22 + rnd() * 0.12),
    );
  }
  trunks.castShadow = false;
  crowns.castShadow = false;
  scene.add(trunks, crowns);
  const rocks = new T.InstancedMesh(
    new T.IcosahedronGeometry(1, 0),
    new T.MeshStandardMaterial({ color: '#7f887b', roughness: 1 }),
    700,
  );
  for (let i = 0; i < 700; i++) {
    const s = i % 2 === 0,
      x = -3500 + rnd() * 7800,
      z = bankAt(x, s ? south : north) + (rnd() - 0.5) * 8;
    matrix.compose(
      pos.set(x, 0.7, z),
      quat.setFromEuler(new T.Euler(rnd(), rnd(), rnd())),
      scale.set(2 + rnd() * 3, 1 + rnd() * 2, 2 + rnd() * 3),
    );
    rocks.setMatrixAt(i, matrix);
  }
  scene.add(rocks);
  // Local skyline: recognisable 63, Parc1 and IFC silhouettes, surrounding fabric.
  for (let i = 0; i < 430; i++) {
    const x = -4400 + rnd() * 9100,
      s = i % 3 !== 0,
      z = bankAt(x, s ? south : north) + (s ? 1 : -1) * (210 + rnd() * 1500),
      h = 18 + Math.pow(rnd(), 2.4) * 105,
      w = 16 + rnd() * 36,
      d = 15 + rnd() * 32;
    // Keep the river-facing 63 Building site open.
    if (s && Math.abs(x - 0) < 150 && z < 700) continue;
    box(i % 4 === 0 ? apartment : glass, x, h / 2 + 5, z, w, h, d);
    box(stone, x, h + 6, z, w * 0.6, 2, d * 0.6);
  }
  function tower(x, z, w, d, h, m) {
    box(m, x, h / 2 + 5, z, w, h, d);
    box(dark, x, h + 6, z, w + 1, 2, d + 1);
    box(concrete, x, 7, z, w + 9, 7, d + 9);
  }
  // 63 Building: warm slab, slightly chamfered shoulders and rooftop crown.
  tower(-75, 590, 52, 31, 249, gold);
  box(gold, -75, 258, 590, 44, 12, 28);
  box(dark, -75, 266, 590, 20, 5, 16);
  for (let x = -98; x < -48; x += 4) box(gold, x, 131, 606, 0.6, 244, 0.8);
  // Parc1: two asymmetrical red exoskeleton towers west of 63.
  for (const [x, z, h, w] of [
    [-1630, 1120, 333, 64],
    [-1505, 1175, 256, 58],
  ]) {
    tower(x, z, w, 49, h, glass);
    for (const dx of [-w / 2, w / 2])
      for (const dz of [-25, 25]) box(red, x + dx, h / 2 + 5, z + dz, 3.2, h, 3.2);
    for (let y = 20; y < h - 30; y += 56) {
      for (const dz of [-25.8, 25.8]) {
        beam(
          red,
          new T.Vector3(x - w / 2, y, z + dz),
          new T.Vector3(x + w / 2, y + 50, z + dz),
          1.8,
        );
        beam(
          red,
          new T.Vector3(x + w / 2, y, z + dz),
          new T.Vector3(x - w / 2, y + 50, z + dz),
          1.8,
        );
      }
    }
    box(red, x, h + 6, z, w + 5, 5, 54);
  }
  for (const [x, z, h, w] of [
    [-1980, 1350, 284, 57],
    [-2090, 1260, 176, 52],
    [-2140, 1390, 196, 52],
  ]) {
    tower(x, z, w, 48, h, glass);
    box(glass, x + 6, h + 15, z, w * 0.7, 21, 44);
  }
  // North-shore high rises, with mountain profiles behind Yongsan.
  for (let i = 0; i < 8; i++) {
    const x = 650 + i * 120;
    for (let j = 0; j < 3; j++) tower(x, -1320 - j * 90, 39, 24, 70 + rnd() * 55, apartment);
  }
  const mountainM = mat('mountain', '#6b7c70');
  for (const [x, z, r, h] of [
    [-2000, -4700, 1700, 520],
    [800, -4200, 1300, 280],
    [2600, -5400, 1700, 450],
    [-4500, -5300, 1900, 510],
  ]) {
    const g = new T.ConeGeometry(r, h, 17, 3);
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const yy = a.getY(i);
      if (yy < 0) a.setY(i, yy + (rnd() - 0.5) * 70);
    }
    g.computeVertexNormals();
    addGeo(g, mountainM, x, h / 2 - 10, z);
  }
  function bridge(cx, railway = false) {
    const zStart = -835,
      zEnd = 420,
      len = zEnd - zStart,
      tilt = -0.15;
    const bx = (z) => cx + z * tilt;
    const angle = -Math.atan2(1, tilt);
    const mid = (zStart + zEnd) / 2;
    if (!railway) {
      box(concrete, bx(mid), 21.5, mid, len * Math.hypot(1, tilt), 3.5, 22, angle);
      box(road, bx(mid), 23.4, mid, len * Math.hypot(1, tilt), 0.3, 20, angle);
      for (const side of [-1, 1]) {
        box(steel, bx(mid) + side * 11, 24.7, mid, len * Math.hypot(1, tilt), 1.2, 0.35, angle);
        for (let z = zStart; z < zEnd; z += 12)
          box(steel, bx(z) + side * 10.8, 24.2, z, 0.25, 2, 0.25);
      }
      for (let z = zStart + 45; z < zEnd; z += 120) {
        box(concrete, bx(z), 9.2, z, 9, 19, 9);
        box(concrete, bx(z), 18.5, z, 21, 3, 12);
        box(edge, bx(z), 0.8, z, 14, 2.5, 14);
        for (const side of [-1, 1])
          beam(
            concrete,
            new T.Vector3(bx(z), 15, z),
            new T.Vector3(bx(z) + side * 12, 20, z),
            2.5,
            7,
          );
      }
      for (let z = zStart; z < zEnd; z += 20) box(paint, bx(z), 23.65, z, 0.25, 0.1, 9);
    } else {
      // Four parallel tracks and two trussed spans, not an invented suspension bridge.
      for (const offset of [-15, -5, 5, 15]) {
        box(dark, bx(mid) + offset, 20, mid, len * Math.hypot(1, tilt), 2, 6.5, angle);
        for (const side of [-1, 1]) {
          box(
            steel,
            bx(mid) + offset + side * 2,
            21.15,
            mid,
            len * Math.hypot(1, tilt),
            0.2,
            0.2,
            angle,
          );
          box(
            dark,
            bx(mid) + offset + side * 3.8,
            29,
            mid,
            len * Math.hypot(1, tilt),
            0.9,
            0.6,
            angle,
          );
          for (let z = zStart; z < zEnd; z += 30) {
            const p = new T.Vector3(bx(z) + offset + side * 3.8, 21, z),
              q = new T.Vector3(bx(z + 30) + offset + side * 3.8, 29, z + 30);
            beam(steel, p, q, 0.55);
            beam(steel, new T.Vector3(p.x, 29, z), new T.Vector3(q.x, 21, z + 30), 0.55);
          }
        }
      }
      for (let z = zStart + 15; z < zEnd; z += 100) box(concrete, bx(z), 9, z, 48, 19, 8);
    }
  }
  bridge(0);
  bridge(1400, true);
  // Shore lamps and their restrained night-time emission.
  const lamp = new T.MeshStandardMaterial({
    color: '#eee6c8',
    emissive: '#ffcf83',
    emissiveIntensity: 0,
  });
  for (const points of [south, north])
    for (let x = -2600; x < 3600; x += 75) {
      const z = bankAt(x, points) + (points === south ? 20 : -20);
      cylinder(dark, x, 6, z, 0.14, 6);
      box(lamp, x, 9.4, z, 1.2, 0.4, 1.2);
    }
  // Dock and a low-profile moored boat on the south bank.
  box(dark, -1200, 1.8, 415, 65, 2, 23);
  box(white, -1190, 4.5, 390, 43, 4, 11);
  box(glass, -1190, 8, 390, 30, 4, 9);
  box(white, -1190, 10.5, 390, 34, 1, 10);
  // Flush by material: city is ~20 draw calls, not hundreds.
  for (const [m, geos] of batches) {
    const merged = mergeGeometries(geos, false);
    const mesh = new T.Mesh(merged, m);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    scene.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  batches.clear();
  const movingBoat = new T.Group();
  const hull = new T.Mesh(new T.BoxGeometry(27, 3, 8), white);
  hull.position.y = 2;
  movingBoat.add(hull);
  const cabin = new T.Mesh(new T.BoxGeometry(16, 4, 6), glass);
  cabin.position.y = 5;
  movingBoat.add(cabin);
  const roof = new T.Mesh(new T.BoxGeometry(18, 0.7, 7), white);
  roof.position.y = 7.5;
  movingBoat.add(roof);
  scene.add(movingBoat);
  return {
    materials,
    glass,
    gold,
    apartment,
    trees: crowns,
    setTime(preset) {
      const n = preset === 'night';
      glass.map = n ? nightMap : dayMap;
      apartment.map = n ? nightMap : dayMap;
      gold.map = n ? nightMap : goldMap;
      for (const m of [glass, apartment, gold]) {
        m.emissiveMap = n ? nightMap : null;
        m.emissive.set(n ? '#ffce97' : '#000000');
        m.emissiveIntensity = n ? 0.7 : 0;
        m.needsUpdate = true;
      }
      lamp.emissiveIntensity = n ? 3 : 0;
      grass.color.set(n ? '#3d514a' : '#657c55');
    },
    update(t) {
      movingBoat.position.set(1700 - Math.sin(t * 0.008) * 2300, 0.07 * Math.sin(t), -430);
      movingBoat.rotation.y = Math.cos(t * 0.008) > 0 ? Math.PI : 0;
    },
  };
}
function teakTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d'),
    r = seededRandom(84);
  ctx.fillStyle = '#ac987a';
  ctx.fillRect(0, 0, 1024, 256);
  for (let y = 0; y < 256; y++) {
    const shade = Math.floor(70 + r() * 40);
    ctx.strokeStyle = `rgba(${shade},${shade * 0.83},${shade * 0.63},${0.06 + r() * 0.1})`;
    ctx.lineWidth = 0.4 + r() * 0.8;
    ctx.beginPath();
    for (let x = 0; x <= 1024; x += 16) {
      const dy = Math.sin(x * 0.008 + y * 0.3) * 0.8 + Math.sin(x * 0.034 + y) * 0.3;
      if (x === 0) ctx.moveTo(x, y + dy);
      else ctx.lineTo(x, y + dy);
    }
    ctx.stroke();
  }
  const t = new T.CanvasTexture(canvas);
  t.colorSpace = T.SRGBColorSpace;
  t.wrapS = t.wrapT = T.RepeatWrapping;
  t.repeat.set(0.25, 1);
  t.anisotropy = 4;
  return t;
}

export function createBoat(scene) {
  const boat = new T.Group();
  boat.name = 'Cruise deck';
  scene.add(boat);
  const wood = teakTexture();
  const deckMat = new T.MeshStandardMaterial({ color: '#e2d2b7', map: wood, roughness: 0.78 });
  const white = new T.MeshStandardMaterial({ color: '#e5e3d6', roughness: 0.43, metalness: 0.12 });
  const rail = new T.MeshStandardMaterial({ color: '#bcc3bc', roughness: 0.24, metalness: 0.85 });
  const teak = new T.MeshStandardMaterial({ color: '#9e8469', map: wood, roughness: 0.6 });
  const mesh = (g, m, x, y, z) => {
    const a = new T.Mesh(g, m);
    a.position.set(x, y, z);
    a.castShadow = true;
    a.receiveShadow = true;
    boat.add(a);
    return a;
  };
  const shape = new T.Shape();
  shape.moveTo(-20, -5);
  shape.lineTo(12, -5);
  shape.quadraticCurveTo(22, -4, 24, 0);
  shape.quadraticCurveTo(22, 4, 12, 5);
  shape.lineTo(-20, 5);
  shape.closePath();
  const floor = mesh(
    new T.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }),
    deckMat,
    0,
    2.95,
    0,
  );
  floor.rotation.x = -Math.PI / 2;
  mesh(new T.BoxGeometry(34, 2.1, 9.6), white, -4, 1.8, 0);
  // Individual narrow caulk lines make the foreground read at human scale.
  const lineMat = new T.MeshStandardMaterial({ color: '#726655', roughness: 1 });
  for (let z = -4.8; z <= 4.8; z += 0.22)
    mesh(new T.BoxGeometry(34, 0.008, 0.014), lineMat, -3, 3.14, z);
  for (let x = -19; x < 14; x += 3.2)
    for (let z = -4.6; z < 4.6; z += 0.88)
      mesh(
        new T.BoxGeometry(0.014, 0.009, 0.22),
        lineMat,
        x + (Math.floor(z / 0.88) % 2) * 1.6,
        3.145,
        z,
      );
  const points = [
    new T.Vector3(-18, 0, -4.8),
    new T.Vector3(11, 0, -4.8),
    new T.Vector3(19, 0, -3.5),
    new T.Vector3(23, 0, 0),
    new T.Vector3(19, 0, 3.5),
    new T.Vector3(11, 0, 4.8),
    new T.Vector3(-18, 0, 4.8),
  ];
  const curve = new T.CatmullRomCurve3(points, false, 'centripetal');
  for (const height of [3.45, 3.85, 4.3]) {
    const p = curve.getPoints(100).map((p) => p.add(new T.Vector3(0, height, 0)));
    const lineCurve = new T.CatmullRomCurve3(p);
    const tube = new T.Mesh(
      new T.TubeGeometry(lineCurve, 100, height === 4.3 ? 0.055 : 0.025, 7, false),
      rail,
    );
    boat.add(tube);
  }
  for (let i = 0; i <= 36; i++) {
    const p = curve.getPoint(i / 36);
    mesh(new T.CylinderGeometry(0.036, 0.04, 1.2, 7), rail, p.x, 3.72, p.z);
  }
  // Stern lookout stays behind the cabin, within the deck and its guard rail.
  for (const height of [3.45, 3.85, 4.3]) {
    const line = new T.LineCurve3(
      new T.Vector3(-19.5, height, -4.8),
      new T.Vector3(-19.5, height, 4.8),
    );
    mesh(new T.TubeGeometry(line, 1, height === 4.3 ? 0.055 : 0.025, 7, false), rail, 0, 0, 0);
  }
  for (let z = -4.8; z <= 4.8; z += 2.4)
    mesh(new T.CylinderGeometry(0.036, 0.04, 1.2, 7), rail, -19.5, 3.72, z);
  // Cabin behind the viewpoint; prevents a floating-camera impression.
  const cabinGlass = new T.MeshStandardMaterial({
    color: '#254652',
    metalness: 0.55,
    roughness: 0.18,
  });
  mesh(new T.BoxGeometry(8, 2.6, 8.5), white, -12, 4.45, 0);
  mesh(new T.BoxGeometry(0.1, 1.6, 7.8), cabinGlass, -7.94, 4.7, 0);
  mesh(new T.BoxGeometry(9, 0.25, 9.2), white, -12, 5.9, 0);
  for (const z of [-3.4, 3.4])
    for (const x of [-5, -1, 3]) {
      mesh(new T.BoxGeometry(1.8, 0.15, 0.6), teak, x, 3.65, z);
      mesh(new T.BoxGeometry(1.8, 0.6, 0.12), teak, x, 4, z + (z > 0 ? 0.28 : -0.28));
      for (const dx of [-0.6, 0.6])
        mesh(new T.BoxGeometry(0.08, 0.55, 0.45), rail, x + dx, 3.35, z);
    }
  const lifeRing = new T.Mesh(
    new T.TorusGeometry(0.36, 0.1, 10, 28),
    new T.MeshStandardMaterial({ color: '#db7f43', roughness: 0.8 }),
  );
  lifeRing.position.set(-8, 3.95, 4.85);
  boat.add(lifeRing);
  const boatBatches = new Map();
  boat.children.slice().forEach((m) => {
    m.updateMatrix();
    const g = m.geometry.clone().applyMatrix4(m.matrix);
    if (!boatBatches.has(m.material)) boatBatches.set(m.material, []);
    boatBatches.get(m.material).push(g);
    boat.remove(m);
    m.geometry.dispose();
  });
  for (const [material, geometries] of boatBatches) {
    const merged = mergeGeometries(geometries, false);
    const m = new T.Mesh(merged, material);
    m.castShadow = true;
    m.receiveShadow = true;
    boat.add(m);
    geometries.forEach((g) => g.dispose());
  }
  return boat;
}
