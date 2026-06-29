/* Nodeでの自動対戦検証: AIのみでN戦回し、クラッシュ/無限ループ/異常を検出。
   実行: node test_autoplay.js [回数] */
const DATA = require('./data.js');
global.PL_DATA = DATA;
const ENGINE = require('./engine.js');
const AI = require('./ai.js');

async function runOne(seed, nplayers) {
  const cfg = { seed, players: Array.from({ length: nplayers }, (_, i) => ({ name: 'P' + i, isAI: true })) };
  const g = new ENGINE.Game(cfg);
  const ai = AI.makeAI();
  // 安全弁: ターン上限で打ち切り(無限ループ検出)
  const origRun = g.run.bind(g);
  await origRun(ai);
  return g;
}

(async () => {
  const N = parseInt(process.argv[2] || '50', 10);
  let ok = 0, fail = 0, wins = 0, timeouts = 0;
  const turnsArr = [], winners = {}, reasons = {};
  for (let i = 0; i < N; i++) {
    const np = 3 + (i % 2); // 3 or 4
    const seed = 1000 + i;
    try {
      const g = await Promise.race([
        runOne(seed, np),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 8000)),
      ]);
      ok++;
      turnsArr.push(g.turn);
      if (g.winner) {
        wins++;
        const last = g.log[g.log.length - 1].text;
        const m = last.match(/\((.*)\)/);
        const r = m ? m[1] : '?';
        reasons[r] = (reasons[r] || 0) + 1;
      } else {
        timeouts++;
      }
    } catch (e) {
      fail++;
      console.error(`FAIL seed=${seed} np=${np}: ${e.stack || e}`);
      if (fail >= 4) { console.error('中断: 失敗が多すぎる'); break; }
    }
  }
  const avg = turnsArr.length ? (turnsArr.reduce((a, b) => a + b, 0) / turnsArr.length).toFixed(1) : 0;
  console.log(`\n=== ${ok}/${N} games OK, ${fail} crash ===`);
  console.log(`勝者決定: ${wins} / ターン上限到達(未決): ${timeouts}`);
  console.log(`平均ターン数: ${avg}  最大: ${Math.max(...turnsArr, 0)}`);
  console.log('勝因内訳:', reasons);
})();
