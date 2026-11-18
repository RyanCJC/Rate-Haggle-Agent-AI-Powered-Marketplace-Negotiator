from pathlib import Path

from backend.app.evaluation.metrics import summarize_by
from backend.app.evaluation.protocol import ASKINGS, DEFAULT_SEEDS, RATIOS
from backend.app.evaluation.round2 import V1_CANDIDATE, candidates, evaluate, pick_winner
from backend.app.evaluation.runner import build_scenarios, run_suite
from backend.app.sim.personas import DEV_PERSONAS

OUT = Path("eval/reports/round2_tuning.md")


def fmt(value, digits: int = 3) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def main() -> None:
    seeds = tuple(range(DEFAULT_SEEDS))
    scenarios = build_scenarios(DEV_PERSONAS, ASKINGS, RATIOS, seeds)
    results = run_suite(candidates(), scenarios)
    rows = evaluate(results, DEV_PERSONAS)
    winner = pick_winner(rows)
    winner_name = winner["name"] if winner else None

    lines = [
        "# Round 2: tuning on the DEV split only",
        "",
        "Rule (from docs/eval_round2_plan.md): no rule breaks, then the best mean of per-seller",
        "scores (each seller weighs the same), then fewer rounds.",
        f"Sellers: {', '.join(p.name for p in DEV_PERSONAS)}",
        "",
        (
            "| candidate | score | impatient sellers | other sellers | deal rate "
            "| violation rate | rounds |"
        ),
        "|---|---|---|---|---|---|---|",
    ]
    for row in rows:
        tag = " (round 1 style)" if row["name"] == V1_CANDIDATE else ""
        tag += " (WINNER)" if row["name"] == winner_name else ""
        lines.append(
            f"| {row['name']}{tag} | {fmt(row['score'])} | {fmt(row['impatient_score'])} "
            f"| {fmt(row['other_score'])} | {fmt(row['deal_rate'], 2)} "
            f"| {fmt(row['violation_rate'], 2)} | {fmt(row['rounds'], 1)} |"
        )

    if winner_name is None:
        lines += ["", "No candidate qualified."]
    else:
        lines += ["", "## Score by seller", "", "| seller | round 1 style | winner |", "|---|---|---|"]
        old = summarize_by([r for r in results if r.policy == V1_CANDIDATE], "persona")
        new = summarize_by([r for r in results if r.policy == winner_name], "persona")
        for seller in old:
            lines.append(
                f"| {seller} | {fmt(old[seller]['mean_score'])} "
                f"| {fmt(new[seller]['mean_score'])} |"
            )

    text = "\n".join(lines) + "\n"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text, encoding="utf-8")
    print(text)
    print(f"saved {OUT}")


if __name__ == "__main__":
    main()