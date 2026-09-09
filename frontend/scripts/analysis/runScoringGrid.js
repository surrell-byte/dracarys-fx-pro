#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { fetchCandles } from '../scheduler/candles.js';
import { runBacktest } from '../../src/js/analysis/backtestEngine.js';

function parseArgs(argv) {
  const args = { strategy: null, symbol: 'BTC/USDT', assetClass: 'crypto', timeframe: '5m', limit: 2000, atrs: '1.0,1.2', rewards: '1.5,2.5', volumes: '0.5,1.0,1.5', lookbacks: '5,10,20' };
  for (let i=0;i<argv.length;i+=1) {
    if (argv[i] === '--strategy') args.strategy = argv[++i];
    if (argv[i] === '--symbol') args.symbol = argv[++i];
    if (argv[i] === '--assetClass') args.assetClass = argv[++i];
    if (argv[i] === '--timeframe') args.timeframe = argv[++i];
    if (argv[i] === '--limit') args.limit = Number(argv[++i]);
    if (argv[i] === '--atrs') args.atrs = argv[++i];
    if (argv[i] === '--rewards') args.rewards = argv[++i];
    if (argv[i] === '--volumes') args.volumes = argv[++i];
    if (argv[i] === '--lookbacks') args.lookbacks = argv[++i];
  }
  return args;
}

function pct(n, digits=3) { return n==null ? 'n/a' : `${n>=0?'+':''}${n.toFixed(digits)}%`; }

async function main(){
  const args = parseArgs(process.argv.slice(2));
  if (!args.strategy) { console.error('Pass --strategy'); process.exit(1); }
  console.log('Fetching candles once for', args.symbol);
  const candles = await fetchCandles({ symbol: args.symbol, timeframe: args.timeframe, limit: args.limit, assetClass: args.assetClass });
  console.log('Got', candles.length, 'candles');

  const atrList = args.atrs.split(',').map(Number);
  const rewardList = args.rewards.split(',').map(Number);
  const volumes = args.volumes.split(',').map(Number);
  const lookbacks = args.lookbacks.split(',').map(Number);

  const outDir = path.resolve('reports/analysis');
  await fs.mkdir(outDir, { recursive: true });

  for (const vol of volumes) {
    for (const lk of lookbacks) {
      const results = [];
      for (const atr of atrList) {
        for (const reward of rewardList) {
          const strategyOverrides = { atrStopMultiplier: atr, rewardMultiple: reward, volumeRatio: vol, lookback: lk };
          const result = await runBacktest(candles, { strategyIds: [args.strategy], payoutRatio: reward, extraStrategyConfig: { [args.strategy]: strategyOverrides }, assetClass: null });
          const row = result.spotLeaderboard.find(r => r.strategy === args.strategy) || {};
          results.push({ atr, reward, vol, lk, trades: row.trades, expectancy: row.expectancy, profitFactor: row.profitFactor });
          console.log(`vol=${vol}, lk=${lk}, atr=${atr}, reward=${reward} -> trades=${row.trades}, exp=${pct(row.expectancy)}`);
        }
      }
      const outPath = path.resolve(`${outDir}/parameter-sweep-${args.strategy}-${args.symbol.replace('/','-')}-${args.timeframe}-vol${vol}-lk${lk}.json`);
      await fs.writeFile(outPath, JSON.stringify(results,null,2),'utf8');
      console.log('Saved', outPath);
    }
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
