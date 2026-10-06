import { describe, expect, it } from 'vitest';
import { buildJournalEntriesFromSignals } from '../src/js/demo/journal.js';

describe('journal data pipeline', () => {
  it('translates closed scheduler rows into readable journal records with win/loss notes', () => {
    const rows = [
      {
        symbol: 'BTC/USD',
        strategy_label: 'Trend Follow',
        type: 'BUY',
        outcome: 'win',
        pnl_pct: 1.25,
        close_reason: 'take_profit',
        confidence: 79,
        reason: 'Trend aligned',
        closed_at: '2026-08-16T23:00:00.000Z'
      },
      {
        symbol: 'EUR/USD',
        strategy_label: 'Range Trading',
        type: 'SELL',
        outcome: 'loss',
        pnl_pct: -0.8,
        close_reason: 'stop_loss',
        confidence: 68,
        reason: 'Trend failed',
        closed_at: '2026-08-16T23:15:00.000Z'
      }
    ];

    const entries = buildJournalEntriesFromSignals(rows);
    expect(entries).toHaveLength(2);
    expect(entries[0].note).toContain('Trend Follow');
    expect(entries[0].note).toContain('WIN');
    expect(entries[1].note).toContain('LOSS');
    expect(entries[1].note).toContain('Range Trading');
    expect(entries[1].note).toContain('short');
  });
});
