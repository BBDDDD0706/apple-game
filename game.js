// 사과게임 대결 - 같은 시드(seed)면 누구에게나 같은 판이 나온다.
const ROWS = 10, COLS = 17, TIME = 120;
const $ = (id) => document.getElementById(id);
const board = $('board'), selbox = $('selbox');
const APPLE_SVG = '<svg viewBox="0 0 100 100"><use href="#apple"/></svg>';

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
let roomPlayers = [];
const challenge = readChallenge();
$('nick').value = store.get('nick') || '';

function readChallenge() {
  const p = new URLSearchParams(location.search);
  const c = p.get('c'), s = parseInt(p.get('s'), 10);
  if (!c || !/^[a-z0-9]{1,16}$/.test(c) || !Number.isFinite(s)) return null;
  return { seed: c, score: Math.max(0, Math.min(s, 999)), name: (p.get('n') || '친구').slice(0, 10) };
}
const nick = () => { const n = $('nick').value.trim().slice(0, 10); store.set('nick', n); return n || '플레이어'; };

// ---------- 판 그리기 ----------
function layout() {
  game.portrait = window.innerWidth < window.innerHeight * 0.9;
  const dr = game.portrait ? COLS : ROWS, dc = game.portrait ? ROWS : COLS;
  const availW = Math.min(document.querySelector('main').clientWidth, 980) - 16;
  const availH = window.innerHeight - (game.portrait ? 170 : 210);
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
      el.innerHTML = `<div class="apple">${APPLE_SVG}<b>${game.values[i] || ''}</b></div>`;
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
  Sound.pop(out.length);
  if (game.mode === 'room') Room.sendScore(game.score, false);
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

// ---------- 화면 전환 ----------
const overlays = ['startOverlay', 'endOverlay'];
function show(id) {
  const lobby = id === 'lobby';
  $('lobbyScreen').hidden = !lobby;
  $('gameScreen').hidden = lobby;
  overlays.forEach((o) => ($(o).hidden = o !== id));
  if (lobby) window.scrollTo(0, 0);
}

function modeText() {
  if (game.mode === 'daily') return `오늘의 판 · ${kstDate().slice(5).replace('-', '/')}`;
  if (game.mode === 'challenge') return `${challenge.name}님의 도전 · ${challenge.score}점`;
  if (game.mode === 'room') return '방 대결';
  return '랜덤 판';
}

// 3-2-1 카운트다운 뒤 시작
function start(mode, seed) {
  clearInterval(game.timer);
  Object.assign(game, { mode, seed, score: 0, playing: false });
  show(null);
  $('score').textContent = '0';
  $('modeLabel').textContent = modeText();
  $('time').style.width = '100%';
  $('time').classList.remove('low');
  const count = $('count');
  let n = 3;
  count.hidden = false;
  count.textContent = n;
  Sound.beep(false);
  const iv = setInterval(() => {
    n--;
    if (n > 0) { count.textContent = n; Sound.beep(false); return; }
    clearInterval(iv);
    count.hidden = true;
    Sound.beep(true);
    begin();
  }, 700);
}
function begin() {
  newBoard(game.seed);
  layout();
  game.playing = true;
  game.endAt = Date.now() + TIME * 1000;
  Sound.setTempo(132);
  Sound.startBgm();
  game.timer = setInterval(tick, 200);
  tick();
}
function tick() {
  const left = Math.max(0, game.endAt - Date.now());
  const bar = $('time');
  bar.style.width = (left / (TIME * 1000)) * 100 + '%';
  bar.classList.toggle('low', left < 20000);
  if (left < 20000) Sound.setTempo(160); // 막판엔 음악이 빨라진다
  if (left === 0) finish(false);
}

function finish(cleared) {
  if (!game.playing) return;
  game.playing = false;
  clearInterval(game.timer);
  Sound.stopBgm();
  drag = null;
  selbox.style.display = 'none';

  const key = game.mode === 'daily' ? 'best:' + game.seed : 'best:' + game.mode;
  const prev = parseInt(store.get(key) || '0', 10);
  if (game.score > prev) store.set(key, String(game.score));
  $('endTitle').textContent = cleared ? '더 묶을 사과가 없어요!' : '시간 종료!';
  $('endScore').textContent = game.score;
  $('endBest').textContent = game.score > prev && prev > 0 ? `🎉 최고 기록 경신! (이전 ${prev}점)` : `내 최고 기록 ${Math.max(prev, game.score)}점`;

  const inRoom = game.mode === 'room';
  $('soloBtns').hidden = inRoom;
  $('roomBtns').hidden = !inRoom;
  $('endPlayers').hidden = !inRoom;
  const vs = $('endVs');
  vs.hidden = game.mode !== 'challenge';
  if (game.mode === 'challenge') {
    const d = game.score - challenge.score;
    vs.textContent = d > 0 ? `🏆 ${challenge.name}님(${challenge.score}점)을 ${d}점 차로 이겼어요!`
      : d === 0 ? `🤝 ${challenge.name}님과 동점이에요!`
      : `😢 ${challenge.name}님(${challenge.score}점)에게 ${-d}점 졌어요`;
  }
  if (inRoom) {
    Room.sendScore(game.score, true);
    $('rematch').hidden = !Room.isHost;
    $('rematchMsg').hidden = Room.isHost;
    $('endTitle').textContent = '판 종료!';
    renderRanking();
  }
  show('endOverlay');
}

// ---------- 방 ----------
function renderPlayers(ul, players, withScore) {
  ul.replaceChildren();
  const sorted = withScore ? [...players].sort((a, b) => b.score - a.score) : players;
  sorted.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === Room.myId) li.className = 'me';
    const left = document.createElement('span');
    if (withScore) { const r = document.createElement('span'); r.className = 'rank'; r.textContent = `${i + 1}위`; left.append(r); }
    left.append(p.name + (p.id === Room.myId ? ' (나)' : ''));
    const right = document.createElement('span');
    right.textContent = withScore ? `${p.score}점${p.done ? '' : ' · 진행 중'}` : (i === 0 ? '방장' : '');
    li.append(left, right);
    ul.append(li);
  });
}
function renderLive() {
  const live = $('live');
  live.replaceChildren();
  if (game.mode !== 'room') return;
  [...roomPlayers].sort((a, b) => b.score - a.score).forEach((p) => {
    const s = document.createElement('span');
    if (p.id === Room.myId) s.className = 'me';
    s.textContent = `${p.name} ${p.score}`;
    live.append(s);
  });
}
function renderRanking() {
  renderPlayers($('endPlayers'), roomPlayers, true);
  const me = [...roomPlayers].sort((a, b) => b.score - a.score).findIndex((p) => p.id === Room.myId);
  if (roomPlayers.length > 1 && roomPlayers.every((p) => p.done)) {
    $('endTitle').textContent = me === 0 ? '🏆 1등이에요!' : `${me + 1}등이에요!`;
    if (Room.isHost) Room.endRound();
  }
}

