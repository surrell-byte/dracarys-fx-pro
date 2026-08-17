# Strategy Diagnostics

Generated: 2026-08-16T23:39:30.866Z

## Research Integrity

- Method: rolling-origin-out-of-sample-evaluation
- Optimisation performed: no
- Market/timeframe combinations: 12 / 12
- All folds have full warm-up: YES
- All required HTF context available: YES

## Diagnostic Summary

- Strategies analysed: 13
- Signal failures: undefined
- Cost failures: undefined
- Regime dependent: undefined
- Confidence sensitive: undefined

## Strategy Diagnosis

| Strategy | Trades | Gross Exp. | Net Exp. | Cost Drag | PF | Diagnosis | Recommendation |
|---|---:|---:|---:|---:|---:|---|---|
| EMA Pullback (ADX Filter) | 141 | -0.051% | -0.181% | -0.130% | 0.03 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Trend Following 2 (EMA 50/200) | 222 | -0.002% | -0.204% | -0.202% | 0.17 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Pullback (Fib) | 472 | -0.032% | -0.235% | -0.203% | 0.07 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Mean Reversion 2 (RSI Range) | 36 | -0.001% | -0.236% | -0.235% | 0.12 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Breakout | 407 | -0.025% | -0.237% | -0.212% | 0.07 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Mean Reversion | 67 | -0.028% | -0.245% | -0.217% | 0.05 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| EMA165 SAR ROC21 | 394 | -0.029% | -0.254% | -0.225% | 0.10 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Range Trading | 75 | -0.034% | -0.261% | -0.227% | 0.05 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Scalping | 197 | -0.008% | -0.263% | -0.255% | 0.11 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Trend Follow | 153 | -0.055% | -0.264% | -0.209% | 0.15 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Balanced | 90 | -0.059% | -0.306% | -0.247% | 0.11 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |
| Momentum | 4 | -0.003% | -0.313% | -0.310% | 0.00 | SIGNAL_FAILURE | The strategy has negative gross expectancy. Do not optimise execution costs yet; investigate the entry/exit logic first. |
| Breakout 2 (Volume Confirmed) | 164 | -0.018% | -0.328% | -0.310% | 0.05 | SIGNAL_AND_EXIT_FAILURE | Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry. |

## EMA Pullback (ADX Filter)

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.051%
- Net expectancy: -0.181%
- Average cost drag: -0.130%

### MAE / MFE

- Average MAE: -0.143%
- Median MAE: -0.082%
- Average MFE: +0.055%
- Median MFE: +0.000%

### Holding Time

- Average candles: 20.8
- Median candles: 7.0
- Winning trades: 38.1 candles average
- Losing trades: 19.9 candles average


### Exit Outcomes

- Winners: 7 (+4.965%)
- Losers: 134 (+95.035%)
- Stop-loss exits: +79.433%
- Take-profit exits: +10.638%
- Timeout exits: +9.929%

### Exit Reason Breakdown

- stop_loss: 112 (+79.433%)
- take_profit: 15 (+10.638%)
- end_of_data: 14 (+9.929%)

## Trend Following 2 (EMA 50/200)

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.002%
- Net expectancy: -0.204%
- Average cost drag: -0.202%

### MAE / MFE

- Average MAE: -0.165%
- Median MAE: -0.087%
- Average MFE: +0.135%
- Median MFE: +0.014%

### Holding Time

- Average candles: 35.0
- Median candles: 9.0
- Winning trades: 66.8 candles average
- Losing trades: 29.2 candles average


### Exit Outcomes

- Winners: 34 (+15.315%)
- Losers: 188 (+84.685%)
- Stop-loss exits: +65.315%
- Take-profit exits: +21.622%
- Timeout exits: +13.063%

### Exit Reason Breakdown

- stop_loss: 145 (+65.315%)
- take_profit: 48 (+21.622%)
- end_of_data: 29 (+13.063%)

## Pullback (Fib)

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.032%
- Net expectancy: -0.235%
- Average cost drag: -0.203%

### MAE / MFE

- Average MAE: -0.163%
- Median MAE: -0.090%
- Average MFE: +0.096%
- Median MFE: +0.004%

### Holding Time

- Average candles: 24.7
- Median candles: 7.0
- Winning trades: 55.0 candles average
- Losing trades: 21.4 candles average


### Exit Outcomes

