#!/usr/bin/env node
// LINEスタンプ「ほっとけペンギン」ビルドスクリプト
// SVG原画を生成し、ヘッドレスChromiumで透過PNGに変換する
//   node stamp/build.mjs
// 出力: stamp/svg/*.svg, stamp/png/*.png (main/tab/01-08)

import { mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { globSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SVG_DIR = join(ROOT, 'svg');
const PNG_DIR = join(ROOT, 'png');

// ---- 固定パレット(純黒・純白は使わない) ----
const C = {
  line:   '#4E3620', // 輪郭: ウォームブラウン
  text:   '#543820', // セリフ文字
  body:   '#A9CBE8', // 体: パステルブルー
  bodyHi: '#C3DCF0', // 体の明るい差し色
  belly:  '#FCF6EC', // おなか: クリーム
  cheek:  '#F5C2A8', // ほっぺ
  beak:   '#F2B98C', // くちばし・足
  coral:  '#FCC8B4', // ハート・ナイトキャップ
  sun:    '#FCD98C', // おひさま・月
  steam:  '#C8B8A4', // 湯気・弱い線
};

const FONT = `'Zen Maru Gothic','Kosugi Maru','IPAPGothic','Hiragino Maru Gothic ProN',sans-serif`;

// ---- パーツ ----
const eyes = (type) => {
  const y = 178, dx = 34;
  switch (type) {
    case 'happy': // にこにこ(∩型)
      return `<path d="M${185 - dx - 11},${y + 3} Q${185 - dx},${y - 10} ${185 - dx + 11},${y + 3}" fill="none" stroke="${C.line}" stroke-width="5" stroke-linecap="round"/>
              <path d="M${185 + dx - 11},${y + 3} Q${185 + dx},${y - 10} ${185 + dx + 11},${y + 3}" fill="none" stroke="${C.line}" stroke-width="5" stroke-linecap="round"/>`;
    case 'sleep': // ねむねむ(やわらかい下向きカーブ)
      return `<path d="M${185 - dx - 11},${y - 2} Q${185 - dx},${y + 7} ${185 - dx + 11},${y - 2}" fill="none" stroke="${C.line}" stroke-width="5" stroke-linecap="round"/>
              <path d="M${185 + dx - 11},${y - 2} Q${185 + dx},${y + 7} ${185 + dx + 11},${y - 2}" fill="none" stroke="${C.line}" stroke-width="5" stroke-linecap="round"/>`;
    case 'sad': // しゅん(点目+困り眉)
      return `<circle cx="${185 - dx}" cy="${y + 2}" r="5.5" fill="${C.line}"/>
              <circle cx="${185 + dx}" cy="${y + 2}" r="5.5" fill="${C.line}"/>
              <path d="M${185 - dx - 12},${y - 16} q10,-6 20,-1" fill="none" stroke="${C.line}" stroke-width="4" stroke-linecap="round"/>
              <path d="M${185 + dx + 12},${y - 16} q-10,-6 -20,-1" fill="none" stroke="${C.line}" stroke-width="4" stroke-linecap="round"/>`;
    case 'wink':
      return `<circle cx="${185 - dx}" cy="${y}" r="6" fill="${C.line}"/>
              <path d="M${185 + dx - 11},${y + 2} Q${185 + dx},${y - 9} ${185 + dx + 11},${y + 2}" fill="none" stroke="${C.line}" stroke-width="5" stroke-linecap="round"/>`;
    default: // dot: まんまる点目
      return `<circle cx="${185 - dx}" cy="${y}" r="6" fill="${C.line}"/>
              <circle cx="${185 + dx}" cy="${y}" r="6" fill="${C.line}"/>`;
  }
};

const flipper = (side, pose) => {
  // side: -1=左(向かって左), 1=右
  const x = 185 + side * 88, sw = 4;
  const shape = (cx, cy, rot) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="15" ry="36" fill="${C.body}" stroke="${C.line}" stroke-width="${sw}"
       transform="rotate(${rot * side} ${cx} ${cy})"/>`;
  switch (pose) {
    case 'up':    return shape(185 + side * 80, 150, 35);  // ばんざい(上向き)
    case 'wave':  return shape(185 + side * 84, 158, 46);  // 手ふり(斜め上)
    case 'front': return shape(185 + side * 48, 250, 72);  // 前ならえ(湯のみ・ハート抱き)
    case 'hidden': return '';
    default:      return shape(x, 218, 18);                // おろす
  }
};

// 体・顔の本体。opts: {eyes, flipL, flipR, tilt, blushLines}
const penguin = (o = {}) => {
  const tilt = o.tilt || 0;
  // 「前ならえ」は抱えている物ごと体の手前に描く。それ以外は体の後ろ
  const behindL = o.flipL !== 'front' ? flipper(-1, o.flipL || 'down') : '';
  const behindR = o.flipR !== 'front' ? flipper(1, o.flipR || 'down') : '';
  const frontFlips = (o.flipL === 'front' ? flipper(-1, 'front') : '') +
                     (o.flipR === 'front' ? flipper(1, 'front') : '');
  return `<g transform="rotate(${tilt} 185 210)">
    ${behindL}
    ${behindR}
    <!-- 足 -->
    <ellipse cx="152" cy="302" rx="18" ry="9" fill="${C.beak}" stroke="${C.line}" stroke-width="3.5"/>
    <ellipse cx="218" cy="302" rx="18" ry="9" fill="${C.beak}" stroke="${C.line}" stroke-width="3.5"/>
    <!-- 体(頭と一体のまんまる) -->
    <ellipse cx="185" cy="206" rx="92" ry="96" fill="${C.body}" stroke="${C.line}" stroke-width="4"/>
    <ellipse cx="185" cy="232" rx="58" ry="62" fill="${C.belly}"/>
    <!-- あほ毛 -->
    <path d="M185,111 q-3,-13 7,-19" fill="none" stroke="${C.line}" stroke-width="3.5" stroke-linecap="round"/>
    <!-- 目・くちばし・ほっぺ -->
    ${eyes(o.eyes || 'dot')}
    <ellipse cx="185" cy="196" rx="11" ry="7.5" fill="${C.beak}" stroke="${C.line}" stroke-width="3"/>
    <circle cx="130" cy="200" r="13.5" fill="${C.cheek}" opacity="0.85"/>
    <circle cx="240" cy="200" r="13.5" fill="${C.cheek}" opacity="0.85"/>
    ${o.extraOnBody || ''}
    ${frontFlips}
  </g>`;
};

// セリフ(白フチ付き丸ゴシック)
const label = (text, { size = 50, x = 185, y = 62 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-weight="700" font-size="${size}"
     text-anchor="middle" fill="${C.text}" stroke="#FFFFFF" stroke-width="12"
     paint-order="stroke" stroke-linejoin="round">${text}</text>`;

// 小物
const heart = (x, y, s, fill = C.coral) =>
  `<path transform="translate(${x} ${y}) scale(${s})" fill="${fill}" stroke="${C.line}" stroke-width="${2.5 / s}"
     d="M0,6 C-2,-1 -12,-2 -12,-9 C-12,-14 -8,-16 -5,-16 C-2,-16 0,-14 0,-11 C0,-14 2,-16 5,-16 C8,-16 12,-14 12,-9 C12,-2 2,-1 0,6 Z"/>`;

const sun = (x, y) => `
  <g stroke="${C.line}" stroke-width="3" stroke-linecap="round">
    <circle cx="${x}" cy="${y}" r="20" fill="${C.sun}"/>
    ${[0, 45, 90, 135, 180, 225, 270, 315].map(a => {
      const r = (a * Math.PI) / 180;
      return `<line x1="${x + Math.cos(r) * 27}" y1="${y + Math.sin(r) * 27}" x2="${x + Math.cos(r) * 35}" y2="${y + Math.sin(r) * 35}"/>`;
    }).join('')}
  </g>`;

const moonStars = () => `
  <path d="M310,110 a26,26 0 1,1 -20,-42 a20,20 0 1,0 20,42 Z" transform="rotate(-16 296 90)"
    fill="${C.sun}" stroke="${C.line}" stroke-width="3"/>
  <text x="72" y="140" font-family="${FONT}" font-weight="700" font-size="26" fill="${C.text}"
    stroke="#FFFFFF" stroke-width="7" paint-order="stroke" stroke-linejoin="round" transform="rotate(-14 72 140)">Zzz</text>
  <path d="M56,190 l3,8 8,3 -8,3 -3,8 -3,-8 -8,-3 8,-3 Z" fill="${C.sun}" stroke="${C.line}" stroke-width="2"/>`;

const teacup = () => `
  <g>
    <path d="M150,262 q0,26 35,26 q35,0 35,-26 l0,-10 q-35,8 -70,0 Z" fill="${C.belly}" stroke="${C.line}" stroke-width="3.5"/>
    <ellipse cx="185" cy="251" rx="35" ry="8" fill="#D8E8D0" stroke="${C.line}" stroke-width="3"/>
    <path d="M174,242 q-6,-8 0,-16 q5,-7 0,-14 M196,242 q6,-8 0,-16 q-5,-7 0,-14"
      fill="none" stroke="${C.steam}" stroke-width="3.5" stroke-linecap="round"/>
  </g>`;

const waveLines = () => `
  <g fill="none" stroke="${C.steam}" stroke-width="3.5" stroke-linecap="round">
    <path d="M300,132 q10,10 8,24"/>
    <path d="M316,124 q13,13 10,32"/>
  </g>`;

const sweat = () => `<path d="M272,138 q10,14 0,22 q-9,-8 0,-22 Z" fill="#BCD8EC" stroke="${C.line}" stroke-width="2.5"/>`;

const nightcap = () => `
  <g>
    <path d="M120,146 Q150,96 250,116 L236,88 Q170,60 122,110 Z" fill="${C.coral}" stroke="${C.line}" stroke-width="3.5"
      transform="rotate(3 180 120)"/>
    <circle cx="240" cy="99" r="11" fill="${C.belly}" stroke="${C.line}" stroke-width="3"/>
  </g>`;

// ---- スタンプ定義 ----
// キャンバスは全て 370x320。キャラは基準座標(185,210)に描き、sceneで組み合わせる。
const stamps = [
  {
    id: '01', name: 'おはよう',
    scene: () => sun(56, 112) + penguin({ eyes: 'happy', flipL: 'up', flipR: 'up' }) + label('おはよう'),
  },
  {
    id: '02', name: 'ありがとう',
    scene: () => penguin({ eyes: 'happy', tilt: 8 }) + heart(300, 150, 1.5) + heart(318, 196, 1.0) + label('ありがとう'),
  },
  {
    id: '03', name: 'OK!',
    scene: () => penguin({ eyes: 'wink', flipR: 'up' }) + label('OK!', { size: 58 }),
  },
  {
    id: '04', name: 'おつかれさま',
    scene: () => penguin({ eyes: 'happy', flipL: 'front', flipR: 'front', extraOnBody: teacup() }) +
      label('おつかれさま', { size: 44 }),
  },
  {
    id: '05', name: 'ごめんね',
    scene: () => penguin({ eyes: 'sad', tilt: 6 }) + sweat() +
      `<text x="308" y="250" font-family="${FONT}" font-weight="700" font-size="30" fill="${C.text}"
         stroke="#FFFFFF" stroke-width="8" paint-order="stroke">…</text>` + label('ごめんね'),
  },
  {
    id: '06', name: 'いってらっしゃい',
    scene: () => penguin({ eyes: 'happy', flipR: 'wave' }) + waveLines() +
      label('いってらっしゃい', { size: 38 }),
  },
  {
    id: '07', name: 'だいすき',
    scene: () => penguin({ eyes: 'happy', flipL: 'front', flipR: 'front', extraOnBody: heart(185, 262, 2.6) }) +
      heart(84, 132, 1.1) + heart(292, 122, 0.8) + label('だいすき'),
  },
  {
    id: '08', name: 'おやすみ',
    scene: () => penguin({ eyes: 'sleep', extraOnBody: nightcap() }) + moonStars() + label('おやすみ'),
  },
];

const svgDoc = (w, h, viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}">${body}</svg>`;

// ---- 出力対象 ----
const targets = stamps.map(s => ({
  file: `${s.id}`, w: 370, h: 320,
  svg: svgDoc(370, 320, '0 0 370 320', s.scene()),
}));

// メイン画像 240x240: にこにこ正面(文字なし・ハート添え)
targets.push({
  file: 'main', w: 240, h: 240,
  svg: svgDoc(240, 240, '38 42 294 294',
    penguin({ eyes: 'happy' }) + heart(292, 128, 1.2)),
});

// タブ画像 96x74: 顔のアップ
targets.push({
  file: 'tab', w: 96, h: 74,
  svg: svgDoc(96, 74, '69 88 232 178.9', penguin({ eyes: 'happy' })),
});

// ---- SVG書き出し + Chromiumで透過PNG化 ----
mkdirSync(SVG_DIR, { recursive: true });
mkdirSync(PNG_DIR, { recursive: true });

// 通常のchromeバイナリ(新headless)は --window-size を無視して500x233になるため、
// ビューポートを正確に守る headless_shell を使う
const CHROME = process.env.CHROME_BIN ||
  globSync('/opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell')[0] ||
  globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0];
if (!CHROME) throw new Error('Chromium not found. Set CHROME_BIN.');

const work = join(tmpdir(), `stamp-build-${process.pid}`);
mkdirSync(work, { recursive: true });

for (const t of targets) {
  const svgPath = join(SVG_DIR, `${t.file}.svg`);
  writeFileSync(svgPath, t.svg);

  const html = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}svg{display:block}</style>
${t.svg}`;
  const htmlPath = join(work, `${t.file}.html`);
  writeFileSync(htmlPath, html);

  const out = join(PNG_DIR, `${t.file}.png`);
  execFileSync(CHROME, [
    '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=00000000',
    `--window-size=${t.w},${t.h}`,
    `--screenshot=${out}`,
    `file://${htmlPath}`,
  ], { stdio: 'pipe' });
  console.log(`rendered ${t.file}.png (${t.w}x${t.h})`);
}
rmSync(work, { recursive: true, force: true });

// ---- 検証: 寸法 / RGBA / 1MB以下 ----
let ok = true;
for (const t of targets) {
  const p = join(PNG_DIR, `${t.file}.png`);
  const buf = readFileSync(p);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25); // 6 = RGBA
  const size = statSync(p).size;
  const pass = w === t.w && h === t.h && colorType === 6 && size <= 1024 * 1024;
  if (!pass) ok = false;
  console.log(`${pass ? 'OK ' : 'NG '} ${t.file}.png ${w}x${h} colorType=${colorType} ${(size / 1024).toFixed(1)}KB`);
}
if (!ok) { console.error('検証NGがあります'); process.exit(1); }
console.log('全ファイル LINE規格チェックOK');
