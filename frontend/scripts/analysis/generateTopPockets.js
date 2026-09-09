#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

async function readJson(p) { try { return JSON.parse(await fs.readFile(p,'utf8')); } catch (e) { return null; } }

function parseSweepFilename(fname){
  // parameter-sweep-<strategy>-<symbol>-<timeframe>(-suffix).json
  const base = path.basename(fname, '.json');
  const parts = base.split('-');
  // remove 'parameter','sweep'
  parts.shift(); parts.shift();
  const strategy = parts.shift();
  const timeframe = parts.pop();
  const symbol = parts.join('-');
  return { strategy, symbol: symbol.replace(/-/g,'/'), timeframe, fname };
}

async function main(){
  const dir = path.resolve('reports/analysis');
  const files = await fs.readdir(dir);
  const sweepFiles = files.filter(f=>f.startsWith('parameter-sweep-') && f.endsWith('.json'));
  const histDir = path.join(dir, 'histograms');
  const diag = await readJson(path.join(dir,'strategy-diagnostics.json'));

  const entries = [];
  for (const f of sweepFiles) {
    const fp = path.join(dir,f);
    const data = await readJson(fp);
    if (!Array.isArray(data) || data.length===0) continue;
    // pick best (max expectancy)
    let best = data[0];
    for (const r of data) {
      if ((r.expectancy ?? -Infinity) > (best.expectancy ?? -Infinity)) best = r;
    }
    const meta = parseSweepFilename(f);
    entries.push({ file: f, path: fp, strategy: meta.strategy, symbol: meta.symbol, timeframe: meta.timeframe, suffix: f.replace(`parameter-sweep-${meta.strategy}-${f.split(meta.timeframe)[0]}`,'').replace('.json',''), best });
  }

  const byStrategy = {};
  for (const e of entries) {
    byStrategy[e.strategy] = byStrategy[e.strategy] || [];
    byStrategy[e.strategy].push(e);
  }

  const topN = 3;
  const lines = [];
  lines.push('# Top Market/Timeframe Pockets per Strategy');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  for (const [strategy, list] of Object.entries(byStrategy)){
    lines.push(`## ${strategy}`);
    lines.push('');
    const sorted = list.slice().sort((a,b)=> (b.best.expectancy ?? -Infinity) - (a.best.expectancy ?? -Infinity));
    const top = sorted.slice(0, topN);
    if (top.length === 0) { lines.push('- No sweep data available.'); lines.push(''); continue; }
    for (const t of top) {
      // try to load histogram for strategy
      const histName = `${t.strategy}-mae-mfe-hist.json`;
      const hist = await readJson(path.join(histDir, histName));
      const maeMean = hist?.maeStats?.mean ?? null;
      const mfeMean = hist?.mfeStats?.mean ?? null;
      lines.push(`- **${t.symbol} ${t.timeframe}** — Expectancy: ${t.best.expectancy != null ? (t.best.expectancy>=0?'+':'')+t.best.expectancy.toFixed(3)+'%' : 'n/a'}; Trades: ${t.best.trades}; PF: ${t.best.profitFactor ?? 'n/a'}`);
      if (maeMean != null || mfeMean != null) {
        lines.push(`  - MAE mean: ${maeMean != null ? maeMean.toFixed(4)+'%' : 'n/a'} — MFE mean: ${mfeMean != null ? mfeMean.toFixed(4)+'%' : 'n/a'}`);
      }
      // link to sweep file
      lines.push(`  - Sweep file: ${t.file}`);
      // add short rationale
      const diagEntry = diag?.strategies?.find(s => s.id === t.strategy || s.name === t.strategy) || null;
      if (diagEntry) {
        lines.push(`  - Diagnosis: ${diagEntry.diagnosis || diagEntry.verdict || 'n/a'}`);
      }
      lines.push('');
    }
  }

  const outPath = path.join(dir, 'top-pockets.md');
  await fs.writeFile(outPath, lines.join('\n'),'utf8');
  console.log('Wrote', outPath);
}

main().catch(e=>{ console.error(e); process.exit(1); });
