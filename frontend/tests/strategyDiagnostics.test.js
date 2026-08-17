import {
    describe,
    expect,
    it
} from "vitest";

import {
    buildStrategyDiagnostics,
    buildAllStrategyDiagnostics
} from "@analysis/strategyDiagnostics.js";

const TRADE = ({
    pnl = 1,
    gross = pnl,
    cost = pnl - gross,
    side = "long",
    symbol = "BTC/USDT",
    timeframe = "5m",
    regime = "TRENDING",
    confidence = 75,
    closeReason = "take_profit",
    mae = -0.5,
    mfe = 1.5,
    holdingCandles = 5
} = {}) => ({
    strategy: "test",
    label: "Test Strategy",

    pnlPercent: pnl,

    grossPnlPercent:
        gross,

    costDragPercent:
        cost,

    side,

    symbol,

    timeframe,

    regime,

    confidence,

    closeReason,

    maePercent:
        mae,

    mfePercent:
        mfe,

    holdingCandles
});

describe(
    "strategyDiagnostics",
    () => {
        it(
            "separates gross and net performance",
            () => {
                const trades = [
                    TRADE({
                        pnl: -0.1,
                        gross: 0.2,
                        cost: -0.3
                    }),

                    TRADE({
                        pnl: 0.1,
                        gross: 0.4,
                        cost: -0.3
                    })
                ];

                const result =
                    buildStrategyDiagnostics(
                        trades,
                        {
                            strategy: "test"
                        }
                    );

                expect(
                    result.gross.expectancy
                ).toBeCloseTo(
                    0.3,
                    6
                );

                expect(
                    result.net.expectancy
                ).toBeCloseTo(
                    0,
                    6
                );
            }
        );

        it(
            "analyses MAE and MFE",
            () => {
                const result =
                    buildStrategyDiagnostics(
                        [
                            TRADE({
                                mae: -0.4,
                                mfe: 1.2
                            }),

                            TRADE({
                                mae: -0.8,
                                mfe: 2.0
                            })
                        ],
                        {
                            strategy: "test"
                        }
                    );

                expect(
                    result.excursions
                        .averageMAE
                ).toBeCloseTo(
                    -0.6,
                    6
                );

                expect(
                    result.excursions
                        .averageMFE
                ).toBeCloseTo(
                    1.6,
                    6
                );
            }
        );

        it(
            "groups exit reasons",
            () => {
                const result =
                    buildStrategyDiagnostics(
                        [
                            TRADE({
                                closeReason:
                                    "stop_loss",
                                pnl: -1
                            }),

                            TRADE({
                                closeReason:
                                    "take_profit",
                                pnl: 2
                            })
                        ],
                        {
                            strategy: "test"
                        }
                    );

                expect(
                    result.exits.stop_loss
                        .trades
                ).toBe(1);

                expect(
                    result.exits.take_profit
                        .trades
                ).toBe(1);
            }
        );

        it(
            "groups direction",
            () => {
                const result =
                    buildStrategyDiagnostics(
                        [
                            TRADE({
                                side: "long"
                            }),

                            TRADE({
                                side: "short"
                            })
                        ],
                        {
                            strategy: "test"
                        }
                    );

                expect(
                    result.direction.long
                        .trades
                ).toBe(1);

                expect(
                    result.direction.short
                        .trades
                ).toBe(1);
            }
        );

        it(
            "identifies a gross signal failure",
            () => {
                const result =
                    buildStrategyDiagnostics(
                        [
                            TRADE({
                                pnl: -0.3,
                                gross: -0.2
                            }),

                            TRADE({
                                pnl: -0.4,
                                gross: -0.3
                            })
                        ],
                        {
                            strategy: "test"
                        }
                    );

                expect(
                    result.diagnosis
                        .category
                ).toBe(
                    "SIGNAL_FAILURE"
                );
            }
        );

        it(
            "identifies cost failure",
            () => {
                const result =
                    buildStrategyDiagnostics(
                        [
                            TRADE({
                                pnl: -0.2,
                                gross: 0.2,
                                cost: -0.4
                            }),

                            TRADE({
                                pnl: -0.1,
                                gross: 0.3,
                                cost: -0.4
                            })
                        ],
                        {
                            strategy: "test"
                        }
                    );

                expect(
                    result.diagnosis
                        .category
                ).toBe(
                    "COST_FAILURE"
                );
            }
        );

        it(
            "builds all strategy diagnostics",
            () => {
                const trades = [
                    TRADE({
                        pnl: 1
                    }),

                    {
                        ...TRADE({
                            pnl: -1
                        }),
                        strategy: "other",
                        label: "Other"
                    }
                ];

                const result =
                    buildAllStrategyDiagnostics(
                        trades
                    );

                expect(
                    result
                ).toHaveLength(2);
            }
        );

        it(
            "correctly counts snake_case exit reasons",
            () => {
                const trades = [
                    {
                        pnlPercent: -1,
                        closeReason: "stop_loss"
                    },

                    {
                        pnlPercent: -1,
                        closeReason: "stop_loss"
                    },

                    {
                        pnlPercent: 1,
                        closeReason: "take_profit"
                    },

                    {
                        pnlPercent: 0,
                        closeReason: "end_of_data"
                    }
                ];

                const result = buildStrategyDiagnostics(trades);

                expect(result.outcomes.stopLossCount).toBe(2);
                expect(result.outcomes.takeProfitCount).toBe(1);
                expect(result.outcomes.timeoutCount).toBe(1);
            }
        );
    }
);
