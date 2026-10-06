# Strategy Playbook

This page explains when each strategy is intended to be used, what it is
actually looking for, and how to operate it. It is a decision aid for paper
trading and research, not a promise of profitability.

## Operating Rules

1. Select the market and timeframe before selecting a strategy.
2. Wait for a closed candle and confirm the higher-timeframe trend when the
   strategy requires it.
3. Treat confidence as a ranking score, not as a probability.
4. Use the displayed ATR stop and target as a complete trade plan. Do not move
   the stop farther away to rescue a losing trade.
5. Record the signal, regime, entry, exit reason, and result in the journal.
6. Keep a strategy in paper mode until it has a positive net result across
   multiple timestamped walk-forward folds and market conditions.

## Strategy Guide

| Strategy | Best environment | What it uses | Avoid when | Current evidence |
|---|---|---|---|---|
| Balanced | Mixed conditions where no single factor dominates | Weighted trend, momentum, RSI, bands, pattern, levels, and ADX inputs | Costs are large relative to the target or signals disagree | Net-negative in the latest report; cost failure |
| Trend Follow | Sustained directional movement | Trend and momentum receive the largest weights, with ADX confirmation | Price is ranging or repeatedly crossing its moving averages | Gross-positive but net-negative; cost failure |
| Mean Reversion | Established ranges and stretched price | RSI, Bollinger bands, support/resistance, and a negative ADX bias | Strong breakouts or persistent trends | Net-negative in the latest report |
| Breakout | Range expansion through meaningful support or resistance | Levels, momentum, trend, bands, and ADX | Low-volume congestion and false-breakout conditions | Gross-positive but net-negative; cost failure |
| Scalping | Short-lived intraday moves with unusually low execution friction | Momentum, RSI, patterns, bands, and trend | Wide spreads, thin liquidity, and targets smaller than total costs | Net-negative in the latest report |
| Pullback (Fib) | Trend continuation after a retracement | Trend, Fibonacci levels, momentum, and price-action confirmation | No clear trend or a pullback that breaks the invalidation level | Gross-positive but net-negative; cost failure |
| Momentum | Fast directional acceleration | Momentum and trend, with ADX support | Late moves, exhausted price, or weak volume | Negative net and gross evidence; insufficiently reliable |
| Range Trading | Repeating oscillation between support and resistance | RSI, bands, levels, and low-ADX regime detection | Range expansion or a confirmed trend | Net-negative in the latest report |
| EMA165 SAR ROC21 | Directional moves confirmed by long EMA, Parabolic SAR, and ROC | EMA165, SAR, ROC21, ADX, and volume context | Flat markets and conflicting SAR/ROC readings | Net-negative in the latest report |
| Trend Following 2 (EMA 50/200) | Higher-timeframe trend continuation | EMA50/EMA200 alignment plus the higher-timeframe trend filter | Higher-timeframe neutral or opposing trend | Net-negative; signal/exit failure |
| Breakout 2 (Volume Confirmed) | Breakouts with clear volume confirmation | Breakout structure, volume ratio, ADX, and volatility | Breakout without volume expansion | Net-negative; cost and exit risk |
| Mean Reversion 2 (RSI Range) | RSI-defined range extremes | RSI range behavior, levels, bands, ADX, and volume | Strong trend or RSI staying pinned at an extreme | Net-negative; small evidence sample |
| EMA Pullback (ADX Filter) | Pullbacks inside a strong EMA20/EMA50 trend | EMA alignment, wick-and-close pullback trigger, ADX, and higher-timeframe trend | Weak ADX, opposing higher-timeframe trend, or deep invalidation | Net-negative; signal/exit failure |
| AI Confidence Pipeline | Comparative signal ranking across mixed evidence | Independent indicator and smart-money votes, volatility/regime weighting | Treating its score as a calibrated probability or trading every vote | Research-only: zero scored spot trades in the current multi-week study; threshold/calibration work required |

## Risk and Exit Model

The engine creates an ATR-based stop and an R-multiple target. The research
and paper scheduler now use the same `60`-candle maximum hold and conservative
stop-first rule when a candle touches both levels. A timeout is an exit, not a
signal reversal.

The backtester evaluates the candle high/low, not only its close. This is more
conservative about intrabar stop hits, but OHLC data cannot prove whether a
stop or target was reached first when both are inside one candle.

## Research Gate

A strategy is not live-eligible merely because one fold or one market is
profitable. Require:

- continuous timestamp validation for every requested market/timeframe;
- full indicator warm-up and closed higher-timeframe context;
- several non-overlapping out-of-sample folds;
- positive net expectancy after spread, slippage, and fees;
- enough trades to make the estimate meaningful;
- no unresolved signal, cost, stop, or holding-period diagnosis;
- exchange-side protective exits and position reconciliation.

Run the gate with:

```bash
npm --prefix frontend run live-readiness
```

The command is intentionally fail-closed. The current report should remain
blocked until performance and live execution protection improve.
