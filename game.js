// 사과게임 대결 - 서버 없이 동작. 같은 시드(seed)면 누구에게나 같은 판이 나온다.
const ROWS = 10, COLS = 17, TIME = 120;
const $ = (id) => document.getElementById(id);
const board = $('board'), selbox = $('selbox');

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// ---------- 시드 난수 ----------
function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const kstDate = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dailySeed = () => 'd' + kstDate().replaceAll('-', '');
const randomSeed = () => Math.random().toString(36).slice(2, 8);

// ---------- 상태 ----------
const game = {
  seed: '', mode: 'solo', values: [], alive: [], score: 0,
  endAt: 0, timer: null, playing: false, portrait: false, cells: [],
};
const challenge = readChallenge();
$('nick').value = store.get('nick') || '';

function readChallenge() {
  const p = new URLSearchParams(location.search);
  const c = p.get('c'), s = parseInt(p.get('s'), 10);
  if (!c || !/^[a-z0-9]{1,16}$/.test(c) || !Number.isFinite(s)) return null;
  return { seed: c, score: Math.max(0, Math.min(s, 999)), name: (p.get('n') || '친구').slice(0, 10) };
}

// ---------- 판 그리기 ----------
function layout() {
  game.portrait = window.innerWidth < window.innerHeight * 0.9;
  const dr = game.portrait ? COLS : ROWS, dc = game.portrait ? ROWS : COLS;
  const availW = Math.min(document.querySelector('main').clientWidth, 980) - 16;
  const availH = window.innerHeight - (game.portrait ? 150 : 190);
  const cell = Math.max(18, Math.min(56, Math.floor(Math.min(availW / dc, availH / dr))));
  board.style.setProperty('--cell', cell + 'px');
  board.style.gridTemplateColumns = `repeat(${dc}, var(--cell))`;

  board.querySelectorAll('.cell').forEach((el) => el.remove());
  game.cells = [];
  for (let r = 0; r < dr; r++) {
    for (let c = 0; c < dc; c++) {
      const i = game.portrait ? c * COLS + r : r * COLS + c; // 세로 화면은 판을 전치해서 보여준다
      const el = document.createElement('div');
      el.className = 'cell';
      el.innerHTML = `<div class="apple">${game.values[i] || ''}</div>`;
      if (!game.alive[i]) el.classList.add('gone');
      board.appendChild(el);
      game.cells[i] = el;
    }
  }
}

function newBoard(seed) {
  const rand = rng(seed);
  game.values = Array.from({ length: ROWS * COLS }, () => 1 + Math.floor(rand() * 9));
  game.alive = game.values.map(() => true);
}

// ---------- 드래그 선택 ----------
let drag = null;
function pos(e) {
  const r = board.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function selected() {
  const x1 = Math.min(drag.x0, drag.x1), x2 = Math.max(drag.x0, drag.x1);
  const y1 = Math.min(drag.y0, drag.y1), y2 = Math.max(drag.y0, drag.y1);
  const out = [];
  game.cells.forEach((el, i) => {
    if (!game.alive[i]) return;
    const cx = el.offsetLeft + el.offsetWidth / 2, cy = el.offsetTop + el.offsetHeight / 2;
    if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2) out.push(i);
  });
  return { out, x1, y1, w: x2 - x1, h: y2 - y1 };
}
function paint() {
  const { out, x1, y1, w, h } = selected();
  const sum = out.reduce((s, i) => s + game.values[i], 0);
  game.cells.forEach((el) => el.classList.remove('sel'));
  out.forEach((i) => game.cells[i].classList.add('sel'));
  Object.assign(selbox.style, { display: 'block', left: x1 + 'px', top: y1 + 'px', width: w + 'px', height: h + 'px' });
  selbox.classList.toggle('ok', sum === 10);
  $('selsum').textContent = out.length ? `합 ${sum}` : '';
  return { out, sum };
}
board.addEventListener('pointerdown', (e) => {
  if (!game.playing) return;
  board.setPointerCapture(e.pointerId);
  const p = pos(e);
  drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  paint();
});
board.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = pos(e);
  drag.x1 = p.x; drag.y1 = p.y;
  paint();
});
function endDrag() {
  if (!drag) return;
  const { out, sum } = paint();
  drag = null;
  selbox.style.display = 'none';
  game.cells.forEach((el) => el.classList.remove('sel'));
  if (sum !== 10 || !game.playing) return;
  out.forEach((i) => {
    game.alive[i] = false;
    const el = game.cells[i];
    el.classList.add('pop');
    setTimeout(() => { el.classList.remove('pop'); el.classList.add('gone'); }, 280);
  });
  game.score += out.length;
  $('score').textContent = game.score;
  blip(out.length);
  if (!hasMove()) setTimeout(() => finish(true), 300);
}
board.addEventListener('pointerup', endDrag);
board.addEventListener('pointercancel', endDrag);

