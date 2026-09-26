// 실시간 방: PeerJS(WebRTC) 기반. 방장 브라우저가 방 역할을 하고, 참가자는 초대코드로 방장에게 직접 연결한다.
// 별도 서버/가입 없이 PeerJS 공개 중계 서버로 연결만 맺는다.
const Room = (() => {
  const PREFIX = 'budle-apple-';
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const LIMIT = 64;
  let peer = null, conn = null, conns = {}, players = {}, order = [], h = {};
  let max = 8, hostId = '', flushT = null;
  let dids = {}, banned = new Set(); // 기기 식별값 (강퇴한 기기는 다시 못 들어온다)
  let state = { isHost: false, code: '', myId: '', inGame: false };

  const clean = (s) => String(s || '').trim().slice(0, 10) || '플레이어';
  const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  function deviceId() {
    try {
      let d = localStorage.getItem('did');
      if (!d) { d = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('did', d); }
      return d;
    } catch { return ''; }
  }
  const list = () => order.filter((id) => players[id]).map((id) => ({ id, ...players[id] }));
  const snapshot = () => ({ players: list(), max, hostId });

  function broadcast(msg) {
    Object.values(conns).forEach((c) => { try { c.send(msg); } catch {} });
  }
  function pushLobby() { const s = snapshot(); broadcast({ t: 'lobby', ...s }); h.onLobby?.(s); }
  // 점수는 인원이 많아도 부담이 없도록 0.25초마다 한 번만 모아서 보낸다
  function pushScores() {
    if (flushT) return;
    flushT = setTimeout(() => {
      flushT = null;
      const l = list();
      broadcast({ t: 'scores', players: l });
      h.onScores?.(l);
    }, 250);
  }
  function addPlayer(id, name, ready) { players[id] = { name: clean(name), score: 0, done: false, ready }; order.push(id); }
  function removePlayer(id) { delete players[id]; delete conns[id]; order = order.filter((x) => x !== id); }
  function checkRoundOver() {
    if (state.inGame && order.every((id) => !players[id] || players[id].done)) state.inGame = false;
  }

  function hostHandle(c, msg) {
    if (!msg || typeof msg !== 'object') return;
    const p = players[c.peer];
    if (msg.t === 'hello') {
      const did = String(msg.did || '').slice(0, 40);
      if (did && banned.has(did)) return deny(c, '방장이 내보낸 방이라 다시 들어갈 수 없어요.');
      if (state.inGame) return deny(c, '이미 게임이 진행 중이에요. 판이 끝난 뒤 다시 들어와 주세요.');
      if (order.length >= max) return deny(c, `방이 가득 찼어요 (최대 ${max}명)`);
      conns[c.peer] = c;
      dids[c.peer] = did;
      addPlayer(c.peer, msg.name, false);
      pushLobby();
    } else if (!p) {
      return;
    } else if (msg.t === 'score') {
      p.score = Math.max(0, Math.min(999, msg.score | 0));
      p.done = !!msg.done;
      checkRoundOver();
      pushScores();
    } else if (msg.t === 'name') {
      p.name = clean(msg.name);
      pushLobby();
    } else if (msg.t === 'ready') {
      p.ready = !!msg.ready;
      pushLobby();
    }
  }
  function deny(c, why) {
    try { c.send({ t: 'deny', why }); } catch {}
    setTimeout(() => c.close(), 300);
  }

  function host(name, handlers) {
    h = handlers;
    state = { isHost: true, code: newCode(), myId: '', inGame: false };
    players = {}; order = []; conns = {}; dids = {}; banned = new Set();
    peer = new Peer(PREFIX + state.code, { debug: 0 });
    peer.on('open', (id) => {
      state.myId = hostId = id;
      addPlayer(id, name, true);
      h.onReady?.(state.code);
      pushLobby();
    });
    peer.on('connection', (c) => {
      c.on('data', (m) => hostHandle(c, m));
      c.on('close', () => {
        if (!players[c.peer]) return;
        removePlayer(c.peer);
        checkRoundOver();
        state.inGame ? pushScores() : pushLobby();
      });
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
      conn.on('open', () => { clearTimeout(fail); conn.send({ t: 'hello', name: clean(name), did: deviceId() }); });
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'lobby') {
          hostId = String(msg.hostId || '');
          max = Math.max(2, Math.min(LIMIT, msg.max | 0));
          h.onLobby?.({ players: msg.players || [], max, hostId });
        } else if (msg.t === 'scores') h.onScores?.(msg.players || []);
        else if (msg.t === 'start') { state.inGame = true; h.onStart?.(String(msg.seed)); }
        else if (msg.t === 'deny') { h.onError?.(String(msg.why)); leave(); }
        else if (msg.t === 'kick') { h.onClose?.('방장이 나를 방에서 내보냈어요.'); leave(); }
      });
      conn.on('close', () => { if (peer) { h.onClose?.('방장이 방을 나갔어요.'); leave(); } });
    });
    peer.on('error', (e) => {
      clearTimeout(fail);
      h.onError?.(e.type === 'peer-unavailable' ? '방을 찾을 수 없어요. 초대코드를 확인해 주세요.' : '연결에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
      leave();
    });
  }

  // ---- 방장 전용 ----
  function start(seed) {
    state.inGame = true;
    order.forEach((id) => { const p = players[id]; p.score = 0; p.done = false; if (id !== hostId) p.ready = false; });
    broadcast({ t: 'start', seed });
    h.onStart?.(seed);
    pushLobby();
  }
  function kick(id) {
    if (!state.isHost || id === hostId || !conns[id]) return;
    const c = conns[id];
    try { c.send({ t: 'kick' }); } catch {}
    if (dids[id]) banned.add(dids[id]);
    removePlayer(id);
    setTimeout(() => c.close(), 300);
    pushLobby();
  }
  function setMax(n) {
    if (!state.isHost) return max;
    max = Math.max(2, Math.min(LIMIT, n | 0, LIMIT));
    if (max < order.length) max = order.length;
    pushLobby();
    return max;
  }

  // ---- 공통 ----
  function sendScore(score, done) {
    if (state.isHost) {
      const me = players[state.myId];
      if (!me) return;
      me.score = score; me.done = done;
      checkRoundOver();
      pushScores();
    } else if (conn) {
      try { conn.send({ t: 'score', score, done }); } catch {}
    }
  }
  function setName(name) {
    if (state.isHost) { if (players[state.myId]) players[state.myId].name = clean(name); pushLobby(); }
    else if (conn) { try { conn.send({ t: 'name', name: clean(name) }); } catch {} }
  }
  function setReady(ready) {
    if (!state.isHost && conn) { try { conn.send({ t: 'ready', ready }); } catch {} }
  }

  function leave() {
    const p = peer;
    peer = null; conn = null; conns = {}; players = {}; order = []; hostId = '';
    clearTimeout(flushT); flushT = null;
    state = { isHost: false, code: '', myId: '', inGame: false };
    try { p && p.destroy(); } catch {}
  }

  return {
    host, join, start, kick, setMax, sendScore, setName, setReady, leave,
    get active() { return !!peer; },
    get isHost() { return state.isHost; },
    get code() { return state.code; },
    get myId() { return state.myId; },
    get hostId() { return hostId; },
    get max() { return max; },
    LIMIT,
    normalize: (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5),
  };
})();
