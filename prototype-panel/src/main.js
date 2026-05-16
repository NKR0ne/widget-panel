import './styles.css';
import * as THREE from 'three';
import { Text } from 'troika-three-text';

const root = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  premultipliedAlpha: false,
  powerPreference: 'high-performance',
});
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
root.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2400);
camera.position.set(0, 0, 900);

const stage = new THREE.Group();
scene.add(stage);

const pointer = new THREE.Vector2(0, 0);
const smoothedPointer = new THREE.Vector2(0, 0);
const startedAt = performance.now();
const pulsingMaterials = [];
const floatingGroups = [];
const particles = [];
const sparkLines = [];
const SHOW_CARD_REFERENCE = true;

const palette = {
  neon: 0x1f6fff,
  neonMid: 0x0b46ff,
  neonDeep: 0x071a91,
  edgeWhite: 0xeaf4ff,
  edgeBlue: 0x9fc4ff,
  glass: 0x071328,
  shell: 0x060b18,
  card: 0x07142b,
  card2: 0x0a1b3d,
  line: 0x1f6fff,
  mist: 0xffffff,
  soft: 0xffffff,
  dim: 0xffffff,
  shadow: 0x080a0f,
  cyan: 0x1f6fff,
  blue: 0x1f6fff,
  mint: 0x3c7dff,
  green: 0x2b63ff,
  gold: 0x7aa2ff,
  orange: 0x315cff,
  rose: 0x5f7dff,
  violet: 0x6a4dff,
  red: 0x3169ff,
};

const DASHBOARD = {
  width: 1760,
  height: 1120,
  corner: 10,
  cardCorner: 8,
  gap: 20,
};

const REFERENCE_SCENE = {
  width: 820,
  height: 520,
};

const panel = new THREE.Group();
stage.add(panel);

function roundedRectShape(width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  const x = -width / 2;
  const y = -height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function makeRoundedPlane(width, height, radius, options = {}) {
  const geometry = new THREE.ShapeGeometry(roundedRectShape(width, height, radius), 10);
  const opacity = options.solid ? (options.opacity ?? 0.18) : Math.min(options.opacity ?? 0.085, options.maxOpacity ?? 0.16);
  const material = new THREE.MeshBasicMaterial({
    color: options.color ?? palette.card,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.userData.baseOpacity = material.opacity;
  if (options.pulse) pulsingMaterials.push(material);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = options.z ?? 0;
  return mesh;
}

function makeStroke(width, height, radius, color = palette.neon, opacity = 0.16, z = 1) {
  const points = roundedRectShape(width, height, radius).getPoints(10);
  points.push(points[0]);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  line.position.z = z;
  return line;
}

function makeBar(width, height, color, opacity = 0.82, z = 2) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: Math.min(opacity, 0.58),
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return mesh;
}

function makeCircle(radius, color, opacity = 1, segments = 40, z = 2) {
  const geometry = new THREE.CircleGeometry(radius, segments);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: Math.min(opacity, 0.88),
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return mesh;
}

function makeRing(innerRadius, outerRadius, color, opacity = 0.8, segments = 72, z = 2) {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, segments);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return mesh;
}

function makeText(value, options = {}) {
  const text = new Text();
  text.text = value;
  text.fontSize = options.size ?? 14;
  text.color = 0xffffff;
  text.anchorX = options.anchorX ?? 'left';
  text.anchorY = options.anchorY ?? 'middle';
  text.textAlign = options.align ?? 'left';
  if (options.maxWidth != null) text.maxWidth = options.maxWidth;
  text.lineHeight = options.lineHeight ?? 1.12;
  text.letterSpacing = options.letterSpacing ?? 0;
  text.material.depthWrite = false;
  text.material.transparent = true;
  text.material.opacity = 1;
  text.position.set(options.x ?? 0, options.y ?? 0, options.z ?? 8);
  text.sync();
  return text;
}

function addText(parent, value, x, y, options = {}) {
  const text = makeText(value, { ...options, x, y });
  parent.add(text);
  return text;
}

function makeLine(points, color, opacity = 0.7, z = 3) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(([x, y]) => new THREE.Vector3(x, y, z)));
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
  return new THREE.Line(geometry, material);
}

function withPosition(group, x, y, z = 0) {
  group.position.set(x, y, z);
  return group;
}

function addHoloFrame(parent, w, h, color = palette.neon) {
  const corner = 34;
  const inset = 13;
  const positions = [
    [-w / 2 + inset + corner / 2, h / 2 - inset],
    [-w / 2 + inset, h / 2 - inset - corner / 2],
    [w / 2 - inset - corner / 2, h / 2 - inset],
    [w / 2 - inset, h / 2 - inset - corner / 2],
    [-w / 2 + inset + corner / 2, -h / 2 + inset],
    [-w / 2 + inset, -h / 2 + inset + corner / 2],
    [w / 2 - inset - corner / 2, -h / 2 + inset],
    [w / 2 - inset, -h / 2 + inset + corner / 2],
  ];
  positions.forEach(([x, y], index) => {
    const horizontal = index % 2 === 0;
    const piece = makeBar(horizontal ? corner : 1.2, horizontal ? 1.2 : corner, color, 0.72, 5);
    piece.position.set(x, y, 5);
    parent.add(piece);
  });
}

function addHoloGrid(parent, w, h, step = 42, color = palette.neon, opacity = 0.06) {
  for (let x = -w / 2 + step; x < w / 2; x += step) {
    const line = makeLine([[x, -h / 2 + 20], [x, h / 2 - 52]], color, opacity, 2.8);
    parent.add(line);
  }
  for (let y = -h / 2 + step; y < h / 2 - 42; y += step) {
    const line = makeLine([[-w / 2 + 20, y], [w / 2 - 20, y]], color, opacity, 2.8);
    parent.add(line);
  }
}

