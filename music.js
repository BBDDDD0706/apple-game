// 배경음악·효과음: 외부 음원 없이 Web Audio로 직접 합성한 자작 루프.
const Sound = (() => {
  const read = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch {} };

  let ctx = null, master = null, timer = null, step = 0, nextTime = 0;
  let bgmOn = read('bgm', true), sfxOn = read('sfx', true), playing = false, tempo = 132;

  // 음 이름 → 주파수
  const N = { A2: 110, C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G2: 98, G3: 196, A3: 220,
    A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5 };

  // 16분음표 기준 64스텝(4마디) 자작 멜로디. null = 쉼표
  const melody = [
    'E5', null, 'G5', null, 'C6', null, 'G5', 'E5', 'A5', null, 'G5', null, 'E5', null, 'D5', null,
    'C5', null, 'D5', 'E5', null, 'G5', null, 'E5', 'D5', null, 'C5', null, 'D5', null, null, null,
    'E5', null, 'G5', null, 'A5', null, 'G5', 'E5', 'F5', null, 'E5', null, 'D5', null, 'C5', null,
    'D5', null, 'E5', 'D5', null, 'B4', null, 'G5', null, null, 'E5', null, 'C5', null, null, null,
  ];
  const bassRoots = ['C3', 'A2', 'F3', 'G2']; // 마디별 베이스 (C - Am - F - G)

  function ensure() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }

  function tone(freq, t, dur, type, vol) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function hat(t, vol) {
    const len = 0.04, buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(f).connect(g).connect(master);
    src.start(t);
  }

  function schedule() {
    const stepDur = 60 / tempo / 4;
    while (nextTime < ctx.currentTime + 0.15) {
      const s = step % 64, bar = Math.floor(s / 16);
      const m = melody[s];
      if (m) tone(N[m], nextTime, stepDur * 1.6, 'square', 0.045);
      if (s % 4 === 0) tone(N[bassRoots[bar]], nextTime, stepDur * 3, 'triangle', 0.16);
      if (s % 4 === 2) tone(N[bassRoots[bar]] * 2, nextTime, stepDur * 1.5, 'triangle', 0.08);
      if (s % 2 === 1) hat(nextTime, 0.05);
      if (s % 8 === 0) tone(60, nextTime, 0.12, 'sine', 0.25); // 킥
      nextTime += stepDur;
      step++;
    }
  }

  function startBgm() {
    playing = true;
    if (!bgmOn) return;
    ensure();
    ctx.resume();
    if (timer) return;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(schedule, 40);
  }
  function stopBgm() {
    playing = false;
    clearInterval(timer);
    timer = null;
  }

  return {
    get bgmOn() { return bgmOn; },
    get sfxOn() { return sfxOn; },
    startBgm, stopBgm,
    setTempo(bpm) { tempo = bpm; },
    toggleBgm() {
      bgmOn = !bgmOn; write('bgm', bgmOn);
      if (!bgmOn) { clearInterval(timer); timer = null; }
      else if (playing) { playing = false; startBgm(); }
      return bgmOn;
    },
    toggleSfx() { sfxOn = !sfxOn; write('sfx', sfxOn); return sfxOn; },
    // 사과를 없앴을 때: 개수가 많을수록 높은 음의 짧은 아르페지오
    pop(n) {
      if (!sfxOn) return;
      try {
        ensure(); ctx.resume();
        const t = ctx.currentTime, base = 660 + Math.min(n, 6) * 60;
        [1, 1.25, 1.5].forEach((r, i) => tone(base * r, t + i * 0.05, 0.12, 'square', 0.05));
      } catch {}
    },
    beep(high) {
      if (!sfxOn) return;
      try { ensure(); ctx.resume(); tone(high ? 988 : 660, ctx.currentTime, 0.15, 'square', 0.06); } catch {}
    },
  };
})();
