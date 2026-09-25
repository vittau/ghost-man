// Renders the README's vaporwave banner and section headers as SVG, in the
// game's palette and with its bundled font embedded (GitHub shows SVGs as
// <img>, which can't fetch webfonts). Run: node docs/readme/generate.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const font = readFileSync(join(here, '../../src/assets/fonts/press-start-2p.woff2')).toString('base64');

// Kept in step with PALETTE / SKY / GHOSTS in src/config.ts.
const C = {
  bgDeep: '#0a0318',
  bg: '#1a0b34',
  pink: '#ff3fb0',
  accent: '#ff4fd8',
  cyan: '#00e5ff',
  text: '#ffe6ff',
  textDim: '#9d7fc4',
  chrome0: '#bff4ff',
  chrome2: '#d9b8ff',
  sunTop: '#ffd76a',
  sunMid: '#ff6fb0',
  sunBot: '#7a2ff0',
  skyUpper: '#2a0a4a',
  skyMid: '#5b1d6e',
  skyLower: '#8a2a7a',
  horizon: '#ff5f9e',
  pac: '#ffe14d',
  dot: '#ffe3fb',
  eye: '#f7f4ff',
  pupil: '#24104a',
  ghosts: ['#ff3b30', '#ff79c8', '#22d3ee', '#ff9f43'],
};

const style = `<style>@font-face{font-family:PS2P;src:url(data:font/woff2;base64,${font}) format('woff2')}text{font-family:PS2P,monospace}</style>`;

/** Deterministic noise so re-running the script doesn't churn the SVGs. */
function rng(seed) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** The favicon ghost (32-unit box), eyes glancing along `look`. */
function ghost(x, y, size, color, look = -1) {
  const k = size / 32;
  const px = 1.4 * look;
  return `<g transform="translate(${x - 16 * k} ${y - 16 * k}) scale(${k})">
    <path fill="${color}" filter="url(#glow)" d="M5 27V14.5a11 11 0 0 1 22 0V27l-3.7-3.2-3.6 3.2-3.7-3.2-3.7 3.2-3.6-3.2z"/>
    <ellipse cx="12" cy="14.5" rx="3.1" ry="3.6" fill="${C.eye}"/>
    <ellipse cx="20.4" cy="14.5" rx="3.1" ry="3.6" fill="${C.eye}"/>
    <circle cx="${12 + px}" cy="15.2" r="1.7" fill="${C.pupil}"/>
    <circle cx="${20.4 + px}" cy="15.2" r="1.7" fill="${C.pupil}"/>
  </g>`;
}

function pacman(x, y, r, facing = -1) {
  const a = 0.6;
  const dir = facing < 0 ? Math.PI : 0;
  const p = (t) => `${(x + r * Math.cos(t)).toFixed(1)} ${(y + r * Math.sin(t)).toFixed(1)}`;
  return `<path fill="${C.pac}" filter="url(#glow)" d="M${x} ${y}L${p(dir + a)}A${r} ${r} 0 1 1 ${p(dir - a)}Z"/>`;
}