function addGlassSheen(parent, w, h) {
  const upperWash = makeRoundedPlane(w - 22, Math.max(26, h * 0.28), Math.max(5, DASHBOARD.cardCorner - 2), {
    color: palette.card2,
    opacity: 0.075,
    maxOpacity: 0.09,
    z: 1.7,
  });
  upperWash.position.set(0, h / 2 - Math.max(28, h * 0.16) - 8, 1.7);
  parent.add(upperWash);

  const edgeGlow = makeBar(w - 46, 1.6, palette.neon, 0.52, 5.1);
  edgeGlow.position.set(0, h / 2 - 42, 5.1);
  parent.add(edgeGlow);

  const reflectionA = makeLine([
    [-w / 2 + 38, h / 2 - 78],
    [w / 2 - 70, h / 2 - 25],
  ], palette.mist, 0.14, 5);
  parent.add(reflectionA);

  const reflectionB = makeLine([
    [-w / 2 + 24, -h / 2 + 38],
    [w / 2 - 118, -h / 2 + 78],
  ], palette.neon, 0.08, 5);
  parent.add(reflectionB);
}

function createWidget({ x, y, w, h, title, subtitle = '', accent = palette.cyan, badge = '', extra = '' }) {
  const group = new THREE.Group();
  group.position.set(x, y, 4);
  group.userData.floatSeed = Math.random() * Math.PI * 2;
  floatingGroups.push(group);

  group.add(makeRoundedPlane(w, h, DASHBOARD.cardCorner, {
    color: palette.glass,
    opacity: 0.105,
    maxOpacity: 0.12,
    pulse: true,
  }));
  group.add(makeStroke(w + 6, h + 6, DASHBOARD.cardCorner + 3, palette.edgeBlue, 0.18, 0.8));
  group.add(makeStroke(w + 2, h + 2, DASHBOARD.cardCorner + 1, palette.edgeWhite, 0.68, 1.08));
  group.add(makeStroke(w, h, DASHBOARD.cardCorner, palette.edgeWhite, 0.42, 1.22));
  group.add(makeStroke(w - 9, h - 9, Math.max(4, DASHBOARD.cardCorner - 2), palette.neon, 0.26, 1.36));
  addHoloGrid(group, w, h, 48, palette.neon, 0.04);
  addGlassSheen(group, w, h);

  const topGlint = makeBar(w - 34, 1.2, palette.neon, 0.5, 3);
  topGlint.position.set(0, h / 2 - 42, 3);
  group.add(topGlint);
  const diagonalGlint = makeLine([
    [-w / 2 + 24, h / 2 - 64],
    [w / 2 - 92, h / 2 - 22],
  ], palette.neon, 0.13, 3);
  group.add(diagonalGlint);

  const dot = makeCircle(3.2, accent, 0.95, 18, 5);
  dot.position.set(-w / 2 + 28, h / 2 - 23, 5);
  group.add(dot);

  addText(group, '::', -w / 2 + 12, h / 2 - 23, {
    size: 10,
    color: palette.soft,
    opacity: 0.75,
  });
  addText(group, title, -w / 2 + 42, h / 2 - 23, {
    size: 13,
    color: palette.soft,
    maxWidth: w - 118,
  });
  if (subtitle) {
    addText(group, subtitle, -w / 2 + 56 + title.length * 9.8, h / 2 - 23, {
      size: 10.5,
      color: palette.soft,
      opacity: 0.72,
      maxWidth: 170,
    });
  }
  if (badge) {
    const badgeBg = makeRoundedPlane(30, 18, 5, {
      color: palette.neon,
      opacity: 0.16,
      solid: true,
      z: 4,
    });
    badgeBg.position.set(w / 2 - 55, h / 2 - 23, 4);
    group.add(badgeBg);
    addText(group, badge, w / 2 - 55, h / 2 - 23, {
      size: 10.5,
      color: palette.mist,
      anchorX: 'center',
    });
  }
  addText(group, extra || 'v', w / 2 - 22, h / 2 - 23, {
    size: 13,
    color: palette.soft,
    opacity: 0.82,
    anchorX: 'center',
  });
  return group;
}

function addDivider(parent, x, y, width) {
  const divider = makeBar(width, 1, palette.neon, 0.28, 4);
  divider.position.set(x, y, 4);
  parent.add(divider);
}

function makeSparkline(values, width, height, color, fill = false) {
  const group = new THREE.Group();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = -width / 2 + (index / (values.length - 1)) * width;
    const y = -height / 2 + ((value - min) / span) * height;
    return [x, y];
  });
  if (fill) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], -height / 2);
    for (const [x, y] of points) shape.lineTo(x, y);
    shape.lineTo(points[points.length - 1][0], -height / 2);
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    mesh.position.z = 2.7;
    group.add(mesh);
  }
  const line = makeLine(points, color, 0.86, 4);
  group.add(line);
  sparkLines.push({ line, values, width, height, color });
  return group;
}