// 대기실 그리기
const MAX_SEATS = 8;
// 방송용: 초대코드는 기본으로 흐리게 가린다
function maskCode(masked) {
  $('roomCode').classList.toggle('masked', masked);
  $('revealCode').textContent = masked ? '👁 코드 보기' : '🙈 코드 가리기';
}
$('revealCode').onclick = () => maskCode(!$('roomCode').classList.contains('masked'));
$('peekJoin').onclick = () => $('joinCode').classList.toggle('shown');
function setCode(code) {
  const box = $('roomCode');
  box.replaceChildren();
  for (let i = 0; i < 5; i++) {
    const s = document.createElement('span');
    s.textContent = code ? code[i] : '•';
    if (!code) s.className = 'dot';
    box.append(s);
  }
}
function renderLobby(players) {
  const ul = $('lobbyPlayers');
  ul.replaceChildren();
  for (let i = 0; i < MAX_SEATS; i++) {
    const p = players[i];
    const li = document.createElement('li');
    if (!p) {
      li.className = 'seat empty';
      li.textContent = i === players.length ? '초대 대기 중…' : '빈 자리';
      ul.append(li);
      continue;
    }
    li.className = 'seat' + (p.id === Room.myId ? ' me' : '');
    const av = document.createElement('div');
    av.className = 'avatar';
    av.innerHTML = APPLE_SVG;
    const b = document.createElement('b');
    b.textContent = p.name.slice(0, 1);
    av.append(b);
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = p.name;
    const tag = document.createElement('span');
    tag.className = 'tag' + (i === 0 ? ' host' : '');
    tag.textContent = i === 0 ? '방장' : (p.id === Room.myId ? '나' : '준비 완료');
    if (i === 0) { const c = document.createElement('span'); c.className = 'crown'; c.textContent = '👑'; li.append(c); }
    li.append(av, name, tag);
    ul.append(li);
  }
  $('seatCount').textContent = `${players.length}/${MAX_SEATS}`;
  const btn = $('roomStart');
  btn.disabled = players.length < 2;
  btn.textContent = players.length < 2 ? '친구가 들어오면 시작할 수 있어요' : `게임 시작 (${players.length}명)`;
  if (Room.isHost) $('lobbyMsg').textContent = players.length < 2 ? '초대코드를 친구에게 알려 주세요' : '모두 모였으면 시작!';
  else if (players.length) $('lobbyMsg').textContent = '곧 시작해요. 준비하세요!';
}

const roomHandlers = {
  onReady(code) {
    setCode(code);
    $('roomStart').hidden = false;
    $('lobbyBadge').textContent = '👑 내가 방장';
    $('lobbyBadge').classList.remove('wait');
  },
  onLobby(players) {
    roomPlayers = players;
    renderLobby(players);
    if (!Room.isHost) {
      setCode(Room.code);
      $('lobbyBadge').textContent = '방장을 기다리는 중';
      $('lobbyBadge').classList.add('wait');
      if (!game.playing && $('endOverlay').hidden) show('lobby');
    }
    if (!$('endOverlay').hidden && game.mode === 'room') renderRanking();
  },
  onStart(seed) { roomPlayers.forEach((p) => { p.score = 0; p.done = false; }); start('room', seed); },
  onScores(players) {
    roomPlayers = players;
    renderLive();
    if (!$('endOverlay').hidden && game.mode === 'room') renderRanking();
  },
  onError(msg) { toast(msg); leaveRoom(); },
  onClose(msg) { toast(msg); if (!game.playing) leaveRoom(); else game.mode = 'solo'; },
};

