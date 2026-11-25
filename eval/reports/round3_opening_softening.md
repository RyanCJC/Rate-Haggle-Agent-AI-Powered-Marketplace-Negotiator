# Round 3: opening softening (round 1 vs softer opening) — DEV split only

**Status:** unreviewed exploration, run once on the DEV split. Not the scored test split; no
committed report is overwritten.

## Command to reproduce

From the repo root:

```
.venv\Scripts\python.exe - <<'EOF'
from decimal import Decimal
from backend.app.evaluation.round2 import V1_PARAMS, NEW_BALANCED
from backend.app.evaluation.policies import default_policies, haggle_policy
from backend.app.evaluation.runner import build_scenarios, run_suite
from backend.app.evaluation.metrics import summarize
from backend.app.sim.personas import DEV_PERSONAS
from backend.app.evaluation.protocol import ASKINGS, RATIOS

scenarios = build_scenarios(DEV_PERSONAS, ASKINGS, RATIOS, (0,))
v1 = haggle_policy(V1_PARAMS)      # round 1: opening 0.70, beta 1.5, opening_cap 0.85
nb = NEW_BALANCED                  # softer opening: 0.80, beta 1.5, opening_cap 0.90
for label, policy in [("V1 (round 1)", v1), ("NEW_BALANCED", nb)]:
    res = run_suite({label: policy}, scenarios)
    s = summarize(res)
    print(label, {
        "runs": s["runs"],
        "feasible": s["feasible_runs"],
        "deal_rate": s["deal_rate_feasible"],
        "mean_surplus": s["mean_surplus"],
        "mean_score": s["mean_score"],
        "mean_rounds": s["mean_rounds"],
        "budget_violations": s["budget_violations"],
        "outbound_violations": s["outbound_violations"],
        "violation_rate": s["violation_rate"],
    })
EOF
```

NEW_BALANCED is defined outside the round-2 grid in `backend/app/evaluation/round2.py` and is
behaviourally identical to `default_policies()["haggle_balanced"] (covered by
`backend/tests/test_eval_round2.py`).

## Scenarios

DEV sellers x asking prices [600, 1200, 2400] x budget ratios [0.70, 0.75, 0.80, 0.85, 0.90,
0.95, 1.0] x seed 0 = 231 negotiations per policy (11 DEV sellers). The test split is NOT run.

## Results

| policy | runs | feasible | deal rate | mean surplus | mean score | mean rounds | budget violations | outbound violations |
|---|---|---|---|---|---|---|---|---|
| V1 (round 1: opening 0.70, cap 0.85) | 231 | 165 | 67% | 0.88 | 0.59 | 4.6 | 0 | 0 |
| NEW_BALANCED (opening 0.80, cap 0.90) | 231 | 165 | 73% | 0.85 | 0.62 | 4.2 | 0 | 0 |

## Reading

Softening the opening (round 1 -> NEW_BALANCED) raises the deal rate (67% -> 73%) and the mean
score (0.59 -> 0.62) with fewer rounds (4.6 -> 4.2), at the cost of a lower mean surplus per
clean deal (0.88 -> 0.85: the buyer concedes more of the room to move). No rule is broken:
budget violations and outbound violations are 0 for both policies. This matches the intent of
commit 3807010 "adjust negotiation strategy parameters" (opening_cap 0.85 -> 0.90, gentler
openings for user experience).

## Round 1 reproduction check

V1 (round 1: opening 0.70, beta 1.5, opening_cap 0.85) reproduces the committed round-1
behaviour: on the DEV split it matches `eval/reports/dev_report.md` haggle_balanced (deal rate
67%, mean score 0.593, mean rounds 4.6, 0% violations). The exact committed test-split figures
(`README.md` lines 153/163; `eval/reports/final_test_report.md`, `eval/reports/round2_test_report.md`)
were scored on the TEST / test2 splits with 5 seeds and are not regenerated here.
