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
const kstDate = (offsetDays = 0) => new Date(Date.now() + 9 * 3600e3 + offsetDays * 864e5).toISOString().slice(0, 10);
const dailySeed = () => 'd' + kstDate().replaceAll('-', '');
const randomSeed = () => Math.random().toString(36).slice(2, 8);

// ---------- 상태 ----------
const game = {
  seed: '', mode: 'solo', values: [], alive: [], score: 0,
  endAt: 0, timer: null, playing: false, portrait: false, cells: [],
};
let roomPlayers = [];
$('nick').value = store.get('nick') || '';

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
  if (game.mode === 'room') return '방 대결';
  if (game.mode === 'daily') return dailyPlayed() ? '오늘의 판 · 연습' : '오늘의 판 · 랭킹 도전';
  return '혼자 하기';
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
  const showNum = (text) => { count.innerHTML = `<b>${text}</b>`; };
  let n = 3;
  count.hidden = false;
  showNum(n);
  Sound.beep(false);
  const iv = setInterval(() => {
    n--;
    if (n > 0) { showNum(n); Sound.beep(false); return; }
    clearInterval(iv);
    count.hidden = true;
    Sound.beep(true);
    begin();
  }, 550);
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
  $('dailyResult').hidden = game.mode !== 'daily';
  if (game.mode === 'daily') submitDaily(game.score);
  $('soloBtns').hidden = inRoom;
  $('roomBtns').hidden = !inRoom;
  $('endPlayers').hidden = !inRoom;
  if (inRoom) {
    Room.sendScore(game.score, true);
    $('endTitle').textContent = '판 종료!';
    renderRanking();
  }
  show('endOverlay');
}

// ---------- 방 ----------
let lobbySnap = { players: [], max: 8, hostId: '' };
let myReady = false;

// 동점이면 같은 등수
const rankOf = (players, p) => players.filter((q) => q.score > p.score).length + 1;
function renderPlayers(ul, players, withScore) {
  ul.replaceChildren();
  const sorted = withScore ? [...players].sort((a, b) => b.score - a.score) : players;
  sorted.forEach((p, i) => {
    const li = document.createElement('li');
    if (p.id === Room.myId) li.className = 'me';
    const left = document.createElement('span');
    if (withScore) { const r = document.createElement('span'); r.className = 'rank'; r.textContent = `${rankOf(players, p)}위`; left.append(r); }
    left.append(p.name + (p.id === Room.myId ? ' (나)' : ''));
    const right = document.createElement('span');
    right.textContent = withScore ? `${p.score}점${p.done ? '' : ' · 진행 중'}` : '';
    li.append(left, right);
    ul.append(li);
  });
}
// 게임 중 상단 점수판: 인원이 많으면 상위 5명 + 나만
function renderLive() {
  const live = $('live');
  live.replaceChildren();
  if (game.mode !== 'room') return;
  const sorted = [...roomPlayers].sort((a, b) => b.score - a.score);
  const shown = sorted.slice(0, 5);
  const meIdx = sorted.findIndex((p) => p.id === Room.myId);
  if (meIdx >= 5) shown.push(sorted[meIdx]);
  shown.forEach((p) => {
    const s = document.createElement('span');
    if (p.id === Room.myId) s.className = 'me';
    s.textContent = `${rankOf(sorted, p)}. ${p.name} ${p.score}`;
    live.append(s);
  });
  if (sorted.length > shown.length) {
    const more = document.createElement('span');
    more.textContent = `외 ${sorted.length - shown.length}명`;
    live.append(more);
  }
}
function renderRanking() {
  renderPlayers($('endPlayers'), roomPlayers, true);
  const meP = roomPlayers.find((p) => p.id === Room.myId);
  if (meP && roomPlayers.length > 1 && roomPlayers.every((p) => p.done)) {
    const r = rankOf(roomPlayers, meP);
    $('endTitle').textContent = r === 1 ? '🏆 1등이에요!' : `${r}등이에요! (${roomPlayers.length}명 중)`;
  }
}

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

function seatCard(p) {
  const isHostSeat = p.id === lobbySnap.hostId, isMe = p.id === Room.myId;
  const li = document.createElement('li');
  li.className = 'seat' + (isMe ? ' me' : '') + (p.ready && !isHostSeat ? ' is-ready' : '');
  if (isHostSeat) { const c = document.createElement('span'); c.className = 'crown'; c.textContent = '👑'; li.append(c); }
  if (Room.isHost && !isHostSeat) {
    const k = document.createElement('button');
    k.type = 'button'; k.className = 'kick'; k.textContent = '✕'; k.title = '내보내기';
    k.onclick = () => { if (confirm(`${p.name}님을 방에서 내보낼까요?`)) Room.kick(p.id); };
    li.append(k);
  }
  const av = document.createElement('div');
  av.className = 'avatar';
  av.innerHTML = APPLE_SVG;
  const b = document.createElement('b');
  b.textContent = p.name.slice(0, 1);
  av.append(b);
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = p.name + (isMe ? ' (나)' : '');
  const tag = document.createElement('span');
  if (isHostSeat) { tag.className = 'tag host'; tag.textContent = '방장'; }
  else if (p.ready) { tag.className = 'tag ready'; tag.textContent = '✅ 준비 완료'; }
  else { tag.className = 'tag'; tag.textContent = '⏳ 준비 중'; }
  li.append(av, name, tag);
  return li;
}