function createWeatherWidget(x, y) {
  const w = 410;
  const h = 314;
  const group = createWidget({ x, y, w, h, title: 'PREVISIONS', subtitle: 'Quebec, Quebec', accent: palette.gold });

  const sun = new THREE.Group();
  sun.position.set(-w / 2 + 55, h / 2 - 72, 6);
  for (let i = 0; i < 12; i += 1) {
    const ray = makeBar(7, 19, i % 2 ? palette.orange : palette.gold, 0.72, 4);
    ray.position.set(Math.cos(i / 12 * Math.PI * 2) * 22, Math.sin(i / 12 * Math.PI * 2) * 22, 4);
    ray.rotation.z = i / 12 * Math.PI * 2;
    sun.add(ray);
  }
  sun.add(makeCircle(24, palette.gold, 0.98, 48, 5));
  group.add(sun);

  addText(group, '12°', -w / 2 + 98, h / 2 - 65, {
    size: 31,
    color: palette.mist,
  });
  addText(group, 'Clear · feels 9°', -w / 2 + 99, h / 2 - 98, {
    size: 13,
    color: palette.soft,
  });
  addText(group, 'Humidity 85%\nWind 18 km/h', w / 2 - 110, h / 2 - 79, {
    size: 12.5,
    color: palette.soft,
    maxWidth: 96,
    lineHeight: 1.25,
  });

  const hours = ['Now', '10 h 00', '11 h 00', '12 h 00', '13 h 00', '14 h 00'];
  hours.forEach((hour, index) => {
    const xPos = -w / 2 + 42 + index * 61;
    if (index === 0) {
      const pill = makeRoundedPlane(48, 76, 7, { color: palette.neonDeep, opacity: 0.12, solid: true, z: 3 });
      pill.position.set(xPos + 4, h / 2 - 152, 3);
      group.add(pill);
    }
    addText(group, hour, xPos + 4, h / 2 - 132, {
      size: 10.5,
      color: index === 0 ? palette.gold : palette.soft,
      anchorX: 'center',
    });
    const mini = makeCircle(8, palette.gold, 0.92, 24, 5);
    mini.position.set(xPos + 4, h / 2 - 158, 5);
    group.add(mini);
    addText(group, `${index < 3 ? 12 - (index === 0 ? 1 : 0) : index + 10}°`, xPos + 4, h / 2 - 185, {
      size: 10,
      color: palette.soft,
      anchorX: 'center',
    });
  });

  addDivider(group, 0, -42, w - 40);
  const days = [
    ['Today', '8°', '17°', palette.gold],
    ['Sam.', '10°', '22°', palette.mint],
    ['Dim.', '10°', '19°', palette.blue],
    ['Lun.', '7°', '12°', palette.violet],
    ['Mar.', '9°', '25°', palette.orange],
  ];
  days.forEach((day, index) => {
    const rowY = -62 - index * 22;
    addText(group, day[0], -w / 2 + 20, rowY, { size: 13, color: palette.soft });
    addText(group, '·', -w / 2 + 78, rowY, { size: 20, color: day[3], anchorX: 'center' });
    addText(group, day[1], w / 2 - 105, rowY, { size: 12.5, color: palette.soft, anchorX: 'right' });
    const range = makeLine([[-22, 0], [26, 0]], day[3], 0.42, 5);
    range.position.set(w / 2 - 64, rowY, 5);
    group.add(range);
    addText(group, day[2], w / 2 - 20, rowY, { size: 12.5, color: palette.soft, anchorX: 'right' });
  });
  return group;
}

function createMarketsWidget(x, y) {
  const w = 410;
  const h = 332;
  const group = createWidget({ x, y, w, h, title: 'MARCHES', subtitle: 'Last updated: 09:48', accent: palette.mint });
  const tabs = ['Marches', 'Main', 'Bloomberg Live', 'Heatmap'];
  tabs.forEach((tab, index) => {
    if (index === 1) {
      const active = makeRoundedPlane(48, 22, 6, { color: palette.neon, opacity: 0.12, solid: true, z: 4 });
      active.position.set(-w / 2 + 108, h / 2 - 61, 4);
      group.add(active);
    }
    addText(group, tab, -w / 2 + 26 + index * 82, h / 2 - 61, {
      size: 10.5,
      color: index === 1 ? palette.mist : palette.dim,
      anchorX: index === 1 ? 'center' : 'left',
    });
  });

  const rows = [
    ['GLD', 'SPDR Gold Shares', '415.39', '-11.80', palette.red, [4, 4, 3, 3, 2, 2, 2]],
    ['NVDA', 'NVIDIA Corporation', '226.38', '-9.36', palette.red, [6, 5, 4, 4, 4, 3, 3]],
    ['IBIT', 'iShares Bitcoin Trust ETF', '44.80', '-1.37', palette.red, [7, 5, 4, 3, 3, 3, 3]],
    ['MSFT', 'Microsoft Corporation', '414.50', '+5.07', palette.green, [3, 4, 7, 8, 5, 4, 4]],
    ['GOOG', 'Alphabet Inc.', '392.67', '-4.50', palette.red, [3, 4, 4, 5, 7, 7, 8]],
    ['VOO', 'Vanguard S&P 500 ETF', '679.38', '-8.35', palette.red, [7, 6, 5, 4, 4, 4, 5]],
    ['BOTZ', 'Global X Robotics & AI ETF', '40.20', '-0.92', palette.red, [4, 3, 3, 2, 2, 1, 2]],
    ['SMCI', 'Super Micro Computer, Inc.', '31.04', '-1.99', palette.red, [7, 6, 5, 4, 2, 1, 2]],
  ];

  rows.forEach((row, index) => {
    const rowY = h / 2 - 95 - index * 28;
    addText(group, row[0], -w / 2 + 20, rowY, { size: 12.2, color: palette.mist });
    addText(group, row[1], -w / 2 + 20, rowY - 12, { size: 8.5, color: palette.dim, maxWidth: 160 });
    const spark = makeSparkline(row[5], 78, 15, row[4], true);
    spark.position.set(w / 2 - 132, rowY - 5, 6);
    group.add(spark);
    addText(group, row[2], w / 2 - 22, rowY, { size: 12.4, color: palette.mist, anchorX: 'right' });
    addText(group, row[3], w / 2 - 22, rowY - 13, { size: 9.2, color: row[4], anchorX: 'right' });
  });
  return group;
}

function createTrafficWidget(x, y) {
  const w = 410;
  const h = 310;
  const group = createWidget({ x, y, w, h, title: 'CIRCULATION', subtitle: 'Satellite · Quebec, Quebec', accent: palette.orange });
  const map = makeRoundedPlane(w - 38, h - 72, 6, { color: palette.neonDeep, opacity: 0.035, z: 3 });
  map.position.set(0, -22, 3);
  group.add(map);

  const roads = [
    [[-170, -86], [-95, -45], [-44, 6], [28, 38], [164, 91]],
    [[-166, 18], [-70, 3], [40, -9], [166, -54]],
    [[-130, 92], [-40, 52], [46, 5], [136, -86]],
    [[-180, -26], [-88, -22], [6, -31], [112, -17], [181, -1]],
  ];
  roads.forEach((road, index) => {
    const line = makeLine(road, index === 1 ? palette.gold : palette.green, index === 1 ? 0.86 : 0.62, 5);
    group.add(withPosition(line, 0, -22, 0));
  });
  addText(group, 'Quebec', -24, -16, { size: 29, color: palette.mist, opacity: 0.72, anchorX: 'center' });
  addText(group, 'Levis', 18, -56, { size: 18, color: palette.soft, opacity: 0.62, anchorX: 'center' });
  addText(group, '18 min clear · bridge steady', -w / 2 + 28, -h / 2 + 26, {
    size: 11.5,
    color: palette.soft,
    maxWidth: w - 56,
  });
  return group;
}

