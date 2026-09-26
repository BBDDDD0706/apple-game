// 실시간 방: Supabase Realtime(브로드캐스트 + 접속 상태) 중계.
// 참가자끼리 직접 연결하지 않으므로 서로의 IP가 노출되지 않고, 방장 인터넷에 부담이 몰리지 않는다.
// 방 상태(참가자·준비·인원 제한)는 방장 브라우저가 관리하고 채널로 알린다.
const Room = (() => {
  const SUPABASE_URL = 'https://wkyqotnysmuzjgwlbnlf.supabase.co';
  const SUPABASE_KEY = 'sb_publishable__JtY-5lIILQt-cjrvVyw0A_VZrSQdsR'; // 공개용 키 (브라우저에 노출돼도 되는 키)
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const LIMIT = 64;
  const SCORE_EVERY = 1500; // 점수는 1.5초에 한 번만 모아서 보낸다 (메시지 사용량 절약)

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  let ch = null, h = {};
  let players = {}, order = [], scores = {};
  let max = 8, hostId = '', joined = false, failT = null, scoreT = null, pendingScore = null;
  let dids = {}, banned = new Set(); // 기기 식별값 (강퇴한 기기는 다시 못 들어온다)
  let state = { isHost: false, code: '', myId: '', inGame: false };

  const uid = () => Math.random().toString(36).slice(2, 10);
  const clean = (s) => String(s || '').trim().slice(0, 10) || '플레이어';
  const newCode = () => Array.from({ length: 5 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  function deviceId() {
    try {
      let d = localStorage.getItem('did');
      if (!d) { d = uid() + Date.now().toString(36); localStorage.setItem('did', d); }
      return d;
    } catch { return ''; }
  }
  const list = () => order.filter((id) => players[id]).map((id) => ({
    id, name: players[id].name, ready: players[id].ready,
    score: scores[id]?.v || 0, done: !!scores[id]?.d,
  }));

  function send(msg) {
    if (ch) ch.send({ type: 'broadcast', event: 'm', payload: msg });
  }
  function open(code, onJoined) {
    ch = sb.channel('apple:' + code, { config: { broadcast: { self: false }, presence: { key: state.myId } } });
    ch.on('broadcast', { event: 'm' }, ({ payload }) => onMsg(payload || {}));
    ch.on('presence', { event: 'leave' }, ({ key }) => onLeave(key));
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') onJoined();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { h.onError?.('연결에 문제가 생겼어요. 잠시 후 다시 시도해 주세요.'); leave(); }
    });
  }

  // ---- 방장: 방 상태 알리기 ----
  function pushLobby() {
    const snap = { players: list(), max, hostId };
    send({ t: 'lobby', ...snap });
    h.onLobby?.(snap);
  }
  function addPlayer(id, name, ready) {
    players[id] = { name: clean(name), ready };
    if (!order.includes(id)) order.push(id);
  }
  function removePlayer(id) { delete players[id]; delete scores[id]; delete dids[id]; order = order.filter((x) => x !== id); }
  function checkRoundOver() {
    if (state.inGame && order.every((id) => scores[id]?.d)) state.inGame = false;
  }

  function onMsg(m) {
    // 누구에게서 왔든 점수 메시지는 모두가 직접 반영한다
    if (m.t === 's' && players[m.f]) {
      scores[m.f] = { v: Math.max(0, Math.min(999, m.v | 0)), d: !!m.d };
      if (state.isHost) checkRoundOver();
      h.onScores?.(list());
      return;
    }
    if (state.isHost) return hostMsg(m);
    // 참가자
    if (m.t === 'lobby') {
      joined = true;
      clearTimeout(failT);
      hostId = String(m.hostId || '');
      max = Math.max(2, Math.min(LIMIT, m.max | 0));
      players = {}; order = [];
      (m.players || []).forEach((p) => { players[p.id] = { name: clean(p.name), ready: !!p.ready }; order.push(p.id); });
      h.onLobby?.({ players: list(), max, hostId });
    } else if (m.t === 'start') {
      scores = {};
      state.inGame = true;
      h.onStart?.(String(m.seed));
    } else if (m.to === state.myId && m.t === 'deny') {
      h.onError?.(String(m.why)); leave();
    } else if (m.to === state.myId && m.t === 'kick') {
      h.onClose?.('방장이 나를 방에서 내보냈어요.'); leave();
    }
  }

  function hostMsg(m) {
    const from = String(m.f || '');
    if (!from) return;
    if (m.t === 'hello') {
      const did = String(m.did || '').slice(0, 40);
      const deny = (why) => send({ t: 'deny', to: from, why });
      if (did && banned.has(did)) return deny('방장이 내보낸 방이라 다시 들어갈 수 없어요.');
      if (players[from]) return pushLobby();
      if (state.inGame) return deny('이미 게임이 진행 중이에요. 판이 끝난 뒤 다시 들어와 주세요.');
      if (order.length >= max) return deny(`방이 가득 찼어요 (최대 ${max}명)`);
      dids[from] = did;
      addPlayer(from, m.name, false);
      pushLobby();
    } else if (!players[from]) {
      return;
    } else if (m.t === 'name') {
      players[from].name = clean(m.name);
      pushLobby();
    } else if (m.t === 'ready') {
      players[from].ready = !!m.ready;
      pushLobby();
    }
  }

  function onLeave(key) {
    if (!ch) return;
    if (!state.isHost) {
      if (key === hostId) { h.onClose?.('방장이 방을 나갔어요.'); leave(); }
      return;
    }
    if (players[key] && key !== hostId) {
      removePlayer(key);
      checkRoundOver();
      pushLobby();
    }
  }

  // ---- 방 만들기 / 들어가기 ----
  function host(name, handlers, tries = 0) {
    h = handlers;
    reset();
    state = { isHost: true, code: newCode(), myId: uid(), inGame: false };
    hostId = state.myId;
    open(state.code, async () => {
      // 같은 코드의 방이 이미 있으면 새 코드로 다시
      await new Promise((r) => setTimeout(r, 600));
      if (Object.keys(ch.presenceState()).length && tries < 5) { await sb.removeChannel(ch); ch = null; return host(name, handlers, tries + 1); }
      await ch.track({ host: true });
      addPlayer(state.myId, name, true);
      h.onReady?.(state.code);
      pushLobby();
    });
  }

  function join(code, name, handlers) {
    h = handlers;
    reset();
    state = { isHost: false, code, myId: uid(), inGame: false };
    open(code, async () => {
      await ch.track({});
      send({ t: 'hello', f: state.myId, name: clean(name), did: deviceId() });
      failT = setTimeout(() => { if (!joined) { h.onError?.('방을 찾을 수 없어요. 초대코드를 확인해 주세요.'); leave(); } }, 6000);
    });
  }

  // ---- 방장 전용 ----
  function start(seed) {
    state.inGame = true;
    scores = {};
    order.forEach((id) => { if (id !== hostId) players[id].ready = false; });
    send({ t: 'start', seed });
    h.onStart?.(seed);
    pushLobby();
  }
  function kick(id) {
    if (!state.isHost || id === hostId || !players[id]) return;
    send({ t: 'kick', to: id });
    if (dids[id]) banned.add(dids[id]);
    removePlayer(id);
    pushLobby();
  }
  function setMax(n) {
    if (!state.isHost) return max;
    max = Math.max(2, Math.min(LIMIT, n | 0));
    if (max < order.length) max = order.length;
    pushLobby();
    return max;
  }

  // ---- 공통 ----
  function sendScore(score, done) {
    scores[state.myId] = { v: score, d: done };
    if (state.isHost) checkRoundOver();
    h.onScores?.(list());
    pendingScore = { t: 's', f: state.myId, v: score, d: done };
    if (done) { clearTimeout(scoreT); scoreT = null; send(pendingScore); pendingScore = null; return; }
    if (scoreT) return;
    scoreT = setTimeout(() => { scoreT = null; if (pendingScore) send(pendingScore); pendingScore = null; }, SCORE_EVERY);
  }
  function setName(name) {
    if (state.isHost) { if (players[state.myId]) players[state.myId].name = clean(name); pushLobby(); }
    else send({ t: 'name', f: state.myId, name: clean(name) });
  }
  function setReady(ready) {
    if (!state.isHost) send({ t: 'ready', f: state.myId, ready });
  }

  function reset() {
    players = {}; order = []; scores = {}; dids = {}; banned = new Set();
    max = 8; hostId = ''; joined = false;
    clearTimeout(failT); clearTimeout(scoreT); scoreT = null; pendingScore = null;
  }
  function leave() {
    const c = ch;
    ch = null;
    reset();
    state = { isHost: false, code: '', myId: '', inGame: false };
    if (c) sb.removeChannel(c);
  }

  return {
    host, join, start, kick, setMax, sendScore, setName, setReady, leave,
    get active() { return !!ch; },
    get isHost() { return state.isHost; },
    get code() { return state.code; },
    get myId() { return state.myId; },
    get hostId() { return hostId; },
    get max() { return max; },
    LIMIT,
    db: sb,
    deviceId,
    normalize: (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5),
  };
})();
