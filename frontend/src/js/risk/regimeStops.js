// Regime-aware stop-loss / take-profit sizing. First piece of a dedicated
// risk/ module (previously this math lived entirely in signalEngine.js's
// risk block, with fixed ATR multipliers regardless of market condition).
//
// This does NOT replace the existing ATR-based stop/reward math or
// resolveQuantity()'s risk% position sizing in app.js - it sits on top of
// both as a multiplicative adjustment:
//   - stopDistance = atr * strategy's own multiplier * this module's factor
//   - resolveQuantity() still sizes quantity off the resulting stopDistance,
//     so a wider regime-adjusted stop still automatically produces a
//     smaller position for the same $ risk - nothing about the $-risk-per-
//     trade guarantee changes, only where the stop/target actually sit.
//
// Rationale per regime:
//   TRENDING   - established trend, wider stop (avoid getting shaken out by
//                a normal pullback) and a bigger reward target (let a
//                winner run with the trend).
//   RANGING    - mean-reversion setups have a nearby target by nature (the
//                other side of the range) - tighter stop AND tighter target
//                keeps the reward-to-risk realistic instead of aiming for a
//                move the range isn't going to give.
//   BREAKOUT   - similar logic to TRENDING but slightly less aggressive on
//                the reward side, since a fresh breakout hasn't proven
//                follow-through yet the way an established trend has.
//   HIGH_VOLATILITY - stop widened the most (normal noise is bigger here,
//                so a tight stop gets clipped by chop rather than a real
//                reversal), reward left at 1x (no evidence a wide-swinging,
//                non-trending, non-breaking-out market will sustain a move
//                far enough to justify reaching further for it).
const NEUTRAL = { stopMultiplier: 1, rewardMultiplier: 1 };

const REGIME_RISK_FACTORS = {
    TRENDING: { stopMultiplier: 1.15, rewardMultiplier: 1.3 },
    RANGING: { stopMultiplier: 0.85, rewardMultiplier: 0.75 },
    BREAKOUT: { stopMultiplier: 1.1, rewardMultiplier: 1.15 },
    HIGH_VOLATILITY: { stopMultiplier: 1.3, rewardMultiplier: 1.0 }
};

export function getRegimeRiskFactors(primary) {
    return REGIME_RISK_FACTORS[primary] ?? NEUTRAL;
}
