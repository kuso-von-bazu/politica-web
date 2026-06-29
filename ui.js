/* POLITICA UI: 盤面描画 + 人間プレイヤーの非同期choiceプロバイダ */
(function () {
  'use strict';
  var DATA = window.PL_DATA, ENGINE = window.PL_ENGINE, AI = window.PL_AI;
  var IDE = DATA.IDEOLOGIES, BOARD = DATA.BOARD;
  var IDK = IDE.map(function (i) { return i.key; });
  var ideoJp = ENGINE.ideoJp;

  var game = null, aiProvider = null, humanIdx = 0, hotseat = false, FAST = false;
  var pending = null; // {resolve, dec, pi}

  var EMBLEM_DIR = 'assets/board/';
  var CARD_DIR = 'assets/cards/';

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function ideoDef(k) { for (var i = 0; i < IDE.length; i++) if (IDE[i].key === k) return IDE[i]; return null; }
  // 画像があれば<img>、無ければ自動で隠す(フォールバックは呼び出し側の下地が見える)
  function imgEl(src, cls) {
    var im = el('img', cls || 'cardimg');
    im.src = src; im.loading = 'lazy';
    im.onerror = function () { im.style.display = 'none'; };
    return im;
  }
  function polImg(c) { return imgEl(CARD_DIR + 'pol_' + c.id + '.png', 'polface'); }

  // 7x7 外周セル → 盤面indexの対応 (時計回り 左上から)
  function cellCoords() {
    var coords = [];
    for (var c = 0; c < 7; c++) coords.push([0, c]);          // top 0..6
    for (var r = 1; r < 7; r++) coords.push([r, 6]);          // right 7..12
    for (var c2 = 5; c2 >= 0; c2--) coords.push([6, c2]);     // bottom 13..18
    for (var r2 = 5; r2 >= 1; r2--) coords.push([r2, 0]);     // left 19..23
    return coords;
  }
  var COORDS = cellCoords();

  // ---------- 盤面描画 ----------
  function renderBoard(snap) {
    var board = $('board');
    board.innerHTML = '';
    // 外周マス
    for (var i = 0; i < BOARD.length; i++) {
      var sp = BOARD[i], rc = COORDS[i];
      var cell = el('div', 'cell k-' + sp.kind);
      cell.style.gridRow = (rc[0] + 1); cell.style.gridColumn = (rc[1] + 1);
      var ico = el('div', 'ico', spaceIcon(sp.kind));
      var lbl = el('div', 'lbl', sp.label);
      cell.appendChild(ico); cell.appendChild(lbl);
      // pawns
      var pawns = el('div', 'pawns');
      snap.players.forEach(function (p) {
        if (p.pos === i) {
          var pw = el('div', 'pawn' + (p.isPM ? ' pm' : ''));
          pw.style.background = p.color; pw.title = p.name;
          pawns.appendChild(pw);
        }
      });
      cell.appendChild(pawns);
      if (snap.curIdx != null && snap.players[snap.curIdx].pos === i) cell.classList.add('cur');
      board.appendChild(cell);
    }
    // 中央
    var center = el('div', '', '');
    center.id = 'center';
    center.style.gridRow = '2 / 7'; center.style.gridColumn = '2 / 7';
    center.appendChild(influenceGauges(snap));
    var decks = el('div', 'decks');
    decks.appendChild(deckPill('政治家', game.polDeck.length));
    decks.appendChild(deckPill('チャンス', game.chanceDeck.length));
    decks.appendChild(deckPill('インシデント', game.incidentDeck.length));
    decks.appendChild(deckPill('法案', game.lawDeck.length));
    center.appendChild(decks);
    var phase = el('div', '', 'ターン ' + snap.turn + ' / ' + phaseJp(snap.phase));
    phase.style.color = '#9fb0c8'; phase.style.fontSize = '12px';
    center.appendChild(phase);
    board.appendChild(center);
  }
  function deckPill(name, n) { var d = el('div', 'deckpill', name + ':' + n); return d; }
  function spaceIcon(k) {
    return { election: '🗳', politician: '👤', ip: '★', chance: '🎴', incident: '⚡', law: '📜', money: '💰', rest: '💤' }[k] || '';
  }
  function phaseJp(p) {
    return { setup: '準備', turn: '行動', vote: '採決', election: '首班指名選挙', gameover: '終了' }[p] || p;
  }

  // イデオロギー影響力ゲージ: 現在の手番プレイヤーの5思想の影響力を棒で表示。
  // 一番長い=最強=IPマスでIPが入る思想。世論の追い風や各IPも併記し「影響力→勝利」の関係を可視化。
  function influenceGauges(snap) {
    var wrap = el('div', 'gauges');
    var p = snap.players[snap.curIdx];
    var title = el('div', 'gtitle');
    var dot = el('span', 'gdot'); dot.style.background = p.color; title.appendChild(dot);
    title.appendChild(el('span', '', p.name + ' の影響力'));
    if (p.strongest) {
      var sd = ideoDef(p.strongest);
      var st = el('span', 'gstrong', '最強: ' + sd.short); st.style.color = sd.color;
      title.appendChild(st);
    }
    wrap.appendChild(title);
    // スケール = その人の最大影響力(最低8)で正規化
    var maxv = 8; IDK.forEach(function (k) { if (p.infl[k] > maxv) maxv = p.infl[k]; });
    IDK.forEach(function (k) {
      var d = ideoDef(k);
      var row = el('div', 'grow' + (p.strongest === k ? ' gstrongrow' : ''));
      // 紋章(あれば)。無ければアイコン文字
      var em = imgEl(EMBLEM_DIR + 'ideo_' + k + '.png', 'gem');
      var emWrap = el('span', 'gemwrap'); emWrap.style.background = d.color;
      emWrap.appendChild(em); emWrap.appendChild(el('span', 'gemico', d.icon));
      row.appendChild(emWrap);
      row.appendChild(el('span', 'gname', d.short));
      var track = el('div', 'gtrack');
      var fill = el('div', 'gfill'); fill.style.width = Math.round((p.infl[k] / maxv) * 100) + '%';
      fill.style.background = d.color;
      track.appendChild(fill);
      var infv = el('span', 'ginfl', String(p.infl[k]));
      track.appendChild(infv);
      row.appendChild(track);
      // 世論の追い風
      var tail = el('span', 'gtail');
      if (snap.climate && snap.climate[k] > 0) { tail.textContent = '追い風'; tail.title = '世論の追い風: このマス止まりでIP+1'; }
      row.appendChild(tail);
      // このプレイヤーの該当IP
      row.appendChild(el('span', 'gip', 'IP' + p.ip[k]));
      wrap.appendChild(row);
    });
    var note = el('div', 'gnote', '影響力＝政治家の思想値の合計（票数）。最も高い思想のIPが「★IPマス」で増え、勝利値で勝ち。');
    wrap.appendChild(note);
    return wrap;
  }

  // ---------- プレイヤー描画 ----------
  function renderPlayers(snap) {
    var box = $('players'); box.innerHTML = '';
    snap.players.forEach(function (p) {
      var card = el('div', 'pcard' + (p.idx === humanIdx && !hotseat ? ' me' : '') + (p.idx === snap.curIdx ? ' active' : ''));
      card.style.borderLeftColor = p.color;
      var head = el('div', 'phead');
      head.appendChild(el('span', '', p.name));
      if (p.isPM) head.appendChild(el('span', 'pm-badge', '首班'));
      card.appendChild(head);
      var res = el('div', 'res');
      res.appendChild(el('span', '', '💰' + p.gold + 'G'));
      res.appendChild(el('span', '', '信用' + p.trust));
      res.appendChild(el('span', '', '影響' + p.total));
      if (p.skipTurns > 0) res.appendChild(el('span', '', '休' + p.skipTurns));
      card.appendChild(res);
      var iprow = el('div', 'iprow');
      IDK.forEach(function (k) {
        var chip = el('div', 'ipchip s-' + k + (p.strongest === k ? ' lead' : ''));
        chip.innerHTML = '<b>' + p.ip[k] + '</b>';
        chip.title = ideoJp(k) + ' IP:' + p.ip[k] + ' / 影響:' + p.infl[k];
        iprow.appendChild(chip);
      });
      card.appendChild(iprow);
      var pm = el('div', 'polmini');
      p.pols.forEach(function (c) {
        var d = ideoDef(c.ideo);
        var t = el('div', 'pm-card', c.name + '(' + polTotal(c) + ')');
        t.style.borderLeftColor = d ? d.color : '#888';
        pm.appendChild(t);
      });
      card.appendChild(pm);
      var hc = el('div', 'res');
      hc.appendChild(el('span', '', '🎴ﾁｬﾝｽ' + p.chanceN));
      hc.appendChild(el('span', '', '📜法案' + p.lawsN));
      if (p.basicEnacted) hc.appendChild(el('span', '', '🏛' + p.basicEnacted));
      card.appendChild(hc);
      box.appendChild(card);
    });
    // 成立法案 / 基幹政策
    var en = $('enacted'); en.innerHTML = '';
    en.appendChild(el('h3', '', '成立法案 (' + snap.enacted.length + '/5)'));
    snap.enacted.forEach(function (e) {
      en.appendChild(el('div', 'law', e.name + ' [' + snap.players[e.owner].name + ']'));
    });
    if (snap.basicSlot && snap.basicSlot.length) {
      en.appendChild(el('h3', '', '基幹政策(永続)'));
      snap.basicSlot.forEach(function (e) {
        var d = ideoDef(e.ideo);
        var b = el('div', 'law', '🏛 ' + e.name + ' [' + snap.players[e.owner].name + ']');
        if (d) { b.style.background = '#2a3852'; b.style.borderLeft = '4px solid ' + d.color; }
        en.appendChild(b);
      });
    }
  }
  function polTotal(c) { var s = (c.infl.non || 0); IDK.forEach(function (k) { s += (c.infl[k] || 0); }); return s; }

  function renderLog(snap) {
    var lg = $('log'); lg.innerHTML = '';
    snap.log.forEach(function (l) {
      var d = el('div', 'l' + (/[★―]/.test(l.text) ? ' star' : ''), l.text);
      lg.appendChild(d);
    });
    lg.scrollTop = lg.scrollHeight;
  }

  function renderAll() {
    if (!game) return;
    var snap = game.snapshot();
    renderBoard(snap); renderPlayers(snap); renderLog(snap);
    var ti = $('turninfo');
    var cur = snap.players[snap.curIdx];
    ti.textContent = snap.over ? '【ゲーム終了】' : ('現在の手番: ' + cur.name + (cur.idx === humanIdx && !hotseat ? '(あなた)' : '(AI)'));
    renderHand(snap);
  }

  // ---------- 人間の手札表示 ----------
  function renderHand(snap) {
    var hand = $('hand'); hand.innerHTML = '';
    var showIdx = (pending && pending.pi != null) ? pending.pi : snap.curIdx;
    if (hotseat || showIdx === humanIdx) {
      var p = game.players[showIdx];
      p.chance.forEach(function (c) { hand.appendChild(handCard(c, 'chance', '🎴')); });
      p.laws.forEach(function (c) { hand.appendChild(handCard(c, 'law', '📜')); });
    }
  }
  function handCard(c, type, tag) {
    var card = el('div', 'card t-' + type);
    card.appendChild(el('div', 'cn', c.name));
    var e = el('div', 'ce', c.eff || effLawSummary(c));
    card.appendChild(e);
    card.appendChild(el('div', 'tag', tag));
    return card;
  }
  function effLawSummary(c) {
    if (!c.d) return '';
    return IDK.filter(function (k) { return c.d[k]; }).map(function (k) { return ideoDef(k).short + (c.d[k] > 0 ? '+' : '') + c.d[k]; }).join(' ');
  }

  // =================================================================
  //  決定UI (provider)
  // =================================================================
  function humanChoose(pi, dec, g) {
    return new Promise(function (resolve) {
      pending = { resolve: resolve, dec: dec, pi: pi };
      renderAll();
      renderDecision(pi, dec);
    });
  }
  function resolvePending(val) {
    if (!pending) return;
    var r = pending.resolve; pending = null;
    $('decision').innerHTML = '';
    r(val);
  }

  function renderDecision(pi, dec) {
    var box = $('decision'); box.innerHTML = '';
    var who = game.players[pi];
    var q = el('div', 'q', (hotseat ? '【' + who.name + '】 ' : '') + decQuestion(dec));
    box.appendChild(q);

    switch (dec.type) {
      case 'turnAction':
        dec.options.forEach(function (o) { box.appendChild(actBtn(o.label, function () { resolvePending({ id: o.id }); })); });
        break;
      case 'yesno':
        box.appendChild(actBtn('はい', function () { resolvePending(decBool(dec, true)); }));
        box.appendChild(actBtn('いいえ', function () { resolvePending(decBool(dec, false)); }));
        break;
      case 'pickPolitician':
        renderPickPol(box, pi, dec); break;
      case 'pickCard':
        renderPickCard(box, pi, dec); break;
      case 'pickPlayer':
        dec.players.forEach(function (idx) { var p = game.players[idx]; box.appendChild(actBtn(p.name, function () { resolvePending({ idx: idx }); })); });
        box.appendChild(cancelBtn());
        break;
      case 'pickIdeo':
        IDK.forEach(function (k) { var d = ideoDef(k); box.appendChild(actBtn(d.icon + d.short, function () { resolvePending({ key: k }); })); });
        break;
      case 'vote':
        box.appendChild(el('div', '', voteInfo(dec)));
        box.appendChild(actBtn('賛成', function () { resolvePending({ yes: true }); }));
        box.appendChild(actBtn('反対', function () { resolvePending({ yes: false }); }));
        break;
      case 'candidacy':
        box.appendChild(actBtn('立候補する', function () { resolvePending({ run: true }); }));
        box.appendChild(actBtn('立候補しない', function () { resolvePending({ run: false }); }));
        break;
      case 'voteFor':
        dec.candidates.forEach(function (idx) { var p = game.players[idx]; box.appendChild(actBtn(p.name + '(影響' + game.totalInfluence(p) + ')', function () { resolvePending({ idx: idx }); })); });
        break;
      default:
        box.appendChild(actBtn('OK', function () { resolvePending(null); }));
    }
  }

  function decQuestion(dec) {
    if (dec.q) return dec.q;
    switch (dec.type) {
      case 'turnAction': return dec.when === 'pre' ? '行動を選択(サイコロ前)' : '追加行動を選択';
      case 'pickPolitician': return '政治家を選ぶ';
      case 'vote': return '法案「' + dec.card.name + '」に投票';
      case 'candidacy': return '首班指名選挙: 立候補しますか?';
      case 'voteFor': return 'どの候補に投票しますか?';
      case 'pickIdeo': return 'イデオロギーを選ぶ';
      default: return '選択してください';
    }
  }
  function decBool(dec, v) {
    if (dec.cost === 'propose') return { yes: v };
    return v;
  }
  function voteInfo(dec) {
    var c = dec.card;
    return '効果: ' + (c.eff || effLawSummary(c)) + ' / 必要影響力' + dec.need + ' / 提出: ' + game.players[dec.proposer].name;
  }

  function actBtn(label, fn) { var b = el('button', 'act', label); b.onclick = fn; return b; }
  function cancelBtn() { return actBtn('やめる', function () { resolvePending({ index: null, take: null, idx: null }); }); }

  function renderPickPol(box, pi, dec) {
    var wrap = el('div', '');
    dec.cards.forEach(function (c, i) {
      var card = el('div', 'card t-pol', '');
      card.appendChild(polImg(c));
      card.appendChild(el('div', 'cn', c.name));
      card.appendChild(el('div', 'ce', '影響' + polTotal(c) + ' / ' + ideoDef(c.ideo).short + ' ' + (c.eff ? c.eff.slice(0, 40) : '')));
      card.style.display = 'inline-block'; card.style.marginRight = '4px';
      card.onclick = function () {
        if (dec.slotFull && !dec.fromOther) {
          // 入替先を選ぶ
          pickReplace(pi, dec, i);
        } else {
          resolvePending({ take: i });
        }
      };
      wrap.appendChild(card);
    });
    box.appendChild(wrap);
    if (dec.slotFull) box.appendChild(actBtn('どれも取らない', function () { resolvePending({ take: null }); }));
    if (dec.fromOther && dec.cancelable !== false) {} // bribe等は必須
  }
  function pickReplace(pi, dec, takeIdx) {
    var box = $('decision'); box.innerHTML = '';
    box.appendChild(el('div', 'q', '入れ替えで捨てる自分の政治家を選択'));
    var p = game.players[pi];
    p.pols.forEach(function (c, j) {
      box.appendChild(actBtn(c.name + '(' + polTotal(c) + ')', function () { resolvePending({ take: takeIdx, replace: j }); }));
    });
  }

  function renderPickCard(box, pi, dec) {
    var wrap = el('div', '');
    dec.cards.forEach(function (c, i) {
      var card = el('div', 'card t-' + (dec.kind === 'law' ? 'law' : 'chance'), '');
      card.appendChild(el('div', 'cn', c.name));
      card.appendChild(el('div', 'ce', c.eff || effLawSummary(c)));
      card.style.display = 'inline-block'; card.style.marginRight = '4px';
      card.onclick = function () { resolvePending({ index: i }); };
      wrap.appendChild(card);
    });
    box.appendChild(wrap);
    if (dec.cancelable) box.appendChild(cancelBtn());
  }

  // =================================================================
  //  プロバイダ: 人間 or AI を手番で切替
  // =================================================================
  function makeProvider() {
    return {
      notify: function () { renderAll(); return delay(snapDelay()); },
      choose: function (pi, dec, g) {
        var p = g.players[pi];
        var isHuman = hotseat ? true : (pi === humanIdx);
        if (isHuman && !p.isAI) {
          return humanChoose(pi, dec, g);
        }
        // AI: 少し待ってから決定(演出)
        return delay(FAST ? 0 : 280).then(function () { return aiProvider.choose(pi, dec, g); });
      }
    };
  }
  function snapDelay() { return FAST ? 0 : 160; }
  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // =================================================================
  //  起動
  // =================================================================
  function startGame() {
    var name = $('pname').value || 'あなた';
    var n = parseInt($('pcount').value, 10);
    var winip = parseInt($('winip').value, 10);
    hotseat = $('hotseat').checked;
    var players = [];
    for (var i = 0; i < n; i++) {
      if (hotseat) players.push({ name: 'P' + (i + 1) + '(' + DATA.PLAYER_COLOR_NAMES[i] + ')', isAI: false });
      else players.push({ name: i === 0 ? name : DATA.PLAYER_COLOR_NAMES[i] + 'AI', isAI: i !== 0 });
    }
    humanIdx = 0;
    var seed = (Date.now() & 0x7fffffff) || 12345;
    game = new ENGINE.Game({ seed: seed, players: players, winIP: winip });
    aiProvider = AI.makeAI();
    $('setup').style.display = 'none';
    $('game').style.display = 'grid';
    var provider = makeProvider();
    game.run(provider).then(function () {
      renderAll();
      showWinner();
    });
  }

  function showWinner() {
    var snap = game.snapshot();
    var w = snap.winner != null ? snap.players[snap.winner] : null;
    var mc = $('modal-content'); mc.innerHTML = '';
    mc.appendChild(el('div', 'win-banner', w ? '★ ' + w.name + ' の勝利! ★' : 'ゲーム終了'));
    if (w) {
      var last = game.log[game.log.length - 1];
      mc.appendChild(el('p', '', last ? last.text : ''));
    }
    var b = el('button', 'primary', 'もう一度遊ぶ');
    b.onclick = function () { location.reload(); };
    mc.appendChild(b);
    $('modal').classList.remove('modal-hidden');
  }

  // ---------- 遊び方モーダル ----------
  function showRules() {
    var mc = $('modal-content');
    mc.innerHTML = '<h2>POLITICA 遊び方</h2>' +
      '<p>サイコロで盤面を進み、止まったマスで政治家を集め・カードを引き・法案を成立させて、' +
      'いずれかの<b>イデオロギーIPを勝利値まで貯めれば勝利</b>。</p>' +
      '<ul>' +
      '<li>👤政治家獲得: 山札から選んでスロット(最大5)に加える。影響力の合計があなたの政治力。</li>' +
      '<li>★IP: 一番影響力の高いイデオロギーのIPが+1。</li>' +
      '<li>🎴チャンス/⚡インシデント: 1G or 1IPで引く / 強制発生。</li>' +
      '<li>📜法案提出: 法案を引き、採決にかける。賛成影響力>反対で可決し、提出者はIPと信用度を得る。</li>' +
      '<li>🗳総選挙: 首班が通過すると首班指名選挙。影響力の票を集めた者が首班(首相)に。</li>' +
      '<li>基幹政策(影響力12以上で提出可)は可決で最強思想IPを一気に+5する廃案不可の永続政策。終盤の切り札。</li>' +
      '</ul>' +
      '<p>チャンスカードの使用には信用度を消費します。無主義の政治家は票数にはなりますが特定思想のIPは伸ばしません。</p>';
    var b = el('button', 'ghost', '閉じる'); b.onclick = closeModal;
    mc.appendChild(b);
    $('modal').classList.remove('modal-hidden');
  }
  function closeModal() { $('modal').classList.add('modal-hidden'); }

  // 全AI自動実行(動作確認/アトラクト): ?auto=1
  function startAuto() {
    var n = 3; hotseat = false; humanIdx = -1;
    if (location.search.indexOf('fast=1') >= 0) FAST = true;
    var players = [];
    for (var i = 0; i < n; i++) players.push({ name: DATA.PLAYER_COLOR_NAMES[i] + 'AI', isAI: true });
    game = new ENGINE.Game({ seed: 12345, players: players, winIP: 14 });
    aiProvider = AI.makeAI();
    $('setup').style.display = 'none';
    $('game').style.display = 'grid';
    game.run(makeProvider()).then(function () { renderAll(); showWinner(); });
  }

  // ---------- 配線 ----------
  window.addEventListener('DOMContentLoaded', function () {
    $('startBtn').onclick = startGame;
    $('rulesBtn').onclick = showRules;
    if (location.search.indexOf('auto=1') >= 0) startAuto();
  });
})();