- Winners: 46 (+9.746%)
- Losers: 426 (+90.254%)
- Stop-loss exits: +69.915%
- Take-profit exits: +22.669%
- Timeout exits: +7.415%

### Exit Reason Breakdown

- stop_loss: 330 (+69.915%)
- take_profit: 107 (+22.669%)
- end_of_data: 35 (+7.415%)

## Mean Reversion 2 (RSI Range)

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.001%
- Net expectancy: -0.236%
- Average cost drag: -0.235%

### MAE / MFE

- Average MAE: -0.154%
- Median MAE: -0.071%
- Average MFE: +0.098%
- Median MFE: +0.021%

### Holding Time

- Average candles: 13.4
- Median candles: 8.0
- Winning trades: 31.9 candles average
- Losing trades: 9.0 candles average


### Exit Outcomes

- Winners: 7 (+19.444%)
- Losers: 29 (+80.556%)
- Stop-loss exits: +61.111%
- Take-profit exits: +33.333%
- Timeout exits: +5.556%

### Exit Reason Breakdown

- stop_loss: 22 (+61.111%)
- take_profit: 12 (+33.333%)
- end_of_data: 2 (+5.556%)

## Breakout

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.025%
- Net expectancy: -0.237%
- Average cost drag: -0.212%

### MAE / MFE

- Average MAE: -0.161%
- Median MAE: -0.095%
- Average MFE: +0.100%
- Median MFE: +0.000%

### Holding Time

- Average candles: 20.3
- Median candles: 7.0
- Winning trades: 32.4 candles average
- Losing trades: 19.0 candles average


### Exit Outcomes

- Winners: 38 (+9.337%)
- Losers: 369 (+90.663%)
- Stop-loss exits: +71.253%
- Take-profit exits: +22.359%
- Timeout exits: +6.388%

### Exit Reason Breakdown

- stop_loss: 290 (+71.253%)
- take_profit: 91 (+22.359%)
- end_of_data: 26 (+6.388%)

## Mean Reversion

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.028%
- Net expectancy: -0.245%
- Average cost drag: -0.217%

### MAE / MFE

- Average MAE: -0.175%
- Median MAE: -0.093%
- Average MFE: +0.087%
- Median MFE: +0.031%

### Holding Time

- Average candles: 8.8
- Median candles: 6.0
- Winning trades: 13.9 candles average
- Losing trades: 7.7 candles average


### Exit Outcomes

- Winners: 12 (+17.910%)
- Losers: 55 (+82.090%)
- Stop-loss exits: +70.149%
- Take-profit exits: +28.358%
- Timeout exits: +1.493%

### Exit Reason Breakdown

- take_profit: 19 (+28.358%)
- stop_loss: 47 (+70.149%)
- end_of_data: 1 (+1.493%)

## EMA165 SAR ROC21

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.029%
- Net expectancy: -0.254%
- Average cost drag: -0.225%

### MAE / MFE

- Average MAE: -0.193%
- Median MAE: -0.116%
- Average MFE: +0.123%
- Median MFE: +0.019%

### Holding Time

- Average candles: 18.3
- Median candles: 7.0
- Winning trades: 31.6 candles average
- Losing trades: 16.6 candles average


### Exit Outcomes

- Winners: 43 (+10.914%)
- Losers: 351 (+89.086%)
- Stop-loss exits: +69.036%
- Take-profit exits: +23.858%
- Timeout exits: +7.107%

### Exit Reason Breakdown

- stop_loss: 272 (+69.036%)
- take_profit: 94 (+23.858%)
- end_of_data: 28 (+7.107%)

## Range Trading

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.034%
- Net expectancy: -0.261%
- Average cost drag: -0.227%

### MAE / MFE

- Average MAE: -0.180%
- Median MAE: -0.105%
- Average MFE: +0.090%
- Median MFE: +0.032%

### Holding Time

- Average candles: 9.6
- Median candles: 6.0
- Winning trades: 13.9 candles average
- Losing trades: 8.8 candles average


### Exit Outcomes

- Winners: 12 (+16.000%)
- Losers: 63 (+84.000%)
- Stop-loss exits: +72.000%
- Take-profit exits: +26.667%
- Timeout exits: +1.333%

### Exit Reason Breakdown

- take_profit: 20 (+26.667%)
- stop_loss: 54 (+72.000%)
- end_of_data: 1 (+1.333%)

## Scalping

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.008%
- Net expectancy: -0.263%
- Average cost drag: -0.255%

