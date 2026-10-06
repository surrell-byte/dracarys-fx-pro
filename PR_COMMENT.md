Pipeline summary

- Tests: ✅ all tests passed (28 files, 259 tests)
- Build: ✅ frontend build successful (vite dist produced)
- Walk‑forward: ✅ research saved to `frontend/reports/analysis/multi-market-walk-forward.json`
- Scorecards: ✅ generated (research audit saved)
- Diagnostics: ✅ `frontend/reports/analysis/strategy-diagnostics.md` and `.json` regenerated using new classifier

Files changed in branch `diagnostics/classifier-edge-improvements`:
- `frontend/src/js/analysis/strategyDiagnostics.js` (new)
- `frontend/tests/strategyDiagnostics.test.js` (new)
- `frontend/reports/analysis/strategy-diagnostics.md` (generated, included for review)
- `frontend/reports/analysis/strategy-diagnostics.json` (generated)

Notes
- Exit-reason names are normalised and classifier now separates SIGNAL/COST/EXIT failure categories.
- If you want visual snapshots, attach `strategy-diagnostics.html` and `strategy-diagnostics.pdf` (place them in `frontend/reports/analysis/` then add to this PR or upload via GitHub UI).

Commands to reproduce locally

```
cd frontend
npm test
npm run build
npm run walk-forward -- --limit 1000 --folds 3 --warmup 320
npm run scorecards
npm run strategy-diagnostics
```

Attach snapshots by uploading `frontend/reports/analysis/strategy-diagnostics.html` and `.pdf` to this PR.