const glowFilter = (id, blur) => `<filter id="${id}" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="${blur}" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;

function banner() {
  const W = 1280;
  const H = 440;
  const HZ = 300; // horizon
  const rand = rng(7);

  const stars = Array.from({ length: 70 }, () => {
    const x = rand() * W;
    const y = rand() * (HZ - 90);
    const r = 0.6 + rand() * 1.3;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${C.text}" opacity="${(0.3 + rand() * 0.6).toFixed(2)}"/>`;
  }).join('');

  // Sun: gradient disc, sliced by widening gaps towards the horizon.
  const sunR = 118;
  const slices = Array.from({ length: 7 }, (_, i) => {
    const y = HZ - 74 + i * 11 + i * i * 0.7;
    const h = 2 + i * 1.6;
    return `<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${h.toFixed(1)}" fill="black"/>`;
  }).join('');

  // Wireframe ridges either side of the sun.
  const ridge = (x0, x1, peaks, seed) => {
    const r = rng(seed);
    const pts = [[x0, HZ]];
    for (let i = 1; i < peaks; i++) {
      const x = x0 + ((x1 - x0) * i) / peaks;
      pts.push([x, HZ - 25 - r() * 80]);
    }
    pts.push([x1, HZ]);
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
    const spokes = pts
      .slice(1, -1)
      .map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}L${(x + (r() - 0.5) * 60).toFixed(1)} ${HZ}`)
      .join('');
    return `<path d="${d}Z" fill="${C.bgDeep}" opacity="0.92"/>
      <path d="${d}${spokes}" fill="none" stroke="${C.accent}" stroke-width="1.2" opacity="0.7"/>`;
  };

  // Perspective floor grid.
  const rows = Array.from({ length: 9 }, (_, i) => {
    const y = HZ + 3 + (i * i + i) * 1.75;
    return `<line x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }).join('');
  const cols = Array.from({ length: 31 }, (_, i) => {
    const t = (i - 15) / 15;
    return `<line x1="${W / 2 + t * 90}" y1="${HZ}" x2="${W / 2 + t * 1500}" y2="${H}"/>`;
  }).join('');

  // The chase: Pac-Man flees left along a row of dots, the squad on his tail.
  const floorY = 392;
  const dots = Array.from({ length: 7 }, (_, i) =>
    `<circle cx="${110 + i * 34}" cy="${floorY}" r="4" fill="${C.dot}" filter="url(#glow)"/>`,
  ).join('');
  const squad = C.ghosts.map((c, i) => ghost(520 + i * 92, floorY - 4, 62, c, -1)).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Ghost-Man: you are the ghost">
  ${style}
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bgDeep}"/>
      <stop offset="0.35" stop-color="${C.skyUpper}"/>
      <stop offset="0.62" stop-color="${C.skyMid}"/>
      <stop offset="0.85" stop-color="${C.skyLower}"/>
      <stop offset="1" stop-color="${C.horizon}"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.sunTop}"/>
      <stop offset="0.55" stop-color="${C.sunMid}"/>
      <stop offset="1" stop-color="${C.sunBot}"/>
    </linearGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.skyMid}"/>
      <stop offset="0.25" stop-color="${C.bg}"/>
      <stop offset="1" stop-color="${C.bgDeep}"/>
    </linearGradient>
    <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.chrome0}"/>
      <stop offset="0.45" stop-color="#ffffff"/>
      <stop offset="0.52" stop-color="${C.chrome2}"/>
      <stop offset="1" stop-color="${C.accent}"/>
    </linearGradient>
    <mask id="sunCut">
      <rect width="${W}" height="${HZ}" fill="white"/>
      ${slices}
    </mask>
    <pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse">
      <rect width="4" height="1.4" fill="black" opacity="0.22"/>
    </pattern>
    <radialGradient id="vignette" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.6" stop-color="black" stop-opacity="0"/>
      <stop offset="1" stop-color="black" stop-opacity="0.55"/>
    </radialGradient>
    ${glowFilter('glow', 1.6)}
    ${glowFilter('bigGlow', 6)}
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  ${stars}
  <circle cx="${W / 2}" cy="${HZ + 4}" r="${sunR + 36}" fill="${C.sunMid}" opacity="0.18" filter="url(#bigGlow)"/>
  <circle cx="${W / 2}" cy="${HZ + 4}" r="${sunR}" fill="url(#sun)" mask="url(#sunCut)"/>
  ${ridge(0, 470, 9, 3)}
  ${ridge(810, W, 9, 11)}
  <rect y="${HZ}" width="${W}" height="${H - HZ}" fill="url(#floor)"/>
  <g stroke="${C.pink}" stroke-width="1.3" opacity="0.65" filter="url(#glow)">${rows}${cols}</g>
  <line x1="0" x2="${W}" y1="${HZ}" y2="${HZ}" stroke="${C.horizon}" stroke-width="2.5" filter="url(#bigGlow)"/>
  ${dots}
  ${pacman(390, floorY, 26, -1)}
  ${squad}
  <g text-anchor="middle">
    <text x="${W / 2 + 5}" y="130" font-size="76" fill="${C.cyan}" opacity="0.75">GHOST-MAN</text>
    <text x="${W / 2 - 5}" y="126" font-size="76" fill="${C.pink}" opacity="0.75">GHOST-MAN</text>
    <text x="${W / 2}" y="128" font-size="76" fill="url(#chrome)" stroke="${C.bgDeep}" stroke-width="1.5" filter="url(#glow)">GHOST-MAN</text>
    <text x="${W / 2}" y="168" font-size="18" fill="${C.text}" letter-spacing="4">YOU ARE THE GHOST</text>
  </g>
  <rect width="${W}" height="${H}" fill="url(#scan)"/>
  <rect width="${W}" height="${H}" fill="url(#vignette)"/>
