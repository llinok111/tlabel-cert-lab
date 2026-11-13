// Deterministic sample-scene generator. Same command => byte-identical output.
import { mkdirSync, writeFileSync } from "node:fs";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T = 4;
const vp = { xmin: -10, xmax: 10, ymin: -6, ymax: 6 };

function makeScene(name, seed, labels, occluders) {
  return {
    name,
    T,
    viewport: { ...vp },
    labels: labels.map((l, i) => ({ id: `${name}-L${i}`, ...l })),
    occluders: occluders.map((o, i) => ({ id: `${name}-O${i}`, ...o })),
  };
}

function crossingsRows() {
  const labels = [];
  for (let k = 0; k < 8; k++) {
    const row = k % 2 === 0 ? -0.9 : 0.9;
    labels.push({ p: [-9 + k * 2.2, row], v: [3.6, 0], s: [0.55, 0.38], priority: (k * 3) % 5, z: 1 + (k % 3) });
  }
  for (let k = 0; k < 8; k++) {
    const row = k % 2 === 0 ? 0.9 : -0.9;
    labels.push({ p: [9 - k * 2.2, row], v: [-3.6, 0], s: [0.55, 0.38], priority: (k * 2 + 1) % 5, z: 1 + ((k + 1) % 3) });
  }
  return makeScene("crossing-rows", 11, labels, []);
}

function subframeConveyor() {
  const labels = [];
  for (let k = 0; k < 6; k++) {
    labels.push({ p: [-9 + k * 3, 0], v: [120, 0], s: [0.12, 0.12], priority: k % 3, z: 2 });
    labels.push({ p: [9 - k * 3, 0], v: [-120, 0], s: [0.12, 0.12], priority: (k + 1) % 3, z: 2 });
  }
  return makeScene("subframe-conveyor", 22, labels, []);
}

function swarm() {
  const rnd = mulberry32(33);
  const labels = [];
  for (let k = 0; k < 18; k++) {
    labels.push({
      p: [-4 + rnd() * 8, -3 + rnd() * 6],
      v: [-2.5 + rnd() * 5, -2.5 + rnd() * 5],
      s: [0.35 + rnd() * 0.35, 0.25 + rnd() * 0.25],
      priority: Math.floor(rnd() * 6),
      z: rnd() * 3,
    });
  }
  const occ = [];
  for (let k = 0; k < 3; k++) {
    occ.push({ p: [-7 + k * 5, -4 + k * 2], v: [1.2 + k * 0.2, -0.6], s: [2.4, 1.6], z: 6 });
  }
  return makeScene("swarm-occlusion", 33, labels, occ);
}

function priorityStack() {
  const rnd = mulberry32(44);
  const labels = [];
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    labels.push({
      p: [0.05 * k, -0.04 * k],
      v: [1.1 * Math.cos(a), 1.1 * Math.sin(a)],
      s: [0.62, 0.42],
      priority: k,
      z: rnd() * 2,
    });
  }
  return makeScene("priority-stack", 44, labels, []);
}

function viewportEgress() {
  const rnd = mulberry32(55);
  const labels = [];
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + 0.2;
    labels.push({
      p: [Math.cos(a) * 1.2, Math.sin(a) * 1.2],
      v: [Math.cos(a) * (3 + rnd() * 2), Math.sin(a) * (3 + rnd() * 2)],
      s: [0.45, 0.32],
      priority: k % 4,
      z: rnd() * 2,
    });
  }
  return makeScene("viewport-egress", 55, labels, []);
}

function occluderSweep() {
  const rnd = mulberry32(66);
  const labels = [];
  for (let k = 0; k < 12; k++) {
    labels.push({
      p: [-8 + (k % 4) * 5, -3 + Math.floor(k / 4) * 3],
      v: [0.35 * Math.sin(k), 0.2 * Math.cos(k)],
      s: [0.5, 0.34],
      priority: k % 3,
      z: rnd(),
    });
  }
  const occ = [];
  for (let k = 0; k < 4; k++) {
    occ.push({ p: [-12 + k * 3, -5 + k * 3], v: [3.2, 0.4 - 0.2 * k], s: [1.8, 1.2], z: 5 });
  }
  return makeScene("occluder-sweep", 66, labels, occ);
}

const scenes = [
  crossingsRows(),
  subframeConveyor(),
  swarm(),
  priorityStack(),
  viewportEgress(),
  occluderSweep(),
];

mkdirSync(new URL("../data", import.meta.url), { recursive: true });
const out = new URL("../data/scenes.json", import.meta.url);
writeFileSync(out, JSON.stringify({ version: 1, scenes }, null, 2) + "\n");
const labelCount = scenes.reduce((n, s) => n + s.labels.length, 0);
console.log(`wrote ${scenes.length} scenes, ${labelCount} labels -> data/scenes.json`);