function createClockWidget(x, y) {
  const w = 410;
  const h = 238;
  const group = createWidget({ x, y, w, h, title: 'HORLOGE', accent: palette.mist });
  const face = makeCircle(61, palette.neonDeep, 0.13, 64, 4);
  face.position.set(0, -6, 4);
  group.add(face);
  group.add(withPosition(makeLine([[0, 0], [-43, 24]], palette.mist, 0.92, 6), 0, -6, 0));
  group.add(withPosition(makeLine([[0, 0], [36, -16]], palette.soft, 0.82, 6), 0, -6, 0));
  group.add(withPosition(makeLine([[0, 0], [38, 17]], palette.rose, 0.9, 6), 0, -6, 0));
  group.add(withPosition(makeCircle(5, palette.rose, 1, 20, 7), 0, -6, 0));
  for (let i = 0; i < 48; i += 1) {
    const major = i % 4 === 0;
    const tick = makeBar(major ? 2.2 : 1.1, major ? 12 : 7, palette.soft, major ? 0.48 : 0.24, 5);
    const angle = i / 48 * Math.PI * 2;
    tick.position.set(Math.cos(angle) * 53, Math.sin(angle) * 53 - 6, 5);
    tick.rotation.z = angle + Math.PI / 2;
    group.add(tick);
  }
  addText(group, '09:48:41 AM', 0, -91, {
    size: 15,
    color: palette.soft,
    anchorX: 'center',
  });
  return group;
}

function createCameraWidget(x, y) {
  const w = 410;
  const h = 260;
  const group = createWidget({ x, y, w, h, title: 'CAMERA', accent: palette.blue });
  const view = makeRoundedPlane(w - 38, h - 76, 7, { color: palette.neonDeep, opacity: 0.035, z: 3 });
  view.position.set(0, -24, 3);
  group.add(view);
  group.add(withPosition(makeBar(w - 40, 78, palette.neonDeep, 0.11, 4), 0, -66, 0));
  group.add(withPosition(makeBar(w - 40, 102, palette.neon, 0.08, 4), 0, -9, 0));
  group.add(withPosition(makeLine([[-180, -50], [-52, -12], [22, 38], [180, 80]], 0xcad1d9, 0.26, 5), 0, -24, 0));
  group.add(withPosition(makeLine([[-166, 24], [-34, 2], [114, -36]], 0xf2f2ee, 0.18, 5), 0, -24, 0));
  const carA = makeRoundedPlane(70, 34, 6, { color: palette.neonDeep, opacity: 0.08, z: 7 });
  carA.position.set(-92, 4, 7);
  carA.rotation.z = -0.22;
  group.add(carA);
  const carB = makeRoundedPlane(78, 38, 6, { color: palette.neon, opacity: 0.1, solid: true, z: 7 });
  carB.position.set(26, -10, 7);
  carB.rotation.z = 0.15;
  group.add(carB);
  addText(group, '15-05-2026 09:48:41', -w / 2 + 32, h / 2 - 62, {
    size: 9,
    color: palette.mist,
    opacity: 0.86,
  });
  addText(group, 'Driveway live · pull stream ready', -w / 2 + 20, -h / 2 + 20, {
    size: 11,
    color: palette.soft,
  });
  return group;
}

function createAgendaWidget(x, y) {
  const w = 410;
  const h = 466;
  const group = createWidget({ x, y, w, h, title: 'OUTLOOK AGENDA', accent: palette.blue });
  const sections = [
    ['AUJOURD HUI', 'Vendredi 15 Mai'],
    ['DIMANCHE 17 MAI', 'Depot VEF Canada 188,04$'],
    ['MARDI 19 MAI', 'Repata'],
    ['MERCREDI 20 MAI', 'PMT Hydro 256,02$'],
  ];
  let yCursor = h / 2 - 72;
  sections.forEach((section, sectionIndex) => {
    addText(group, section[0], -w / 2 + 20, yCursor, { size: 13, color: palette.soft });
    addText(group, section[1], -w / 2 + 20, yCursor - 20, { size: 11.5, color: sectionIndex === 0 ? palette.soft : palette.dim });
    yCursor -= sectionIndex === 0 ? 48 : 55;
    if (sectionIndex === 0) {
      const events = [
        ['Spectacle Comedie Musicale', 'Reunion Microsoft Teams', '19 h 30', '1h'],
        ['Comedie musicale parascolaire - Dans les bois', '650 Av. du Bourg-Royal, Quebec', '19 h 30', '2h30'],
      ];
      events.forEach((event) => {
        const dot = makeCircle(4, palette.mint, 1, 18, 5);
        dot.position.set(-w / 2 + 22, yCursor + 7, 5);
        group.add(dot);
        addText(group, event[0], -w / 2 + 42, yCursor + 12, { size: 13, color: palette.mist, maxWidth: 270 });
        addText(group, event[1], -w / 2 + 42, yCursor - 9, { size: 11, color: palette.soft, maxWidth: 260 });
        addText(group, event[2], w / 2 - 22, yCursor + 10, { size: 11, color: palette.soft, anchorX: 'right' });
        addText(group, event[3], w / 2 - 22, yCursor - 9, { size: 10, color: palette.soft, anchorX: 'right' });
        addDivider(group, 40, yCursor - 28, w - 86);
        yCursor -= 58;
      });
    }
  });
  return group;
}

