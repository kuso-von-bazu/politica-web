/* POLITICA AI: choose(playerIdx, decision, game) -> 値 (Promise可)。
   1ターン1コマンド。3つの勝利条件(信用20/場の影響力50/選挙3回首班)のうち
   最も近い道を進める単一コマンドを選ぶ。 */
(function (root) {
  'use strict';
  var IDK = ['cap', 'mil', 'com', 'sci', 'env'];

  function makeAI() {
    function polTotal(c) { var s = (c.infl.non || 0); IDK.forEach(function (k) { s += c.infl[k] || 0; }); return s; }
    function myStrong(g, pi) { return g.strongestIdeo(g.players[pi]); }
    function leadingOpponent(g, pi) {
      var best = null, bv = -1;
      g.players.forEach(function (p) { if (p.idx === pi) return; var t = g.totalInfluence(p); if (t > bv) { bv = t; best = p; } });
      return best;
    }
    function amStrongest(g, pi) {
      var mine = g.totalInfluence(g.players[pi]);
      return !g.players.some(function (q) { return q.idx !== pi && g.totalInfluence(q) > mine; });
    }
    function topInIdeo(g, k) {
      var best = -1, bi = -1;
      g.players.forEach(function (p) { var v = g.influenceByIdeo(p)[k]; if (v > best) { best = v; bi = p.idx; } });
      return bi;
    }

    function decide(pi, dec, g) {
      var p = g.players[pi];
      switch (dec.type) {
        case 'turnAction': {
          var ids = dec.options.map(function (o) { return o.id; });
          var has = function (x) { return ids.indexOf(x) >= 0; };
          var s = myStrong(g, pi);
          var goodLaw = p.laws.some(function (l) { return (l.d[s] || 0) > 0 || (l.pip || 0) >= 1; });
          var goal = ['election', 'trust', 'field'][pi % 3]; // AIごとの勝利方針(道を分散)
          var field = g.fieldInfluence();
          var TW = g.TRUST_WIN || 20, PW = g.PM_WIN || 3, FW = g.FIELD_WIN || 50;

          // 共通: 勝利目前なら押し切る
          if (p.trust >= TW - 2 && has('lawPropose') && goodLaw) return { id: 'lawPropose' };
          if (has('election') && amStrongest(g, pi) && p.pmCount >= PW - 1) return { id: 'election' };

          if (goal === 'election') {
            if (has('election') && amStrongest(g, pi) && g.rng() < 0.7) return { id: 'election' };
            // 影響力を高めて選挙に勝てる体制を作る
            if (!p.isPM && has('polSwap')) return { id: 'polSwap' };
            if (has('election') && g.rng() < 0.3) return { id: 'election' };
          } else if (goal === 'trust') {
            if (has('lawPropose') && goodLaw) return { id: 'lawPropose' };
            if (has('lawDraw') && p.laws.length < 2) return { id: 'lawDraw' };
            if (!p.isPM && has('polSwap') && (g.influenceByIdeo(p)[s] || 0) < 10) return { id: 'polSwap' }; // 地盤=真価条件
            if (has('lawPropose') && p.laws.length) return { id: 'lawPropose' };
          } else { // field: 一思想を場で50に押し上げる
            if (!p.isPM && has('polSwap')) return { id: 'polSwap' };
            if (has('lawPropose') && goodLaw && g.fieldDominant() === s) return { id: 'lawPropose' };
            if (has('lawDraw') && p.laws.length < 2) return { id: 'lawDraw' };
          }

          // 汎用フォールバック
          if (has('lawPropose') && goodLaw) return { id: 'lawPropose' };
          if (has('lawDraw') && p.laws.length < 2) return { id: 'lawDraw' };
          if (!p.isPM && has('polSwap')) return { id: 'polSwap' };
          if (has('donate') && p.gold < 6) return { id: 'donate' };
          if (has('lawPropose') && p.laws.length) return { id: 'lawPropose' };
          if (has('donate')) return { id: 'donate' };
          return { id: 'done' };
        }
        case 'pickPolitician': {
          var s2 = myStrong(g, pi);
          var bi = 0, bv = -1;
          dec.cards.forEach(function (c, i) { var v = (c.infl[s2] || 0) * 2 + polTotal(c) * 0.5; if (v > bv) { bv = v; bi = i; } });
          if (dec.fromOther) return { take: bi };
          if (dec.slotFull) {
            var wi = 0, wv = Infinity;
            dec.current.forEach(function (c, i) { var t = (c.infl[s2] || 0) * 2 + polTotal(c) * 0.5; if (t < wv) { wv = t; wi = i; } });
            if (bv > wv) return { take: bi, replace: wi };
            return { take: null };
          }
          return { take: bi };
        }
        case 'pickCard': {
          if (dec.kind === 'law') {
            var s3 = myStrong(g, pi), bi3 = -1, bv3 = -1;
            dec.cards.forEach(function (l, i) { var v = (l.pip || 0) + (l.d[s3] || 0) * 0.5; if (v > bv3) { bv3 = v; bi3 = i; } });
            return { index: bi3 >= 0 ? bi3 : (dec.cancelable ? null : 0) };
          }
          return { index: dec.cancelable ? null : 0 };
        }
        case 'pickPlayer': {
          var lead = leadingOpponent(g, pi);
          if (lead && dec.players.indexOf(lead.idx) >= 0) return { idx: lead.idx };
          return { idx: dec.players[0] };
        }
        case 'pickRepeal': {
          // 廃案: 信用が高い相手(脅威)の成立法案を狙って信用-2を与える。自分の法案は狙わない。
          var bi = -1, bv = 12; // 相手信用がこれ未満なら廃案しない(無駄打ち回避)
          dec.enacted.forEach(function (e, i) {
            if (e.owner === pi) return;
            var t = g.players[e.owner].trust;
            if (t > bv) { bv = t; bi = i; }
          });
          return { index: bi };
        }
        case 'vote': {
          var card = dec.card, s4 = myStrong(g, pi);
          var proposer = g.players[dec.proposer];
          // 自分の法案を廃案にする提案には反対
          if (dec.repeal && dec.repeal.owner === pi) return { yes: false };
          // 提出者が信用勝利に近い、または最有力なら反対
          if (proposer.trust >= 16) return { yes: false };
          var lead2 = leadingOpponent(g, pi);
          if (dec.proposer === (lead2 && lead2.idx) && proposer.trust >= 12) return { yes: false };
          // 自分が賛同者として信用(aip)をもらえるなら賛成寄り
          if ((card.aip || 0) >= 1 && proposer.trust < 14) return { yes: true };
          var benefit = (card.d[s4] || 0);
          return { yes: benefit > 0 };
        }
        case 'candidacy': {
          var mine = g.totalInfluence(p), maxv = 0;
          g.players.forEach(function (q) { var t = g.totalInfluence(q); if (t > maxv) maxv = t; });
          return { run: mine >= maxv * 0.8 };
        }
        case 'voteFor': {
          // 連合投票: 勝利目前(首班回数・信用)の先頭走者を避け、それを倒せる最有力候補に票を集める。
          var PW2 = g.PM_WIN || 3, TW2 = g.TRUST_WIN || 20;
          function threat(q) { return q.pmCount >= PW2 - 1 || q.trust >= TW2 - 3; }
          var s5 = myStrong(g, pi), best = dec.candidates[0], bv5 = -Infinity;
          dec.candidates.forEach(function (ci) {
            var q = g.players[ci];
            var v = g.totalInfluence(q) * 0.3 + (g.influenceByIdeo(q)[s5] || 0);
            if (threat(q)) v -= 1000;            // 勝利目前は全力で阻止
            if (q.idx === g.pmIdx) v -= 5;       // 現職もやや避ける
            if (v > bv5) { bv5 = v; best = ci; }
          });
          return { idx: best };
        }
        case 'yesno': return true;
        default: return null;
      }
    }

    return {
      choose: function (pi, dec, g) { return Promise.resolve(decide(pi, dec, g)); },
      notify: function () { }
    };
  }

  var AI = { makeAI: makeAI };
  root.PL_AI = AI;
  if (typeof module !== 'undefined' && module.exports) module.exports = AI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
