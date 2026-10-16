/* Ultimate Hold'em: networking (PeerJS, host-authoritative) and UI */
(() => {
  'use strict';

  // Peer-to-peer config. Add a TURN server here if some friends can't connect (strict mobile/office networks).
  const PEER_OPTS = {
    debug: 1,
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] }
  };
  const PREFIX = 'uth-holdem-v1-';
  const L = UTH.LIMITS;
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n * 100) / 100).toLocaleString();
  const signed = n => (n > 0 ? '+' : '') + money(n);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage off */ } }
  };

  let token = store.get('uth.token', null);
  if (!token) { token = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('uth.token', token); }

  const app = {
    role: null, peer: null, table: null, conns: new Map(), conn: null,
    view: null, code: null, draft: null, draftHand: -1, sel: 'ante',
    seen: new Set(), offline: false, closing: false
  };

  // ---------- toast ----------
  if (window.innerWidth < 900) document.querySelector('details.pay').removeAttribute('open');
  let toastT;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 2800);
  }
  function banner(msg) {
    const b = $('#banner');
    if (!msg) { b.classList.add('hidden'); return; }
    b.innerHTML = msg; b.classList.remove('hidden');
  }

  // ---------- welcome ----------
  const params = new URLSearchParams(location.search);
  const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  $('#nameIn').value = store.get('uth.name', '');
  if (roomParam) {
    $('#codeIn').value = roomParam;
    const n = $('#inviteNote');
    n.textContent = "You're invited to table " + roomParam + '. Enter your name and hit Join.';
    n.classList.remove('hidden');
    $('#hostCard').classList.add('hidden');
  }
  let startBank = 1000;
  $('#bankSeg').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    startBank = +b.dataset.v;
    document.querySelectorAll('#bankSeg button').forEach(x => x.classList.toggle('on', x === b));
  });
  function getName() {
    const n = $('#nameIn').value.trim();
    if (!n) { $('#wErr').textContent = 'Enter your name first'; $('#nameIn').focus(); return null; }
    store.set('uth.name', n);
    return n;
  }
  $('#hostBtn').onclick = () => { const n = getName(); if (n) hostGame(n); };
  $('#joinBtn').onclick = () => {
    const n = getName(); if (!n) return;
    const c = $('#codeIn').value.trim().toUpperCase();
    if (c.length < 4) { $('#wErr').textContent = 'Enter the table code your host shared'; return; }
    joinGame(n, c);
  };
  $('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
  $('#nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') (roomParam ? $('#joinBtn') : $('#hostBtn')).click(); });

  function busy(on, msg) {
    $('#hostBtn').disabled = on; $('#joinBtn').disabled = on;
    $('#wErr').textContent = msg || '';
  }
  function showGame() {
    $('#welcome').classList.add('hidden');
    $('#game').classList.remove('hidden');
    $('#codeOut').textContent = app.code || 'SOLO';
  }
  const genCode = () => {
    const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)];
    return s;
  };

  // ---------- host ----------
  function hostGame(name, tries = 0) {
    busy(true, 'Opening your table...');
    app.role = 'host';
    app.code = store.get('uth.hostCode', null) && tries === 0 ? store.get('uth.hostCode') : genCode();
    const peer = new Peer(PREFIX + app.code, PEER_OPTS);
    app.peer = peer;
    let opened = false;
    const startTable = () => {
      if (app.table) return;
      app.table = new UTH.Table({ startBank, onChange: broadcast });
      app.table.join('host', name, token);
      showGame();
      broadcast();
    };
    peer.on('open', () => {
      opened = true;
      store.set('uth.hostCode', app.code);
      history.replaceState(null, '', location.pathname + '?room=' + app.code);
      startTable();
      setNet(true);
    });
    peer.on('connection', conn => {
      conn.on('open', () => { app.conns.set(conn.peer, conn); });
      conn.on('data', m => onHostMsg(conn, m));
      conn.on('close', () => { app.conns.delete(conn.peer); if (app.table) app.table.disconnect(conn.peer); });
      conn.on('error', () => {});
    });
    peer.on('disconnected', () => { setNet(false); if (!app.closing && !peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
    peer.on('error', e => {
      if (e.type === 'unavailable-id' && !opened) {
        peer.destroy();
        if (tries < 4) { store.set('uth.hostCode', null); hostGame(name, tries + 1); }
        else busy(false, 'Could not reserve a table code. Try again.');
        return;
      }
      if (!opened && ['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(e.type)) {
        app.offline = true; app.code = null;
        startTable(); setNet(false);
        banner('Could not reach the online lobby, so this table is <b>offline</b> (you plus computer players). Reload to try again.');
        return;
      }
      if (e.type === 'network' || e.type === 'socket-closed') setNet(false);
    });
    peer.on('open', () => setNet(true));
  }
  function onHostMsg(conn, m) {
    if (!app.table || !m) return;
    if (m.t === 'join') {
      const i = app.table.join(conn.peer, m.name, m.token);
      if (i < 0) conn.send({ t: 'err', msg: 'All 5 seats are taken. You are watching for now.' });
      broadcast();
      return;
    }
    const err = app.table.command(conn.peer, m);
    if (err) conn.send({ t: 'err', msg: err });
  }
  function broadcast() {
    const t = app.table;
    if (!t) return;
    app.conns.forEach((c, id) => {
      if (c.open) { try { c.send({ t: 'state', v: t.view(t.seatOf(id)) }); } catch (e) { /* closed */ } }
    });
    app.view = t.view(t.seatOf('host'));
    render();
  }

  // ---------- guest ----------
  function joinGame(name, code) {
    busy(true, 'Connecting to table ' + code + '...');
    app.role = 'guest'; app.code = code;
    const peer = new Peer(PEER_OPTS);
    app.peer = peer;
    let got = false;
    const fail = msg => { if (got) return; busy(false, msg); try { peer.destroy(); } catch (e) { /* noop */ } };
    const timer = setTimeout(() => fail('Could not reach table ' + code + '. Check the code, and make sure the host still has the page open.'), 15000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true });
      app.conn = conn;
      conn.on('open', () => conn.send({ t: 'join', name, token }));
      conn.on('data', m => {
        if (!m) return;
        if (m.t === 'state') {
          if (!got) { got = true; clearTimeout(timer); history.replaceState(null, '', location.pathname + '?room=' + code); showGame(); setNet(true); }
          app.view = m.v; render();
        } else if (m.t === 'err') toast(m.msg);
      });
      conn.on('close', () => {
        setNet(false);
        if (got) banner('Lost connection to the host. <button class="btn sm gold" onclick="location.reload()">Reconnect</button> Your seat and chips are kept.');
      });
    });
    peer.on('error', e => {
      if (e.type === 'peer-unavailable') { clearTimeout(timer); fail('No open table with code ' + code + '. Double-check it with your host.'); }
      else if (!got) { clearTimeout(timer); fail('Connection problem (' + e.type + '). Try again.'); }
    });
    peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1500); });
  }

  function send(m) {
    if (app.role === 'host') {
      const err = app.table.command('host', m);
      if (err) toast(err);
    } else if (app.conn && app.conn.open) app.conn.send(m);
    else toast('Not connected');
  }
  function setNet(on) { $('#netDot').classList.toggle('off', !on); }

  $('#inviteBtn').onclick = async () => {
    if (!app.code) { toast('Offline table, nothing to share'); return; }
    const url = location.origin + location.pathname + '?room=' + app.code;
    if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      try { await navigator.share({ title: "Ultimate Hold'em", text: 'Pull up a seat at my table', url }); return; } catch (e) { /* fall through */ }
    }
    try { await navigator.clipboard.writeText(url); toast('Invite link copied'); }
    catch (e) { prompt('Copy this invite link', url); }
  };
  $('#chatForm').addEventListener('submit', e => {
    e.preventDefault();
    const v = $('#chatIn').value.trim();
    if (v) send({ t: 'chat', text: v });
    $('#chatIn').value = '';
  });
  window.addEventListener('beforeunload', e => {
    if (app.role === 'host' && app.table && app.conns.size) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- rendering ----------
  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  function cardHTML(c, key, opts = {}) {
    const cls = ['card'];
    if (opts.sm) cls.push('sm');
    if (opts.dim) cls.push('dim');
    if (opts.hi) cls.push('hi');
    const k = key + ':' + c;
    if (!app.seen.has(k)) { app.seen.add(k); cls.push('deal'); }
    if (!c) return '<div class="card slot' + (opts.sm ? ' sm' : '') + '"></div>';
    if (c === '??') return '<div class="' + cls.join(' ') + ' back"></div>';
    const r = c[0] === 'T' ? '10' : c[0], s = c[1];
    if (s === 'h' || s === 'd') cls.push('red');
    return '<div class="' + cls.join(' ') + '"><span class="r">' + r + '</span><span class="s2">' + SUIT[s] + '</span><span class="s">' + SUIT[s] + '</span></div>';
  }

  const PHASE_TXT = {
    betting: 'Place your bets',
    preflop: 'Check, or bet 3x or 4x before the flop',
    flop: 'Flop is out. Check or bet 2x',
    river: 'Final cards. Bet 1x or fold',
    results: 'Hand over. Lock in your next bet'
  };

  function render() {
    const v = app.view;
    if (!v) return;
    if (v.handNo !== app.lastHand) { app.seen.clear(); app.lastHand = v.handNo; }
    const me = v.me >= 0 ? v.seats[v.me] : null;
    const res = v.phase === 'results';
    const winSet = new Set(res && v.dealerHand ? v.dealerHand.cards : []);

    // dealer
    $('#dealerCards').innerHTML = (v.dealer.length ? v.dealer : [null, null])
      .map((c, i) => cardHTML(c, v.handNo + 'd' + i, { hi: res && winSet.has(c) })).join('');
    $('#dealerName').innerHTML = v.dealerHand
      ? esc(v.dealerHand.name) + '<span class="q" style="color:' + (v.dealerHand.qual ? 'var(--gold)' : 'var(--muted)') + '">' + (v.dealerHand.qual ? 'Opens' : 'Does not open') + '</span>'
      : '';
    // board
    const myBest = me && me.hole.length && me.hole[0] !== '??' && v.board.length >= 3 ? UTH.best(me.hole.concat(v.board)) : null;
    const mySet = new Set(myBest && !res ? myBest.cards : []);
    const b = [];
    for (let i = 0; i < 5; i++) b.push(cardHTML(v.board[i] || null, v.handNo + 'b' + i, { hi: mySet.has(v.board[i]) }));
    $('#boardCards').innerHTML = b.join('');
    $('#phaseTxt').textContent = v.handNo === 0 && v.phase === 'betting' ? 'Waiting for the first hand' : PHASE_TXT[v.phase];

    // seats
    const isHost = app.role === 'host';
    $('#seats').innerHTML = v.seats.map((s, i) => {
      if (!s) {
        return '<div class="seat empty' + (isHost ? '' : ' guest') + '"><div>Open seat</div>' +
          (isHost ? '<button class="btn sm" data-addbot>+ Computer</button>' : '') + '</div>';
      }
      const tags = (s.host ? '<span class="t h">HOST</span>' : '') + (s.bot ? '<span class="t">CPU</span>' : '') + (!s.bot && !s.connected ? '<span class="t">AWAY</span>' : '');
      const chips = [];
      const st = s.inHand ? s.stake : (s.ready ? s.next : null);
      if (st) {
        chips.push('<span class="chip">Ante ' + money(st.ante) + '</span>');
        chips.push('<span class="chip">Blind ' + money(st.ante) + '</span>');
        if (st.play) chips.push('<span class="chip play">Play ' + money(st.play) + '</span>');
        if (st.trips) chips.push('<span class="chip">Trips ' + money(st.trips) + '</span>');
        if (st.pairs) chips.push('<span class="chip">Pairs ' + money(st.pairs) + '</span>');
      }
      let status = '', cls = 'wait';
      if (res && s.result) {
        const n = s.result.net;
        cls = n > 0 ? 'win' : n < 0 ? 'lose' : 'wait';
        status = (s.folded ? 'Folded' : esc(s.result.hand)) + '<br>' + signed(n);
      } else if (s.inHand && ['preflop', 'flop', 'river'].includes(v.phase)) {
        status = s.acted ? esc(s.action === 'Check' ? 'Checked' : s.action === 'Fold' ? 'Folded' : 'Bet ' + s.action) : 'Thinking...';
        if (s.acted) cls = '';
      } else if (s.ready) { status = 'Ready'; cls = ''; }
      else if (!s.inHand && !res && v.phase !== 'betting') status = 'Sitting out';
      else status = s.bot ? '' : 'Placing bets...';
      const hole = s.hole.map((c, j) => cardHTML(c, v.handNo + 's' + i + j, { sm: true, hi: res && s.result && !s.folded && s.result.best.includes(c), dim: s.folded && res })).join('');
      const canRemove = isHost && !s.host && (!s.inHand || res || v.phase === 'betting');
      return '<div class="seat' + (i === v.me ? ' me' : '') + '">' +
        (canRemove ? '<button class="x" title="Remove from table" data-remove="' + i + '">✕</button>' : '') +
        '<div class="nm">' + esc(s.name) + tags + '</div>' +
        '<div class="bk">Chips <b>' + money(s.bank) + '</b> &nbsp;<span class="' + (s.net >= 0 ? 'pos' : 'neg') + '">' + signed(s.net) + '</span></div>' +
        '<div class="cards">' + hole + '</div>' +
        '<div class="chips">' + chips.join('') + '</div>' +
        '<div class="status ' + cls + '">' + status + '</div></div>';
    }).join('');

    renderControls(v, me, myBest);
    renderFeed(v);
  }

  function ensureDraft(v, me) {
    if (!me) return;
    if (!app.draft || app.draftHand !== v.handNo || me.ready) {
      app.draft = Object.assign({}, me.next);
      app.draftHand = v.handNo;
    }
  }

  function renderControls(v, me, myBest) {
    const el = $('#ctl');
    const isHost = app.role === 'host';
    let h = '';
    if (!me) {
      h = '<h3 class="display">Watching</h3><p class="sub">All seats are full. You will see the action live.</p>';
    } else {
      const bettingOpen = v.phase === 'betting' || v.phase === 'results';
      // my result
      if (v.phase === 'results' && me.result) {
        const r = me.result;
        h += '<div class="big ' + (r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : '') + '">' + (r.net > 0 ? 'You won ' + money(r.net) : r.net < 0 ? 'You lost ' + money(-r.net) : 'You broke even') + '</div>';
        h += '<div class="sub" style="margin:2px 0 0">' + (me.folded ? 'You folded' : 'Your ' + esc(r.hand) + ' vs dealer ' + esc(v.dealerHand.name)) + '</div>';
        h += '<table class="res">' + r.lines.map(l =>
          '<tr><td>' + l.label + ' ' + money(l.stake) + '</td><td style="color:var(--muted);font-weight:500">' + esc(l.note) + '</td><td class="' + (l.ret - l.stake > 0 ? 'pos' : l.ret - l.stake < 0 ? 'neg' : '') + '">' + signed(l.ret - l.stake) + '</td></tr>').join('') + '</table>';
      }
      if (bettingOpen) {
        ensureDraft(v, me);
        const d = app.draft;
        const cost = d.ante * 2 + d.trips + d.pairs;
        if (me.ready) {
          h += '<h3 class="display">You are in</h3><p class="sub">Ante ' + money(d.ante) + ' + Blind ' + money(d.ante) +
            (d.trips ? ' + Trips ' + money(d.trips) : '') + (d.pairs ? ' + Pairs ' + money(d.pairs) : '') +
            '. Dealing once everyone is ready' + (isHost ? ', or hit Deal now.' : '.') + '</p>' +
            '<div class="acts"><button class="btn" data-unready>Change bet</button></div>';
        } else {
          h += '<h3 class="display">' + (v.handNo ? 'Next hand' : 'Place your bets') + '</h3>' +
            '<p class="sub">Tap a spot, then tap chips. Blind always matches the Ante. Trips and Pairs Bonus are optional.</p>' +
            '<div class="spots">' +
            spot('ante', 'Ante + Blind', d.ante, money(d.ante) + ' each') +
            spot('trips', 'Trips', d.trips, d.trips ? '' : 'Optional') +
            spot('pairs', 'Pairs Bonus', d.pairs, d.pairs ? '' : 'Optional') + '</div>' +
            '<div class="chiprow">' + [5, 10, 25, 100].map(c => '<button class="pchip c' + c + '" data-chip="' + c + '">' + c + '</button>').join('') +
            '<button class="btn sm ghost" data-rebet>Min bet</button></div>' +
            '<div class="acts"><button class="btn gold" data-ready ' + (cost > me.bank ? 'disabled' : '') + '>Deal me in · ' + money(cost) + '</button>' +
            (me.bank < cost || me.bank < me.next.ante * 6 ? '<button class="btn" data-rebuy>Rebuy ' + money(v.startBank) + '</button>' : '') + '</div>';
        }
      } else if (me.inHand) {
        const a = me.stake.ante;
        h += '<div class="mine">' + (myBest ? 'You have <b>' + esc(myBest.name) + '</b>' : preflopHint(me.hole)) + '</div>';
        if (me.acted) {
          h += '<h3 class="display">' + (me.folded ? 'Folded' : me.stake.play ? 'Play bet ' + money(me.stake.play) : 'Checked') + '</h3><p class="sub">' +
            (me.stake.play ? 'You are locked in. Sit back and watch the cards.' : 'Waiting on the rest of the table.') + '</p>';
        } else {
          const opts = { preflop: [['check', 'Check', ''], ['bet3', 'Bet 3x', a * 3], ['bet4', 'Bet 4x', a * 4]],
            flop: [['check', 'Check', ''], ['bet2', 'Bet 2x', a * 2]],
            river: [['fold', 'Fold', ''], ['bet1', 'Bet 1x', a]] }[v.phase] || [];
          h += '<h3 class="display">Your move</h3><p class="sub">' + PHASE_TXT[v.phase] + '.</p><div class="acts">' +
            opts.map(([k, lbl, amt]) => '<button class="btn ' + (amt ? 'gold' : k === 'fold' ? 'red' : '') + '" data-act="' + k + '" ' + (amt && amt > me.bank ? 'disabled' : '') + '>' + lbl + (amt ? ' · ' + money(amt) : '') + '</button>').join('') + '</div>';
        }
      } else {
        h += '<h3 class="display">Sitting this one out</h3><p class="sub">You will be dealt in next hand.</p>';
      }
    }
    if (isHost) {
      const decision = ['preflop', 'flop', 'river'].includes(v.phase);
      const full = v.seats.every(Boolean);
      h += '<div class="hostbar"><span class="lbl">Host</span>' +
        '<button class="btn sm" data-addbot ' + (full ? 'disabled' : '') + '>+ Computer player</button>' +
        (!decision ? '<button class="btn sm gold" data-deal>Deal now</button>' : '<button class="btn sm" data-force title="Auto check or fold anyone still thinking">Hurry up</button>') +
        '</div>';
    }
    el.innerHTML = h;
  }
  function spot(k, label, val, hint) {
    return '<div class="spot ' + k + (app.sel === k ? ' sel' : '') + '" data-spot="' + k + '">' +
      (val && k !== 'ante' ? '<button class="clr" data-clear="' + k + '">✕</button>' : '') +
      '<div class="k">' + label + '</div><div class="v">' + (val ? money(val) : '$0') + '</div><div class="h">' + (hint || '&nbsp;') + '</div></div>';
  }
  function preflopHint(hole) {
    if (!hole || hole.length < 2 || hole[0] === '??') return '';
    const m = UTH.pairsPay(hole);
    const [a, b] = hole.map(c => c[0] === 'T' ? '10' : c[0]);
    const suited = hole[0][1] === hole[1][1];
    const name = a === b ? 'Pocket ' + a + 's' : a + '-' + b + (suited ? ' suited' : '');
    return 'You have <b>' + name + '</b>' + (m ? ' &middot; Pairs Bonus hand, pays ' + m + ' to 1' : '');
  }

  function renderFeed(v) {
    const box = $('#msgs');
    const items = v.log.map(l => ({ ts: l.ts, h: '<div class="m sys">' + esc(l.t) + '</div>' }))
      .concat(v.chat.map(c => ({ ts: c.ts, h: '<div class="m"><b>' + esc(c.who) + ':</b> ' + esc(c.text) + '</div>' })))
      .sort((a, b) => a.ts - b.ts).slice(-60).map(x => x.h).join('');
    if (box.dataset.last === items) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = items; box.dataset.last = items;
    if (atBottom) box.scrollTop = box.scrollHeight;
  }

  // ---------- control events ----------
  $('#game').addEventListener('click', e => {
    const t = e.target.closest('button,[data-spot]');
    if (!t) return;
    const ds = t.dataset;
    if ('addbot' in ds) return send({ t: 'addBot' });
    if ('deal' in ds) return send({ t: 'deal' });
    if ('force' in ds) return send({ t: 'force' });
    if ('remove' in ds) return send({ t: 'remove', seat: +ds.remove });
    if ('act' in ds) { t.disabled = true; return send({ t: 'act', a: ds.act }); }
    if ('ready' in ds) return send({ t: 'ready', next: app.draft });
    if ('unready' in ds) return send({ t: 'unready' });
    if ('rebuy' in ds) return send({ t: 'rebuy' });
    if (!app.draft) return;
    const d = app.draft;
    if ('clear' in ds) { e.stopPropagation(); d[ds.clear] = 0; return pushDraft(); }
    if ('rebet' in ds) { Object.assign(d, { ante: L.anteMin, trips: 0, pairs: 0 }); return pushDraft(); }
    if ('chip' in ds) {
      const c = +ds.chip, k = app.sel;
      if (k === 'ante') d.ante = Math.min(L.anteMax, d.ante + c);
      else d[k] = Math.min(L.sideMax, Math.max(L.sideMin, d[k] + c));
      return pushDraft();
    }
    if ('spot' in ds) { app.sel = ds.spot; render(); }
  });
  // long-press / right-click a spot resets it
  $('#game').addEventListener('contextmenu', e => {
    const s = e.target.closest('[data-spot]');
    if (!s || !app.draft) return;
    e.preventDefault();
    app.draft[s.dataset.spot] = s.dataset.spot === 'ante' ? L.anteMin : 0;
    pushDraft();
  });
  function pushDraft() {
    send({ t: 'next', next: app.draft });
    render();
  }
})();
