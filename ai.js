/* POLITICA AI: choose(playerIdx, decision, game) -> 値 (Promise可)。
   ヒューリスティック。自分のIPリードを伸ばし、脅威プレイヤーを妨害する。 */
(function (root) {
  'use strict';
  var IDK = ['cap', 'mil', 'com', 'sci', 'env'];

  function makeAI() {
    function polTotal(c) { var s = 0; IDK.forEach(function (k) { s += c.infl[k] || 0; }); return s; }
    function myStrong(g, pi) { return g.strongestIdeo(g.players[pi]); }

    function leadingOpponent(g, pi) {
      var best = null, bv = -1;
      g.players.forEach(function (p) { if (p.idx === pi) return; var t = g.totalInfluence(p); if (t > bv) { bv = t; best = p; } });
      return best;
    }
    function maxIP(g, pi) { var p = g.players[pi], m = 0; IDK.forEach(function (k) { if (p.ip[k] > m) m = p.ip[k]; }); return m; }

    function decide(pi, dec, g) {
      var p = g.players[pi];
      switch (dec.type) {
        case 'yesno': {
          if (dec.cost === 'drawChance') return p.chance.length < 2 && (p.gold >= 2 || maxIP(g, pi) >= 3);
          if (dec.cost === 'dodgeIncident') return (p.gold >= 4 || maxIP(g, pi) >= 6) && g.rng() < 0.4;
          if (dec.cost === 'expandPol') return p.gold >= 3 || maxIP(g, pi) >= 4;
          if (dec.cost === 'propose') return true;
          return { yes: true };
        }
        case 'turnAction': {
          var opts = dec.options.map(function (o) { return o.id; });
          // 基幹政策(強力な決め手): 影響力が高く、最強IPが終盤域なら一気に勝ちに近づける
          if (opts.indexOf('basic') >= 0 && !p.basicEnacted) {
            var infl = g.totalInfluence(p), sIP = p.ip[myStrong(g, pi)];
            if (infl >= 14 && sIP >= g.winIP * 0.55 && sIP < g.winIP - 1 && g.rng() < 0.4) return { id: 'basic' };
          }
          if (opts.indexOf('law') >= 0 && p.laws.length && dec.when === 'pre') {
            // 自分に有利な法案があるか
            var s = myStrong(g, pi);
            var good = p.laws.some(function (l) { return (l.d[s] || 0) > 0; });
            if (good && g.rng() < 0.8) return { id: 'law' };
          }
          if (opts.indexOf('chance') >= 0 && p.chance.length) {
            // 攻撃/有益カードがあれば使う
            if (g.rng() < 0.55) return { id: 'chance' };
          }
          if (opts.indexOf('bribe') >= 0 && g.rng() < 0.15) return { id: 'bribe' };
          return { id: 'done' };
        }
        case 'pickPolitician': {
          var s2 = myStrong(g, pi);
          // 自分の強イデオロギーに合う最大影響力
          var bi = 0, bv = -1;
          dec.cards.forEach(function (c, i) {
            var v = polTotal(c) + (c.infl[s2] ? 2 : 0);
            if (v > bv) { bv = v; bi = i; }
          });
          if (dec.fromOther) return { take: bi };
          if (dec.slotFull) {
            // 自分の最弱と比較
            var wi = 0, wv = Infinity;
            dec.current.forEach(function (c, i) { var t = polTotal(c); if (t < wv) { wv = t; wi = i; } });
            if (polTotal(dec.cards[bi]) > wv) return { take: bi, replace: wi };
            return { take: null };
          }
          return { take: bi };
        }
        case 'pickCard': {
          if (dec.kind === 'law') {
            var s3 = myStrong(g, pi), bi3 = -1, bv3 = -0.1;
            dec.cards.forEach(function (l, i) { var v = (l.d[s3] || 0) + (l.pip || 0) * 0.3; if (v > bv3) { bv3 = v; bi3 = i; } });
            return { index: bi3 >= 0 ? bi3 : (dec.cancelable ? null : 0) };
          }
          // chance: 捨てる時は最弱(コスト高い=強力を温存しない簡略)、使う時はそのまま先頭
          if (dec.q && dec.q.indexOf('捨てる') >= 0) {
            var ci = 0, cv = 99; dec.cards.forEach(function (c, i) { var a = Math.abs(c.cost || 0); if (a < cv) { cv = a; ci = i; } });
            return { index: ci };
          }
          // 使うチャンス: 信用度で払える中で価値が高そうなもの
          var usable = [];
          dec.cards.forEach(function (c, i) { if (p.trust >= Math.abs(c.cost || 0)) usable.push(i); });
          if (!usable.length) return { index: dec.cancelable ? null : 0 };
          return { index: usable[Math.floor(g.rng() * usable.length)] };
        }
        case 'pickPlayer': {
          // 攻撃系: 最強の他者。買収: 同上。
          var lead = leadingOpponent(g, pi);
          if (lead && dec.players.indexOf(lead.idx) >= 0) return { idx: lead.idx };
          return { idx: dec.players[0] };
        }
        case 'pickIdeo': return { key: myStrong(g, pi) };
        case 'vote': {
          var card = dec.card, s4 = myStrong(g, pi);
          // 基幹政策=提出者を大きく利する強力政策。脅威プレイヤーのものなら反対、そうでなければ消極的反対。
          if (card.basic && dec.proposer !== pi) {
            var ld0 = leadingOpponent(g, pi);
            if (dec.proposer === (ld0 && ld0.idx)) return { yes: false };
            return { yes: g.rng() < 0.3 };
          }
          // 自分のイデオロギーを伸ばすなら賛成、下げるなら反対。提出者が脅威でも反対寄り。
          var benefit = (card.d[s4] || 0);
          var lead2 = leadingOpponent(g, pi);
          var proposerThreat = (dec.proposer === (lead2 && lead2.idx));
          var yes = benefit > 0 && !proposerThreat;
          if (benefit >= 2) yes = true;
          if (benefit < 0) yes = false;
          return { yes: yes };
        }
        case 'candidacy': {
          // 影響力が上位なら立候補
          var arr = g.players.map(function (q) { return g.totalInfluence(q); });
          var mine = g.totalInfluence(p), maxv = Math.max.apply(null, arr);
          return { run: mine >= maxv * 0.8 };
        }
        case 'voteFor': {
          // 自分に近いイデオロギーの候補、無ければ最弱候補(脅威を避ける)
          var s5 = myStrong(g, pi);
          var best = dec.candidates[0], bv5 = -1;
          dec.candidates.forEach(function (ci) {
            var q = g.players[ci];
            var v = (g.influenceByIdeo(q)[s5] || 0) - g.totalInfluence(q) * 0.1;
            if (v > bv5) { bv5 = v; best = ci; }
          });
          return { idx: best };
        }
        default:
          return null;
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