function renderLobby(snap) {
  lobbySnap = snap;
  const { players, max } = snap;
  const ul = $('lobbyPlayers');
  ul.replaceChildren(...players.map(seatCard));
  if (players.length < max) {
    const li = document.createElement('li');
    li.className = 'seat empty';
    li.textContent = players.length ? `빈 자리 ${max - players.length}개` : '연결 중…';
    ul.append(li);
  }

  const guests = players.filter((p) => p.id !== snap.hostId);
  const readyN = guests.filter((p) => p.ready).length;
  const allReady = guests.length > 0 && readyN === guests.length;
  $('seatCount').textContent = `${players.length}/${max}`;
  $('readyCount').textContent = guests.length ? `· 준비 ${readyN}/${guests.length}` : '';

  const me = players.find((p) => p.id === Room.myId);
  if (me && document.activeElement !== $('roomName')) $('roomName').value = me.name;
  if (document.activeElement !== $('maxInput')) $('maxInput').value = max;

  const host = Room.isHost && !!me;
  $('maxSetting').hidden = !host;
  $('roomStart').hidden = !host;
  $('readyBtn').hidden = Room.isHost || !me;
  if (host) {
    $('roomStart').disabled = !guests.length;
    $('roomStart').textContent = !guests.length ? '친구가 들어오면 시작할 수 있어요' : `게임 시작 (${players.length}명)`;
    $('lobbyMsg').textContent = !guests.length ? '초대코드를 친구에게 알려 주세요' : allReady ? '모두 준비됐어요!' : `준비 ${readyN}/${guests.length}명`;
  } else if (me) {
    myReady = !!me.ready;
    $('readyBtn').textContent = myReady ? '✅ 준비 완료 (누르면 취소)' : '준비';
    $('readyBtn').classList.toggle('readied', myReady);
    $('lobbyMsg').textContent = myReady ? '방장이 시작하길 기다리는 중…' : '준비 버튼을 눌러 주세요';
  }
}

const roomHandlers = {
  onReady(code) {
    setCode(code);
    $('lobbyBadge').textContent = '👑 내가 방장';
    $('lobbyBadge').classList.remove('wait');
  },
  onLobby(snap) {
    roomPlayers = snap.players;
    if (!Room.isHost) {
      setCode(Room.code);
      $('lobbyBadge').textContent = '참가 중';
      $('lobbyBadge').classList.remove('wait');
    }
    renderLobby(snap);
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

function enterLobby(badge) {
  setCode(null);
  maskCode(true);
  renderLobby({ players: [], max: 8, hostId: '' });
  ['roomStart', 'readyBtn', 'maxSetting'].forEach((id) => ($(id).hidden = true));
  $('lobbyBadge').textContent = badge;
  $('lobbyBadge').classList.add('wait');
  $('lobbyMsg').textContent = '';
  $('roomName').value = nick();
  show('lobby');
}
$('makeRoom').onclick = () => { enterLobby('방 만드는 중…'); Room.host(nick(), roomHandlers); };
$('joinRoom').onclick = () => {
  const code = Room.normalize($('joinCode').value);
  if (code.length !== 5) { toast('초대코드 5자리를 입력해 주세요.'); return; }
  enterLobby('입장하는 중…');
  setCode(code);
  Room.join(code, nick(), roomHandlers);
};
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('joinRoom').click(); });

$('renameBtn').onclick = () => {
  const n = $('roomName').value.trim().slice(0, 10);
  if (!n) { toast('이름을 입력해 주세요.'); return; }
  $('nick').value = n;
  store.set('nick', n);
  Room.setName(n);
  $('roomName').blur();
  toast('이름을 바꿨어요!');
};
$('roomName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('renameBtn').click(); });

function applyMax(n) { $('maxInput').value = Room.setMax(n); }
$('maxDown').onclick = () => applyMax(Room.max - 1);
$('maxUp').onclick = () => applyMax(Room.max + 1);
$('maxInput').addEventListener('change', () => applyMax(parseInt($('maxInput').value, 10) || Room.max));

$('readyBtn').onclick = () => { myReady = !myReady; Room.setReady(myReady); };
// 준비 안 한 사람이 있으면 한 번만 물어보고 시작
$('roomStart').onclick = () => {
  const notReady = lobbySnap.players.filter((p) => p.id !== lobbySnap.hostId && !p.ready).length;
  if (notReady && !confirm(`아직 준비 안 한 사람이 ${notReady}명 있어요. 시작할까요?`)) return;
  Room.start(randomSeed());
};
$('toLobby').onclick = () => { renderLobby(lobbySnap); show('lobby'); };
$('leaveRoom').onclick = leaveRoom;
$('roomLeave2').onclick = leaveRoom;
$('copyCode').onclick = async () => {
  try { await navigator.clipboard.writeText(Room.code); toast('초대코드를 복사했어요! (화면에는 가려진 채로 유지돼요)'); }
  catch { toast('복사하지 못했어요. 코드 보기를 눌러 직접 확인해 주세요.'); }
};
// 초대 링크는 공유창 없이 바로 클립보드로
$('invite').onclick = async () => {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('room', Room.code);
  try { await navigator.clipboard.writeText(url.href); toast('초대 링크를 복사했어요! 친구에게 붙여넣어 보내세요'); }
  catch { toast('복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.'); }
};

function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 2800);
}

