// Renderer only: consumes core output, never re-derives intervals.
import * as THREE from "three";
import { solveScene, statusAt } from "./src/core.mjs";

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
const vp = { xmin: -10, xmax: 10, ymin: -6, ymax: 6 };
const camera = new THREE.OrthographicCamera(vp.xmin, vp.xmax, vp.ymax, vp.ymin, 0.1, 100);
camera.position.set(0, 0, 30);

const data = await (await fetch("./data/scenes.json")).json();
const solvedCache = new Map();
const palette = ["#38bdf8", "#f472b6", "#a78bfa", "#fbbf24", "#34d399", "#fb7185", "#e879f9", "#facc15", "#22d3ee", "#c084fc", "#4ade80"];

function texture(text, color) {
  const cv = document.createElement("canvas");
  cv.width = 256; cv.height = 128;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(8,15,30,0.88)";
  g.strokeStyle = color; g.lineWidth = 8;
  g.beginPath(); g.roundRect(4, 4, 248, 120, 16); g.fill(); g.stroke();
  g.fillStyle = "#f8fafc"; g.font = "bold 44px ui-monospace, monospace";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 128, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let current = 0;
let t = 0;
let playing = false;
let labelSprites = [];
let occluderMeshes = [];

function solved() {
  if (!solvedCache.has(current)) solvedCache.set(current, solveScene(data.scenes[current]));
  return solvedCache.get(current);
}

function clearStage() {
  for (const s of labelSprites) { scene.remove(s); s.material.map.dispose(); s.material.dispose(); }
  for (const m of occluderMeshes) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
  labelSprites = []; occluderMeshes = [];
}

function build(sceneIdx) {
  clearStage();
  const sc = data.scenes[sceneIdx];
  for (const o of sc.occluders) {
    const geo = new THREE.PlaneGeometry(o.s[0], o.s[1]);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.72 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.p[0], o.p[1], 8);
    scene.add(mesh);
    occluderMeshes.push(mesh);
  }
  for (const lab of sc.labels) {
    const rec = solved().labels.find((l) => l.id === lab.id);
    const color = palette[rec.lane % palette.length];
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(lab.id.split("-").pop(), color), depthTest: true }));
    spr.scale.set(lab.s[0] * 1.05, lab.s[1] * 1.05, 1);
    spr.position.set(lab.p[0], lab.p[1], 6 - lab.z);
    scene.add(spr);
    labelSprites.push(spr);
  }
  document.getElementById("time").max = String(sc.T);
  document.getElementById("hudLane").textContent = `${solved().lanes} / clique ${solved().maxClique}`;
  document.getElementById("hudOv").textContent = String(solved().overlaps.length);
  document.getElementById("hudMiss").textContent = String(countMisses(sc, solved()));
}

// 60 Hz counterfactual computed once from the same exact intervals.
function countMisses(sc, s) {
  let miss = 0;
  for (const iv of s.overlaps) {
    let hit = false;
    for (let k = 0; k <= Math.floor(sc.T * 60); k++) {
      const tt = k / 60;
      if (iv.lo < tt && tt < iv.hi) { hit = true; break; }
    }
    if (!hit) miss++;
  }
  return miss;
}

function refresh() {
  const sc = data.scenes[current];
  const s = solved();
  const st = statusAt(s, sc, t);
  const card = document.getElementById("sceneRow");
  [...card.children].forEach((b, i) => b.style.borderColor = i === current ? "#38bdf8" : "#2b3d5f");
  const counts = { visible: 0, occluded: 0, out: 0 };
  for (let i = 0; i < st.length; i++) {
    const lab = sc.labels[i];
    const spr = labelSprites[i];
    const rec = st[i];
    counts[rec.status] = (counts[rec.status] || 0) + 1;
    spr.position.set(rec.x, rec.y, spr.position.z);
    const color = rec.status === "visible" ? 0x4ade80 : rec.status === "occluded" ? 0x94a3b8 : 0x334155;
    spr.material.color.setHex(color);
    spr.material.opacity = rec.status === "out" ? 0.35 : 1;
    spr.visible = rec.status !== "out" || (lab.p[0] + lab.v[0] * t > vp.xmin - 2 && lab.p[0] + lab.v[0] * t < vp.xmax + 2);
  }
  const live = s.collisions.filter((c) => c.lo < t && t < c.hi);
  document.getElementById("hudT").textContent = `${t.toFixed(3)} s`;
  document.getElementById("hudVis").textContent = String(counts.visible || 0);
  document.getElementById("hudCol").textContent = String(live.length);
  document.getElementById("time").value = String(t);
}

function tick() {
  if (playing) {
    t += 1 / 60;
    if (t > data.scenes[current].T) t = 0;
    refresh();
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  const span = 6;
  camera.left = -span * aspect; camera.right = span * aspect;
  camera.top = span; camera.bottom = -span;
  camera.updateProjectionMatrix();
}

const row = document.getElementById("sceneRow");
data.scenes.forEach((sc, i) => {
  const b = document.createElement("button");
  b.textContent = sc.name;
  b.onclick = () => { current = i; t = 0; build(i); refresh(); };
  row.appendChild(b);
});
document.getElementById("time").oninput = (e) => { t = +e.target.value; playing = false; document.getElementById("play").textContent = "▶ play"; refresh(); };
document.getElementById("play").onclick = (e) => { playing = !playing; e.target.textContent = playing ? "⏸ pause" : "▶ play"; };
document.getElementById("cert").onclick = () => {
  const payload = { generated_at: new Date().toISOString(), scenes: data.scenes.map((_, i) => solveScene(data.scenes[i])) };
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  a.download = "certificate.json";
  a.click();
  URL.revokeObjectURL(a.href);
};
addEventListener("resize", resize);
resize();
build(0);
refresh();
tick();