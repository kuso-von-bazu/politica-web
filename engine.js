/* POLITICA -ポリティカ- ルールエンジン (コマンド選択型 / 1ターン1コマンド)
   非同期 choice プロバイダ方式 (UI=クリック待ち / AI=即決) で駆動。Node/ブラウザ両対応。
   各ターン、いずれかのコマンドを1回だけ実行する。
   コマンド: 献金 / 法案を引く / 政治家を入替 / 法案を提出 / 選挙を行う / 買収。
   勝利条件(3種): ①場の影響力が50超(その思想最大の者) ②信用が20超 ③選挙で3回首班。
   詳細は 設計メモ_仮決定.md。 */
(function (root) {
  'use strict';
  var DATA = root.PL_DATA || (typeof require !== 'undefined' ? require('./data.js') : null);
  var IDEOLOGIES = DATA.IDEOLOGIES;
  var IDKEYS = IDEOLOGIES.map(function (i) { return i.key; });

  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
  function emptyIdeo() { return { cap: 0, mil: 0, com: 0, sci: 0, env: 0 }; }
  function ideoJp(k) { for (var i = 0; i < IDEOLOGIES.length; i++) if (IDEOLOGIES[i].key === k) return IDEOLOGIES[i].jp; return k; }

  var POL_SLOTS = 5;       // 議員スロット(常にフル)
  var LAW_HAND = 3;        // 法案手札上限
  var BRIBE_COST = 5;      // 買収コスト(G)
  var ELECTION_TRUST = 2;  // 選挙を起こす信用コスト
  var FIELD_WIN = 50;      // 勝利①: 場の影響力がこれを超える
  var TRUST_WIN = 20;      // 勝利②: 信用がこれを超える
  var PM_WIN = 3;          // 勝利③: 選挙でこの回数首班になる

  // =================================================================
  class Game {
    constructor(config) {
      this.config = config || {};
      this.rng = makeRng(config.seed || 12345);
      this.players = (config.players || []).map(function (p, i) {
        return {
          idx: i, name: p.name || (DATA.PLAYER_COLOR_NAMES[i] + 'プレイヤー'),
          isAI: !!p.isAI, color: DATA.PLAYER_COLORS[i],
          pols: [],            // 政治家スロット(常に5)
          laws: [],            // 法案手札(最大3)
          gold: 6, trust: 8,
          isPM: false,
          pmCount: 0           // 選挙で首班に選ばれた回数
        };
      });
      this.numPlayers = this.players.length;
      this.FIELD_WIN = FIELD_WIN; this.TRUST_WIN = TRUST_WIN; this.PM_WIN = PM_WIN;
      this.log = [];
      this.turn = 0;
      this.curIdx = 0;
      this.pmIdx = 0;
      this.over = false;
      this.winner = null;
      this.phase = 'setup';
      this.enacted = [];          // 成立法案 [{card, owner}] (最大5)
      this.lawFlags = {};
      this.electionCooldown = 0;

      this.polDeck = this._shuffle(deepCopy(DATA.POLITICIANS));
      this.lawDeck = this._shuffle(deepCopy(DATA.LAWS));
      this.polDiscard = [];
      this.lawDiscard = [];
    }

    // ---- ユーティリティ ----
    _shuffle(arr) {
      for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(this.rng() * (i + 1));
        var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    }
    _draw(deck, discardName) {
      if (deck.length === 0) {
        var disc = this[discardName];
        if (disc && disc.length) { this[discardName] = []; while (disc.length) deck.push(disc.pop()); this._shuffle(deck); }
      }
      return deck.length ? deck.pop() : null;
    }
    drawPol() { return this._draw(this.polDeck, 'polDiscard'); }
    drawLaw() { return this._draw(this.lawDeck, 'lawDiscard'); }

    logMsg(s) { this.log.push({ turn: this.turn, text: s }); }
    notify() { if (this.ctx && this.ctx.notify) return this.ctx.notify(this); }
    choose(pi, dec) { return this.ctx.choose(pi, dec, this); }

    // ---- 影響力 ----
    influenceByIdeo(p) {
      var sum = emptyIdeo();
      p.pols.forEach(function (c) { IDKEYS.forEach(function (k) { sum[k] += (c.infl[k] || 0); }); });
      return sum;
    }
    totalInfluence(p) {
      var s = this.influenceByIdeo(p), t = 0; IDKEYS.forEach(function (k) { t += s[k]; });
      p.pols.forEach(function (c) { t += (c.infl.non || 0); });
      return t;
    }
    strongestIdeo(p) {
      var s = this.influenceByIdeo(p), best = 'cap', bv = -1;
      IDKEYS.forEach(function (k) { if (s[k] > bv) { bv = s[k]; best = k; } });
      return best;
    }
    leaderPol(p) {
      var best = null, bv = -1;
      p.pols.forEach(function (c) {
        var t = (c.infl.non || 0); IDKEYS.forEach(function (k) { t += (c.infl[k] || 0); });
        if (t > bv) { bv = t; best = c; }
      });
      return best;
    }
    fieldInfluence() {
      var f = emptyIdeo(), self = this;
      this.players.forEach(function (p) { var s = self.influenceByIdeo(p); IDKEYS.forEach(function (k) { f[k] += s[k]; }); });
      return f;
    }
    fieldDominant() {
      var f = this.fieldInfluence(), best = null, bv = 0;
      IDKEYS.forEach(function (k) { if (f[k] > bv) { bv = f[k]; best = k; } });
      return best;
    }
    // ある思想で最も影響力の高いプレイヤー
    topInIdeo(k) {
      var best = null, bv = -1, self = this;
      this.players.forEach(function (p) { var v = self.influenceByIdeo(p)[k]; if (v > bv) { bv = v; best = p; } });
      return best;
    }
    polTotal(c) { var s = (c.infl.non || 0); IDKEYS.forEach(function (k) { s += (c.infl[k] || 0); }); return s; }

    // =================================================================
    //  メインループ
    // =================================================================
    async run(ctx) {
      this.ctx = ctx;
      await this.setup();
      var guard = 0;
      while (!this.over && guard < 6000) {
        guard++;
        await this.playTurn(this.players[this.curIdx]);
        if (this.over) break;
        this.curIdx = (this.curIdx + 1) % this.numPlayers;
        if (this.curIdx === this.pmIdx % this.numPlayers) this.turn++;
        if (this.turn > 100) { this._declareByProgress(); break; } // 長期化時は進捗トップが勝利
      }
      this.phase = 'gameover';
      await this.notify();
      return { winner: this.winner };
    }

    async setup() {
      this.phase = 'setup';
      this.pmIdx = Math.floor(this.rng() * this.numPlayers);
      this.curIdx = this.pmIdx;
      this.players[this.pmIdx].isPM = true;
      var self = this;
      this.players.forEach(function (p) {
        for (var i = 0; i < POL_SLOTS; i++) { var c = self.drawPol(); if (c) p.pols.push(c); }
        p._leaderId = self.leaderPol(p) ? self.leaderPol(p).id : null;
      });
      this.logMsg('ゲーム開始。各プレイヤーは議員5名を擁する。初代首班は' + this.players[this.pmIdx].name + '(初代は選挙回数に数えない)。');
      this.turn = 1;
      await this.notify();
    }

    // ---- 勝利判定(3種) ----
    checkWin() {
      // ② 信用20超
      for (var i = 0; i < this.players.length; i++) {
        if (this.players[i].trust > TRUST_WIN) { this._declareWin(this.players[i], '信用が' + TRUST_WIN + 'を超えた'); return true; }
      }
      // ③ 選挙で3回首班
      for (var j = 0; j < this.players.length; j++) {
        if (this.players[j].pmCount >= PM_WIN) { this._declareWin(this.players[j], '選挙で' + PM_WIN + '回首班に選ばれた'); return true; }
      }
      // ① 場の影響力50超 → その思想で最も影響力の高い者
      var f = this.fieldInfluence();
      for (var k = 0; k < IDKEYS.length; k++) {
        if (f[IDKEYS[k]] > FIELD_WIN) {
          var w = this.topInIdeo(IDKEYS[k]);
          this._declareWin(w, ideoJp(IDKEYS[k]) + 'の場の影響力が' + FIELD_WIN + 'を超え、その思想の筆頭になった');
          return true;
        }
      }
      return false;
    }
    _declareWin(p, why) { this.over = true; this.winner = p; this.logMsg('★' + p.name + 'の勝利! (' + why + ')'); }
    // 長期化時: 各勝利条件への到達率が最も高いプレイヤーを勝者とする
    _declareByProgress() {
      var self = this, f = this.fieldInfluence();
      var best = null, bs = -1;
      this.players.forEach(function (p) {
        var fieldShare = 0;
        IDKEYS.forEach(function (k) { if (self.topInIdeo(k).idx === p.idx) fieldShare = Math.max(fieldShare, self.influenceByIdeo(p)[k] / FIELD_WIN); });
        var sc = Math.max(p.trust / TRUST_WIN, p.pmCount / PM_WIN, fieldShare);
        if (sc > bs) { bs = sc; best = p; }
      });
      this._declareWin(best || this.players[0], '規定ターン到達・進捗トップ');
    }

    // =================================================================
    //  1ターン: いずれかのコマンドを1回
    // =================================================================
    async playTurn(p) {
      if (this.over) return;
      this.curIdx = p.idx;
      this.phase = 'turn';
      this.logMsg('―― ' + p.name + ' の手番 ――');
      await this.notify();

      var opts = this.availableCommands(p);
      var act = await this.choose(p.idx, { type: 'turnAction', options: opts, when: 'main' });
      var id = act && act.id ? act.id : 'done';
      if (id === 'donate') await this.cmdDonate(p);
      else if (id === 'lawDraw') await this.cmdLawDraw(p);
      else if (id === 'polSwap') await this.cmdPolSwap(p);
      else if (id === 'lawPropose') await this.cmdLawPropose(p);
      else if (id === 'bribe') await this.cmdBribe(p);
      else if (id === 'election') await this.cmdElection(p);

      if (this.checkWin()) return;
      if (this.electionCooldown > 0) this.electionCooldown--;
      await this.notify();
    }

    availableCommands(p) {
      var opts = [];
      opts.push({ id: 'donate', label: '献金(+' + (p.isPM ? 2 : 1) + 'G)' });
      if (p.laws.length < LAW_HAND) opts.push({ id: 'lawDraw', label: '法案を引く' + (p.isPM ? '(2枚)' : '') });
      if (!p.isPM) opts.push({ id: 'polSwap', label: '政治家を入替' });
      if (p.laws.length > 0 && (this.enacted.length < 5 || this.enacted.length > 0) && !(this.lawFlags.purge && this.strongestIdeo(p) === 'com'))
        opts.push({ id: 'lawPropose', label: '法案を提出' });
      if (!p.isPM && p.gold >= BRIBE_COST && this.bribable(p)) opts.push({ id: 'bribe', label: '買収(' + BRIBE_COST + 'G)' });
      if (this.electionCooldown <= 0 && p.trust >= ELECTION_TRUST) opts.push({ id: 'election', label: '選挙を行う(信用' + ELECTION_TRUST + ')' });
      opts.push({ id: 'done', label: '何もしない(ターン終了)' });
      return opts;
    }
    bribable(p) { return this.players.some(function (q) { return q.idx !== p.idx && !q.isPM && q.pols.length > 0; }); }

    // ---- 献金 ----
    async cmdDonate(p) {
      var g = p.isPM ? 2 : 1;
      p.gold += g;
      this.logMsg(p.name + 'は献金で +' + g + 'G (所持' + p.gold + 'G)。');
    }

    // ---- 法案獲得(首班は2枚) ----
    async cmdLawDraw(p) {
      var n = p.isPM ? 2 : 1;
      for (var i = 0; i < n && p.laws.length < LAW_HAND; i++) {
        var c = this.drawLaw();
        if (c) { p.laws.push(c); this.logMsg(p.name + 'は法案「' + c.name + '」を手札に加えた。'); }
      }
    }

    // ---- 政治家入替(首班は不可・availableで制御) ----
    async cmdPolSwap(p) {
      var n = 3;
      if (this.lawFlags.redArmy && p.isPM) n = 4;
      var drawn = [];
      for (var i = 0; i < n; i++) { var c = this.drawPol(); if (c) drawn.push(c); }
      if (!drawn.length) { this.logMsg('政治家山札が尽きている。'); return; }
      var pick = await this.choose(p.idx, { type: 'pickPolitician', cards: drawn, slotFull: true, current: p.pols, q: '加える政治家(議員と入替)' });
      if (pick && pick.take != null) {
        var nc = drawn[pick.take];
        var ri = (pick.replace != null) ? pick.replace : this.weakestSlot(p);
        var old = p.pols.splice(ri, 1, nc)[0];
        if (old) this.polDiscard.push(old);
        this.logMsg(p.name + 'は「' + (old ? old.name : '空き') + '」を「' + nc.name + '」に入れ替えた。');
        drawn.splice(pick.take, 1);
        this.onLeaderMaybeChanged(p);
      }
      drawn.forEach(function (c) { this.polDiscard.push(c); }, this);
    }
    weakestSlot(p) {
      var wi = 0, wv = Infinity, self = this;
      p.pols.forEach(function (c, i) { var t = self.polTotal(c); if (t < wv) { wv = t; wi = i; } });
      return wi;
    }

    // ---- 法案提出(既存の成立法案を廃案にできる) ----
    async cmdLawPropose(p) {
      if (p.laws.length === 0) return;
      var pick = await this.choose(p.idx, { type: 'pickCard', kind: 'law', cards: p.laws, cancelable: true, q: '提出する法案' });
      if (!pick || pick.index == null) return;
      var card = p.laws[pick.index];
      // 廃案対象(任意): 成立法案を1つ選ぶと、可決時にそれを廃案にできる
      var repealIdx = null;
      if (this.enacted.length > 0) {
        var rd = await this.choose(p.idx, {
          type: 'pickRepeal',
          enacted: this.enacted.map(function (e) { return { name: e.card.name, owner: e.owner }; }),
          q: 'この法案で廃案にする成立法案(任意・廃案されると提出者の信用-2)'
        });
        if (rd && rd.index != null && rd.index >= 0 && rd.index < this.enacted.length) repealIdx = rd.index;
      }
      var need = this.lawNeed(card);
      var rtxt = (repealIdx != null) ? ' / 「' + this.enacted[repealIdx].card.name + '」の廃案を含む' : '';
      this.logMsg(p.name + 'が法案「' + card.name + '」を提出 (必要影響力' + need + '/提出者' + this.totalInfluence(p) + rtxt + ')。');
      p.laws.splice(pick.index, 1);
      await this.runVote(p, card, need, repealIdx);
    }
    lawNeed(card) {
      var s = 0; IDKEYS.forEach(function (k) { s += Math.abs(card.d[k] || 0); });
      return Math.max(3, s * 2);
    }

    async runVote(proposer, card, need, repealIdx) {
      this.phase = 'vote';
      await this.notify();
      var repealInfo = (repealIdx != null && this.enacted[repealIdx])
        ? { name: this.enacted[repealIdx].card.name, owner: this.enacted[repealIdx].owner } : null;
      var votes = {}; votes[proposer.idx] = 'yes';
      for (var i = 0; i < this.players.length; i++) {
        var q = this.players[i];
        if (q.idx === proposer.idx) continue;
        if (this.lawFlags.twoParty && !this.isTop2Influence(q)) { votes[q.idx] = 'abstain'; continue; }
        var v = await this.choose(q.idx, { type: 'vote', card: card, proposer: proposer.idx, need: need, repeal: repealInfo });
        votes[q.idx] = (v && v.yes) ? 'yes' : 'no';
      }
      var yesInf = 0, noInf = 0, supporters = [];
      for (var idx in votes) {
        var pl = this.players[idx];
        if (votes[idx] === 'yes') { yesInf += this.totalInfluence(pl); if (pl.idx !== proposer.idx) supporters.push(pl); }
        else if (votes[idx] === 'no') noInf += this.totalInfluence(pl);
      }
      var pass = (yesInf > noInf) && (yesInf >= need);
      if (pass) {
        this.logMsg('可決! (賛成' + yesInf + ' vs 反対' + noInf + ')');
        await this.enactLaw(proposer, card, supporters, repealIdx);
      } else {
        this.logMsg('否決… (賛成' + yesInf + ' vs 反対' + noInf + ')');
        if (card.id) this.lawDiscard.push(card);
      }
      this.phase = 'turn';
      await this.notify();
    }
    isTop2Influence(p) {
      var arr = this.players.map(function (q) { return { i: q.idx, v: this.totalInfluence(q) }; }, this).sort(function (a, b) { return b.v - a.v; });
      return arr.slice(0, 2).some(function (x) { return x.i === p.idx; });
    }

    // 法案成立 → 信用を得る。場で優勢/地盤が強いと真価を発揮し信用が増す。
    //   repealIdx 指定時は、その成立法案を廃案にし、廃案された法案の提出者の信用-2。
    async enactLaw(proposer, card, supporters, repealIdx) {
      if (repealIdx != null && this.enacted[repealIdx]) {
        var tgt = this.enacted.splice(repealIdx, 1)[0];
        this.lawDiscard.push(tgt.card); this.clearLawFlag(tgt.card);
        var owner = this.players[tgt.owner];
        owner.trust -= 2;
        this.logMsg('法案「' + tgt.card.name + '」が廃案に! 提出者' + owner.name + 'の信用-2 (信用' + owner.trust + ')。');
      }
      proposer.trust += (card.pip || 0);
      supporters.forEach(function (s) { s.trust += (card.aip || 0); });
      // 主たる思想
      var primary = null, pv = 0;
      IDKEYS.forEach(function (k) { if ((card.d[k] || 0) > pv) { pv = card.d[k]; primary = k; } });
      if (primary) {
        var infl = this.influenceByIdeo(proposer);
        var bonus = 0, reasons = [];
        if (infl[primary] >= 10) { bonus += 1; reasons.push('地盤(' + ideoJp(primary) + '影響力' + infl[primary] + ')'); }
        if (this.fieldDominant() === primary) { bonus += 2; reasons.push('場の支持'); }
        if (bonus > 0) {
          proposer.trust += bonus;
          this.logMsg('法案が真価を発揮! 信用+' + bonus + ' [' + reasons.join('・') + ']');
        }
      }
      this.logMsg(proposer.name + 'は信用を得た (信用' + proposer.trust + ')。');
      this.enacted.push({ card: card, owner: proposer.idx });
      if (this.enacted.length > 5) { var old = this.enacted.shift(); this.lawDiscard.push(old.card); this.clearLawFlag(old.card); }
      this.applyLawFlag(card);
    }

    applyLawFlag(card) {
      switch (card.name) {
        case '公職追放': this.lawFlags.purge = true; break;
        case '2大政党制': this.lawFlags.twoParty = true; break;
        case '赤軍の設立': this.lawFlags.redArmy = true; break;
        case '文民統制': this.lawFlags.civilian = true; break;
      }
    }
    clearLawFlag(card) {
      var m = { '公職追放': 'purge', '2大政党制': 'twoParty', '赤軍の設立': 'redArmy', '文民統制': 'civilian' };
      if (m[card.name]) this.lawFlags[m[card.name]] = false;
    }

    // ---- 買収(5G・首班は対象外/実行不可) ----
    async cmdBribe(p) {
      var targets = this.players.filter(function (q) { return q.idx !== p.idx && !q.isPM && q.pols.length > 0; });
      if (!targets.length) return;
      var t = await this.choose(p.idx, { type: 'pickPlayer', players: targets.map(function (q) { return q.idx; }), q: '買収する相手(首班は不可)' });
      if (!t || t.idx == null) return;
      var target = this.players[t.idx];
      if (target.isPM) { this.logMsg('首班は買収できない。'); return; }
      var pc = await this.choose(p.idx, { type: 'pickPolitician', cards: target.pols, q: '奪う政治家', fromOther: true });
      if (!pc || pc.take == null) return;
      if (p.gold < BRIBE_COST) return;
      var stolen = target.pols.splice(pc.take, 1)[0];
      var ri = this.weakestSlot(p);
      var dropped = p.pols.splice(ri, 1, stolen)[0];
      if (dropped) this.polDiscard.push(dropped);
      p.gold -= BRIBE_COST;
      this.logMsg(p.name + 'は' + target.name + 'から「' + stolen.name + '」を買収(' + BRIBE_COST + 'G)。自党の「' + (dropped ? dropped.name : '空き') + '」を放出。');
      var refill = this.drawPol(); if (refill) target.pols.push(refill);
      this.onLeaderMaybeChanged(p); this.onLeaderMaybeChanged(target);
    }

    // ---- 選挙 ----
    async cmdElection(p) {
      if (p.trust < ELECTION_TRUST || this.electionCooldown > 0) return;
      p.trust -= ELECTION_TRUST;
      this.logMsg(p.name + 'が選挙を要求した(信用-' + ELECTION_TRUST + ')。');
      await this.runElection();
      this.electionCooldown = this.numPlayers * 2; // 選挙は間隔をあける(連打抑制)
    }

    async runElection() {
      this.phase = 'election';
      this.logMsg('★ 首班指名選挙 ★');
      await this.notify();
      var cands = [];
      for (var i = 0; i < this.players.length; i++) {
        var q = this.players[i];
        var ans = await this.choose(q.idx, { type: 'candidacy' });
        if (ans && ans.run) cands.push(q.idx);
      }
      if (cands.length === 0) cands = [this.pmIdx];
      var incumbent = this.pmIdx; // 現職は再選に不利(現職忌避)
      var tally = {}; cands.forEach(function (c) { tally[c] = 0; });
      cands.forEach(function (c) {
        var w = this.totalInfluence(this.players[c]);
        if (c === incumbent) w = Math.round(w * 0.7);
        tally[c] += w;
      }, this);
      for (var j = 0; j < this.players.length; j++) {
        var v = this.players[j];
        if (cands.indexOf(v.idx) >= 0) continue;
        var vf = await this.choose(v.idx, { type: 'voteFor', candidates: cands });
        var pickC = (vf && vf.idx != null && cands.indexOf(vf.idx) >= 0) ? vf.idx : cands[0];
        tally[pickC] += this.totalInfluence(v);
      }
      var ranked = cands.slice().sort(function (a, b) { return tally[b] - tally[a]; });
      var winner = ranked[0];
      if (this.lawFlags.civilian) {
        for (var r = 0; r < ranked.length; r++) { if (this.strongestIdeo(this.players[ranked[r]]) !== 'mil') { winner = ranked[r]; break; } }
      }
      this.players.forEach(function (pl) { pl.isPM = false; });
      this.pmIdx = winner; var w = this.players[winner];
      w.isPM = true; w.pmCount += 1;
      this.logMsg(w.name + 'が首班に指名された! (得票' + tally[winner] + ' / 通算' + w.pmCount + '回目)');
      w.trust += 2;
      this.logMsg(w.name + 'は組閣で信用+2 (信用' + w.trust + ')。議員は在任中固定される。');
      this.checkWin();
      this.phase = 'turn';
      await this.notify();
    }

    onLeaderMaybeChanged(p) {
      var lead = this.leaderPol(p);
      if (!lead) { p._leaderId = null; return; }
      if (p._leaderId !== lead.id) {
        p._leaderId = lead.id;
        if (lead.eff && /党首になった(時|際).*信用度を?＋５|信用度が＋５/.test(lead.eff)) {
          p.trust += 5; this.logMsg(p.name + 'の党首「' + lead.name + '」就任で信用度+5。');
        }
      }
    }

    snapshot() {
      var self = this;
      return {
        turn: this.turn, phase: this.phase, curIdx: this.curIdx, pmIdx: this.pmIdx,
        over: this.over, winner: this.winner ? this.winner.idx : null,
        electionCooldown: this.electionCooldown,
        field: this.fieldInfluence(), fieldDominant: this.fieldDominant(),
        goals: { field: FIELD_WIN, trust: TRUST_WIN, pm: PM_WIN },
        players: this.players.map(function (p) {
          return {
            idx: p.idx, name: p.name, color: p.color, isPM: p.isPM, pmCount: p.pmCount,
            gold: p.gold, trust: p.trust,
            infl: self.influenceByIdeo(p), total: self.totalInfluence(p),
            strongest: p.pols.length ? self.strongestIdeo(p) : null,
            pols: deepCopy(p.pols), lawsN: p.laws.length
          };
        }),
        enacted: this.enacted.map(function (e) { return { name: e.card.name, owner: e.owner }; }),
        log: this.log.slice(-40)
      };
    }
  }

  var ENGINE = { Game: Game, ideoJp: ideoJp, FIELD_WIN: FIELD_WIN, TRUST_WIN: TRUST_WIN, PM_WIN: PM_WIN };
  root.PL_ENGINE = ENGINE;
  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