</svg>
`;
}

/** Neon-sign section header: a dark plate, a ghost, gradient lettering. */
function header(title, color, idx) {
  const W = 880;
  const H = 76;
  const id = `h${idx}`;
  const rand = rng(100 + idx);
  const stars = Array.from({ length: 14 }, () =>
    `<circle cx="${(560 + rand() * 300).toFixed(1)}" cy="${(10 + rand() * 30).toFixed(1)}" r="${(0.6 + rand()).toFixed(2)}" fill="${C.text}" opacity="${(0.25 + rand() * 0.5).toFixed(2)}"/>`,
  ).join('');
  const grid = Array.from({ length: 9 }, (_, i) => {
    const t = (i - 4) / 4;
    return `<line x1="${760 + t * 40}" y1="50" x2="${760 + t * 190}" y2="${H}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${title}">
  ${style}
  <defs>
    <linearGradient id="${id}bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bgDeep}"/>
      <stop offset="0.65" stop-color="${C.skyUpper}"/>
      <stop offset="1" stop-color="${C.skyMid}"/>
    </linearGradient>
    <linearGradient id="${id}edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.pink}"/>
      <stop offset="1" stop-color="${C.cyan}"/>
    </linearGradient>
    <linearGradient id="${id}ink" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.chrome0}"/>
      <stop offset="0.5" stop-color="#ffffff"/>
      <stop offset="0.56" stop-color="${C.chrome2}"/>
      <stop offset="1" stop-color="${C.accent}"/>
    </linearGradient>
    <linearGradient id="${id}fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.horizon}" stop-opacity="0"/>
      <stop offset="0.5" stop-color="${C.horizon}"/>
      <stop offset="1" stop-color="${C.horizon}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="${id}sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.sunTop}"/>
      <stop offset="1" stop-color="${C.sunMid}"/>
    </linearGradient>
    <clipPath id="${id}clip"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12"/></clipPath>
    ${glowFilter('glow', 1.4)}
  </defs>
  <g clip-path="url(#${id}clip)">
    <rect width="${W}" height="${H}" fill="url(#${id}bg)"/>
    ${stars}
    <path d="M734 50A26 26 0 0 1 786 50Z" fill="url(#${id}sun)" opacity="0.9"/>
    <line x1="520" x2="${W}" y1="50" y2="50" stroke="url(#${id}fade)" stroke-width="2" filter="url(#glow)"/>
    <g stroke="${C.pink}" stroke-width="1" opacity="0.55">${grid}
      <line x1="560" x2="${W}" y1="57" y2="57"/><line x1="540" x2="${W}" y1="66" y2="66"/></g>
  </g>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="none" stroke="url(#${id}edge)" stroke-width="2"/>
  ${ghost(44, 38, 40, color, 1)}
  <text x="84" y="50" font-size="26" fill="url(#${id}ink)" stroke="${C.bgDeep}" stroke-width="0.8" filter="url(#glow)">${title}</text>
</svg>
`;
}

writeFileSync(join(here, 'banner.svg'), banner());
const HEADERS = [
  ['play', 'PLAY'],
  ['steam-deck', 'STEAM DECK'],
  ['controls', 'CONTROLS'],
  ['squad', 'THE SQUAD'],
  ['rules', 'RULES'],
  ['build', 'BUILD IT'],
  ['credits', 'CREDITS'],
  ['support', 'SUPPORT'],
];
HEADERS.forEach(([file, title], i) => {
  writeFileSync(join(here, `h-${file}.svg`), header(title, C.ghosts[i % C.ghosts.length], i));
});
console.log(`wrote banner.svg + ${HEADERS.length} headers`);