function createCalendarWidget(x, y) {
  const w = 410;
  const h = 316;
  const group = createWidget({ x, y, w, h, title: 'CALENDRIER', accent: palette.violet });
  addText(group, 'May\n2026', 0, h / 2 - 71, {
    size: 14,
    color: palette.soft,
    anchorX: 'center',
    lineHeight: 1.05,
  });
  ['<<', '<', '>', '>>'].forEach((symbol, index) => {
    const xPos = [-154, -115, 114, 153][index];
    const button = makeRoundedPlane(32, 25, 5, { color: palette.neon, opacity: 0.12, solid: true, z: 4 });
    button.position.set(xPos, h / 2 - 70, 4);
    group.add(button);
    addText(group, symbol, xPos, h / 2 - 70, { size: 11, color: palette.mist, anchorX: 'center' });
  });
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  days.forEach((day, index) => {
    addText(group, day, -150 + index * 50, h / 2 - 116, {
      size: 10,
      color: palette.soft,
      anchorX: 'center',
    });
  });
  let value = 1;
  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 7; col += 1) {
      if (row === 0 && col < 5) continue;
      if (value > 31) continue;
      const cx = -150 + col * 50;
      const cy = h / 2 - 149 - row * 34;
      if (value === 15) {
        const active = makeRoundedPlane(44, 26, 5, { color: palette.neon, opacity: 0.14, solid: true, z: 4 });
        active.position.set(cx, cy, 4);
        group.add(active);
      }
      addText(group, String(value), cx, cy, {
        size: 12,
        color: value === 15 ? palette.mist : palette.soft,
        anchorX: 'center',
      });
      value += 1;
    }
  }
  return group;
}

function createMailWidget(x, y) {
  const w = 410;
  const h = 376;
  const group = createWidget({ x, y, w, h, title: 'OUTLOOK MAIL', accent: palette.blue, badge: '20' });
  const mails = [
    ['Thule', 'Our Spring sale is live!', 'Save up to 20% now', '09 h 33'],
    ['Seesaw', 'Vos mises a jour Seesaw pour May 15t...', 'Vous avez de nouvelles mises a jour dans S...', '08 h 21'],
    ['Ollama', 'Ollama 0.24 is now available with supp...', 'Ollama 0.24 is now available with support f...', '08 h 10'],
    ['Intelcom Notification', 'Nous avons votre colis!', 'Aimeriez-vous ajouter des instructions de l...', '08 h 02'],
    ['RONA', 'Longue fin de semaine? On s attaque ...', 'Economisez 40% avec la Semaine RONA!', '07 h 02'],
    ['Aeroplan', 'Jusqu a 90 % de points-bonis a l acha...', 'Les titulaires de carte de credit Aeroplan p...', '01 h 09'],
  ];
  mails.forEach((mail, index) => {
    const rowY = h / 2 - 72 - index * 48;
    const dot = makeCircle(3.5, index < 5 ? palette.blue : palette.dim, 1, 18, 5);
    dot.position.set(-w / 2 + 25, rowY + 7, 5);
    group.add(dot);
    addText(group, mail[0], -w / 2 + 40, rowY + 11, { size: 11.5, color: palette.soft, maxWidth: 160 });
    addText(group, mail[1], -w / 2 + 40, rowY - 7, { size: 12.5, color: palette.mist, maxWidth: 222 });
    addText(group, mail[2], -w / 2 + 40, rowY - 25, { size: 10.3, color: palette.dim, maxWidth: 240 });
    addText(group, mail[3], w / 2 - 92, rowY + 10, { size: 10, color: palette.soft, anchorX: 'right' });
    addText(group, 'ok  del  no', w / 2 - 25, rowY + 4, { size: 9, color: palette.dim, anchorX: 'right' });
    addDivider(group, 26, rowY - 37, w - 76);
  });
  return group;
}

function createTodoWidget(x, y) {
  const w = 410;
  const h = 300;
  const group = createWidget({ x, y, w, h, title: 'MICROSOFT TO-DO', accent: palette.blue });
  const select = makeRoundedPlane(w - 70, 28, 5, { color: palette.neon, opacity: 0.1, solid: true, z: 4 });
  select.position.set(10, h / 2 - 63, 4);
  group.add(select);
  addText(group, 'Taches', -w / 2 + 50, h / 2 - 63, { size: 12, color: palette.soft });
  addText(group, 'v', w / 2 - 54, h / 2 - 63, { size: 13, color: palette.soft, anchorX: 'center' });
  const tasks = [
    'Baisser tablette olivier',
    'Roller blades moi',
    'Investissement Olivier',
    'Mouchoirs portables',
    'Fil USB-C -USB-C pour Airpods Isabella',
    'Installer Wii Music',
  ];
  tasks.forEach((task, index) => {
    const rowY = h / 2 - 103 - index * 33;
    const circle = makeCircle(8, palette.neonDeep, 0.16, 32, 5);
    circle.position.set(-w / 2 + 50, rowY, 5);
    group.add(circle);
    group.add(withPosition(makeStroke(16, 16, 8, palette.gold, 0.16, 6), -w / 2 + 50, rowY, 0));
    addText(group, task, -w / 2 + 72, rowY, { size: 12.2, color: palette.soft, maxWidth: 270 });
    addText(group, '.', w / 2 - 38, rowY, { size: 16, color: palette.dim, anchorX: 'center' });
    addDivider(group, 24, rowY - 19, w - 94);
  });
  return group;
}