// 남은 사과로 합 10을 만들 수 있는 네모가 하나라도 있는지 (누적합으로 검사)
function hasMove() {
  const P = Array.from({ length: ROWS + 1 }, () => new Array(COLS + 1).fill(0));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      P[r + 1][c + 1] = (game.alive[i] ? game.values[i] : 0) + P[r][c + 1] + P[r + 1][c] - P[r][c];
    }
  }
  for (let r1 = 0; r1 < ROWS; r1++)
    for (let r2 = r1 + 1; r2 <= ROWS; r2++)
      for (let c1 = 0; c1 < COLS; c1++)
        for (let c2 = c1 + 1; c2 <= COLS; c2++) {
          const s = P[r2][c2] - P[r1][c2] - P[r2][c1] + P[r1][c1];
          if (s === 10) return true;
          if (s > 10) break;
        }
  return false;
}

// ---------- 효과음 (직접 합성) ----------
let audio;
function blip(n) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 520 + Math.min(n, 6) * 80;
    g.gain.setValueAtTime(0.08, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.15);
    o.connect(g).connect(audio.destination);
    o.start(); o.stop(audio.currentTime + 0.16);
  } catch {}
}

// ---------- 게임 흐름 ----------
function modeText() {
  if (game.mode === 'daily') return `오늘의 판 · ${kstDate().slice(5).replace('-', '/')}`;
  if (game.mode === 'challenge') return `${challenge.name}님의 도전 · ${challenge.score}점`;
  return '랜덤 판';
}
function start(mode, seed) {
  store.set('nick', $('nick').value.trim());
  Object.assign(game, { mode, seed, score: 0, playing: true });
  newBoard(seed);
  layout();
  $('score').textContent = '0';
  $('modeLabel').textContent = modeText();
  $('startOverlay').hidden = true;
  $('endOverlay').hidden = true;
  game.endAt = Date.now() + TIME * 1000;
  clearInterval(game.timer);
  game.timer = setInterval(tick, 200);
  tick();
}
function tick() {
  const left = Math.max(0, game.endAt - Date.now());
  const bar = $('time');
  bar.style.width = (left / (TIME * 1000)) * 100 + '%';
  bar.classList.toggle('low', left < 20000);
  if (left === 0) finish(false);
}
function finish(cleared) {
  if (!game.playing) return;
  game.playing = false;
  clearInterval(game.timer);
  drag = null;
  selbox.style.display = 'none';

  const key = game.mode === 'daily' ? 'best:' + game.seed : 'best:' + game.mode;
  const prev = parseInt(store.get(key) || '0', 10);
  if (game.score > prev) store.set(key, String(game.score));
  $('endTitle').textContent = cleared ? '더 묶을 사과가 없어요!' : '시간 종료!';
  $('endScore').textContent = game.score;
  $('endBest').textContent = game.score > prev && prev > 0 ? `🎉 최고 기록 경신! (이전 ${prev}점)` : `내 최고 기록 ${Math.max(prev, game.score)}점`;

  const vs = $('endVs');
  vs.hidden = game.mode !== 'challenge';
  if (game.mode === 'challenge') {
    const d = game.score - challenge.score;
    vs.textContent = d > 0 ? `🏆 ${challenge.name}님(${challenge.score}점)을 ${d}점 차로 이겼어요!`
      : d === 0 ? `🤝 ${challenge.name}님과 동점이에요!`
      : `😢 ${challenge.name}님(${challenge.score}점)에게 ${-d}점 졌어요`;
  }
  $('endOverlay').hidden = false;
}

async function share() {
  const nick = $('nick').value.trim() || store.get('nick') || '';
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('c', game.seed);
  url.searchParams.set('s', game.score);
  if (nick) url.searchParams.set('n', nick);
  const text = `🍎 사과게임 ${game.score}점! 같은 판으로 나를 이겨 봐`;
  try {
    if (navigator.share) { await navigator.share({ title: '사과게임 도전장', text, url: url.href }); return; }
    await navigator.clipboard.writeText(`${text}\n${url.href}`);
    toast('도전장 링크를 복사했어요. 친구에게 붙여넣어 보내세요!');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    prompt('아래 링크를 복사해서 보내세요', url.href);
  }
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 2500);
}

// ---------- 버튼 ----------
$('playDaily').onclick = () => start('daily', dailySeed());
$('playSolo').onclick = () => start('solo', randomSeed());
$('playChallenge').onclick = () => start('challenge', challenge.seed);
$('again').onclick = () => start(game.mode, game.seed);
$('share').onclick = share;
$('quit').onclick = () => { if (game.playing) finish(false); };
$('home').onclick = () => { $('endOverlay').hidden = true; $('startOverlay').hidden = false; };

if (challenge) {
  const box = $('challengeBox');
  box.hidden = false;
  box.textContent = `📨 ${challenge.name}님이 ${challenge.score}점으로 도전장을 보냈어요!`;
  $('playChallenge').hidden = false;
}

// 첫 화면 배경용 판 (실제 판을 미리 보지 못하게 별도 시드)
newBoard('preview');
layout();
$('modeLabel').textContent = '';
let lastPortrait = game.portrait;
window.addEventListener('resize', () => {
  if (drag) return;
  const p = window.innerWidth < window.innerHeight * 0.9;
  if (p !== lastPortrait || !game.playing) { lastPortrait = p; layout(); }
});
