/* POLITICA AI: choose(playerIdx, decision, game) -> 値 (Promise可)。
   コマンド選択型に対応。自分の最強思想を伸ばす法案/入替を優先し、優勢なら選挙で首班を狙う。 */
(function (root) {
  'use strict';
  var IDK = ['cap', 'mil', 'com', 'sci', 'env'];

  function makeAI() {
    function polTotal(c) { var s = (c.infl.non || 0); IDK.forEach(function (k) { s += c.infl[k] || 0; }); return s; }
    function myStrong(g, pi) { return g.strongestIdeo(g.players[pi]); }
    function maxIP(g, pi) { var p = g.players[pi], m = 0; IDK.forEach(function (k) { if (p.ip[k] > m) m = p.ip[k]; }); return m; }
    function leadingOpponent(g, pi) {
      var best = null, bv = -1;
      g.players.forEach(function (p) { if (p.idx === pi) return; var t = g.totalInfluence(p); if (t > bv) { bv = t; best = p; } });
      return best;
    }
    function amStrongest(g, pi) {
      var mine = g.totalInfluence(g.players[pi]);
      return !g.players.some(function (q) { return q.idx !== pi && g.totalInfluence(q) > mine; });
    }
    function lawValue(g, pi, l) { // 自分の最強思想を伸ばすほど高い
      var s = myStrong(g, pi);
      return (l.d[s] || 0) * 2 + (l.pip || 0) * 0.3;
    }

    function decide(pi, dec, g) {
      var p = g.players[pi];
      switch (dec.type) {
        case 'turnAction': {
          var ids = dec.options.map(function (o) { return o.id; });
          var s = myStrong(g, pi);
          var hasGoodLaw = p.laws.some(function (l) { return (l.d[s] || 0) > 0; });
          // 1) 有利な法案があれば提出
          if (ids.indexOf('lawPropose') >= 0 && hasGoodLaw) return { id: 'lawPropose' };
          // 2) 有利な法案が無ければ引く
          if (ids.indexOf('lawDraw') >= 0 && !hasGoodLaw) return { id: 'lawDraw' };
          // 3) 政治家入替で地盤強化(1ターン1回)
          if (ids.indexOf('polSwap') >= 0) return { id: 'polSwap' };
          // 4) 優勢なら選挙で首班(+IP)を取りにいく
          if (ids.indexOf('election') >= 0 && amStrongest(g, pi) && g.rng() < 0.6) return { id: 'election' };
          // 5) たまに買収(高コスト)
          if (ids.indexOf('bribe') >= 0 && p.gold >= 8 && g.rng() < 0.12) return { id: 'bribe' };
          // 余った法案も提出(消極)
          if (ids.indexOf('lawPropose') >= 0 && p.laws.length >= 2) return { id: 'lawPropose' };
          return { id: 'done' };
        }
        case 'pickPolitician': {
          var s2 = myStrong(g, pi);
          var bi = 0, bv = -1;
          dec.cards.forEach(function (c, i) { var v = (c.infl[s2] || 0) * 2 + polTotal(c) * 0.5; if (v > bv) { bv = v; bi = i; } });
          if (dec.fromOther) return { take: bi };
          if (dec.slotFull) {
            // 自分の最弱と比較し、強化になるなら入替
            var wi = 0, wv = Infinity, mys = myStrong(g, pi);
            dec.current.forEach(function (c, i) {
              var t = (c.infl[mys] || 0) * 2 + polTotal(c) * 0.5;
              if (t < wv) { wv = t; wi = i; }
            });
            if (bv > wv) return { take: bi, replace: wi };
            return { take: null };
          }
          return { take: bi };
        }
        case 'pickCard': {
          if (dec.kind === 'law') {
            var bi3 = -1, bv3 = 0.01;
            dec.cards.forEach(function (l, i) { var v = lawValue(g, pi, l); if (v > bv3) { bv3 = v; bi3 = i; } });
            return { index: bi3 >= 0 ? bi3 : (dec.cancelable ? null : 0) };
          }
          return { index: dec.cancelable ? null : 0 };
        }
        case 'pickPlayer': {
          var lead = leadingOpponent(g, pi);
          if (lead && dec.players.indexOf(lead.idx) >= 0) return { idx: lead.idx };
          return { idx: dec.players[0] };
        }
        case 'vote': {
          var card = dec.card, s4 = myStrong(g, pi);
          var benefit = (card.d[s4] || 0);
          var lead2 = leadingOpponent(g, pi);
          var proposerThreat = (dec.proposer === (lead2 && lead2.idx));
          var yes = benefit > 0 && !proposerThreat;
          if (benefit >= 2) yes = true;
          if (benefit < 0) yes = false;
          return { yes: yes };
        }
        case 'candidacy': {
          var mine = g.totalInfluence(p), maxv = 0;
          g.players.forEach(function (q) { var t = g.totalInfluence(q); if (t > maxv) maxv = t; });
          return { run: mine >= maxv * 0.8 };
        }
        case 'voteFor': {
          var s5 = myStrong(g, pi), best = dec.candidates[0], bv5 = -1;
          dec.candidates.forEach(function (ci) {
            var q = g.players[ci];
            var v = (g.influenceByIdeo(q)[s5] || 0) - g.totalInfluence(q) * 0.1;
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
