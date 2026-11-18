# Evaluation on the test split

- Code version: `037a4ef`
- Sellers: firm_pressure, flexible_prober, stubborn_ms, quick_walker
- Grid: asking prices [600, 1200, 2400] x budget ratios [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0] x 5 seeds = 420 negotiations per policy

## How to read this

- **score**: the share of the seller's room to move (asking price minus the seller's hidden floor)
  that the buyer captured, averaged over negotiations where a deal was possible. 1.0 means bought
  at the seller's floor. No deal, a broken rule (offer above the budget, a leaked limit) or an
  impossible deal counts as **0**, so a policy cannot look good by breaking rules.
- **deal rate**: deals closed, among negotiations where the seller's floor was within the budget.
- **violation rate**: negotiations with an offer above the budget or a leaking message.
- **surplus of clean deals**: the average over successful, rule-abiding deals only. It ignores
  every failure, so read it next to the score, never alone.
- **intervals**: 95% bootstrap over independent cases (seller x budget ratio), not over runs.

## Policies

| policy | runs | feasible | deal rate | score [95% CI] | violation rate | impossible deals | surplus of clean deals | rounds |
|---|---|---|---|---|---|---|---|---|
| haggle_aggressive | 420 | 270 | 33% | 0.333 [0.111, 0.556] | 0% | 0 | 1.00 | 5.7 |
| haggle_balanced (headline) | 420 | 270 | 56% | 0.465 [0.263, 0.659] | 0% | 0 | 0.84 | 5.0 |
| haggle_safe | 420 | 270 | 67% | 0.512 [0.325, 0.690] | 0% | 0 | 0.77 | 3.4 |
| haggle_balanced_long | 420 | 270 | 33% | 0.306 [0.105, 0.520] | 0% | 0 | 0.92 | 5.9 |
| b2_fixed_discount | 420 | 270 | 100% | 0.380 [0.250, 0.514] | 57% | 150 | 0.57 | 2.0 |
| b3_capped_ladder | 420 | 270 | 83% | 0.519 [0.375, 0.644] | 0% | 0 | 0.62 | 2.3 |

## haggle_balanced against the baselines (paired: the same negotiation each time)

| baseline | score difference [95% CI] | won / tied / lost | independent cases |
|---|---|---|---|
| b2_fixed_discount | +0.086 [-0.159, +0.322] | 150 / 60 / 60 | 18 |
| b3_capped_ladder | -0.053 [-0.289, +0.157] | 150 / 45 / 75 | 18 |

## haggle_balanced by seller

| seller | runs | deal rate | score | violation rate |
|---|---|---|---|---|
| firm_pressure | 105 | 67% | 0.459 | 0% |
| flexible_prober | 105 | 86% | 0.763 | 0% |
| stubborn_ms | 105 | 67% | 0.551 | 0% |
| quick_walker | 105 | 0% | 0.000 | 0% |

## Caveats

- The sellers are rule-based simulators written by the author. These numbers describe behaviour
  against those rules, not against real people.
- This layer measures the price strategy and the safety checks without a language model. Wording,
  reading messages and honesty about item facts are evaluated separately.
- Prices scale with the asking price and most sellers are deterministic, so the effective sample
  is the number of seller x budget-ratio cases, not the number of runs.
- Dev sellers were used while building the strategy. The test sellers were scored once, on
  committed code.
- B2 ignores the budget on purpose, to show what the safety layer prevents. B3 is the fair
  baseline: a budget-aware fixed ladder.