function createNewsWidget(x, y) {
  const w = 410;
  const h = 390;
  const group = createWidget({ x, y, w, h, title: 'FINANCIAL NEWS', accent: palette.mint, badge: '7' });
  const headlineRows = [
    ['Thiel-Backed Erebor Offers Venezuela Unlikely Banking Lifeline', 'bloomberg.com', '16m'],
    ['Odd Lots Live: Tracy and Joe Come to London', 'bloomberg.com', '36m'],
    ['Trump Says Relationship with China s Xi is Very Strong', 'bloomberg.com', '45m'],
    ['Is the only way really down for stocks?', 'ft.com', '2h'],
    ['The dawn of 24/7 solar power', 'ft.com', '2h'],
    ['Berro: Fed Should Communicate On-Hold Path', 'bloomberg.com', '2h'],
    ['Gilts fall as traders brace for Burnham to challenge Starmer', 'ft.com', '3h'],
  ];
  const avatar = makeRoundedPlane(48, 48, 6, { color: palette.neon, opacity: 0.1, solid: true, z: 4 });
  avatar.position.set(-w / 2 + 44, h / 2 - 83, 4);
  group.add(avatar);
  group.add(withPosition(makeCircle(12, palette.neon, 0.32, 24, 6), -w / 2 + 44, h / 2 - 77, 0));
  headlineRows.slice(0, 5).forEach((item, index) => {
    const rowY = h / 2 - 78 - index * 48;
    const textX = index === 0 ? -w / 2 + 86 : -w / 2 + 22;
    addText(group, item[0], textX, rowY, {
      size: index === 0 ? 12.6 : 12.4,
      color: palette.soft,
      maxWidth: index === 0 ? 268 : 330,
      lineHeight: 1.18,
    });
    addText(group, item[1], textX, rowY - 27, { size: 10.5, color: palette.dim });
    addText(group, item[2], w / 2 - 24, rowY - 23, { size: 10.5, color: palette.soft, anchorX: 'right' });
    addDivider(group, 16, rowY - 34, w - 64);
  });
  return group;
}

function createCategoryStack(x, y, categories = [
  ['AI NEWS', palette.mint, '7'],
  ['PLATFORMS', palette.mint, '7'],
  ['GENERAL TECH', palette.blue, '7'],
  ['TECHNOLOGY NEWS', palette.blue, '7'],
  ['SEMICONDUCTOR & ELECTRONICS', palette.rose, '7'],
]) {
  const w = 410;
  const group = new THREE.Group();
  group.position.set(x, y, 5);
  categories.forEach((cat, index) => {
    const row = makeRoundedPlane(w, 44, 8, {
      color: palette.card,
      opacity: 0.76,
      pulse: index % 4 === 0,
      z: 0,
    });
    const rowY = -index * 57;
    row.position.set(0, rowY, 0);
    group.add(row);
    group.add(withPosition(makeStroke(w, 44, 8, palette.neon, 0.58, 1), 0, rowY, 0));
    addText(group, '::', -w / 2 + 17, rowY + 1, { size: 10, color: palette.soft, opacity: 0.72 });
    const dot = makeCircle(3.2, cat[1], 1, 18, 5);
    dot.position.set(-w / 2 + 44, rowY + 1, 5);
    group.add(dot);
    addText(group, cat[0], -w / 2 + 58, rowY + 1, { size: 12.5, color: palette.soft, maxWidth: 250 });
    const badge = makeRoundedPlane(26, 17, 5, { color: palette.neon, opacity: 0.14, solid: true, z: 4 });
    badge.position.set(w / 2 - 70, rowY + 1, 4);
    group.add(badge);
    addText(group, cat[2], w / 2 - 70, rowY + 1, {
      size: 10,
      color: palette.mist,
      anchorX: 'center',
    });
    addText(group, '>', w / 2 - 22, rowY + 1, { size: 14, color: palette.soft, anchorX: 'center' });
  });
  return group;
}

function createTopBar() {
  const w = DASHBOARD.width;
  const h = 46;
  const group = new THREE.Group();
  group.position.set(0, DASHBOARD.height / 2 - h / 2, 6);
  group.add(makeRoundedPlane(w, h, 8, { color: palette.glass, opacity: 0.08, maxOpacity: 0.1, z: 0 }));
  group.add(makeStroke(w, h, 8, palette.neon, 0.56, 1));
  addHoloFrame(group, w, h, palette.neon);
  addText(group, 'Vendredi', -w / 2 + 24, 2, { size: 17, color: palette.mist });
  addText(group, '15 mai 2026', -w / 2 + 102, 2, { size: 13, color: palette.soft });
  const icons = ['P', 'PIN', '*', '=', 'R'];
  icons.forEach((icon, index) => {
    addText(group, icon, w / 2 - 188 + index * 40, 2, {
      size: icon.length > 1 ? 9.5 : 13,
      color: index === 0 ? palette.mint : index === 1 ? palette.rose : palette.soft,
      anchorX: 'center',
    });
  });
  return group;
}

function createFooter() {
  const w = DASHBOARD.width;
  const group = new THREE.Group();
  group.position.set(0, -DASHBOARD.height / 2 + 21, 7);
  addText(group, '15 categories - OPML', -w / 2 + 22, 0, { size: 10, color: palette.soft, opacity: 0.86 });
  const button = makeRoundedPlane(92, 25, 6, { color: palette.neon, opacity: 0.12, solid: true, z: 4 });
  button.position.set(w / 2 - 74, 0, 4);
  group.add(button);
  addText(group, '+ Add widget', w / 2 - 74, 0, { size: 10.5, color: palette.mist, anchorX: 'center' });
  return group;
}

function createProjectionBacklight() {
  const group = new THREE.Group();
  group.position.set(0, -DASHBOARD.height / 2 + 56, -10);

  const core = makeCircle(42, palette.neon, 0.22, 72, -8);
  core.scale.set(4.6, 0.52, 1);
  group.add(core);

  [82, 128, 178].forEach((radius, index) => {
    const ring = makeRing(radius * 0.82, radius, palette.neon, 0.11 - index * 0.025, 96, -7 + index * 0.1);
    ring.scale.y = 0.28;
    group.add(ring);
  });

  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    const beam = makeLine([
      [Math.cos(angle) * 42, Math.sin(angle) * 12],
      [Math.cos(angle) * 580, 210 + Math.sin(angle) * 110],
    ], palette.neon, 0.045, -6);
    group.add(beam);
  }
  return group;
}

