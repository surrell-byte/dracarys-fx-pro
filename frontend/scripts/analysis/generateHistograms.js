#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';

function parseCsv(content) {
  const lines = content.trim().split('\n');
  const header = lines.shift().split(',');
  return lines.map(l => {
    const cols = l.split(',');
    const obj = {};
    for (let i = 0; i < header.length; i++) obj[header[i]] = cols[i] === '' ? null : cols[i];
    return obj;
  });
}

function toNumber(v) { if (v == null) return null; const n = Number(v); return Number.isNaN(n) ? null : n; }

function stats(arr) {
  const vals = arr.filter(v => v != null).map(Number);
  if (vals.length === 0) return null;
  const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
  const sorted = vals.slice().sort((a,b)=>a-b);
  const median = sorted[Math.floor(sorted.length/2)];
  const sq = vals.reduce((a,b)=>a+(b-mean)*(b-mean),0);
  const std = Math.sqrt(sq/vals.length);
  return { count: vals.length, mean, median, std, min: sorted[0], max: sorted[sorted.length-1] };
}

function makeBins(vals, binCount=40) {
  const nums = vals.filter(v => v != null).map(Number);
  if (nums.length === 0) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const binSize = range / binCount;
  const bins = new Array(binCount).fill(0);
  for (const v of nums) {
    const idx = Math.min(binCount-1, Math.floor((v - min) / binSize));
    bins[idx] += 1;
  }
  const edges = [];
  for (let i=0;i<binCount;i++) edges.push(min + i*binSize);
  return { bins, edges, binSize };
}

async function processStrategy(csvPath, outDir) {
  const name = path.basename(csvPath).replace('-trades.csv','');
  const content = await fs.readFile(csvPath,'utf8');
  const rows = parseCsv(content);
  const mae = rows.map(r => toNumber(r.maePercent));
  const mfe = rows.map(r => toNumber(r.mfePercent));
  const maeStats = stats(mae);
  const mfeStats = stats(mfe);
  const maeBins = makeBins(mae);
  const mfeBins = makeBins(mfe);
  await fs.mkdir(outDir, { recursive: true });
  const outJson = { strategy: name, maeStats, mfeStats, maeBins, mfeBins };
  await fs.writeFile(path.join(outDir, `${name}-mae-mfe-hist.json`), JSON.stringify(outJson,null,2),'utf8');

  // small markdown summary with ASCII histogram
  const lines = [];
  lines.push(`# MAE/MFE Histogram Summary — ${name}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push('');
  if (maeStats) {
    lines.push('## MAE (percent)');
    lines.push(`- count: ${maeStats.count}`);
    lines.push(`- mean: ${maeStats.mean.toFixed(4)}%`);
    lines.push(`- median: ${maeStats.median.toFixed(4)}%`);
    lines.push(`- std: ${maeStats.std.toFixed(4)}%`);
    lines.push('');
    if (maeBins) {
      const max = Math.max(...maeBins.bins);
      for (let i=0;i<maeBins.bins.length;i++){
        const edge = maeBins.edges[i];
        const count = maeBins.bins[i];
        const bar = '#'.repeat(Math.round((count/max)*40));
        lines.push(`${edge.toFixed(4)} | ${count.toString().padStart(4)} ${bar}`);
      }
    }
  }
  lines.push('');
  if (mfeStats) {
    lines.push('## MFE (percent)');
    lines.push(`- count: ${mfeStats.count}`);
    lines.push(`- mean: ${mfeStats.mean.toFixed(4)}%`);
    lines.push(`- median: ${mfeStats.median.toFixed(4)}%`);
    lines.push(`- std: ${mfeStats.std.toFixed(4)}%`);
    lines.push('');
    if (mfeBins) {
      const max = Math.max(...mfeBins.bins);
      for (let i=0;i<mfeBins.bins.length;i++){
        const edge = mfeBins.edges[i];
        const count = mfeBins.bins[i];
        const bar = '#'.repeat(Math.round((count/max)*40));
        lines.push(`${edge.toFixed(4)} | ${count.toString().padStart(4)} ${bar}`);
      }
    }
  }
  await fs.writeFile(path.join(outDir, `${name}-mae-mfe-hist.md`), lines.join('\n'),'utf8');
  return { json: path.join(outDir, `${name}-mae-mfe-hist.json`), md: path.join(outDir, `${name}-mae-mfe-hist.md`) };
}

async function main() {
  const outDir = path.resolve('reports/analysis/histograms');
  const strategies = ['scalping','momentum','emaPullbackAdx','breakout'];
  const base = path.resolve('reports/analysis');
  const results = [];
  for (const s of strategies) {
    const csv = path.join(base, `${s}-trades.csv`);
    try {
      const res = await processStrategy(csv, outDir);
      console.log('Wrote', res.json, res.md);
      results.push(res);
    } catch (e) {
      console.error('Failed for', s, e.message);
    }
  }
  console.log('Done');
}

main().catch(e=>{ console.error(e); process.exit(1); });
