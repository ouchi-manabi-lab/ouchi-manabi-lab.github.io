#!/usr/bin/env node
// GPTなどで作ったイラストをLINEスタンプ規格の透過PNGに変換するスクリプト
//   1. stamp/originals/ に 01.png〜08.png, main.png, (任意)tab.png を置く (jpg/webpも可)
//   2. node stamp/prepare.mjs
//   3. stamp/png/ に規格化されたPNGが出力される
//
// 処理: 背景の自動透過(端からのフラッドフィル) → 余白トリム → 高品質縮小 → 中央配置
// 描画はヘッドレスChromiumのcanvasで行うため、npm依存なし。

import { mkdirSync, writeFileSync, readFileSync, statSync, rmSync, existsSync, globSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ORIG_DIR = join(ROOT, 'originals');
const PNG_DIR = join(ROOT, 'png');

// LINE規格: {出力名, 幅, 高さ, キャラ周囲の余白}
const targets = [
  ...['01', '02', '03', '04', '05', '06', '07', '08'].map(id => ({ file: id, w: 370, h: 320, margin: 10 })),
  { file: 'main', w: 240, h: 240, margin: 8 },
  { file: 'tab', w: 96, h: 74, margin: 3, fallback: 'main' }, // tab原画が無ければmainから縮小生成
];

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

const findOriginal = (name) => {
  for (const ext of Object.keys(MIME)) {
    const p = join(ORIG_DIR, name + ext);
    if (existsSync(p)) return p;
  }
  return null;
};

const CHROME = process.env.CHROME_BIN ||
  globSync('/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell')[0] ||
  globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0];
if (!CHROME) {
  console.error('Chromiumが見つかりません。環境変数 CHROME_BIN にChrome/Chromiumのパスを指定してください。');
  process.exit(1);
}

// ブラウザ内で実行する変換処理。<img>読み込み後に同期実行される
const pageScript = `
function process(img, W, H, MARGIN) {
  // 原寸で取り込み
  const src = document.createElement('canvas');
  src.width = img.naturalWidth; src.height = img.naturalHeight;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const im = sctx.getImageData(0, 0, src.width, src.height);
  const d = im.data, w = src.width, h = src.height;
  const idx = (x, y) => (y * w + x) * 4;

  // --- 背景の自動透過 ---
  // 四隅が不透明かつほぼ同色なら「背景色」とみなし、端から連結する近似色を透明化
  const corners = [[0,0],[w-1,0],[0,h-1],[w-1,h-1]].map(([x,y]) => d.slice(idx(x,y), idx(x,y)+4));
  const opaqueCorners = corners.filter(c => c[3] > 250);
  let bgRemoved = false;
  if (opaqueCorners.length === 4) {
    const [r0, g0, b0] = corners[0];
    const near = (c) => Math.abs(c[0]-r0) + Math.abs(c[1]-g0) + Math.abs(c[2]-b0) < 90;
    if (corners.every(near)) {
      const TOL = 110; // 背景色との合計RGB差の許容値(JPEGノイズ・グラデ縁を吸収)
      const match = (i) => d[i+3] > 0 && (Math.abs(d[i]-r0) + Math.abs(d[i+1]-g0) + Math.abs(d[i+2]-b0)) < TOL;
      const seen = new Uint8Array(w * h);
      const stack = [];
      for (let x = 0; x < w; x++) { stack.push(x, 0, x, h-1); }
      for (let y = 0; y < h; y++) { stack.push(0, y, w-1, y); }
      while (stack.length) {
        const y = stack.pop(), x = stack.pop();
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const p = y * w + x;
        if (seen[p]) continue;
        seen[p] = 1;
        if (!match(p * 4)) continue;
        d[p * 4 + 3] = 0;
        stack.push(x+1, y, x-1, y, x, y+1, x, y-1);
      }
      bgRemoved = true;
    }
  }
  sctx.putImageData(im, 0, 0);

  // --- 不透明部分のバウンディングボックス ---
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[idx(x, y) + 3] > 8) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = w - 1; maxY = h - 1; } // 全透明なら全体
  const bw = maxX - minX + 1, bh = maxY - minY + 1;

  // --- 段階縮小(1/2ずつ)で高品質にターゲットへフィット ---
  let cur = document.createElement('canvas');
  cur.width = bw; cur.height = bh;
  cur.getContext('2d').drawImage(src, minX, minY, bw, bh, 0, 0, bw, bh);
  const targetW = W - MARGIN * 2, targetH = H - MARGIN * 2;
  const scale = Math.min(targetW / bw, targetH / bh, 1);
  while (cur.width * 0.5 > bw * scale && cur.width > 2) {
    const half = document.createElement('canvas');
    half.width = Math.max(1, Math.round(cur.width / 2));
    half.height = Math.max(1, Math.round(cur.height / 2));
    const hctx = half.getContext('2d');
    hctx.imageSmoothingEnabled = true; hctx.imageSmoothingQuality = 'high';
    hctx.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }

  // --- 最終キャンバスに中央配置 ---
  const out = document.getElementById('out');
  out.width = W; out.height = H;
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = true; octx.imageSmoothingQuality = 'high';
  const fw = Math.round(bw * scale), fh = Math.round(bh * scale);
  octx.drawImage(cur, Math.round((W - fw) / 2), Math.round((H - fh) / 2), fw, fh);
  document.title = 'done bg=' + (bgRemoved ? 'removed' : 'kept');
}
`;

