# Evaluation on the test2 split

- Code version: `1e0eb55`
- Sellers: short_fuse, brisk_mid, brisk_firm, moderate, patient_soft, patient_firm
- Grid: asking prices [600, 1200, 2400] x budget ratios [0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0] x 5 seeds = 630 negotiations per policy

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
| haggle_aggressive | 630 | 375 | 20% | 0.174 [0.036, 0.314] | 0% | 0 | 0.87 | 5.1 |
| haggle_balanced | 630 | 375 | 37% | 0.323 [0.168, 0.493] | 0% | 0 | 0.87 | 4.6 |
| haggle_balanced_v2 (headline) | 630 | 375 | 52% | 0.455 [0.284, 0.628] | 0% | 0 | 0.87 | 4.3 |
| haggle_safe | 630 | 375 | 61% | 0.488 [0.337, 0.641] | 0% | 0 | 0.80 | 3.4 |
| haggle_balanced_long | 630 | 375 | 28% | 0.245 [0.103, 0.398] | 0% | 0 | 0.88 | 5.2 |
| b2_fixed_discount | 630 | 375 | 100% | 0.377 [0.266, 0.484] | 60% | 255 | 0.55 | 1.8 |
| b3_capped_ladder | 630 | 375 | 88% | 0.534 [0.439, 0.626] | 0% | 0 | 0.61 | 2.3 |

## haggle_balanced_v2 against the baselines (paired: the same negotiation each time)

| baseline | score difference [95% CI] | won / tied / lost | independent cases |
|---|---|---|---|
| haggle_balanced | +0.132 [+0.024, +0.271] | 85 / 220 / 70 | 25 |
| b3_capped_ladder | -0.079 [-0.246, +0.073] | 195 / 45 / 135 | 25 |
| b2_fixed_discount | +0.078 [-0.051, +0.206] | 195 / 105 / 75 | 25 |

## haggle_balanced_v2 by seller

| seller | runs | deal rate | score | violation rate |
|---|---|---|---|---|
| short_fuse | 105 | 0% | 0.000 | 0% |
| brisk_mid | 105 | 60% | 0.546 | 0% |
| brisk_firm | 105 | 0% | 0.000 | 0% |
| moderate | 105 | 75% | 0.677 | 0% |
| patient_soft | 105 | 83% | 0.713 | 0% |
| patient_firm | 105 | 67% | 0.551 | 0% |

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

## Round 2: success criteria (declared in docs/eval_round2_plan.md before tuning)

| criterion | result | verdict |
|---|---|---|
| v2 minus v1 on impatient sellers: 95% interval above zero | +0.228 [+0.000, +0.459] | not met |
| v2 minus v1 on the other sellers: point estimate not below -0.05 | +0.043 [-0.023, +0.158] | met |
| v2 violation rate is 0 | 0.0 | met |

## Score by seller (v1 = round 1 style)

| seller | impatient | v1 | v2 | b3_capped_ladder |
|---|---|---|---|---|
| short_fuse | yes | 0.000 | 0.000 | 0.492 |
| brisk_mid | yes | 0.000 | 0.546 | 0.727 |
| brisk_firm | yes | 0.000 | 0.000 | 0.556 |
| moderate | no | 0.527 | 0.677 | 0.469 |
| patient_soft | no | 0.719 | 0.713 | 0.533 |
| patient_firm | no | 0.551 | 0.551 | 0.333 |

Limits: the round 2 sellers were written after the round 1 failure was known, so they
are not blind to the hypothesis. Nine candidates were compared on dev. Six sellers give
few independent cases. Round 1 (final_test_report.md) is unchanged and was the only
fully blind test.
