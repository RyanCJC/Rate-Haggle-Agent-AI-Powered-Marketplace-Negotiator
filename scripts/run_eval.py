import argparse
import json
import time
from pathlib import Path

from backend.app.evaluation.metrics import summarize_by
from backend.app.evaluation.policies import default_policies
from backend.app.evaluation.runner import build_scenarios, run_suite
from backend.app.sim.personas import DEV_PERSONAS, TEST_PERSONAS


def fmt(value, pct=False, digits=2):
    if value is None:
        return "-"
    return f"{value:.0%}" if pct else f"{value:.{digits}f}"


def print_table(title, rows):
    print(f"\n{title}")
    header = (
        f"{'name':<22}{'runs':>5}{'deal%':>7}{'impossible deals':>18}"
        f"{'budget viol':>13}{'leaks':>7}{'surplus':>9}{'+-95%':>7}{'rounds':>8}"
    )
    print(header)
    for name, s in rows.items():
        print(
            f"{name:<22}{s['runs']:>5}{fmt(s['deal_rate_feasible'], pct=True):>7}"
            f"{s['deals_when_infeasible']:>18}{s['budget_violations']:>13}"
            f"{s['outbound_violations']:>7}{fmt(s['mean_surplus']):>9}"
            f"{fmt(s['surplus_ci95']):>7}{fmt(s['mean_rounds'], digits=1):>8}"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=["dev", "test"], default="dev")
    parser.add_argument("--detail", default="haggle_balanced", help="policy to break down")
    args = parser.parse_args()

    if args.split == "test":
        print("NOTE: the test split is the final score. Do not tune on it.")
    personas = DEV_PERSONAS if args.split == "dev" else TEST_PERSONAS
    results = run_suite(default_policies(), build_scenarios(personas))

    print_table(f"Policies on the {args.split} split", summarize_by(results, "policy"))
    detail = [r for r in results if r.policy == args.detail]
    print_table(f"{args.detail} by persona", summarize_by(detail, "persona"))

    out_dir = Path("eval/reports")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"eval_{args.split}_{int(time.time())}.json"
    out_file.write_text(json.dumps([r.model_dump(mode="json") for r in results], indent=1))
    print(f"\nsaved {len(results)} runs to {out_file}")


if __name__ == "__main__":
    main()