function leaveRoom() {
  Room.leave();
  roomPlayers = [];
  $('live').replaceChildren();
  if (game.playing) { game.playing = false; clearInterval(game.timer); Sound.stopBgm(); }
  show('startOverlay');
}

$('makeRoom').onclick = () => {
  setCode(null);
  maskCode(true);
  renderLobby([]);
  $('roomStart').hidden = true;
  $('lobbyBadge').textContent = '방 만드는 중…';
  $('lobbyMsg').textContent = '';
  show('lobby');
  Room.host(nick(), roomHandlers);
};
$('joinRoom').onclick = () => {
  const code = Room.normalize($('joinCode').value);
  if (code.length !== 5) { toast('초대코드 5자리를 입력해 주세요.'); return; }
  setCode(code);
  maskCode(true);
  renderLobby([]);
  $('roomStart').hidden = true;
  $('lobbyBadge').textContent = '입장하는 중…';
  $('lobbyBadge').classList.add('wait');
  $('lobbyMsg').textContent = '';
  show('lobby');
  Room.join(code, nick(), roomHandlers);
};
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinRoom').click(); });
$('roomStart').onclick = () => Room.start(randomSeed());
$('rematch').onclick = () => Room.start(randomSeed());
$('leaveRoom').onclick = leaveRoom;
$('copyCode').onclick = async () => {
  try { await navigator.clipboard.writeText(Room.code); toast('초대코드를 복사했어요! (화면에는 가려진 채로 유지돼요)'); }
  catch { prompt('초대코드', Room.code); }
};
$('roomLeave2').onclick = leaveRoom;
$('invite').onclick = () => {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('room', Room.code);
  shareLink('🍎 사과게임 같이 하자! 초대코드 ' + Room.code, url.href, '초대 링크를 복사했어요. 친구에게 보내 주세요!');
};

// ---------- 공유 ----------
async function shareLink(text, href, copiedMsg) {
  try {
    if (navigator.share) { await navigator.share({ title: '사과게임', text, url: href }); return; }
    await navigator.clipboard.writeText(`${text}\n${href}`);
    toast(copiedMsg);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    prompt('아래 링크를 복사해서 보내세요', href);
  }
}
function share() {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('c', game.seed);
  url.searchParams.set('s', game.score);
  const n = $('nick').value.trim();
  if (n) url.searchParams.set('n', n);
  shareLink(`🍎 사과게임 ${game.score}점! 같은 판으로 나를 이겨 봐`, url.href, '도전장 링크를 복사했어요. 친구에게 붙여넣어 보내세요!');
}
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 2800);
}

// ---------- 버튼 ----------
$('playDaily').onclick = () => { nick(); start('daily', dailySeed()); };
$('playSolo').onclick = () => { nick(); start('solo', randomSeed()); };
$('playChallenge').onclick = () => { nick(); start('challenge', challenge.seed); };
$('again').onclick = () => start(game.mode, game.seed);
$('share').onclick = share;
$('quit').onclick = () => { if (game.playing) finish(false); };
$('home').onclick = () => show('startOverlay');

function syncSoundButtons() {
  $('bgmBtn').classList.toggle('off', !Sound.bgmOn);
  $('sfxBtn').classList.toggle('off', !Sound.sfxOn);
}
$('bgmBtn').onclick = () => { Sound.toggleBgm(); if (Sound.bgmOn && game.playing) Sound.startBgm(); syncSoundButtons(); };
$('sfxBtn').onclick = () => { Sound.toggleSfx(); syncSoundButtons(); };
syncSoundButtons();

if (challenge) {
  const box = $('challengeBox');
  box.hidden = false;
  box.textContent = `📨 ${challenge.name}님이 ${challenge.score}점으로 도전장을 보냈어요!`;
  $('playChallenge').hidden = false;
}
const invited = Room.normalize(new URLSearchParams(location.search).get('room'));
if (invited.length === 5) {
  $('joinCode').value = invited;
  history.replaceState(null, '', location.pathname); // 주소창에 코드가 남지 않게
  toast('초대코드가 입력됐어요. 닉네임을 쓰고 참여를 눌러 주세요!');
}

// 첫 화면 배경용 판 (실제 판을 미리 보지 못하게 별도 시드)
newBoard('preview');
layout();
let lastPortrait = game.portrait;
window.addEventListener('resize', () => {
  if (drag) return;
  const p = window.innerWidth < window.innerHeight * 0.9;
  if (p !== lastPortrait || !game.playing) { lastPortrait = p; layout(); }
});
window.addEventListener('beforeunload', () => Room.leave());
