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

  // ---------- 中央(場)描画: 政界の勢力図 + 山札 + ターン情報 ----------
  function renderBoard(snap) {
    var board = $('board');
    board.innerHTML = '';
    var center = el('div', '', ''); center.id = 'center';
    center.appendChild(influenceGauges(snap));
    var decks = el('div', 'decks');
    decks.appendChild(deckPill('政治家山札', game.polDeck.length));
    decks.appendChild(deckPill('法案山札', game.lawDeck.length));
    if (snap.electionCooldown > 0) decks.appendChild(deckPill('次の選挙まで', snap.electionCooldown));
    center.appendChild(decks);
    var phase = el('div', '', 'ターン ' + snap.turn + ' / ' + phaseJp(snap.phase));
    phase.style.color = '#9fb0c8'; phase.style.fontSize = '12px';
    center.appendChild(phase);
    board.appendChild(center);
  }
  function deckPill(name, n) { var d = el('div', 'deckpill', name + ':' + n); return d; }
  function phaseJp(p) {
    return { setup: '準備', turn: '行動', vote: '採決', election: '首班指名選挙', gameover: '終了' }[p] || p;
  }

  // 場（政界全体）の影響力ゲージ: 全プレイヤーの影響力を思想ごとに合算して棒で表示。
  // どの思想が政界で優勢か（勢力図）が一目で分かる。世論の追い風も併記。
  function influenceGauges(snap) {
    var wrap = el('div', 'gauges');
    // 場の合計影響力(全員の各思想influenceの和)
    var field = { cap: 0, mil: 0, com: 0, sci: 0, env: 0 };
    snap.players.forEach(function (p) { IDK.forEach(function (k) { field[k] += (p.infl[k] || 0); }); });
    var domK = null, domv = -1;
    IDK.forEach(function (k) { if (field[k] > domv) { domv = field[k]; domK = k; } });
    var anyField = domv > 0;

    var title = el('div', 'gtitle');
    title.appendChild(el('span', '', '場の影響力（政界の勢力図）'));
    if (anyField && domK) {
      var dd = ideoDef(domK);
      var st = el('span', 'gstrong', '優勢: ' + dd.short); st.style.color = dd.color;
      title.appendChild(st);
    }
    wrap.appendChild(title);

    var maxv = 8; IDK.forEach(function (k) { if (field[k] > maxv) maxv = field[k]; });
    IDK.forEach(function (k) {
      var d = ideoDef(k);
      var row = el('div', 'grow' + (anyField && domK === k ? ' gstrongrow' : ''));
      var em = imgEl(EMBLEM_DIR + 'ideo_' + k + '.png', 'gem');
      var emWrap = el('span', 'gemwrap'); emWrap.style.background = d.color;
      emWrap.appendChild(em); emWrap.appendChild(el('span', 'gemico', d.icon));
      row.appendChild(emWrap);
      row.appendChild(el('span', 'gname', d.short));
      var track = el('div', 'gtrack');
      var fill = el('div', 'gfill'); fill.style.width = Math.round((field[k] / maxv) * 100) + '%';
      fill.style.background = d.color;
      track.appendChild(fill);
      track.appendChild(el('span', 'ginfl', String(field[k])));
      row.appendChild(track);
      // 優勢思想は法案効果が増す
      var tail = el('span', 'gtail');
      if (anyField && domK === k) { tail.textContent = '優勢'; tail.title = 'この思想が場で優勢。該当法案の効果が増す'; }
      row.appendChild(tail);
      wrap.appendChild(row);
    });
    var note = el('div', 'gnote', '全プレイヤーの政治家の思想値を合算した、政界における各思想の勢力。優勢な思想の法案は効果が増す。');
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
      hc.appendChild(el('span', '', '📜法案手札' + p.lawsN));
      card.appendChild(hc);
      box.appendChild(card);
    });
    // 成立法案
    var en = $('enacted'); en.innerHTML = '';
    en.appendChild(el('h3', '', '成立法案 (' + snap.enacted.length + '/5)'));
    snap.enacted.forEach(function (e) {
      en.appendChild(el('div', 'law', e.name + ' [' + snap.players[e.owner].name + ']'));
    });
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
      case 'turnAction': return 'コマンドを選択（各1回ずつ）';
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
      '<p>各プレイヤーは議員5名を擁する政党。自分の手番に下記コマンドを<b>各1回ずつ</b>実行できる。' +
      'いずれかの<b>イデオロギーIPを勝利値まで貯めれば勝利</b>。</p>' +
      '<ul>' +
      '<li>📜<b>法案を引く</b>: 法案カードを1枚手札に加える(手札3枚まで)。</li>' +
      '<li>👤<b>政治家を入替</b>: 山札から3枚引き、1枚を自党の議員と入れ替える(常に5名)。影響力の合計が政治力。</li>' +
      '<li>🏛<b>法案を提出</b>: 法案を採決にかける。賛成影響力>反対かつ必要影響力で可決。提出者はIPと信用を得る。' +
      '<b>自分の地盤(影響力)・高い信用・場で優勢な思想</b>だと法案が真価を発揮し追加IP。</li>' +
      '<li>🗳<b>選挙を行う</b>: 信用2を払い首班指名選挙。影響力の票を最も集めた者が首班(首相)に。' +
      '首班は組閣で信用+5・最強思想IP+2、さらに毎手番の施政で最強思想IP+1。</li>' +
      '<li>💰<b>買収(5G)</b>: 相手の議員1名を奪い自党へ(玉突きで自党の最弱を放出)。</li>' +
      '</ul>' +
      '<p>無主義の政治家は票数(影響力)にはなりますが、特定思想のIPは伸ばしません。</p>';
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