### MAE / MFE

- Average MAE: -0.191%
- Median MAE: -0.099%
- Average MFE: +0.148%
- Median MFE: +0.006%

### Holding Time

- Average candles: 36.7
- Median candles: 9.0
- Winning trades: 121.2 candles average
- Losing trades: 23.8 candles average


### Exit Outcomes

- Winners: 26 (+13.198%)
- Losers: 171 (+86.802%)
- Stop-loss exits: +71.066%
- Take-profit exits: +17.259%
- Timeout exits: +11.675%

### Exit Reason Breakdown

- take_profit: 34 (+17.259%)
- stop_loss: 140 (+71.066%)
- end_of_data: 23 (+11.675%)

## Trend Follow

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.055%
- Net expectancy: -0.264%
- Average cost drag: -0.209%

### MAE / MFE

- Average MAE: -0.245%
- Median MAE: -0.174%
- Average MFE: +0.174%
- Median MFE: +0.039%

### Holding Time

- Average candles: 30.3
- Median candles: 11.0
- Winning trades: 60.9 candles average
- Losing trades: 25.9 candles average


### Exit Outcomes

- Winners: 19 (+12.418%)
- Losers: 134 (+87.582%)
- Stop-loss exits: +69.935%
- Take-profit exits: +17.647%
- Timeout exits: +12.418%

### Exit Reason Breakdown

- stop_loss: 107 (+69.935%)
- take_profit: 27 (+17.647%)
- end_of_data: 19 (+12.418%)

## Balanced

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.059%
- Net expectancy: -0.306%
- Average cost drag: -0.247%

### MAE / MFE

- Average MAE: -0.269%
- Median MAE: -0.161%
- Average MFE: +0.218%
- Median MFE: +0.060%

### Holding Time

- Average candles: 53.4
- Median candles: 13.5
- Winning trades: 160.6 candles average
- Losing trades: 40.0 candles average


### Exit Outcomes

- Winners: 10 (+11.111%)
- Losers: 80 (+88.889%)
- Stop-loss exits: +74.444%
- Take-profit exits: +12.222%
- Timeout exits: +13.333%

### Exit Reason Breakdown

- stop_loss: 67 (+74.444%)
- take_profit: 11 (+12.222%)
- end_of_data: 12 (+13.333%)

## Momentum

**Diagnosis:** SIGNAL_FAILURE

**Recommendation:** The strategy has negative gross expectancy. Do not optimise execution costs yet; investigate the entry/exit logic first.

### Gross vs Net

- Gross expectancy: -0.003%
- Net expectancy: -0.313%
- Average cost drag: -0.310%

### MAE / MFE

- Average MAE: -0.387%
- Median MAE: -0.379%
- Average MFE: +0.752%
- Median MFE: +0.911%

### Holding Time

- Average candles: 84.5
- Median candles: 50.5
- Winning trades: n/a candles average
- Losing trades: 84.5 candles average


### Exit Outcomes

- Winners: 0 (+0.000%)
- Losers: 4 (+100.000%)
- Stop-loss exits: +50.000%
- Take-profit exits: +0.000%
- Timeout exits: +50.000%

### Exit Reason Breakdown

- stop_loss: 2 (+50.000%)
- end_of_data: 2 (+50.000%)

## Breakout 2 (Volume Confirmed)

**Diagnosis:** SIGNAL_AND_EXIT_FAILURE

**Recommendation:** Signal shows directional bias but exits are destroying realised profits. Review stop placement, take-profit sizing and holding period before changing the entry.

### Gross vs Net

- Gross expectancy: -0.018%
- Net expectancy: -0.328%
- Average cost drag: -0.310%

### MAE / MFE

- Average MAE: -0.184%
- Median MAE: -0.108%
- Average MFE: +0.109%
- Median MFE: +0.000%

### Holding Time

- Average candles: 7.7
- Median candles: 3.5
- Winning trades: 13.1 candles average
- Losing trades: 7.3 candles average


### Exit Outcomes

- Winners: 11 (+6.707%)
- Losers: 153 (+93.293%)
- Stop-loss exits: +63.415%
- Take-profit exits: +33.537%
- Timeout exits: +3.049%

### Exit Reason Breakdown

- take_profit: 55 (+33.537%)
- stop_loss: 104 (+63.415%)
- end_of_data: 5 (+3.049%)
