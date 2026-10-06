#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

async function main() {
  const dir = path.resolve('reports/analysis');
  const files = await fs.readdir(dir);
  const sweepFiles = files.filter(f => f.startsWith('parameter-sweep-') && f.endsWith('.json'));
  const summary = [];
  for (const f of sweepFiles) {
    const content = await fs.readFile(path.join(dir, f), 'utf8');
    let data;
    try { data = JSON.parse(content); } catch (e) { continue; }
    if (!Array.isArray(data) || data.length === 0) continue;
    // choose best by highest expectancy
    let best = data[0];
    for (const row of data) {
      if ((row.expectancy ?? -Infinity) > (best.expectancy ?? -Infinity)) best = row;
    }
    summary.push({ file: f, best });
  }

  // Build markdown
  const lines = [
    '# Parameter Sweep Summary',
    `Generated: ${new Date().toISOString()}`,
    '',
  ];
  for (const s of summary) {
    lines.push(`## ${s.file}`);
    lines.push('');
    lines.push(`- Best config: ATR=${s.best.atr}, Reward=${s.best.reward}`);
    lines.push(`- Trades: ${s.best.trades}`);
    lines.push(`- Expectancy: ${s.best.expectancy != null ? (s.best.expectancy >= 0 ? '+' : '') + (s.best.expectancy.toFixed(3)) + '%' : 'n/a'}`);
    lines.push(`- Profit factor: ${s.best.profitFactor ?? 'n/a'}`);
    lines.push('');
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'parameter-sweep-summary.md'), lines.join('\n'), 'utf8');
  console.log('Wrote parameter-sweep-summary.md');
}

main().catch(e => { console.error(e); process.exit(1); });