function createReferenceCard(x = 0, y = 0) {
  const w = 560;
  const h = 228;
  const group = new THREE.Group();
  group.position.set(x, y, 14);
  group.userData.floatSeed = 1.4;
  floatingGroups.push(group);

  group.add(makeRoundedPlane(w, h, 8, {
    color: 0x08152f,
    opacity: 0.13,
    maxOpacity: 0.15,
    pulse: true,
    z: 0,
  }));
  group.add(makeRoundedPlane(w - 12, h - 12, 6, {
    color: 0x0a1c47,
    opacity: 0.06,
    maxOpacity: 0.08,
    z: 0.6,
  }));
  group.add(makeStroke(w + 6, h + 6, 10, palette.edgeBlue, 0.18, 0.85));
  group.add(makeStroke(w + 2, h + 2, 9, palette.edgeWhite, 0.72, 1.18));
  group.add(makeStroke(w, h, 8, palette.edgeWhite, 0.46, 1.28));
  group.add(makeStroke(w - 9, h - 9, 6, palette.neon, 0.34, 1.45));

  const topGlow = makeBar(w - 28, 2, palette.neonDeep, 0.48, 4);
  topGlow.position.set(0, h / 2 - 8, 4);
  group.add(topGlow);

  const softBeam = makeLine([
    [-w / 2 + 64, h / 2 - 16],
    [w / 2 - 96, h / 2 - 18],
  ], palette.neon, 0.25, 4.5);
  group.add(softBeam);

  const cyanWash = makeRoundedPlane(w - 24, h - 26, 7, {
    color: palette.card2,
    opacity: 0.08,
    maxOpacity: 0.1,
    z: 1.1,
  });
  cyanWash.position.set(0, -4, 1.1);
  group.add(cyanWash);

  const arc = makeRing(405, 409, palette.neon, 0.11, 128, 3);
  arc.position.set(96, -210, 3);
  arc.rotation.z = -0.24;
  group.add(arc);

  addText(group, 'Acme Inc.', -w / 2 + 24, h / 2 - 31, {
    size: 17,
    color: palette.mist,
  });

  const activePill = makeRoundedPlane(74, 24, 6, {
    color: palette.neonDeep,
    opacity: 0.42,
    solid: true,
    z: 6,
  });
  activePill.position.set(w / 2 - 57, h / 2 - 31, 6);
  group.add(activePill);
  const activeDot = makeCircle(2.7, palette.neon, 0.9, 16, 7);
  activeDot.position.set(w / 2 - 84, h / 2 - 31, 7);
  group.add(activeDot);
  addText(group, 'Active', w / 2 - 47, h / 2 - 31, {
    size: 9.2,
    color: 0xffffff,
    anchorX: 'center',
  });

  addText(group, 'Organizations and individuals store a vast amount of sensitive information online, ranging from personal details to financial data.', -w / 2 + 24, h / 2 - 74, {
    size: 9.2,
    color: palette.soft,
    maxWidth: w - 60,
    lineHeight: 1.24,
  });

  addText(group, 'Areas', -w / 2 + 24, h / 2 - 112, {
    size: 9,
    color: palette.soft,
    opacity: 0.9,
  });

  const tags = ['Sales', 'Engineering', 'Marketing', 'Legal'];
  let tagX = -w / 2 + 39;
  tags.forEach((tag) => {
    const tagW = tag.length * 6.2 + 22;
    const chip = makeRoundedPlane(tagW, 21, 5, {
      color: 0x0a1c47,
      opacity: 0.46,
      solid: true,
      z: 6,
    });
    chip.position.set(tagX + tagW / 2 - 15, h / 2 - 142, 6);
    group.add(chip);
    addText(group, tag, tagX + tagW / 2 - 15, h / 2 - 142, {
      size: 8.2,
      color: palette.mist,
      anchorX: 'center',
    });
    tagX += tagW + 8;
  });

  addText(group, '$12,567', -w / 2 + 24, -h / 2 + 43, {
    size: 12.8,
    color: palette.mist,
  });
  addText(group, '/mo', -w / 2 + 82, -h / 2 + 42, {
    size: 8,
    color: palette.soft,
  });
  addText(group, '$15,000 max', w / 2 - 24, -h / 2 + 43, {
    size: 8.8,
    color: palette.mist,
    anchorX: 'right',
  });

  const rail = makeBar(w - 52, 4, 0x10285e, 0.48, 6);
  rail.position.set(0, -h / 2 + 24, 6);
  group.add(rail);
  const progress = makeBar((w - 52) * 0.82, 4, palette.neon, 0.58, 7);
  progress.position.set(-(w - 52) * 0.09, -h / 2 + 24, 7);
  group.add(progress);
  const progressGlow = makeBar((w - 52) * 0.82, 9, palette.neon, 0.16, 6.5);
  progressGlow.position.set(progress.position.x, -h / 2 + 24, 6.5);
  group.add(progressGlow);

  return group;
}

function createCardReferenceScene() {
  const shell = makeRoundedPlane(620, 452, 10, {
    color: palette.glass,
    opacity: 0.08,
    maxOpacity: 0.11,
    pulse: true,
    z: -8,
  });
  panel.add(shell);
  panel.add(makeStroke(620, 452, 10, palette.edgeWhite, 0.32, -7));
  panel.add(makeStroke(596, 428, 8, palette.neon, 0.1, -6.8));
  addHoloGrid(panel, 600, 420, 54, palette.neon, 0.018);

  const titleY = 180;
  addText(panel, 'STOCKS CARD TREATMENT', -262, titleY, {
    size: 12,
    color: palette.soft,
  });
  addText(panel, 'full prototype markets widget', -262, titleY - 24, {
    size: 9,
    color: palette.dim,
  });

  const guide = makeLine([[-214, -190], [-94, -164], [34, -182], [156, -152], [246, -186]], palette.neon, 0.1, 2);
  panel.add(guide);

  panel.add(createMarketsWidget(0, -22));
}

