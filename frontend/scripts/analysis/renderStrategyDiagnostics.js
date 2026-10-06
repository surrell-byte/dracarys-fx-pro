#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(){
  const mdPath = path.resolve('reports/analysis/strategy-diagnostics.md');
  const md = await fs.readFile(mdPath,'utf8');
  let marked;
  try { marked = (await import('marked')).marked; } catch (e) { console.error('Missing dependency: run `npm install marked puppeteer` in frontend'); process.exit(1); }
  const html = marked(md);
  const full = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  body{font-family: Arial, Helvetica, sans-serif; padding:28px; color:#111}
  pre, code{font-family: Menlo, monospace; background:#f6f8fa;padding:4px}
  h1,h2,h3{color:#0b5cff}
  table{border-collapse:collapse}
  table td, table th{border:1px solid #ddd;padding:6px}
  </style></head><body>${html}</body></html>`;
  const outHtml = path.resolve('reports/analysis/strategy-diagnostics.html');
  await fs.writeFile(outHtml, full, 'utf8');
  let puppeteer;
  try { puppeteer = await import('puppeteer'); } catch (e) { console.error('Missing dependency: run `npm install marked puppeteer` in frontend'); process.exit(1); }
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.setContent(full, { waitUntil: 'networkidle0' });
  const pdfPath = path.resolve('reports/analysis/strategy-diagnostics.pdf');
  await page.pdf({ path: pdfPath, format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  const pngPath = path.resolve('reports/analysis/strategy-diagnostics.png');
  await page.screenshot({ path: pngPath, fullPage: true });
  await browser.close();
  console.log('Wrote', pdfPath, pngPath, outHtml);
}

main().catch(e=>{ console.error(e); process.exit(1); });
