/* Ultimate Texas Hold'em engine: rules, payouts, table state, computer players.
   Runs in the browser (window.UTH) and in Node (module.exports) for testing. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UTH = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const MAX_SEATS = 5;
  const LIMITS = { anteMin: 10, anteMax: 500, sideMin: 5, sideMax: 100 };
  const CAT = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush',
    'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'];

  // Pay tables (to 1), taken from the table layout
  const TRIPS_PAY = { 9: 50, 8: 40, 7: 30, 6: 8, 5: 7, 4: 4, 3: 3 };
  const BLIND_PAY = { 9: 500, 8: 50, 7: 10, 6: 3, 5: 1.5, 4: 1 };
  const BOT_NAMES = ['Vinnie', 'Lola', 'Dutch', 'Mona', 'Sal', 'Rita', 'Coco', 'Frankie', 'Benny', 'Pearl'];

  const NAMES = { 2: 'Deuce', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight',
    9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  const plural = v => (v === 6 ? 'Sixes' : NAMES[v] + 's');

  // ---------- cards ----------
  function randInt(n) {
    const c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && c.getRandomValues) {
      const a = new Uint32Array(1);
      const lim = Math.floor(0x100000000 / n) * n;
      let x;
      do { c.getRandomValues(a); x = a[0]; } while (x >= lim);
      return x % n;
    }
    return Math.floor(Math.random() * n);
  }
  function newDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push(r + s);
    return d;
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const rv = c => RANKS.indexOf(c[0]) + 2;

  // ---------- hand evaluation ----------
  function eval5(cs) {
    const vals = cs.map(rv).sort((a, b) => b - a);
    const flush = cs.every(c => c[1] === cs[0][1]);
    const counts = {};
    vals.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
    const g = Object.keys(counts).map(v => [counts[v], +v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    let sh = 0;
    if (g.length === 5) {
      if (vals[0] - vals[4] === 4) sh = vals[0];
      else if (vals[0] === 14 && vals[1] === 5) sh = 5; // wheel
    }
    if (sh && flush) return [sh === 14 ? 9 : 8, sh];
    if (g[0][0] === 4) return [7, g[0][1], g[1][1]];
    if (g[0][0] === 3 && g[1][0] === 2) return [6, g[0][1], g[1][1]];
    if (flush) return [5, ...vals];
    if (sh) return [4, sh];
    if (g[0][0] === 3) return [3, g[0][1], g[1][1], g[2][1]];
    if (g[0][0] === 2 && g[1][0] === 2) return [2, g[0][1], g[1][1], g[2][1]];
    if (g[0][0] === 2) return [1, g[0][1], g[1][1], g[2][1], g[3][1]];
    return [0, ...vals];
  }
  function cmp(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  function best(cards) {
    if (cards.length < 5) return null;
    let top = null, topCards = null;
    const n = cards.length, pick = [];
    (function rec(start) {
      if (pick.length === 5) {
        const five = pick.map(i => cards[i]);
        const s = eval5(five);
        if (!top || cmp(s, top) > 0) { top = s; topCards = five; }
        return;
      }
      for (let i = start; i <= n - (5 - pick.length); i++) { pick.push(i); rec(i + 1); pick.pop(); }
    })(0);
    return { score: top, cards: topCards, name: describe(top) };
  }
  function describe(s) {
    if (!s) return '';
    switch (s[0]) {
      case 9: return 'Royal Flush';
      case 8: return 'Straight Flush, ' + NAMES[s[1]] + ' high';
      case 7: return 'Four ' + plural(s[1]);
      case 6: return plural(s[1]) + ' full of ' + plural(s[2]);
      case 5: return 'Flush, ' + NAMES[s[1]] + ' high';
      case 4: return 'Straight, ' + NAMES[s[1]] + ' high';
      case 3: return 'Three ' + plural(s[1]);
      case 2: return plural(s[1]) + ' and ' + plural(s[2]);
      case 1: return 'Pair of ' + plural(s[1]);
      default: return NAMES[s[1]] + ' high';
    }
  }

  // ---------- side bet pays ----------
  function pairsPay(hole) {
    const [a, b] = hole.map(rv).sort((x, y) => y - x);
    const suited = hole[0][1] === hole[1][1];
    if (a === b) return a === 14 ? 30 : a >= 11 ? 10 : 3;
    if (a === 14 && b === 13) return suited ? 25 : 15;
    if (a === 14 && (b === 12 || b === 11)) return suited ? 20 : 5;
    return 0;
  }
  const fmtOdds = m => (m === 1.5 ? '3 to 2' : m + ' to 1');

  // ---------- computer player strategy (close to basic strategy) ----------
  function botDecide(phase, hole, board) {
    const [a, b] = hole.map(rv).sort((x, y) => y - x);
    const suited = hole[0][1] === hole[1][1];
    const pocket = a === b;
    if (phase === 'preflop') {
      const raise = (pocket && a >= 3) || a === 14 ||
        (a === 13 && (suited || b >= 5)) ||
        (a === 12 && ((suited && b >= 6) || b >= 8)) ||
        (a === 11 && ((suited && b >= 8) || b >= 10));
      return raise ? 'bet4' : 'check';
    }
    const boardRanks = board.map(rv);
    const hiddenPair = (pocket && a > 2) || hole.some(c => boardRanks.includes(rv(c)));
    const mine = best(hole.concat(board)).score;
    if (phase === 'flop') {
      if (hiddenPair || mine[0] >= 4) return 'bet2';
      for (const s of SUITS) {
        const all = hole.concat(board).filter(c => c[1] === s);
        const myHi = hole.filter(c => c[1] === s).map(rv);
        if (all.length >= 4 && myHi.some(v => v >= 10)) return 'bet2';
      }
      return 'check';
    }
    // river
    const boardOnly = eval5(board);
    if (hiddenPair || mine[0] > boardOnly[0]) return 'bet1';
    return 'fold';
  }

  // ---------- settlement for one player ----------
  function settle(stake, hole, board, folded, dealerScore) {
    const ph = best(hole.concat(board));
    const cat = ph.score[0];
    const lines = [];
    const add = (k, label, amt, ret, note) => { if (amt > 0) lines.push({ k, label, stake: amt, ret, note }); };
    let outcome = 'fold';
    if (folded) {
      add('ante', 'Ante', stake.ante, 0, 'Folded');
      add('blind', 'Blind', stake.blind, 0, 'Folded');
    } else {
      const c = cmp(ph.score, dealerScore);
      const qual = dealerScore[0] >= 1;
      if (c > 0) {
        outcome = 'win';
        add('ante', 'Ante', stake.ante, qual ? stake.ante * 2 : stake.ante, qual ? 'Wins 1 to 1' : 'Push, dealer did not open');
        const m = BLIND_PAY[cat];
        add('blind', 'Blind', stake.blind, m ? stake.blind * (1 + m) : stake.blind, m ? 'Wins ' + fmtOdds(m) : 'Push');
        add('play', 'Play', stake.play, stake.play * 2, 'Wins 1 to 1');
      } else if (c < 0) {
        outcome = 'lose';
        add('ante', 'Ante', stake.ante, 0, 'Loses');
        add('blind', 'Blind', stake.blind, 0, 'Loses');
        add('play', 'Play', stake.play, 0, 'Loses');
      } else {
        outcome = 'push';
        add('ante', 'Ante', stake.ante, stake.ante, 'Tie, push');
        add('blind', 'Blind', stake.blind, stake.blind, 'Tie, push');
        add('play', 'Play', stake.play, stake.play, 'Tie, push');
      }
    }
    if (stake.trips) {
      const m = TRIPS_PAY[cat];
      add('trips', 'Trips', stake.trips, m ? stake.trips * (1 + m) : 0, m ? 'Wins ' + fmtOdds(m) : 'Loses');
    }
    if (stake.pairs) {
      const m = pairsPay(hole);
      add('pairs', 'Pairs Bonus', stake.pairs, m ? stake.pairs * (1 + m) : 0, m ? 'Wins ' + fmtOdds(m) : 'Loses');
    }
    const staked = lines.reduce((t, l) => t + l.stake, 0);
    const ret = lines.reduce((t, l) => t + l.ret, 0);
    return { hand: ph.name, cat, best: ph.cards, outcome, lines, staked, ret, net: ret - staked };
  }

  // ---------- table (runs on the host) ----------
  const ACTIONS = { preflop: ['check', 'bet3', 'bet4'], flop: ['check', 'bet2'], river: ['fold', 'bet1'] };
  const MULT = { bet4: 4, bet3: 3, bet2: 2, bet1: 1 };
  const clean = s => String(s || '').replace(/[<>]/g, '').trim().slice(0, 16);
  const int = v => Math.max(0, Math.floor(Number(v) || 0));

  class Table {
    constructor(opts = {}) {
      this.startBank = int(opts.startBank) || 1000;
      this.schedule = opts.schedule || ((fn, ms) => setTimeout(fn, ms));
      this.onChange = opts.onChange || (() => {});
      this.seats = new Array(MAX_SEATS).fill(null);
      this.phase = 'betting';
      this.handNo = 0;
      this.board = []; this.shown = 0; this.dealer = []; this.dealerBest = null;
      this.log = []; this.chat = [];
      this.dealPending = false; this.advancing = false;
    }
    emit() { this.onChange(); }
    addLog(t) { this.log.push({ t, ts: Date.now() }); if (this.log.length > 80) this.log.shift(); }
    bettingOpen() { return this.phase === 'betting' || this.phase === 'results'; }
    seatOf(clientId) { return this.seats.findIndex(s => s && !s.bot && s.clientId === clientId); }
    cost(n) { return n.ante * 2 + n.trips + n.pairs; }
    uniqueName(name, skip) {
      let base = name || 'Player', n = base, k = 2;
      while (this.seats.some((s, i) => s && i !== skip && s.name.toLowerCase() === n.toLowerCase())) n = base + ' ' + k++;
      return n;
    }
    newSeat(o) {
      return Object.assign({
        name: '', bot: false, clientId: null, token: null, connected: true,
        bank: this.startBank, buyins: 1,
        next: { ante: LIMITS.anteMin, trips: 0, pairs: 0 },
        ready: false, inHand: false, hole: [], stake: null,
        acted: false, folded: false, action: '', result: null
      }, o);
    }

    join(clientId, name, token) {
      name = clean(name);
      let i = token ? this.seats.findIndex(s => s && !s.bot && s.token === token) : -1;
      if (i >= 0) {
        const s = this.seats[i];
        s.clientId = clientId; s.connected = true;
        if (name) s.name = this.uniqueName(name, i);
        this.addLog(s.name + ' is back');
        this.emit();
        return i;
      }
      i = this.seats.findIndex(s => !s);
      if (i < 0) { this.emit(); return -1; }
      this.seats[i] = this.newSeat({ name: this.uniqueName(name), clientId, token });
      this.addLog(this.seats[i].name + ' sat down');
      this.emit();
      return i;
    }
    disconnect(clientId) {
      const i = this.seatOf(clientId);
      if (i < 0) return;
      const s = this.seats[i];
      s.connected = false; s.ready = false;
      this.addLog(s.name + ' disconnected');
      this.autoActAway();
      this.emit();
      this.maybeAutoDeal();
    }
    addBot() {
      const i = this.seats.findIndex(s => !s);
      if (i < 0) return 'All 5 seats are taken';
      const used = this.seats.filter(Boolean).map(s => s.name);
      const pool = BOT_NAMES.filter(n => !used.includes(n));
      const name = pool.length ? pool[randInt(pool.length)] : this.uniqueName('CPU');
      const ante = [10, 10, 15, 25][randInt(4)];
      this.seats[i] = this.newSeat({
        name, bot: true, ready: true,
        next: { ante, trips: randInt(2) ? 5 : 0, pairs: randInt(2) ? 5 : 0 }
      });
      this.addLog(name + ' (computer) sat down');
      this.emit();
      this.maybeAutoDeal();
      return null;
    }
    removeSeat(i) {
      const s = this.seats[i];
      if (!s) return 'Seat is empty';
      if (s.inHand && !this.bettingOpen()) return 'Wait until the hand is over';
      if (s.clientId === 'host') return 'The host cannot leave their own seat';
      this.seats[i] = null;
      this.addLog(s.name + ' left the table');
      this.emit();
      this.maybeAutoDeal();
      return null;
    }
    validNext(n) {
      const v = { ante: int(n && n.ante), trips: int(n && n.trips), pairs: int(n && n.pairs) };
      if (v.ante < LIMITS.anteMin || v.ante > LIMITS.anteMax) return [null, 'Ante must be $' + LIMITS.anteMin + ' to $' + LIMITS.anteMax];
      for (const k of ['trips', 'pairs']) {
        if (v[k] && (v[k] < LIMITS.sideMin || v[k] > LIMITS.sideMax)) return [null, 'Side bets are $' + LIMITS.sideMin + ' to $' + LIMITS.sideMax];
      }
      return [v, null];
    }
    setNext(i, n) {
      const s = this.seats[i];
      if (!this.bettingOpen() || s.ready) return null;
      const [v, err] = this.validNext(n);
      if (err) return err;
      s.next = v;
      this.emit();
      return null;
    }
    ready(i, n) {
      const s = this.seats[i];
      if (!this.bettingOpen()) return 'Hand already in progress';
      const [v, err] = this.validNext(n || s.next);
      if (err) return err;
      if (s.bank < this.cost(v)) return 'Not enough chips. Rebuy or lower your bet';
      s.next = v; s.ready = true;
      this.emit();
      this.maybeAutoDeal();
      return null;
    }
    unready(i) {
      if (!this.bettingOpen()) return null;
      this.seats[i].ready = false;
      this.emit();
      return null;
    }
    rebuy(i) {
      const s = this.seats[i];
      if (s.inHand && !this.bettingOpen()) return 'Rebuy between hands';
      s.bank += this.startBank; s.buyins++;
      this.addLog(s.name + ' rebought for $' + this.startBank);
      this.emit();
      return null;
    }
    addChat(i, text) {
      text = String(text || '').trim().slice(0, 200);
      if (!text) return null;
      this.chat.push({ who: this.seats[i] ? this.seats[i].name : 'Watcher', text, ts: Date.now() });
      if (this.chat.length > 60) this.chat.shift();
      this.emit();
      return null;
    }

    maybeAutoDeal() {
      if (!this.bettingOpen() || this.dealPending) return;
      const humans = this.seats.filter(s => s && !s.bot && s.connected);
      if (!humans.length || !humans.every(s => s.ready)) return;
      if (!this.seats.some(s => s && s.ready && humans.some(h => h === s))) return;
      this.dealPending = true;
      this.schedule(() => { this.dealPending = false; if (this.bettingOpen()) this.deal(); }, 900);
    }
    deal() {
      if (!this.bettingOpen()) return 'Hand already in progress';
      this.seats.forEach(s => {
        if (s && s.bot && s.bank < this.cost(s.next)) { s.bank += this.startBank; s.buyins++; }
      });
      const players = [];
      this.seats.forEach((s, i) => {
        if (s && s.ready && (s.bot || s.connected) && s.bank >= this.cost(s.next)) players.push(i);
      });
      if (!players.length) return 'Nobody has locked in a bet yet';
      this.handNo++;
      const deck = shuffle(newDeck()); // fresh single 52-card deck every hand
      this.seats.forEach(s => {
        if (!s) return;
        Object.assign(s, { inHand: false, hole: [], stake: null, acted: false, folded: false, action: '', result: null });
      });
      for (const i of players) {
        const s = this.seats[i], n = s.next;
        s.inHand = true;
        s.stake = { ante: n.ante, blind: n.ante, trips: n.trips, pairs: n.pairs, play: 0 };
        s.bank -= this.cost(n);
        if (!s.bot) s.ready = false;
      }
      this.dealer = [];
      for (let r = 0; r < 2; r++) {
        for (const i of players) this.seats[i].hole.push(deck.pop());
        this.dealer.push(deck.pop());
      }
      this.board = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
      this.shown = 0; this.dealerBest = null;
      this.phase = 'preflop';
      this.addLog('Hand #' + this.handNo + ' dealt to ' + players.length + (players.length > 1 ? ' players' : ' player'));
      this.emit();
      this.startStreet();
      return null;
    }
    act(i, a) {
      const s = this.seats[i];
      if (!s || !s.inHand || s.acted) return 'Nothing to act on right now';
      if (!ACTIONS[this.phase] || !ACTIONS[this.phase].includes(a)) return 'That move is not allowed now';
      if (MULT[a]) {
        const amt = s.stake.ante * MULT[a];
        if (s.bank < amt) return 'Not enough chips for that bet';
        s.bank -= amt; s.stake.play = amt; s.action = MULT[a] + 'x';
      } else if (a === 'fold') { s.folded = true; s.action = 'Fold'; }
      else s.action = 'Check';
      s.acted = true;
      this.emit();
      this.checkAdvance();
      return null;
    }
    defaultAction() { return this.phase === 'river' ? 'fold' : 'check'; }
    autoActAway() {
      if (!ACTIONS[this.phase]) return;
      this.seats.forEach((s, i) => {
        if (s && !s.bot && !s.connected && s.inHand && !s.acted) this.act(i, this.defaultAction());
      });
    }
    force() {
      if (!ACTIONS[this.phase]) return 'No one to hurry';
      const a = this.defaultAction();
      this.seats.forEach((s, i) => {
        if (s && s.inHand && !s.acted) { this.act(i, a); this.addLog(s.name + ' timed out (' + a + ')'); }
      });
      this.emit();
      return null;
    }
    startStreet() {
      const ph = this.phase, hand = this.handNo;
      this.seats.forEach((s, i) => {
        if (s && s.bot && s.inHand && !s.acted) {
          this.schedule(() => {
            if (this.phase === ph && this.handNo === hand && !s.acted && this.seats[i] === s) {
              const want = botDecide(ph, s.hole, this.board.slice(0, this.shown));
              const tries = [want, want === 'bet4' ? 'bet3' : null, this.defaultAction()].filter(Boolean);
              for (const a of tries) if (this.act(i, a) === null) break;
            }
          }, 700 + randInt(1100));
        }
      });
      this.autoActAway();
      this.checkAdvance();
    }
    checkAdvance() {
      if (!ACTIONS[this.phase] || this.advancing) return;
      const live = this.seats.filter(s => s && s.inHand);
      if (live.some(s => !s.acted)) return;
      this.advancing = true;
      const hand = this.handNo;
      this.schedule(() => {
        this.advancing = false;
        if (this.handNo === hand) this.nextStreet();
      }, 800);
    }
    nextStreet() {
      if (this.phase === 'preflop') { this.phase = 'flop'; this.shown = 3; }
      else if (this.phase === 'flop') { this.phase = 'river'; this.shown = 5; }
      else if (this.phase === 'river') { this.showdown(); return; }
      else return;
      this.seats.forEach(s => {
        if (!s || !s.inHand) return;
        s.acted = s.stake.play > 0 || s.folded;
        if (!s.acted) s.action = '';
      });
      this.emit();
      this.startStreet();
    }
    showdown() {
      this.phase = 'results';
      this.shown = 5;
      this.dealerBest = best(this.dealer.concat(this.board));
      const qual = this.dealerBest.score[0] >= 1;
      this.addLog('Dealer shows ' + this.dealerBest.name + (qual ? '' : ', does not open (ante pushes)'));
      this.seats.forEach(s => {
        if (!s || !s.inHand) return;
        s.result = settle(s.stake, s.hole, this.board, s.folded, this.dealerBest.score);
        s.bank += s.result.ret;
        const n = s.result.net;
        this.addLog(s.name + ': ' + (s.folded ? 'folded' : s.result.hand) + ', ' + (n > 0 ? '+$' + n : n < 0 ? '-$' + -n : 'even'));
      });
      this.emit();
      this.maybeAutoDeal();
    }

    command(clientId, m) {
      if (!m || typeof m !== 'object') return 'Bad message';
      const isHost = clientId === 'host';
      const i = this.seatOf(clientId);
      switch (m.t) {
        case 'chat': return this.addChat(i, m.text);
        case 'addBot': return isHost ? this.addBot() : 'Only the host can do that';
        case 'remove': return isHost ? this.removeSeat(int(m.seat)) : 'Only the host can do that';
        case 'deal': return isHost ? this.deal() : 'Only the host can do that';
        case 'force': return isHost ? this.force() : 'Only the host can do that';
      }
      if (i < 0) return 'You are watching. Wait for a free seat';
      switch (m.t) {
        case 'next': return this.setNext(i, m.next);
        case 'ready': return this.ready(i, m.next);
        case 'unready': return this.unready(i);
        case 'act': return this.act(i, m.a);
        case 'rebuy': return this.rebuy(i);
        case 'sit': return null;
      }
      return 'Unknown command';
    }

    view(me) {
      const res = this.phase === 'results';
      return {
        phase: this.phase, handNo: this.handNo, me, startBank: this.startBank, limits: LIMITS,
        board: this.board.slice(0, this.shown),
        dealer: this.handNo === 0 ? [] : res ? this.dealer.slice() : ['??', '??'],
        dealerHand: res && this.dealerBest ? { name: this.dealerBest.name, qual: this.dealerBest.score[0] >= 1, cards: this.dealerBest.cards } : null,
        seats: this.seats.map((s, i) => s && {
          name: s.name, bot: s.bot, host: s.clientId === 'host', connected: s.connected,
          bank: s.bank, buyins: s.buyins, net: s.bank - s.buyins * this.startBank,
          next: s.next, ready: s.ready, inHand: s.inHand, stake: s.stake,
          acted: s.acted, folded: s.folded, action: s.action, result: s.result,
          hole: s.inHand ? ((i === me || res) ? s.hole.slice() : ['??', '??']) : []
        }),
        log: this.log.slice(-40), chat: this.chat.slice(-40)
      };
    }
  }

  return {
    RANKS, SUITS, LIMITS, MAX_SEATS, CAT, TRIPS_PAY, BLIND_PAY,
    newDeck, shuffle, eval5, best, cmp, describe, pairsPay, fmtOdds, botDecide, settle, Table
  };
});
