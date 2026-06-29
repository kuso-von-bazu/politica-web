/* POLITICA -ポリティカ- ルールエンジン
   非同期 choice プロバイダ方式 (UI=クリック待ち / AI=即決) で駆動。Node/ブラウザ両対応。
   原作プロトタイプのルールを参照しつつ、デジタル化のため一部を明確化・簡略化している
   (詳細は 設計メモ_仮決定.md)。 */
(function (root) {
  'use strict';
  var DATA = root.PL_DATA || (typeof require !== 'undefined' ? require('./data.js') : null);
  var IDEOLOGIES = DATA.IDEOLOGIES, BOARD = DATA.BOARD, WIN_IP = DATA.WIN_IP;
  var IDKEYS = IDEOLOGIES.map(function (i) { return i.key; });

  function makeRng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  }
  function deepCopy(o) { return JSON.parse(JSON.stringify(o)); }
  function emptyIdeo() { return { cap: 0, mil: 0, com: 0, sci: 0, env: 0 }; }
  function ideoJp(k) { for (var i = 0; i < IDEOLOGIES.length; i++) if (IDEOLOGIES[i].key === k) return IDEOLOGIES[i].jp; return k; }

  // =================================================================
  class Game {
    constructor(config) {
      this.config = config || {};
      this.rng = makeRng(config.seed || 12345);
      this.players = (config.players || []).map(function (p, i) {
        return {
          idx: i, name: p.name || (DATA.PLAYER_COLOR_NAMES[i] + 'プレイヤー'),
          isAI: !!p.isAI, color: DATA.PLAYER_COLORS[i],
          pols: [],          // 政治家スロット (最大5)
          chance: [],        // チャンス手札 (最大3)
          laws: [],          // 法案手札 (最大3)
          ip: emptyIdeo(),   // イデオロギーポイント(表示用整数)
          ipAcc: emptyIdeo(),// IP端数(重み付与をなめらかにするキャリー)
          gold: 5, trust: 10,
          pos: 0, isPM: false,
          skipTurns: 0,
          chanceLock: 0,     // 財政の崖等: チャンスを引けないターン数
          basicEnacted: null,// 成立させた基幹政策名(廃案不可の永続政策。勝利条件ではない)
          onceTenka: false   // 一日天下フラグ
        };
      });
      this.numPlayers = this.players.length;
      this.winIP = config.winIP || WIN_IP;
      this.log = [];
      this.turn = 0;
      this.curIdx = 0;
      this.pmIdx = 0;            // 首班(初回は親)
      this.over = false;
      this.winner = null;
      this.phase = 'setup';
      this.enacted = [];        // 成立法案 [{card, owner}] (最大5)
      this.basicSlot = [];      // 成立した基幹政策 [{card, owner}] (廃案不可・上限なし)
      this.lawFlags = {};       // 成立法案による恒常効果フラグ
      this.electionPending = false;
      this.climate = emptyIdeo(); // 世論(潮流): インシデントで変動。IPマスのボーナス判定に使う

      // 山札
      this.polDeck = this._shuffle(deepCopy(DATA.POLITICIANS));
      this.chanceDeck = this._shuffle(deepCopy(DATA.CHANCES));
      this.incidentDeck = this._shuffle(deepCopy(DATA.INCIDENTS));
      this.lawDeck = this._shuffle(deepCopy(DATA.LAWS));
      this.polDiscard = [];
      this.chanceDiscard = [];
      this.incidentDiscard = [];
      this.lawDiscard = [];
    }

    // ---- 基本ユーティリティ ----
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
    drawChanceCard() { return this._draw(this.chanceDeck, 'chanceDiscard'); }
    drawIncident() { return this._draw(this.incidentDeck, 'incidentDiscard'); }
    drawLaw() { return this._draw(this.lawDeck, 'lawDiscard'); }

    logMsg(s) { this.log.push({ turn: this.turn, text: s }); }

    // IP加算(小数は端数バケツに溜め、整数分のみ表示IPへ繰り上げる)
    addIP(p, k, amt) {
      if (amt <= 0) return 0;
      p.ipAcc[k] += amt;
      var whole = Math.floor(p.ipAcc[k] + 1e-9);
      if (whole > 0) { p.ip[k] += whole; p.ipAcc[k] -= whole; }
      return whole;
    }

    notify() { if (this.ctx && this.ctx.notify) return this.ctx.notify(this); }
    choose(pi, dec) { return this.ctx.choose(pi, dec, this); }

    // ---- 影響力計算 ----
    influenceByIdeo(p) {
      var sum = emptyIdeo();
      p.pols.forEach(function (c) { IDKEYS.forEach(function (k) { sum[k] += (c.infl[k] || 0); }); });
      return sum;
    }
    totalInfluence(p) {
      // 5イデオロギー + 無主義 を総影響力に算入(無主義は票数になるが特定IPには寄与しない)
      var s = this.influenceByIdeo(p), t = 0; IDKEYS.forEach(function (k) { t += s[k]; });
      p.pols.forEach(function (c) { t += (c.infl.non || 0); });
      return t;
    }
    strongestIdeo(p) {
      var s = this.influenceByIdeo(p), best = 'cap', bv = -1;
      IDKEYS.forEach(function (k) { if (s[k] > bv) { bv = s[k]; best = k; } });
      return best;
    }
    leaderPol(p) { // 党首=最大影響力(無主義含む)の政治家
      var best = null, bv = -1;
      p.pols.forEach(function (c) {
        var t = (c.infl.non || 0); IDKEYS.forEach(function (k) { t += (c.infl[k] || 0); });
        if (t > bv) { bv = t; best = c; }
      });
      return best;
    }

    // =================================================================
    //  メインループ
    // =================================================================
    async run(ctx) {
      this.ctx = ctx;
      await this.setup();
      var guard = 0;
      while (!this.over && guard < 4000) {
        guard++;
        await this.playTurn(this.players[this.curIdx]);
        if (this.over) break;
        this.curIdx = (this.curIdx + 1) % this.numPlayers;
        if (this.curIdx === this.pmIdx % this.numPlayers) this.turn++; // 一巡=1ターン目安
      }
      this.phase = 'gameover';
      await this.notify();
      return { winner: this.winner };
    }

    async setup() {
      this.phase = 'setup';
      // 親(初回首班)をランダム決定
      this.pmIdx = Math.floor(this.rng() * this.numPlayers);
      this.curIdx = this.pmIdx;
      this.players[this.pmIdx].isPM = true;
      // 各プレイヤー初期政治家2名
      var self = this;
      this.players.forEach(function (p) {
        for (var i = 0; i < 2; i++) { var c = self.drawPol(); if (c) p.pols.push(c); }
      });
      this.logMsg('ゲーム開始。親(初回首班)は' + this.players[this.pmIdx].name + '。');
      this.turn = 1;
      await this.notify();
    }

    checkWin() {
      for (var i = 0; i < this.players.length; i++) {
        var p = this.players[i];
        for (var k = 0; k < IDKEYS.length; k++) {
          if (p.ip[IDKEYS[k]] >= this.winIP) { this._declareWin(p, ideoJp(IDKEYS[k]) + "IPが" + this.winIP + '到達'); return true; }
        }
      }
      return false;
    }
    _declareWin(p, why) {
      this.over = true; this.winner = p;
      this.logMsg('★' + p.name + 'の勝利! (' + why + ')');
    }

    // =================================================================
    //  1人のターン
    // =================================================================
    async playTurn(p) {
      if (this.over) return;
      this.curIdx = p.idx;
      this.phase = 'turn';
      if (p.chanceLock > 0) p.chanceLock--;
      if (p.skipTurns > 0) {
        p.skipTurns--;
        this.logMsg(p.name + 'は一回休み。');
        await this.notify();
        return;
      }
      this.logMsg('―― ' + p.name + ' の手番 ――');
      await this.notify();

      // 行動フェイズ(ダイスを振る前): チャンス/法案提出/買収 を任意回(上限あり)
      await this.actionPhase(p, 'pre');
      if (this.over) return;

      // ダイス
      var die = 1 + Math.floor(this.rng() * 6);
      var from = p.pos;
      var to = (from + die) % BOARD.length;
      // 首班が総選挙マスを通過/到達したら選挙予約
      if (p.isPM) {
        for (var s = 1; s <= die; s++) {
          if ((from + s) % BOARD.length === 0) { this.electionPending = true; }
        }
      }
      p.pos = to;
      this.logMsg(p.name + 'は' + die + '進み【' + BOARD[to].label + '】に止まった。');
      await this.notify();

      // マス解決
      await this.resolveSpace(p, BOARD[to]);
      if (this.over) return;

      // 行動フェイズ(後)
      await this.actionPhase(p, 'post');
      if (this.over) return;

      // 手札上限調整
      await this.enforceLimits(p);

      if (this.checkWin()) return;

      // 一日天下: このプレイヤーが次回首班として行動済みなら解除
      if (this.electionPending) { await this.runElection(); this.electionPending = false; }
      await this.notify();
    }

    // ---- マス解決 ----
    async resolveSpace(p, space) {
      switch (space.kind) {
        case 'election':
          if (p.isPM) { this.electionPending = true; }
          else this.logMsg(p.name + 'は総選挙マスに止まった(首班でないため選挙は起きない)。');
          break;
        case 'politician': await this.spacePolitician(p); break;
        case 'ip': await this.spaceIP(p); break;
        case 'chance': await this.spaceChance(p); break;
        case 'incident': await this.spaceIncident(p); break;
        case 'law': await this.spaceLaw(p); break;
        case 'money':
          p.gold += 2; this.logMsg(p.name + 'は献金で +2G (所持' + p.gold + 'G)。'); break;
        case 'rest':
          p.skipTurns += 1; this.logMsg(p.name + 'は一回休みマス。次の手番を飛ばす。'); break;
      }
      await this.notify();
    }

    async spacePolitician(p) {
      // 通常2枚→1枚。1IP/1Gで3枚から。赤軍の設立成立かつ首班なら3枚。
      var n = 2;
      if (this.lawFlags.redArmy && p.isPM) n = 3;
      if (p.pols.length < 5) {
        // 拡張オプション
        var canExpand = (n === 2) && (p.gold >= 1 || this.anyIP(p) >= 1);
        if (canExpand) {
          var ex = await this.choose(p.idx, { type: 'yesno', q: '1G または 1IP を払って3枚から選ぶ?', cost: 'expandPol' });
          if (ex) { if (p.gold >= 1) p.gold -= 1; else this.spendIP(p, 1); n = 3; }
        }
      }
      var drawn = [];
      for (var i = 0; i < n; i++) { var c = this.drawPol(); if (c) drawn.push(c); }
      if (drawn.length === 0) { this.logMsg('政治家山札が尽きている。'); return; }
      if (p.pols.length >= 5) {
        // スロット満杯: 入替えるか破棄
        var pick = await this.choose(p.idx, { type: 'pickPolitician', cards: drawn, slotFull: true, current: p.pols });
        if (pick && pick.take != null) {
          var nc = drawn[pick.take];
          if (pick.replace != null) { var old = p.pols.splice(pick.replace, 1)[0]; this.polDiscard.push(old); }
          p.pols.push(nc);
          this.logMsg(p.name + 'は政治家「' + nc.name + '」を獲得(入替)。');
          drawn.splice(pick.take, 1);
        }
        drawn.forEach(function (c) { this.polDiscard.push(c); }, this);
      } else {
        var pick2 = await this.choose(p.idx, { type: 'pickPolitician', cards: drawn });
        var idx = (pick2 && pick2.take != null) ? pick2.take : 0;
        var nc2 = drawn.splice(idx, 1)[0];
        p.pols.push(nc2);
        this.logMsg(p.name + 'は政治家「' + nc2.name + '」を獲得。');
        drawn.forEach(function (c) { this.polDiscard.push(c); }, this);
      }
      this.onLeaderMaybeChanged(p);
    }

    async spaceIP(p) {
      if (p.pols.length === 0) { this.logMsg(p.name + 'は政治家がおらずIPを得られない。'); return; }
      var k = this.strongestIdeo(p);
      var base = 1;
      var tail = false;
      // 世論が自分の最強イデオロギーを後押ししていれば+1ボーナス
      if (this.climate[k] > 0) { base += 1; tail = true; }
      var W = (DATA.IDEO_WEIGHT && DATA.IDEO_WEIGHT[k]) || 1;
      this.addIP(p, k, base * W);
      this.logMsg(p.name + 'は' + ideoJp(k) + 'IPを獲得' + (tail ? '(世論の追い風)' : '') + ' (計' + p.ip[k] + ')。');
      this.checkWin();
    }

    async spaceChance(p) {
      if (p.chanceLock > 0) { this.logMsg(p.name + 'はチャンスを引けない(財政の崖)。'); return; }
      var max = this.lawFlags.monopoly ? 1 : 3;
      if (p.chance.length >= max) { this.logMsg('チャンス手札が上限。'); return; }
      var canPay = p.gold >= 1 || this.anyIP(p) >= 1;
      if (!canPay) { this.logMsg(p.name + 'は対価(1G/1IP)が無くチャンスを引けない。'); return; }
      var ans = await this.choose(p.idx, { type: 'yesno', q: '1G または 1IP を払ってチャンスカードを引く?', cost: 'drawChance' });
      if (!ans) return;
      if (p.gold >= 1) p.gold -= 1; else this.spendIP(p, 1);
      var bonus = (this.lawFlags.bureaucracy && p.isPM) ? 2 : 1;
      for (var i = 0; i < bonus && p.chance.length < max; i++) {
        var c = this.drawChanceCard(); if (c) { p.chance.push(c); this.logMsg(p.name + 'はチャンス「' + c.name + '」を引いた。'); }
      }
    }

    async spaceIncident(p) {
      // 引く前に2IP/2Gで裏のまま捨てられる
      var canDodge = p.gold >= 2 || this.anyIP(p) >= 2;
      if (canDodge) {
        var dodge = await this.choose(p.idx, { type: 'yesno', q: '2G または 2IP を払ってインシデントを引かず裏で捨てる?', cost: 'dodgeIncident' });
        if (dodge) {
          if (p.gold >= 2) p.gold -= 2; else this.spendIP(p, 2);
          var d = this.drawIncident(); if (d) this.incidentDiscard.push(d);
          this.logMsg(p.name + 'はインシデントを回避した。');
          return;
        }
      }
      var card = this.drawIncident();
      if (!card) { this.logMsg('インシデント山札が尽きている。'); return; }
      this.incidentDiscard.push(card);
      this.logMsg('インシデント発生:「' + card.name + '」' + (card.eff ? ' - ' + card.eff : ''));
      await this.applyIncident(card, p);
    }

    async spaceLaw(p) {
      // 法案カードを1枚引く
      if (p.laws.length < 3) {
        var c = this.drawLaw();
        if (c) { p.laws.push(c); this.logMsg(p.name + 'は法案「' + c.name + '」を手札に加えた。'); }
      } else {
        this.logMsg(p.name + 'は法案手札が上限(提出して空ける必要あり)。');
      }
      // 続けて提出するかは行動フェイズで
      await this.maybeProposeLaw(p);
    }

    // =================================================================
    //  行動フェイズ (チャンス使用/法案提出/買収)
    // =================================================================
    async actionPhase(p, when) {
      var guard = 0;
      while (guard < 8 && !this.over) {
        guard++;
        var opts = [];
        if (p.chance.length > 0) opts.push({ id: 'chance', label: 'チャンスカードを使う' });
        if ((when === 'pre') && p.laws.length > 0 && this.enacted.length < 5) opts.push({ id: 'law', label: '法案を提出する' });
        if (this.totalInfluence(p) >= 12 && !p.basicEnacted) opts.push({ id: 'basic', label: '基幹政策を提出する' });
        if ((p.gold >= 2 || this.anyIP(p) >= 2) && this.otherHavePols(p)) opts.push({ id: 'bribe', label: '買収する' });
        opts.push({ id: 'done', label: (when === 'pre' ? 'サイコロを振る' : '手番を終える') });
        var act = await this.choose(p.idx, { type: 'turnAction', options: opts, when: when });
        var id = act && act.id ? act.id : 'done';
        if (id === 'done') break;
        if (id === 'chance') await this.playChanceFlow(p);
        else if (id === 'law') await this.maybeProposeLaw(p, true);
        else if (id === 'basic') await this.proposeBasic(p);
        else if (id === 'bribe') await this.bribeFlow(p);
        if (this.checkWin()) return;
      }
    }

    anyIP(p) { var m = 0; IDKEYS.forEach(function (k) { if (p.ip[k] > m) m = p.ip[k]; }); return m; }
    spendIP(p, n) { // 一番多いイデオロギーから消費
      while (n-- > 0) { var best = 'cap', bv = -1; IDKEYS.forEach(function (k) { if (p.ip[k] > bv) { bv = p.ip[k]; best = k; } }); if (p.ip[best] > 0) p.ip[best]--; }
    }
    otherHavePols(p) { return this.players.some(function (q) { return q.idx !== p.idx && q.pols.length > 0; }); }

    // ---- チャンスカード使用 ----
    async playChanceFlow(p) {
      if (p.chance.length === 0) return;
      var pick = await this.choose(p.idx, { type: 'pickCard', kind: 'chance', cards: p.chance, cancelable: true, q: '使うチャンスカード' });
      if (!pick || pick.index == null) return;
      var card = p.chance[pick.index];
      // 信用度コスト(負値=消費)。毛沢南など一部例外は簡略化のため未対応。
      var cost = Math.abs(card.cost || 0);
      if (p.trust < cost) { this.logMsg(p.name + 'は信用度が足りず「' + card.name + '」を使えない。'); return; }
      p.chance.splice(pick.index, 1);
      p.trust -= cost;
      this.chanceDiscard.push(card);
      this.logMsg(p.name + 'はチャンス「' + card.name + '」を使用(信用-' + cost + ')。');
      await this.applyChance(card, p);
      this.checkWin();
    }

    // ---- 法案提出/投票 ----
    async maybeProposeLaw(p, force) {
      if (p.laws.length === 0 || this.enacted.length >= 5) return;
      if (this.lawFlags.purge && this.strongestIdeo(p) === 'com') { if (force) this.logMsg('公職追放により共産主義筆頭は法案提出不可。'); return; }
      var ans = force ? { yes: true } : await this.choose(p.idx, { type: 'yesno', q: '法案を提出して採決にかける?', cost: 'propose' });
      if (!ans || !(ans === true || ans.yes)) return;
      var pick = await this.choose(p.idx, { type: 'pickCard', kind: 'law', cards: p.laws, cancelable: true, q: '提出する法案' });
      if (!pick || pick.index == null) return;
      var card = p.laws[pick.index];
      var need = this.lawNeed(card);
      var infl = this.totalInfluence(p);
      this.logMsg(p.name + 'が法案「' + card.name + '」を提出 (必要影響力' + need + '/提出者' + infl + ')。');
      p.laws.splice(pick.index, 1);
      await this.runVote(p, card, need, false);
    }

    async proposeBasic(p) {
      if (p.basicEnacted) { this.logMsg('既に基幹政策を成立させている。'); return; }
      var k = this.strongestIdeo(p);
      var bp = DATA.BASIC_POLICIES.find(function (b) { return b.ideo === k; });
      if (!bp) return;
      if (this.totalInfluence(p) < bp.need) { this.logMsg('影響力不足で基幹政策を提出できない。'); return; }
      this.logMsg('★' + p.name + 'が基幹政策「' + bp.name + '」を提出! (' + ideoJp(k) + ')');
      await this.runVote(p, { name: bp.name, d: bp.d, pip: 3, aip: 1, basic: bp.id, ideo: bp.ideo, boost: 5 }, bp.need, true);
    }

    lawNeed(card) {
      var s = 0; IDKEYS.forEach(function (k) { s += Math.abs(card.d[k] || 0); });
      return Math.max(3, s * 2);
    }

    async runVote(proposer, card, need, isBasic) {
      this.phase = 'vote';
      await this.notify();
      // 共同提出: 提出者影響力が必要に満たない場合、賛成側影響力で補填(=可決条件に吸収)
      var votes = {}; // idx -> 'yes'/'no'
      votes[proposer.idx] = 'yes';
      for (var i = 0; i < this.players.length; i++) {
        var q = this.players[i];
        if (q.idx === proposer.idx) continue;
        // 決闘フラグ: 投票できるのは2名のみ
        if (this.lawFlags.duelOnly && this.lawFlags.duelOnly.indexOf(q.idx) < 0) { votes[q.idx] = 'abstain'; continue; }
        // 2大政党制: 影響力上位2名のみ投票可
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
      var pass;
      if (this.lawFlags.superMajority) {
        var totalAll = 0; this.players.forEach(function (pp) { totalAll += this.totalInfluence(pp); }, this);
        pass = yesInf >= Math.ceil(totalAll * 2 / 3);
      } else {
        pass = yesInf > noInf;
      }
      // 必要影響力チェック(賛成側合計が必要影響力以上)
      if (yesInf < need) pass = false;
      this.lawFlags.duelOnly = null; this.lawFlags.superMajority = false; // 単発フラグ消費

      if (pass) {
        this.logMsg('可決! (賛成' + yesInf + ' vs 反対' + noInf + ')');
        await this.enactLaw(proposer, card, supporters, isBasic);
      } else {
        this.logMsg('否決… (賛成' + yesInf + ' vs 反対' + noInf + ')');
        if (!isBasic && card.id) this.lawDiscard.push(card);
      }
      this.phase = 'turn';
      await this.notify();
    }

    isTop2Influence(p) {
      var arr = this.players.map(function (q) { return { i: q.idx, v: this.totalInfluence(q) }; }, this)
        .sort(function (a, b) { return b.v - a.v; });
      return arr.slice(0, 2).some(function (x) { return x.i === p.idx; });
    }

    async enactLaw(proposer, card, supporters, isBasic) {
      // IP付与: 提出者=正のデルタのみ獲得(法案を通して自イデオロギーIPが減ることはない),
      //          賛同者=その半分。イデオロギー補正(IDEO_WEIGHT)で各思想の勝率を均す。
      var self = this;
      var W = DATA.IDEO_WEIGHT || {};
      IDKEYS.forEach(function (k) {
        var d = card.d[k] || 0;
        if (d > 0) self.addIP(proposer, k, d * (W[k] || 1));
      });
      proposer.trust += (card.pip || 0);
      supporters.forEach(function (s) {
        IDKEYS.forEach(function (k) { var d = card.d[k] || 0; if (d > 0) self.addIP(s, k, d * (W[k] || 1) / 2); });
        s.trust += (card.aip || 0);
      });
      this.logMsg(proposer.name + 'はIP/信用を獲得した。');
      if (isBasic) {
        // 即勝利ではなく、最強イデオロギーIPを大きく加算する廃案不可の永続政策。
        // ブーストは思想間で公平にするため補正(IDEO_WEIGHT)を掛けない固定値。
        var bk = card.ideo;
        this.addIP(proposer, bk, (card.boost || 5));
        proposer.basicEnacted = card.name;
        this.basicSlot.push({ card: card, owner: proposer.idx });
        this.logMsg('★基幹政策「' + card.name + '」が成立! ' + proposer.name + 'は' + ideoJp(bk) + 'IPを大きく獲得(計' + proposer.ip[bk] + ')。');
        this.checkWin();
        return;
      }
      // 成立法案を場に(最大5)。満杯ならスロット圧縮は首班マニフェスト時のみ→ここでは古いものを捨てる
      this.enacted.push({ card: card, owner: proposer.idx });
      if (this.enacted.length > 5) { var old = this.enacted.shift(); this.lawDiscard.push(old.card); this.clearLawFlag(old.card); }
      this.applyLawFlag(card);
    }

    applyLawFlag(card) {
      switch (card.name) {
        case '公職追放': this.lawFlags.purge = true; break;
        case '2大政党制': this.lawFlags.twoParty = true; break;
        case '赤軍の設立': this.lawFlags.redArmy = true; break;
        case '独占禁止法': this.lawFlags.monopoly = true; break;
        case '官僚制国家': this.lawFlags.bureaucracy = true; break;
        case '文民統制': this.lawFlags.civilian = true; break;
      }
    }
    clearLawFlag(card) {
      var m = { '公職追放': 'purge', '2大政党制': 'twoParty', '赤軍の設立': 'redArmy', '独占禁止法': 'monopoly', '官僚制国家': 'bureaucracy', '文民統制': 'civilian' };
      if (m[card.name]) this.lawFlags[m[card.name]] = false;
    }

    // ---- 買収 ----
    async bribeFlow(p) {
      var targets = this.players.filter(function (q) { return q.idx !== p.idx && q.pols.length > 0; });
      if (!targets.length) return;
      var t = await this.choose(p.idx, { type: 'pickPlayer', players: targets.map(function (q) { return q.idx; }), q: '買収する相手' });
      if (!t || t.idx == null) return;
      var target = this.players[t.idx];
      var pc = await this.choose(p.idx, { type: 'pickPolitician', cards: target.pols, q: '奪う政治家', fromOther: true });
      if (!pc || pc.take == null) return;
      if (p.pols.length >= 5) { this.logMsg('自分のスロットが満杯で買収できない。'); return; }
      if (p.gold >= 2) p.gold -= 2; else if (this.anyIP(p) >= 2) this.spendIP(p, 2); else return;
      var stolen = target.pols.splice(pc.take, 1)[0];
      p.pols.push(stolen);
      this.logMsg(p.name + 'は' + target.name + 'から政治家「' + stolen.name + '」を買収した。');
      this.onLeaderMaybeChanged(p); this.onLeaderMaybeChanged(target);
    }

    // =================================================================
    //  首班指名選挙
    // =================================================================
    async runElection() {
      this.phase = 'election';
      this.logMsg('★ 首班指名選挙 ★');
      await this.notify();
      // 立候補
      var cands = [];
      for (var i = 0; i < this.players.length; i++) {
        var q = this.players[i];
        // 大澤一郎(党首)は立候補不可 等は簡略化
        var ans = await this.choose(q.idx, { type: 'candidacy' });
        if (ans && ans.run) cands.push(q.idx);
      }
      if (cands.length === 0) { cands = [this.pmIdx]; } // 誰も立たなければ現首班続投
      // 投票: 非立候補者は立候補者の誰かに投票
      var tally = {}; cands.forEach(function (c) { tally[c] = 0; });
      // 立候補者は自分に投票(自分の影響力)
      cands.forEach(function (c) { tally[c] += this.totalInfluence(this.players[c]); }, this);
      for (var j = 0; j < this.players.length; j++) {
        var v = this.players[j];
        if (cands.indexOf(v.idx) >= 0) continue;
        var vf = await this.choose(v.idx, { type: 'voteFor', candidates: cands });
        var pickC = (vf && vf.idx != null && cands.indexOf(vf.idx) >= 0) ? vf.idx : cands[0];
        tally[pickC] += this.totalInfluence(v);
      }
      // 文民統制: 軍国主義筆頭は首相になれない→当選しても次点に
      var ranked = cands.slice().sort(function (a, b) { return tally[b] - tally[a]; });
      var winner = ranked[0];
      if (this.lawFlags.civilian) {
        for (var r = 0; r < ranked.length; r++) { if (this.strongestIdeo(this.players[ranked[r]]) !== 'mil') { winner = ranked[r]; break; } }
      }
      var oldPM = this.pmIdx;
      this.players.forEach(function (pl) { pl.isPM = false; });
      this.pmIdx = winner; this.players[winner].isPM = true;
      this.logMsg(this.players[winner].name + 'が首班に指名された! (得票' + tally[winner] + ')');
      // 首班特典: 首相になった党首の信用度+5(一部政治家効果を一般化)
      var lead = this.leaderPol(this.players[winner]);
      if (lead) { this.players[winner].trust += 5; this.logMsg(this.players[winner].name + 'の信用度+5(組閣)。'); }
      // マニフェスト等は簡略化(別途未実装)
      this.phase = 'turn';
      await this.notify();
    }

    // =================================================================
    //  カード効果
    // =================================================================
    async applyIncident(card, drawer) {
      // イデオロギー変化は「世論(潮流)」に蓄積する(IPを直接変動させない=特定イデオロギーへの一方的な偏りを排除)。
      // 世論は減衰しつつ、IPマスでの追い風ボーナスとして効く。
      var self = this;
      var hasShift = IDKEYS.some(function (k) { return (card.d && card.d[k]); });
      if (hasShift) {
        // カードのデルタをゼロサム化(平均を引く)してから加える → 特定思想への一方的な偏りを排除。
        var mean = 0; IDKEYS.forEach(function (k) { mean += (card.d[k] || 0); }); mean /= IDKEYS.length;
        // 既存世論を一旦7割に減衰させてから今回の(ゼロサム化した)変化を加える(直近の出来事ほど影響大)
        IDKEYS.forEach(function (k) {
          self.climate[k] = Math.round(self.climate[k] * 0.7) + Math.round((card.d[k] || 0) - mean);
        });
        var up = IDKEYS.filter(function (k) { return self.climate[k] > 0; }).map(function (k) { return ideoJp(k); });
        this.logMsg('世論が変化。追い風: ' + (up.length ? up.join('・') : 'なし'));
      }
      // 名前付き効果
      var n = card.name;
      if (n === 'ゴールドラッシュ') this.players.forEach(function (p) { self.giveChance(p, 2); });
      else if (n === '万国博覧会') this.players.forEach(function (p) { self.giveChance(p, 1); });
      else if (n === '大恐慌') this.players.forEach(function (p) { var h = Math.floor(p.chance.length / 2); for (var i = 0; i < h; i++) self.chanceDiscard.push(p.chance.pop()); });
      else if (n === '世界大戦') {
        this.players.forEach(function (p) { while (p.chance.length) self.chanceDiscard.push(p.chance.pop()); });
        var minI = null, mv = Infinity;
        this.players.forEach(function (p) { var t = self.totalInfluence(p); if (t < mv) { mv = t; minI = p.idx; } });
        this.players.forEach(function (p) { p.isPM = false; });
        this.pmIdx = minI; this.players[minI].isPM = true;
        this.logMsg('世界大戦! 現首班は下野し' + this.players[minI].name + 'が首班に。');
      }
      else if (n === '大震災') this.players.forEach(function (p) { while (p.chance.length) self.chanceDiscard.push(p.chance.pop()); });
      else if (n === '内戦') {
        this.players.forEach(function (p) { if (p.chance.length) self.chanceDiscard.push(p.chance.pop()); });
        var more = this.drawIncident(); if (more) { this.incidentDiscard.push(more); this.logMsg('内戦により追加インシデント:「' + more.name + '」'); await this.applyIncident(more, drawer); }
      }
      else if (n === '流行') {
        var top = null, tv = -1; this.players.forEach(function (p) { var t = self.totalInfluence(p); if (t > tv) { tv = t; top = p; } });
        if (top) this.giveChance(top, 1);
      }
      await this.notify();
    }

    giveChance(p, n) {
      var max = this.lawFlags.monopoly ? 1 : 3;
      for (var i = 0; i < n && p.chance.length < max; i++) { var c = this.drawChanceCard(); if (c) p.chance.push(c); }
    }

    async applyChance(card, user) {
      var self = this, n = card.name;
      var others = this.players.filter(function (q) { return q.idx !== user.idx; });
      async function pickTarget(q, withPols) {
        var cand = self.players.filter(function (x) { return x.idx !== user.idx && (!withPols || x.pols.length > 0); });
        if (!cand.length) return null;
        var t = await self.choose(user.idx, { type: 'pickPlayer', players: cand.map(function (x) { return x.idx; }), q: q });
        return (t && t.idx != null) ? self.players[t.idx] : cand[0];
      }
      switch (n) {
        case '不信任決議': this.electionPending = true; this.logMsg('不信任決議! このターン終了時に首班指名選挙。'); break;
        case '襲撃': { var t = await pickTarget('襲撃する相手'); if (t) { t.skipTurns += 1; this.logMsg(t.name + 'は次の手番行動不能。'); } break; }
        case '行財政改革': user.trust += 3; this.logMsg(user.name + 'の信用度+3。'); break;
        case 'スキャンダル': { var t2 = await pickTarget('スキャンダル対象', true); if (t2 && t2.pols.length) { var pc = await this.choose(user.idx, { type: 'pickPolitician', cards: t2.pols, q: '捨てさせる政治家' }); var idx = pc && pc.take != null ? pc.take : 0; var rm = t2.pols.splice(idx, 1)[0]; this.polDiscard.push(rm); this.logMsg(t2.name + 'の政治家「' + rm.name + '」を捨て山へ。'); this.onLeaderMaybeChanged(t2); } break; }
        case '包囲網': { var top = null, tv = -1; this.players.forEach(function (p) { var v = self.totalInfluence(p); if (v > tv) { tv = v; top = p; } }); if (top) { while (top.chance.length) self.chanceDiscard.push(top.chance.pop()); this.logMsg(top.name + '(最大影響力)はチャンスを全て捨てた。'); } break; }
        case '牛歩戦術': this.lawFlags.snail = true; this.logMsg('牛歩戦術(簡略: 効果は限定的)。'); break;
        case '政治献金': this.giveChance(user, 1); this.logMsg(user.name + 'はチャンスを1枚得た。'); break;
        case '名演説': if (user.laws.length < 3) { var l = this.drawLaw(); if (l) { user.laws.push(l); this.logMsg(user.name + 'は法案「' + l.name + '」を引いた。'); } } break;
        case '機関紙発行': for (var i = 0; i < 2; i++) { if (user.pols.length < 5) { var pc2 = this.drawPol(); if (pc2) { user.pols.push(pc2); this.logMsg(user.name + 'は政治家「' + pc2.name + '」を加えた。'); } } } this.onLeaderMaybeChanged(user); break;
        case '一日天下': user.onceTenka = true; this.logMsg(user.name + 'は次ターン首班として行動可能(簡略)。'); break;
        case '暗殺': { var t3 = await pickTarget('暗殺対象', true); if (t3 && t3.pols.length) { var pc3 = await this.choose(user.idx, { type: 'pickPolitician', cards: t3.pols, q: '山札に送る政治家' }); var i3 = pc3 && pc3.take != null ? pc3.take : 0; var rm3 = t3.pols.splice(i3, 1)[0]; this.polDeck.unshift(rm3); this.logMsg(t3.name + 'の政治家「' + rm3.name + '」を山札へ。'); this.onLeaderMaybeChanged(t3); } break; }
        case '財政の崖': this.players.forEach(function (p) { p.chanceLock = Math.max(p.chanceLock, 2); }); this.logMsg('次ターン終了までチャンスを引けない。'); break;
        case '世論操作': { var k = await this.choose(user.idx, { type: 'pickIdeo', q: '+2するイデオロギー' }); var kk = (k && k.key) ? k.key : self.strongestIdeo(user); user.ip[kk] += 2; this.logMsg(user.name + 'は' + ideoJp(kk) + 'IP+2。'); break; }
        case '均衡': { var t4 = await pickTarget('信用度を合わせる相手'); if (t4) { user.trust = t4.trust; this.logMsg(user.name + 'の信用度は' + t4.name + 'と同じ(' + user.trust + ')に。'); } break; }
        case '決闘': { var t5 = await pickTarget('決闘相手'); this.lawFlags.duelOnly = [user.idx, t5 ? t5.idx : user.idx]; this.logMsg('このターンの採決は2名のみ投票可。'); break; }
        case '集中審議': this.lawFlags.superMajority = true; this.logMsg('このターンの法案は2/3の賛成が必要。'); break;
        case '讒言': { var t6 = await pickTarget('讒言対象'); if (t6) { t6.trust -= 2; this.logMsg(t6.name + 'の信用度-2。'); } break; }
        case '陳情': { var t7 = await pickTarget('陳情対象'); if (t7) { t7.trust -= 4; this.logMsg(t7.name + 'の信用度-4。'); } break; }
        case 'ねずみとり': { var t8 = await pickTarget('対象', true); if (t8 && t8.pols.length) { var wi = 0, wv = Infinity; t8.pols.forEach(function (c, i) { var s = 0; IDKEYS.forEach(function (k) { s += c.infl[k] || 0; }); if (s < wv) { wv = s; wi = i; } }); var rm8 = t8.pols.splice(wi, 1)[0]; this.polDiscard.push(rm8); this.logMsg(t8.name + 'の最弱政治家「' + rm8.name + '」を捨て山へ。'); this.onLeaderMaybeChanged(t8); } break; }
        case '恩赦': { if (this.polDiscard.length && user.pols.length < 5) { var rc = this.polDiscard.pop(); user.pols.push(rc); this.logMsg(user.name + 'は捨て山から「' + rc.name + '」を加えた。'); this.onLeaderMaybeChanged(user); } break; }
        case '転向': { var t9 = await pickTarget('転向対象', true); if (t9 && t9.pols.length && user.pols.length < 5) { var pc9 = await this.choose(user.idx, { type: 'pickPolitician', cards: t9.pols, q: '奪う政治家' }); var i9 = pc9 && pc9.take != null ? pc9.take : 0; var rm9 = t9.pols.splice(i9, 1)[0]; user.pols.push(rm9); var nc = this.drawPol(); if (nc) t9.pols.push(nc); this.logMsg(user.name + 'は' + t9.name + 'の「' + rm9.name + '」を転向させた。'); this.onLeaderMaybeChanged(user); this.onLeaderMaybeChanged(t9); } break; }
        case '静観': this.logMsg(user.name + 'は静観(このターン効果対象にならない/簡略)。'); break;
        case '連合': { var t10 = await pickTarget('連合相手'); this.logMsg('連合(簡略: 投票協力の意思表示)。'); break; }
        default: this.logMsg('(「' + n + '」の効果はテキスト参照)'); break;
      }
    }

    // ---- 党首交代時の処理(信用度ボーナス等の一般化) ----
    onLeaderMaybeChanged(p) {
      var lead = this.leaderPol(p);
      if (!lead) { p._leaderId = null; return; }
      if (p._leaderId !== lead.id) {
        p._leaderId = lead.id;
        // 「党首になった際 信用度+5」を持つ政治家の一般化
        if (lead.eff && /党首になった(時|際).*信用度を?＋５|信用度が＋５/.test(lead.eff)) {
          p.trust += 5; this.logMsg(p.name + 'の党首「' + lead.name + '」就任で信用度+5。');
        }
      }
    }

    async enforceLimits(p) {
      // チャンス上限
      var max = this.lawFlags.monopoly ? 1 : 3;
      while (p.chance.length > max) {
        var pick = await this.choose(p.idx, { type: 'pickCard', kind: 'chance', cards: p.chance, q: '捨てるチャンス(上限超過)' });
        var idx = (pick && pick.index != null) ? pick.index : 0;
        this.chanceDiscard.push(p.chance.splice(idx, 1)[0]);
      }
      // 法案手札上限3
      while (p.laws.length > 3) { this.lawDiscard.push(p.laws.pop()); }
      // 政治家5
      while (p.pols.length > 5) { this.polDiscard.push(p.pols.pop()); }
    }

    // ---- 表示用スナップショット ----
    snapshot() {
      var self = this;
      return {
        turn: this.turn, phase: this.phase, curIdx: this.curIdx, pmIdx: this.pmIdx,
        over: this.over, winner: this.winner ? this.winner.idx : null,
        players: this.players.map(function (p) {
          return {
            idx: p.idx, name: p.name, color: p.color, isPM: p.isPM, pos: p.pos,
            gold: p.gold, trust: p.trust, ip: deepCopy(p.ip),
            infl: self.influenceByIdeo(p), total: self.totalInfluence(p),
            strongest: p.pols.length ? self.strongestIdeo(p) : null,
            pols: deepCopy(p.pols), chanceN: p.chance.length, lawsN: p.laws.length,
            skipTurns: p.skipTurns, basicEnacted: p.basicEnacted
          };
        }),
        enacted: this.enacted.map(function (e) { return { name: e.card.name, owner: e.owner }; }),
        basicSlot: this.basicSlot.map(function (e) { return { name: e.card.name, owner: e.owner, ideo: e.card.ideo }; }),
        climate: deepCopy(this.climate),
        log: this.log.slice(-40)
      };
    }
  }

  var ENGINE = { Game: Game, ideoJp: ideoJp };
  root.PL_ENGINE = ENGINE;
  if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
})(typeof globalThis !== 'undefined' ? globalThis : this);
