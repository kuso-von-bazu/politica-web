/* POLITICA -ポリティカ- ルールエンジン (コマンド選択型 / 双六廃止版)
   非同期 choice プロバイダ方式 (UI=クリック待ち / AI=即決) で駆動。Node/ブラウザ両対応。
   1ターンに各コマンド(法案獲得/政治家入替/法案提出/選挙/買収)を1回ずつ実行できる。
   議員は常に5人。IPは法案成立・選挙・現職特典から得る。詳細は 設計メモ_仮決定.md。 */
(function (root) {
  'use strict';
  var DATA = root.PL_DATA || (typeof require !== 'undefined' ? require('./data.js') : null);
  var IDEOLOGIES = DATA.IDEOLOGIES, WIN_IP = DATA.WIN_IP;
  var IDKEYS = IDEOLOGIES.map(function (i) { return i.key; });

  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
  function emptyIdeo() { return { cap: 0, mil: 0, com: 0, sci: 0, env: 0 }; }
  function ideoJp(k) { for (var i = 0; i < IDEOLOGIES.length; i++) if (IDEOLOGIES[i].key === k) return IDEOLOGIES[i].jp; return k; }

  var POL_SLOTS = 5;     // 議員スロット(常にフル)
  var LAW_HAND = 3;      // 法案手札上限
  var BRIBE_COST = 5;    // 買収コスト(G)
  var ELECTION_TRUST = 2;// 選挙を起こす信用コスト

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
          ip: emptyIdeo(),     // イデオロギーポイント(表示用整数)
          ipAcc: emptyIdeo(),  // IP端数キャリー
          gold: 6, trust: 10,
          isPM: false,
          used: {}             // このターン使用済みコマンド
        };
      });
      this.numPlayers = this.players.length;
      this.winIP = config.winIP || WIN_IP;
      this.log = [];
      this.turn = 0;
      this.curIdx = 0;
      this.pmIdx = 0;
      this.over = false;
      this.winner = null;
      this.phase = 'setup';
      this.enacted = [];          // 成立法案 [{card, owner}] (最大5)
      this.lawFlags = {};
      this.electionCooldown = 0;  // 選挙は全体で一定ターン間あけて行う

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

    addIP(p, k, amt) {
      if (amt <= 0) return 0;
      p.ipAcc[k] += amt;
      var whole = Math.floor(p.ipAcc[k] + 1e-9);
      if (whole > 0) { p.ip[k] += whole; p.ipAcc[k] -= whole; }
      return whole;
    }
    // イデオロギー補正(IDEO_WEIGHT)込みのIP加算。全IP源で使い、各思想の勝率を均す。
    addIPw(p, k, amt) {
      var W = (DATA.IDEO_WEIGHT && DATA.IDEO_WEIGHT[k]) || 1;
      return this.addIP(p, k, amt * W);
    }

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
    // 場(政界全体)の各思想影響力と、優勢な思想
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

    // =================================================================
    //  メインループ
    // =================================================================
    async run(ctx) {
      this.ctx = ctx;
      await this.setup();
      var guard = 0;
      while (!this.over && guard < 3000) {
        guard++;
        await this.playTurn(this.players[this.curIdx]);
        if (this.over) break;
        this.curIdx = (this.curIdx + 1) % this.numPlayers;
        if (this.curIdx === this.pmIdx % this.numPlayers) this.turn++;
        if (this.turn > 200) break; // 念のための上限
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
      // 全員 議員5人フルでスタート
      this.players.forEach(function (p) {
        for (var i = 0; i < POL_SLOTS; i++) { var c = self.drawPol(); if (c) p.pols.push(c); }
        p._leaderId = self.leaderPol(p) ? self.leaderPol(p).id : null;
      });
      this.logMsg('ゲーム開始。各プレイヤーは議員5名を擁する。初代首班は' + this.players[this.pmIdx].name + '。');
      this.turn = 1;
      await this.notify();
    }

    checkWin() {
      for (var i = 0; i < this.players.length; i++) {
        var p = this.players[i];
        for (var k = 0; k < IDKEYS.length; k++) {
          if (p.ip[IDKEYS[k]] >= this.winIP) { this._declareWin(p, ideoJp(IDKEYS[k]) + 'IPが' + this.winIP + '到達'); return true; }
        }
      }
      return false;
    }
    _declareWin(p, why) { this.over = true; this.winner = p; this.logMsg('★' + p.name + 'の勝利! (' + why + ')'); }

    // =================================================================
    //  1ターン: コマンドを各1回ずつ
    // =================================================================
    async playTurn(p) {
      if (this.over) return;
      this.curIdx = p.idx;
      this.phase = 'turn';
      p.used = {};
      this.logMsg('―― ' + p.name + ' の手番 ――');
      // 現職特典(首班は手番開始時に最強思想IP+1。補正込み)
      if (p.isPM && p.pols.length) {
        var sk = this.strongestIdeo(p);
        this.addIPw(p, sk, 1);
        this.logMsg(p.name + '(首班)の施政により' + ideoJp(sk) + 'IP+1 (計' + p.ip[sk] + ')。');
        if (this.checkWin()) return;
      }
      await this.notify();

      var guard = 0;
      while (guard < 12 && !this.over) {
        guard++;
        var opts = this.availableCommands(p);
        var act = await this.choose(p.idx, { type: 'turnAction', options: opts, when: 'main' });
        var id = act && act.id ? act.id : 'done';
        if (id === 'done') break;
        p.used[id] = true;
        if (id === 'lawDraw') await this.cmdLawDraw(p);
        else if (id === 'polSwap') await this.cmdPolSwap(p);
        else if (id === 'lawPropose') await this.cmdLawPropose(p);
        else if (id === 'bribe') await this.cmdBribe(p);
        else if (id === 'election') await this.cmdElection(p);
        if (this.checkWin()) return;
        await this.notify();
      }
      if (this.electionCooldown > 0) this.electionCooldown--;
      await this.notify();
    }

    availableCommands(p) {
      var opts = [];
      if (!p.used.lawDraw && p.laws.length < LAW_HAND) opts.push({ id: 'lawDraw', label: '法案を引く' });
      if (!p.used.polSwap) opts.push({ id: 'polSwap', label: '政治家を入替' });
      if (!p.used.lawPropose && p.laws.length > 0 && this.enacted.length < 5 && !(this.lawFlags.purge && this.strongestIdeo(p) === 'com'))
        opts.push({ id: 'lawPropose', label: '法案を提出' });
      if (!p.used.bribe && p.gold >= BRIBE_COST && this.otherHavePols(p)) opts.push({ id: 'bribe', label: '買収(' + BRIBE_COST + 'G)' });
      if (!p.used.election && this.electionCooldown <= 0 && p.trust >= ELECTION_TRUST) opts.push({ id: 'election', label: '選挙を行う(信用' + ELECTION_TRUST + ')' });
      opts.push({ id: 'done', label: 'ターンを終える' });
      return opts;
    }
    otherHavePols(p) { return this.players.some(function (q) { return q.idx !== p.idx && q.pols.length > 0; }); }

    // ---- コマンド: 法案獲得 ----
    async cmdLawDraw(p) {
      var c = this.drawLaw();
      if (c) { p.laws.push(c); this.logMsg(p.name + 'は法案「' + c.name + '」を手札に加えた。'); }
      else this.logMsg('法案山札が尽きている。');
    }

    // ---- コマンド: 政治家入替 ----
    async cmdPolSwap(p) {
      var n = 3;
      if (this.lawFlags.redArmy && p.isPM) n = 4; // 赤軍の設立: 首班は4枚から
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
    polTotal(c) { var s = (c.infl.non || 0); IDKEYS.forEach(function (k) { s += (c.infl[k] || 0); }); return s; }

    // ---- コマンド: 法案提出 ----
    async cmdLawPropose(p) {
      if (p.laws.length === 0) return;
      var pick = await this.choose(p.idx, { type: 'pickCard', kind: 'law', cards: p.laws, cancelable: true, q: '提出する法案' });
      if (!pick || pick.index == null) { p.used.lawPropose = false; return; }
      var card = p.laws[pick.index];
      var need = this.lawNeed(card);
      this.logMsg(p.name + 'が法案「' + card.name + '」を提出 (必要影響力' + need + '/提出者' + this.totalInfluence(p) + ')。');
      p.laws.splice(pick.index, 1);
      await this.runVote(p, card, need);
    }

    lawNeed(card) {
      var s = 0; IDKEYS.forEach(function (k) { s += Math.abs(card.d[k] || 0); });
      return Math.max(3, s * 2);
    }

    async runVote(proposer, card, need) {
      this.phase = 'vote';
      await this.notify();
      var votes = {}; votes[proposer.idx] = 'yes';
      for (var i = 0; i < this.players.length; i++) {
        var q = this.players[i];
        if (q.idx === proposer.idx) continue;
        if (this.lawFlags.twoParty && !this.isTop2Influence(q)) { votes[q.idx] = 'abstain'; continue; }
        var v = await this.choose(q.idx, { type: 'vote', card: card, proposer: proposer.idx, need: need });
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
        await this.enactLaw(proposer, card, supporters);
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

    // 法案成立: 影響力/信用/場の影響力に応じて効果を発揮
    async enactLaw(proposer, card, supporters) {
      var self = this;
      var W = DATA.IDEO_WEIGHT || {};
      // 主たる思想 = 正デルタが最大の思想
      var primary = null, pv = 0;
      IDKEYS.forEach(function (k) { if ((card.d[k] || 0) > pv) { pv = card.d[k]; primary = k; } });
      // 基本IP(正デルタのみ)
      IDKEYS.forEach(function (k) { var d = card.d[k] || 0; if (d > 0) self.addIP(proposer, k, d * (W[k] || 1)); });
      proposer.trust += (card.pip || 0);
      supporters.forEach(function (s) {
        IDKEYS.forEach(function (k) { var d = card.d[k] || 0; if (d > 0) self.addIP(s, k, d * (W[k] || 1) / 2); });
        s.trust += (card.aip || 0);
      });
      // 条件付き効果(法案が真価を発揮する条件)
      if (primary) {
        var infl = this.influenceByIdeo(proposer);
        var fieldDom = this.fieldDominant();
        var bonus = 0, reasons = [];
        if (infl[primary] >= 10) { bonus += 1; reasons.push('地盤(' + ideoJp(primary) + '影響力' + infl[primary] + ')'); }
        if (proposer.trust >= 12) { bonus += 1; reasons.push('高信用'); }
        if (fieldDom === primary) { bonus += 2; reasons.push('場の支持'); }
        if (bonus > 0) {
          this.addIPw(proposer, primary, bonus);
          this.logMsg('法案が真価を発揮! ' + ideoJp(primary) + 'IP+' + bonus + ' [' + reasons.join('・') + ']');
        }
      }
      this.logMsg(proposer.name + 'はIP/信用を獲得した。');
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

    // ---- コマンド: 買収(5G) ----
    async cmdBribe(p) {
      var targets = this.players.filter(function (q) { return q.idx !== p.idx && q.pols.length > 0; });
      if (!targets.length) { p.used.bribe = false; return; }
      var t = await this.choose(p.idx, { type: 'pickPlayer', players: targets.map(function (q) { return q.idx; }), q: '買収する相手' });
      if (!t || t.idx == null) { p.used.bribe = false; return; }
      var target = this.players[t.idx];
      var pc = await this.choose(p.idx, { type: 'pickPolitician', cards: target.pols, q: '奪う政治家', fromOther: true });
      if (!pc || pc.take == null) { p.used.bribe = false; return; }
      if (p.gold < BRIBE_COST) { p.used.bribe = false; return; }
      // 自分の議員5は維持: 奪った議員と引き換えに自分の最弱議員を相手へ渡す(玉突き) ことはせず、
      // 自分の最弱を捨て、相手から奪った議員を加える(相手は1人減る)。
      var stolen = target.pols.splice(pc.take, 1)[0];
      var ri = this.weakestSlot(p);
      var dropped = p.pols.splice(ri, 1, stolen)[0];
      if (dropped) this.polDiscard.push(dropped);
      p.gold -= BRIBE_COST;
      this.logMsg(p.name + 'は' + target.name + 'から「' + stolen.name + '」を買収(' + BRIBE_COST + 'G)。自党の「' + (dropped ? dropped.name : '空き') + '」を放出。');
      // 相手は議員が減るので山札から補充(常に5人)
      var refill = this.drawPol(); if (refill) target.pols.push(refill);
      this.onLeaderMaybeChanged(p); this.onLeaderMaybeChanged(target);
    }

    // ---- コマンド: 選挙 ----
    async cmdElection(p) {
      if (p.trust < ELECTION_TRUST || this.electionCooldown > 0) { p.used.election = false; return; }
      p.trust -= ELECTION_TRUST;
      this.logMsg(p.name + 'が選挙を要求した(信用-' + ELECTION_TRUST + ')。');
      await this.runElection();
      this.electionCooldown = this.numPlayers; // 一巡あける
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
      var tally = {}; cands.forEach(function (c) { tally[c] = 0; });
      cands.forEach(function (c) { tally[c] += this.totalInfluence(this.players[c]); }, this);
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
      this.pmIdx = winner; this.players[winner].isPM = true;
      var w = this.players[winner];
      this.logMsg(w.name + 'が首班に指名された! (得票' + tally[winner] + ')');
      // 首班の特典: 組閣で信用+5、最強思想IP+2
      w.trust += 5;
      var sk = this.strongestIdeo(w);
      this.addIPw(w, sk, 2);
      this.logMsg(w.name + 'は組閣で信用+5、' + ideoJp(sk) + 'IP+2 (計' + w.ip[sk] + ')。');
      this.checkWin();
      this.phase = 'turn';
      await this.notify();
    }

    // ---- 党首交代(信用ボーナス一般化) ----
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

    // ---- スナップショット(UI用) ----
    snapshot() {
      var self = this;
      return {
        turn: this.turn, phase: this.phase, curIdx: this.curIdx, pmIdx: this.pmIdx,
        over: this.over, winner: this.winner ? this.winner.idx : null,
        electionCooldown: this.electionCooldown,
        field: this.fieldInfluence(), fieldDominant: this.fieldDominant(),
        players: this.players.map(function (p) {
          return {
            idx: p.idx, name: p.name, color: p.color, isPM: p.isPM,
            gold: p.gold, trust: p.trust, ip: deepCopy(p.ip),
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

  var ENGINE = { Game: Game, ideoJp: ideoJp };
  root.PL_ENGINE = ENGINE;
  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