function createDashboard() {
  const shell = makeRoundedPlane(DASHBOARD.width, DASHBOARD.height, DASHBOARD.corner, {
    color: palette.glass,
    opacity: 0.052,
    maxOpacity: 0.07,
    pulse: true,
    z: -2,
  });
  panel.add(shell);
  panel.add(makeStroke(DASHBOARD.width + 7, DASHBOARD.height + 7, DASHBOARD.corner + 3, palette.neonMid, 0.16, -1.5));
  panel.add(makeStroke(DASHBOARD.width, DASHBOARD.height, DASHBOARD.corner, palette.neon, 0.54, -1));
  addHoloGrid(panel, DASHBOARD.width, DASHBOARD.height, 70, palette.neon, 0.018);
  addHoloFrame(panel, DASHBOARD.width, DASHBOARD.height, palette.neon);

  const topY = DASHBOARD.height / 2 - 78;
  const colW = 410;
  const gap = DASHBOARD.gap;
  const colX = [
    -DASHBOARD.width / 2 + 22 + colW / 2,
    -DASHBOARD.width / 2 + 22 + colW * 1.5 + gap,
    -DASHBOARD.width / 2 + 22 + colW * 2.5 + gap * 2,
    -DASHBOARD.width / 2 + 22 + colW * 3.5 + gap * 3,
  ];
  [1, 2, 3].forEach((index) => {
    const divider = makeBar(2, DASHBOARD.height - 92, palette.neon, 0.22, 3);
    divider.position.set((colX[index - 1] + colX[index]) / 2, -20, 3);
    panel.add(divider);
  });

  panel.add(createTopBar());
  panel.add(createFooter());

  panel.add(createWeatherWidget(colX[0], topY - 314 / 2));
  panel.add(createMarketsWidget(colX[0], topY - 314 - 18 - 332 / 2));
  panel.add(createTrafficWidget(colX[0], topY - 314 - 18 - 332 - 18 - 310 / 2));

  panel.add(createClockWidget(colX[1], topY - 119));
  panel.add(createCameraWidget(colX[1], topY - 119 - 238 / 2 - 18 - 260 / 2));
  panel.add(createAgendaWidget(colX[1], topY - 119 - 238 / 2 - 18 - 260 - 18 - 466 / 2));

  panel.add(createCalendarWidget(colX[2], topY - 158));
  panel.add(createMailWidget(colX[2], topY - 158 - 316 / 2 - 18 - 376 / 2));
  panel.add(createTodoWidget(colX[2], topY - 158 - 316 / 2 - 18 - 376 - 18 - 300 / 2));

  panel.add(createCategoryStack(colX[3], topY - 22));
  panel.add(createNewsWidget(colX[3], topY - 22 - 57 * 5 - 18 - 390 / 2));
  panel.add(createCategoryStack(colX[3], topY - 22 - 57 * 5 - 18 - 390 - 18, [
    ['EURONEWS Live', palette.blue, 'R'],
    ['INTERNATIONAL', 0xeef45f, '7'],
    ['ACTUALITES', palette.mint, '7'],
    ['POLITIQUE', palette.blue, '7'],
    ['SANTE', palette.violet, '7'],
  ]));
}

function createBackdropParticles() {
  const geometry = new THREE.PlaneGeometry(2, 2);
  const colors = [palette.cyan, palette.mint, palette.orange, palette.violet, palette.rose];
  for (let i = 0; i < 110; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: colors[i % colors.length],
      transparent: true,
      opacity: 0.035 + Math.random() * 0.07,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const shard = new THREE.Mesh(geometry, material);
    shard.position.set((Math.random() - 0.5) * 1900, (Math.random() - 0.5) * 1120, -52 - Math.random() * 70);
    shard.scale.set(2 + Math.random() * 34, 0.7 + Math.random() * 1.8, 1);
    shard.rotation.z = (Math.random() - 0.5) * 0.55;
    shard.userData.seed = Math.random() * 100;
    stage.add(shard);
    particles.push(shard);
  }
}

function resize() {
  const width = root.clientWidth || window.innerWidth;
  const height = root.clientHeight || window.innerHeight;
  renderer.setSize(width, height, false);

  camera.left = -width / 2;
  camera.right = width / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();

  const bounds = SHOW_CARD_REFERENCE ? REFERENCE_SCENE : DASHBOARD;
  const scale = Math.min(width / (bounds.width + 24), height / (bounds.height + 24), 1);
  stage.scale.setScalar(scale);
}

function onPointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
}

function animate(now = performance.now()) {
  const elapsed = (now - startedAt) / 1000;
  smoothedPointer.lerp(pointer, 0.055);

  panel.rotation.y = smoothedPointer.x * 0.035;
  panel.rotation.x = -smoothedPointer.y * 0.022;
  panel.position.x = smoothedPointer.x * 8;
  panel.position.y = smoothedPointer.y * 5;

  for (const material of pulsingMaterials) {
    material.opacity = material.userData.baseOpacity + Math.sin(elapsed * 0.7) * 0.018;
  }

  for (const group of floatingGroups) {
    const seed = group.userData.floatSeed ?? 0;
    group.position.z = 4 + Math.sin(elapsed * 0.95 + seed) * 0.7;
  }

  for (const shard of particles) {
    const seed = shard.userData.seed;
    shard.position.x += Math.sin(elapsed * 0.24 + seed) * 0.025;
    shard.position.y += Math.cos(elapsed * 0.2 + seed) * 0.02;
    shard.material.opacity = 0.08 + Math.sin(elapsed * 0.7 + seed) * 0.035;
  }

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

createBackdropParticles();
if (SHOW_CARD_REFERENCE) {
  createCardReferenceScene();
} else {
  stage.add(createProjectionBacklight());
  createDashboard();
}
resize();

window.addEventListener('resize', resize);
window.addEventListener('pointermove', onPointerMove, { passive: true });
window.addEventListener('pointerleave', () => pointer.set(0, 0), { passive: true });

animate();