mkdirSync(PNG_DIR, { recursive: true });
const work = join(tmpdir(), `stamp-prepare-${process.pid}`);
mkdirSync(work, { recursive: true });

const done = [], skipped = [];
for (const t of targets) {
  let origPath = findOriginal(t.file);
  if (!origPath && t.fallback) origPath = findOriginal(t.fallback);
  if (!origPath) { skipped.push(t.file); continue; }

  const mime = MIME[extname(origPath).toLowerCase()];
  const dataUri = `data:${mime};base64,${readFileSync(origPath).toString('base64')}`;
  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}canvas{display:block}</style>
<canvas id="out"></canvas>
<script>${pageScript}<\/script>
<script>
  const img = new Image();
  img.onload = () => process(img, ${t.w}, ${t.h}, ${t.margin});
  img.src = ${JSON.stringify(dataUri)};
<\/script>`;
  const htmlPath = join(work, `${t.file}.html`);
  writeFileSync(htmlPath, html);

  const out = join(PNG_DIR, `${t.file}.png`);
  execFileSync(CHROME, [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    '--virtual-time-budget=10000',
    `--window-size=${t.w},${t.h}`,
    `--screenshot=${out}`,
    `file://${htmlPath}`,
  ], { stdio: 'pipe' });
  console.log(`converted ${t.file}.png  (from ${origPath.split('/').pop()})`);
  done.push(t);
}
rmSync(work, { recursive: true, force: true });

if (!done.length) {
  console.error(`原画がありません。${ORIG_DIR}/ に 01.png〜08.png, main.png を置いてください。`);
  process.exit(1);
}
if (skipped.length) console.log(`スキップ(原画なし): ${skipped.join(', ')}`);

// ---- 検証: 寸法 / RGBA / 1MB以下 / 中身が空でないか ----
let ok = true;
for (const t of done) {
  const p = join(PNG_DIR, `${t.file}.png`);
  const buf = readFileSync(p);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25); // 6 = RGBA
  const size = statSync(p).size;
  const pass = w === t.w && h === t.h && colorType === 6 && size <= 1024 * 1024 && size > 500;
  if (!pass) ok = false;
  console.log(`${pass ? 'OK ' : 'NG '} ${t.file}.png ${w}x${h} colorType=${colorType} ${(size / 1024).toFixed(1)}KB`);
}
if (!ok) { console.error('検証NGがあります'); process.exit(1); }
console.log(`変換完了 (${done.length}枚)。stamp/index.html をブラウザで開くとプレビューできます。`);
