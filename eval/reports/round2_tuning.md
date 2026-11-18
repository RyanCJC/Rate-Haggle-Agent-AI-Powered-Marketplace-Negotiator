# Round 2: tuning on the DEV split only

Rule (from docs/eval_round2_plan.md): no rule breaks, then the best mean of per-seller
scores (each seller weighs the same), then fewer rounds.
Sellers: firm, flexible, evasive, pressure, mixed_my_en, budget_prober, term_changer, dishonest, walker_2, walker_3, walker_4

| candidate | score | impatient sellers | other sellers | deal rate | violation rate | rounds |
|---|---|---|---|---|---|---|
| cand_open70_beta1.0 | 0.582 | 0.238 | 0.712 | 0.69 | 0.00 | 4.5 |
| cand_open70_beta1.25 | 0.573 | 0.208 | 0.710 | 0.68 | 0.00 | 4.6 |
| cand_open70_beta1.5 (round 1 style) | 0.572 | 0.172 | 0.722 | 0.67 | 0.00 | 4.6 |
| cand_open74_beta1.0 | 0.571 | 0.226 | 0.701 | 0.69 | 0.00 | 4.4 |
| cand_open74_beta1.25 | 0.574 | 0.220 | 0.707 | 0.68 | 0.00 | 4.5 |
| cand_open74_beta1.5 | 0.561 | 0.178 | 0.705 | 0.67 | 0.00 | 4.5 |
| cand_open78_beta1.0 (WINNER) | 0.597 | 0.360 | 0.686 | 0.73 | 0.00 | 4.2 |
| cand_open78_beta1.25 | 0.567 | 0.218 | 0.698 | 0.68 | 0.00 | 4.3 |
| cand_open78_beta1.5 | 0.567 | 0.178 | 0.712 | 0.67 | 0.00 | 4.4 |

## Score by seller

| seller | round 1 style | winner |
|---|---|---|
| firm | 0.492 | 0.578 |
| flexible | 0.939 | 0.885 |
| evasive | 0.691 | 0.668 |
| pressure | 0.751 | 0.654 |
| mixed_my_en | 0.780 | 0.664 |
| budget_prober | 0.792 | 0.686 |
| term_changer | 0.609 | 0.636 |
| dishonest | 0.719 | 0.713 |
| walker_2 | 0.000 | 0.393 |
| walker_3 | 0.000 | 0.000 |
| walker_4 | 0.517 | 0.688 |