// ---------- 버튼 ----------
$('playDaily').onclick = () => { nick(); start('daily', dailySeed()); };
$('playSolo').onclick = () => { nick(); start('solo', randomSeed()); };
$('again').onclick = () => start(game.mode, game.seed);
$('quit').onclick = () => { if (game.playing) finish(false); };
$('home').onclick = () => { loadDailyTop(); show('startOverlay'); };

function syncSoundButtons() {
  $('bgmBtn').classList.toggle('off', !Sound.bgmOn);
  $('sfxBtn').classList.toggle('off', !Sound.sfxOn);
}
$('bgmBtn').onclick = () => { Sound.toggleBgm(); if (Sound.bgmOn && game.playing) Sound.startBgm(); syncSoundButtons(); };
$('sfxBtn').onclick = () => { Sound.toggleSfx(); syncSoundButtons(); };
syncSoundButtons();

const invited = Room.normalize(new URLSearchParams(location.search).get('room'));
if (invited.length === 5) {
  $('joinCode').value = invited;
  history.replaceState(null, '', location.pathname); // 주소창에 코드가 남지 않게
  toast('초대코드가 입력됐어요. 닉네임을 쓰고 참여를 눌러 주세요!');
}

// ---------- 오늘의 판 랭킹 ----------
// 하루 첫 판만 랭킹에 올라간다 (서버도 기기당 하루 한 번만 받는다)
const dailyPlayed = () => store.get('daily:' + kstDate()) === '1';
const BAD_WORDS = /(씨발|시발|ㅅㅂ|병신|ㅄ|좆|개새|니애미|섹스|fuck|shit|sex)/i;
const safeName = (n) => (BAD_WORDS.test(n) ? '플레이어' : n);

function fillTop(ol, rows, myScoreRank) {
  ol.replaceChildren();
  if (!rows.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = '아직 기록이 없어요. 첫 1등이 되어 보세요!'; ol.append(li); return; }
  rows.forEach((r) => {
    const li = document.createElement('li');
    if (myScoreRank && r.rank === myScoreRank.rank && r.score === myScoreRank.score) li.className = 'me';
    const b = document.createElement('b'); b.textContent = r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank + '.';
    const s = document.createElement('span'); s.textContent = r.name;
    const e = document.createElement('em'); e.textContent = r.score + '점';
    li.append(b, s, e);
    ol.append(li);
  });
}
async function loadDailyTop() {
  $('dailyTag').textContent = dailyPlayed() ? '(오늘 도전 완료 · 연습)' : '(하루 한 번 랭킹 도전)';
  try {
    const [{ data: top }, { data: champ }] = await Promise.all([
      Room.db.rpc('daily_top', { p_day: kstDate(), p_limit: 10 }),
      Room.db.rpc('daily_top', { p_day: kstDate(-1), p_limit: 1 }),
    ]);
    fillTop($('dailyTopList'), top || []);
    $('champ').hidden = !champ?.length;
    if (champ?.length) $('champ').textContent = `👑 어제의 챔피언: ${champ[0].name} (${champ[0].score}점)`;
  } catch {
    $('dailyTopList').innerHTML = '<li class="muted">순위를 불러오지 못했어요</li>';
  }
}
async function submitDaily(score) {
  const first = !dailyPlayed();
  store.set('daily:' + kstDate(), '1');
  $('dailyRank').textContent = '순위 확인 중…';
  $('dailyNote').textContent = '';
  $('dailyEndList').replaceChildren();
  try {
    const { data, error } = await Room.db.rpc('submit_daily', { p_device: Room.deviceId(), p_name: safeName(nick()), p_score: score });
    if (error || !data?.length) throw error;
    const me = data[0];
    $('dailyRank').textContent = `오늘 ${me.total}명 중 ${me.my_rank}위!`;
    $('dailyNote').textContent = first ? '🏆 오늘의 랭킹에 등록됐어요. 내일 새 판이 열려요!'
      : `연습 판이라 랭킹엔 첫 기록(${me.my_score}점)만 반영돼요.`;
    const { data: top } = await Room.db.rpc('daily_top', { p_day: kstDate(), p_limit: 10 });
    fillTop($('dailyEndList'), top || [], { rank: me.my_rank, score: me.my_score });
  } catch {
    $('dailyRank').textContent = '';
    $('dailyNote').textContent = '랭킹 서버에 연결하지 못했어요. 잠시 후 다시 확인해 주세요.';
  }
  loadDailyTop();
}
loadDailyTop();

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
