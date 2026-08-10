# Dracarys FX Pro

A trading-analysis platform combining a live signal dashboard, a 14-strategy
signal engine (indicators, price action, smart-money concepts, and market
regime detection), a backtester, a 24/7 paper-trading scheduler, and a
reporting layer.

**Current status: research / paper-trading platform.** Live order execution
exists but does not attach real exchange stop-loss/take-profit brackets - see
[Live trading](#live-trading-status) before enabling it with real funds.

## Architecture

```
                MARKET DATA (Binance crypto / Twelve Data FX)
                              │
                    UnifiedMarketDataService
                              │
              ┌───────────────┴───────────────┐
              │                                │
          WEB APP                          SCHEDULER
    (Vite SPA - dashboard,              (Node - 24/7 polling,
     chart, paper trading,               SQLite, virtual trades,
     journal, strategy lab)              portfolio risk, reports)
              │                                │
              └───────────────┬────────────────┘
                               │
                        SIGNAL ENGINE
              (14 strategies · indicators · SMC ·
               regime detection · AI confidence pipeline)
                               │
                    RISK ENGINE (ATR-based sizing)
                               │
              ┌────────────────┴────────────────┐
              │                                  │
        PAPER ENGINE                       LIVE ENGINE
   (realistic execution costs)     (authenticated, rate-limited,
                                     kill-switched - see below)
```

Both the live scheduler and the backtester call the **same**
`generateSignal(candles, strategyId)` - there's no separate/duplicated
backtest logic that can quietly drift from what's actually deployed.

### Directory layout

```
frontend/
  src/js/
    analysis/       backtest engine, execution-cost model, performance
                     stats, binary outcome tracker, payout/edge math
    indicators/      EMA, RSI, MACD, ADX, ATR, Bollinger, Stochastic
    signals/         signalEngine.js (strategy definitions + orchestration)
    smartMoney/      order blocks, FVGs, liquidity sweeps, breaker blocks
    marketRegime/    trending / ranging / breakout / high-vol classification
    risk/            ATR-based stop distance, regime-adjusted stops, sizing
    ai/              confidence-pipeline scoring (NOT a calibrated
                     probability model - see Statistics below)
    core/            app.js - DOM wiring, chart, paper trading, UI state
    services/        market data adapters (Binance, Twelve Data)
  scripts/scheduler/  24/7 Node scheduler: candles.js, virtualTrades.js,
                       portfolioRisk.js, db.js, runScheduler.js
  api/                Vercel serverless functions (proxy to backend,
                       report endpoints)
  tests/              Vitest suite (see Testing below)
backend/
  services/           Express server exposing /trade (live order execution)
scripts/
  check-imports.js    Validates every relative/aliased import resolves
```

## Setup

### Prerequisites
- Node.js 20+
- npm

### Install

```bash
npm --prefix frontend install
npm --prefix backend install   # only needed if you'll run live trading
```

### Environment variables

Copy `frontend/.env.example` to `frontend/.env` and fill in your own values.
**Never commit `.env` or share a project archive containing it** - `.gitignore`
and `zip-project.sh` both exclude it, but always double-check before sharing
a zip or repo.

| Variable | Used by | Purpose |
|---|---|---|
| `TWELVE_DATA_API_KEY` | scheduler, frontend | FX candle data |
| `DISCORD_WEBHOOK_URL` | scheduler | Trade/report notifications (treat as a credential - anyone with the URL can post to your channel) |
| `REPORTS_API_USER` / `REPORTS_API_PASSWORD` | api/live-reports.js | Basic auth on the reports proxy |
| `TRADE_API_KEY` | backend/services/server.js | Auth for the `/trade` endpoint |
| `LIVE_TRADING` | backend/services/server.js | Must be explicitly `true` to allow real orders - see below |

### Development

```bash
npm run dev              # runs check-imports, then starts the Vite dev server
npm --prefix frontend run scheduler   # runs the 24/7 paper-trading scheduler
```

### Build

```bash
npm run build             # check-imports + vite build -> frontend/dist
```

### Testing

```bash
npm --prefix frontend test          # run once
npm --prefix frontend run test:watch # watch mode
```

The suite covers the pure/testable core: indicators (including a Wilder-ADX
regression test), the execution-cost model, performance statistics
(expectancy/drawdown/Sharpe), the portfolio risk gate, the paper-trading exit
engine (intrabar SL/TP), and the binary outcome tracker's symbol-scoping and
calibration logic - plus, as of this pass, a jsdom-based behavioral suite for
`app.js` itself (`tests/app.behavior.test.js`): it loads the real
`index.html`, mocks only the network-touching collaborators (market data
service, higher-timeframe fetch), and drives the app through actual clicks
and market-callback events (boot, manual paper trade open/close, intrabar
TP/SL auto-close, strategy switching, history clearing). It does **not**
cover the live scheduler's IO (network/SQLite) - that's integration-level
and not yet automated; see [Known gaps](#known-gaps).

Writing that suite caught a real bug on the first run, worth calling out:
`index.html`'s "upgrade-dashboard" redesign had dropped the `#pairSelect`
and `#strategySelect` elements that `app.js` wires up unconditionally at
module load. With them missing, `elements.pairSelect.addEventListener(...)`
threw immediately and **nothing in `app.js` after that line ever ran** - the
app never actually booted in a browser, even though `vite build` succeeded
(bundling doesn't execute the code, so it couldn't have caught this). Fixed
by restoring both selects (14 pairs across crypto/forex, all 14 strategies)
into the dashboard page, styled with the existing `.backtest-controls` CSS.
This is exactly the class of bug DOM-level tests exist to catch and unit
tests on isolated modules cannot.

CI (`.github/workflows/ci.yml`) runs `check-imports`, the test suite, and a
production build on every push/PR.

## Deployment

- **Frontend**: Vercel. `frontend/api/trade.js` proxies trade requests to the
  backend so the backend's `TRADE_API_KEY` never reaches the browser, and
  `frontend/api/live-reports.js` / `report-history.js` proxy report data
  behind an allowlist.
- **Backend**: any Node host reachable from Vercel's serverless functions
  (a small VM works fine - see `setup-gcp-vm.sh` / `setup-gcp-https.sh` for
  a reference GCP setup). Must be reachable over HTTPS with `TRADE_API_KEY`
  set; do not expose it without that key configured.

## Live trading status

Read this before setting `LIVE_TRADING=true` against a real account.

- The `/trade` endpoint is authenticated (`TRADE_API_KEY`), CORS-restricted,
  rate-limited, validates order parameters, enforces a hard max order size,
  and requires the explicit `LIVE_TRADING=true` kill switch.
- **However:** stop-loss/take-profit levels are **not** attached as real
  exchange bracket/OCO orders. The app computes and displays SL/TP levels,
  but the actual order sent to the exchange is a plain market order. If the
  scheduler process, VM, or network goes down after entry, an open live
  position has no exchange-side protection.
- Paper trading and backtesting are safe to use as-is. Treat live trading as
  not production-ready for unattended real-money use until real bracket/OCO
  orders are implemented.

## Statistics & calibration

- **"Confidence" is a signal distribution, not a calibrated probability.**
  A `BUY 64%` reading means 64% of the model's scoring mass points toward
  BUY - it is not a claim that price has a 64% chance of going up. The app's
  confidence-calibration table (Strategy Lab → Binary Mode → Confidence
  Calibration) buckets resolved trades by their stated confidence and shows
  the *actual* win rate observed in each bucket, so you can see how far off
  calibration currently is and track it over time.
- Backtest and paper-trading stats both go through the same execution-cost
  model (`analysis/executionCosts.js`: spread + slippage + fee, tuned per
  asset class) so the two are directly comparable rather than the backtest
  being systematically more optimistic.
- The Strategy Lab's backtest panel supports a walk-forward mode: splits
  history into sequential, non-overlapping folds and reruns the backtest
  independently on each, so you can see whether a strategy's edge is stable
  across periods or concentrated in one lucky segment.
- Binary-mode win-rate stats are scoped to the currently selected symbol by
  default (pass `{ allSymbols: true }` to `getBinaryStats()` for the old
  pooled-across-everything view) - this used to silently mix different
  markets' win rates under the same strategy/expiry key.
- SMC feature value: `scripts/analysis/smcAblationTest.js` runs the AI
  Confidence Pipeline strategy's backtest with each smart-money module
  (order blocks, FVGs, liquidity sweeps, breaker blocks, mitigation) voting
  vs. excluded, and compares expectancy/profit-factor/Sharpe against the
  baseline - so "does this feature actually add predictive value" (the
  original review's question) has a concrete, repeatable answer instead of
  an assumption. Run it with `npm run smc-ablation -- --symbol BTC/USDT
  --timeframe 1m --limit 5000` (see the script header for all flags). The
  underlying `excludeVoteModules` hook only affects the `aiConfidence`
  strategy and defaults to including everything, so it has zero effect on
  normal signal generation.

## Known gaps

Carried over from the original architecture review, roughly in priority
order of what's left:

- No automated tests for the live scheduler's IO paths (network, SQLite) -
  only the pure logic modules and `app.js`'s DOM wiring are covered now.

  **Update:** this is now covered. Four new test files exercise the
  scheduler's IO boundaries with everything mocked or pointed at a
  throwaway resource, so no test hits a real exchange, Twelve Data, or
  the real `frontend/data/signals.db`:
  - `tests/schedulerDb.test.js` runs `db.js` against a real, disposable
    SQLite file (via `SCHEDULER_DB_PATH` pointed at an OS temp path) -
    insert/read/close/report-snapshot-upsert, including the limit-bounds
    behavior on `getRecentClosedSignals` and the daily/weekly report
    dedup key.
  - `tests/candles.test.js` mocks `ccxt`'s Binance client and the global
    `fetch` used for Twelve Data, covering the crypto happy path, forex's
    missing-API-key guard, its newest-first-to-oldest-first reversal,
    null-vs-numeric volume handling, and both of Twelve Data's error
    shapes.
  - `tests/notify.test.js` mocks `fetch` for the Discord webhook call:
    no-webhook-configured (skips, no call attempted), success, a non-ok
    HTTP response, and a thrown network error - all resolving to `false`
    rather than throwing, since a notification failure must never take
    the scheduler down.
  - `tests/runScheduler.test.js` mocks every dependency `scanSymbol()`
    touches (candles, db, virtual-trade decisions, portfolio risk,
    execution costs, notify, signalEngine) to test the orchestration
    itself: candle-fetch failure and empty-response short-circuits, the
    still-forming-candle drop, the already-open-position and
    portfolio-risk-rejected skip paths, the insert-then-notify path (and
    its below-threshold silent variant), and that an existing open
    trade's exit is resolved (with correct same-candle vs. new-candle
    hold-counter behavior) before any new signal is generated for that
    symbol.

  Exporting `scanSymbol` (previously module-private) for the last of
  these needed one behavioral safeguard: `runScheduler.js` used to call
  `main()` unconditionally at the bottom of the file, so simply
  `import`-ing it for a test would start the real polling loop, cron
  jobs, and network calls. It's now gated behind
  `process.env.SCHEDULER_SKIP_AUTOSTART !== "1"` (tests set that var
  before importing). An `import.meta.url`/`process.argv[1]`
  "am I the entry module" check was tried first and reverted - `vite-node
  scripts/scheduler/runScheduler.js` (this script's own documented way of
  being run) does not preserve the script's path in `process.argv`, so
  that check would have silently disabled the scheduler under its normal,
  real invocation. The explicit opt-out env var has no such ambiguity and
  was verified against both the real `vite-node` invocation (still
  auto-starts) and the test suite (does not).
- `app.js` decomposition, pass 1: the pure formatting helpers
  (`formatPrice`/`formatNumber`/`formatCurrency`/`formatSigned`) moved to
  `core/format.js`, and chart drawing (`drawChart`/`resizeCanvas`) moved to
  `core/chart.js` - the two lowest-risk, most self-contained pieces.
- `app.js` decomposition, pass 2: paper-trading position sizing, execution,
  and stop/target enforcement (`resolveQuantity`, `isCoolingDown`,
  `executePaperTrade`, `checkPaperStops`, `resetPaperAccount`, plus a new
  `closePaperPositionManually`) moved to `core/paperTrading.js`. The
  state-mutating functions take the `paper` object and small
  `{ openPosition, closePosition }` dependencies as explicit parameters
  instead of reaching into app.js's module-level `state`, so they're
  independently testable. This pass also fixed a small duplication: the
  manual "Close Position" button used to hand-copy the same five-field
  reset that `checkPaperStops` already did; both now go through one shared
  `closeAndClear` helper.
  `app.js` is down to ~1,300 lines (from ~1,470 pre-decomposition); still
  handles market wiring, signal rendering, the strategy tester/binary
  tracker UI, and backtest rendering, and remains the largest file in the
  project. Each pass was verified via `check-imports`, the full test suite
  (including `app.behavior.test.js`'s DOM suite as a golden-output
  regression check) and a production build before/after, plus new direct
  unit tests for every extracted module (`tests/format.test.js`,
  `tests/chart.test.js`, `tests/paperTrading.test.js`,
  `tests/labels.test.js`).
- `app.js` decomposition, pass 3: `intervalToMinutes`, `expiryLabel`, and
  the binary-stats badge helpers (`clampPayoutRatio`/`edgeClass`/
  `verdictClass`) moved to `core/labels.js`. This pass also removed a real
  duplicate: the live binary-stats table's `expiryLabel(len)` and the
  backtest results table's `backtestExpiryLabel(len, interval)` were two
  hand-written copies of the identical calculation (one reading
  `state.interval` implicitly, one taking it as a parameter). Both call
  sites now go through the single parametrized `expiryLabel`, and
  `tests/labels.test.js` pins that both former call sites now produce
  identical output.
  `app.js` is down to ~1,250 lines (from ~1,470 pre-decomposition).
- `app.js` decomposition, pass 4: `renderTester`, `renderBinaryStats`, and
  `renderCalibrationCurve` moved to `core/testerRender.js`, taking
  `elements`/`tester`/`binaryTracker`/`interval` as explicit parameters.
  `app.js` is down to ~1,170 lines (from ~1,470 pre-decomposition, ~20%
  smaller overall across four passes). New direct tests in
  `tests/testerRender.test.js` (fake DOM elements + fake data sources)
  cover the leaderboard/regime/session/asset tables, the reliable vs.
  not-enough-data binary-stats branches, and the calibration-curve gap
  calculation. Next candidates: backtest result rendering
  (`renderBacktestResults`/`renderWalkForwardResults`), and eventually
  market-data wiring (`loadMarket`/`upsertCandle`/
  `maybeExecute`) as its own controller.
- `app.js` decomposition, pass 5: `renderBacktestResults` and
  `renderWalkForwardResults` moved to `core/backtestRender.js`, taking
  `elements`/`result`/`interval` as explicit parameters. The panel
  show/hide toggling and `lastBacktestResult`/rolling-performance
  bookkeeping stayed in app.js's thin wrappers - those are page-navigation
  and cross-function state concerns, not rendering concerns, so mixing
  them into the extracted module would have re-coupled it to app.js's
  state for no benefit. Also dropped a genuinely-unused `interval`
  parameter from `renderWalkForwardResults` that the original never read.
  `app.js` is down to ~1,080 lines (from ~1,470 pre-decomposition, ~27%
  smaller overall across five passes). New tests in
  `tests/backtestRender.test.js` cover the leaderboard's reliable/
  unreliable-sample branches, the binary-stats table, and the walk-forward
  per-fold table including strategies missing from some folds.
- `app.js` decomposition, pass 6: market-data buffer management and
  auto-execution decision logic moved to `core/candleBuffer.js`
  (`upsertCandle` - tick-replace vs. new-candle-append, trimmed to
  `maxCandles`) and `core/executionDecision.js` (the `maybeExecute`
  gate-checking branch - auto-mode-off / not-ready / low-confidence /
  cooldown / max-loss-reached / paper vs. live - returned as a decision
  object instead of performed directly, so `app.js`'s `maybeExecute` is now
  a thin dispatcher over the decision plus the actual async trade call and
  DOM updates). Also extracted the one genuinely pure piece of
  `updateMarketFromSelection` into `core/marketSelection.js`
  (`resolveMarketSelection`: selected-option data attributes + interval in,
  `{ symbol, apiSymbol, assetClass, marketLabel }` out) - the rest of that
  function (reading `elements.pairSelect`, writing
  `elements.marketLabel.textContent`) stayed in `app.js` since it's DOM
  access, not derivation logic.
  The rest of the market-wiring cluster (`loadMarket`, `init`,
  `loadSelectedMarket`, `refreshHigherTimeframeTrend`,
  `startHtfRefreshTimer`) was deliberately left in `app.js`: it's
  orchestration - sequencing async calls across `market`/`tester`/
  `binaryTracker` and several render functions - not logic with a
  separable pure core. Extracting it into a "controller" module would
  relocate the DOM/state coupling rather than reduce it, at the cost of an
  extra indirection layer; not every function is a good decomposition
  candidate.
  Before this pass, `tests/app.behavior.test.js` was extended with
  coverage for symbol switching (`#pairSelect` change re-fetches and
  updates the market label, disables auto-trade, resets the paper
  account), the higher-timeframe trend render, and an end-to-end
  auto-trade-armed-then-candle-arrives flow - specifically to protect this
  exact cluster before touching it. `app.js` is down to ~1,060 lines (from
  ~1,470 pre-decomposition, ~28% smaller overall across six passes). New
  tests in `tests/marketWiring.test.js` cover both extracted modules,
  including a boundary-condition check on the max-loss comparison and a
  priority-order check matching `app.js`'s original branch order exactly.
  Remaining in app.js: market-data wiring (`loadMarket`/`upsertCandle`/
  `maybeExecute`) - the most state-entangled piece, and probably the last
  one to tackle, since it's woven through `state.candles`/`state.symbol`/
  the live market-service callbacks rather than being a clean
  data-in/HTML-out render function like everything extracted so far.
- Rolling performance is wired into the Strategy Lab (per-strategy, within
  a single backtest run); regime/session performance breakdowns already
  exist for the live paper-trading journal but haven't been cross-checked
  against `computeRollingPerformance`'s definition of a "window".
- The SMC ablation script (above) tells you *whether* a module is earning
  its vote on a given sample - it hasn't actually been run against enough
  real historical data yet to say which specific modules should be
  retired or re-weighted. That's the natural next step once you have
  network access to pull real history.
- Correlation-aware signal weighting is implemented: EMA trend, MACD, the
  RSI trend-continuation vote, and the ADX boost are treated as one "trend
  cluster" rather than four independent confirmations. Whichever of these
  fires first sets `trendClusterSide`; any later cluster member that
  agrees with that side counts at half weight instead of full weight,
  since it's restating information the cluster already has rather than
  adding new information. Bands, fib levels, candle patterns, and
  support/resistance are unaffected - they're not part of the trend
  cluster. Applied to both the live `scoreStrategy` in `signalEngine.js`
  and mirrored into the orphaned `scorers/scoreStrategy.js` copy so the
  two don't drift further apart. Covered by `tests/scoreStrategy.test.js`
  (5 tests: discount-when-agreeing, full-weight-when-disagreeing or when
  no cluster vote has fired yet, and confirming non-cluster signals like
  bands are untouched).
