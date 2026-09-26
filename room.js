// 실시간 방: PeerJS(WebRTC) 기반. 방장 브라우저가 방 역할을 하고, 참가자는 초대코드로 방장에게 직접 연결한다.
// 별도 서버/가입 없이 PeerJS 공개 중계 서버로 연결만 맺는다.
const Room = (() => {
  const PREFIX = 'budle-apple-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MAX = 8;
  let peer = null, conn = null, conns = {}, players = {}, h = {}, state = { isHost: false, code: '', myId: '', inGame: false };

  const clean = (s) => String(s || '').trim().slice(0, 10) || '플레이어';
  const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  const list = () => Object.entries(players).map(([id, p]) => ({ id, ...p }));

  function broadcast(msg) {
    Object.values(conns).forEach((c) => { try { c.send(msg); } catch {} });
  }
  function pushLobby() { const l = list(); broadcast({ t: 'lobby', players: l }); h.onLobby?.(l); }
  function pushScores() { const l = list(); broadcast({ t: 'scores', players: l }); h.onScores?.(l); }

  function hostHandle(c, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (state.inGame) { c.send({ t: 'deny', why: '이미 게임이 진행 중이에요. 판이 끝난 뒤 다시 들어와 주세요.' }); setTimeout(() => c.close(), 300); return; }
      if (Object.keys(players).length >= MAX) { c.send({ t: 'deny', why: `방이 가득 찼어요 (최대 ${MAX}명)` }); setTimeout(() => c.close(), 300); return; }
      conns[c.peer] = c;
      players[c.peer] = { name: clean(msg.name), score: 0, done: false };
      pushLobby();
    } else if (msg.t === 'score' && players[c.peer]) {
      players[c.peer].score = Math.max(0, Math.min(999, msg.score | 0));
      players[c.peer].done = !!msg.done;
      pushScores();
    }
  }

  function host(name, handlers) {
    h = handlers;
    state = { isHost: true, code: newCode(), myId: '', inGame: false };
    peer = new Peer(PREFIX + state.code, { debug: 0 });
    peer.on('open', (id) => {
      state.myId = id;
      players = { [id]: { name: clean(name), score: 0, done: false } };
      h.onReady?.(state.code);
      pushLobby();
    });
    peer.on('connection', (c) => {
      c.on('data', (m) => hostHandle(c, m));
      c.on('close', () => { delete conns[c.peer]; delete players[c.peer]; state.inGame ? pushScores() : pushLobby(); });
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { peer.destroy(); host(name, handlers); return; } // 코드 충돌 → 새 코드
      h.onError?.('연결에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    });
  }

  function join(code, name, handlers) {
    h = handlers;
    state = { isHost: false, code, myId: '', inGame: false };
    peer = new Peer({ debug: 0 });
    const fail = setTimeout(() => { h.onError?.('방을 찾을 수 없어요. 초대코드를 확인해 주세요.'); leave(); }, 10000);
    peer.on('open', (id) => {
      state.myId = id;
      conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => { clearTimeout(fail); conn.send({ t: 'hello', name: clean(name) }); });
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'lobby') h.onLobby?.(msg.players || []);
        else if (msg.t === 'scores') h.onScores?.(msg.players || []);
        else if (msg.t === 'start') { state.inGame = true; h.onStart?.(String(msg.seed)); }
        else if (msg.t === 'deny') { h.onError?.(String(msg.why)); leave(); }
      });
      conn.on('close', () => { if (peer) { h.onClose?.('방장이 방을 나갔어요.'); leave(); } });
    });
    peer.on('error', (e) => {
      clearTimeout(fail);
      h.onError?.(e.type === 'peer-unavailable' ? '방을 찾을 수 없어요. 초대코드를 확인해 주세요.' : '연결에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      leave();
    });
  }

  function start(seed) { // 방장만
    state.inGame = true;
    Object.values(players).forEach((p) => { p.score = 0; p.done = false; });
    broadcast({ t: 'start', seed });
    h.onStart?.(seed);
    pushScores();
  }

  function sendScore(score, done) {
    if (state.isHost) {
      const me = players[state.myId];
      if (!me) return;
      me.score = score; me.done = done;
      if (done && Object.values(players).every((p) => p.done)) state.inGame = false;
      pushScores();
    } else if (conn) {
      try { conn.send({ t: 'score', score, done }); } catch {}
    }
  }

  function endRound() { state.inGame = false; }

  function leave() {
    const p = peer;
    peer = null; conn = null; conns = {}; players = {};
    state = { isHost: false, code: '', myId: '', inGame: false };
    try { p && p.destroy(); } catch {}
  }

  return {
    host, join, start, sendScore, endRound, leave,
    get active() { return !!peer; },
    get isHost() { return state.isHost; },
    get code() { return state.code; },
    get myId() { return state.myId; },
    normalize: (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5),
  };
})();
