# Evaluation round 2: plan (written before any change or result)

## Why

Round 1 (`eval/reports/final_test_report.md`, scored once on code version `037a4ef`) found:

- Haggle's balanced style tied the fair baseline (B3, a budget-capped fixed ladder) on unseen sellers
  (score difference -0.053, 95% CI [-0.289, +0.157]) and never broke a rule.
- Against the seller `quick_walker` (leaves after 3 responses) it closed 0 of 15 possible deals.
  The cause: opening ratio 0.70 and a slow concession curve (beta 1.5) keep all three offers below
  the seller's price. Haggle assumes a seller who negotiates for about six rounds.

Round 1 stays in the repository unchanged. Round 2 is a separate, labelled experiment.

## Hypothesis

A faster opening and a flatter concession curve (higher `opening_ratio`, lower `beta`) lose a
little against very patient sellers but win clearly against impatient ones, so the average over
a mix of sellers improves.

## Rules

1. **Dev first.** Three impatient personas are added to the DEV split (`max_rounds` 2, 3 and 4,
   different reservation and concession pace). All tuning happens on dev only.
2. **A fixed candidate grid**, declared now: `opening_ratio` in {0.70, 0.74, 0.78} x `beta` in
   {1.0, 1.25, 1.5} on the balanced style (9 candidates, other parameters unchanged).
3. **A fixed selection rule**: the candidate with the highest mean of per-seller scores on dev
   (each seller weighs the same). It must have a violation rate of 0. Ties go to fewer rounds.
   The winner is named `haggle_balanced_v2`. The original `haggle_balanced` stays in the code as v1.
4. **Fresh test sellers**, specified below, before any tuning. They are added as a new split
   `test2` only after v2 is frozen by a commit. Nobody looks at their results before that.
5. **One scoring run** of `test2`, with the same guard as round 1 (needs `--final`, a clean
   committed tree, once only).
6. **Report both rounds side by side.** If v2 is worse, or no better, we publish that too.

## The round 2 test sellers (specification)

All other fields are defaults (`serious_ratio` 0.85, `accept_premium` 0.05, English, no evasion,
no pressure, no budget probing, no term changes).

| name | reservation_ratio | concede_share | close_gap | max_rounds | lowball_ratio |
|---|---|---|---|---|---|
| short_fuse | 0.82 | 0.35 | 0.03 | 2 | 0.50 |
| brisk_mid | 0.78 | 0.25 | 0.03 | 3 | 0.55 |
| brisk_firm | 0.88 | 0.12 | 0.02 | 3 | 0.60 |
| moderate | 0.84 | 0.20 | 0.03 | 5 | 0.55 |
| patient_soft | 0.75 | 0.30 | 0.03 | 8 | 0.50 |
| patient_firm | 0.90 | 0.10 | 0.02 | 8 | 0.60 |

Three impatient and three not impatient, so a fix that only helps impatient sellers shows its cost.

## What counts as supported

Declared now, reported whatever the outcome:

- Paired score difference v2 minus v1 on the three impatient sellers: positive, 95% CI above zero.
- Paired score difference v2 minus v1 on the three others: point estimate not below -0.05.
- Violation rate 0 for v2.
- The comparison with B3 is reported, not a pass/fail condition.

## Limits of this experiment (stated up front)

- The test2 sellers were written after the failure was known, so they are not independent of the
  hypothesis. Round 1 was the only fully blind test.
- Nine candidates were compared on dev; the selection is a small multiple-comparison risk.
- Six sellers means few independent cases (six sellers x budget ratios). Intervals will be wide.
- All sellers are rule-based simulators written by the author.