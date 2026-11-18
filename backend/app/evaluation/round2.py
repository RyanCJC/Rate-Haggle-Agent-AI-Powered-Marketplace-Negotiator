from collections import defaultdict
from decimal import Decimal
from statistics import fmean

from ..core.strategy import STYLES
from .metrics import paired_difference, summarize, summarize_by
from .policies import Policy, haggle_policy
from .protocol import HEADLINE, ROUND2_HEADLINE

# Declared in docs/eval_round2_plan.md before any tuning.
OPENINGS = (Decimal("0.70"), Decimal("0.74"), Decimal("0.78"))
BETAS = (1.0, 1.25, 1.5)


def candidate_name(opening: Decimal, beta: float) -> str:
    return f"cand_open{int(opening * 100)}_beta{beta}"


V1_CANDIDATE = candidate_name(Decimal("0.70"), 1.5)  # identical to the round 1 balanced style


def candidates() -> dict[str, Policy]:
    base = STYLES["balanced"]
    grid: dict[str, Policy] = {}
    for opening in OPENINGS:
        for beta in BETAS:
            params = base.model_copy(update={"opening_ratio": opening, "beta": beta})
            grid[candidate_name(opening, beta)] = haggle_policy(params)
    return grid


def evaluate(results, personas) -> list[dict]:
    """One row per candidate. Every seller weighs the same, so a seller with more feasible
    negotiations does not dominate the average."""
    impatient = {p.name for p in personas if "impatient" in p.tags}
    by_policy = defaultdict(list)
    for result in results:
        by_policy[result.policy].append(result)

    rows = []
    for name, runs in by_policy.items():
        per_seller = {
            seller: stats["mean_score"]
            for seller, stats in summarize_by(runs, "persona").items()
            if stats["mean_score"] is not None
        }
        quick = [v for k, v in per_seller.items() if k in impatient]
        other = [v for k, v in per_seller.items() if k not in impatient]
        overall = summarize(runs)
        rows.append(
            {
                "name": name,
                "score": fmean(per_seller.values()) if per_seller else None,
                "impatient_score": fmean(quick) if quick else None,
                "other_score": fmean(other) if other else None,
                "deal_rate": overall["deal_rate_feasible"],
                "violation_rate": overall["violation_rate"],
                "rounds": overall["mean_rounds"],
            }
        )
    return rows


def pick_winner(rows: list[dict]) -> dict | None:
    """The pre-declared rule: no rule breaks, then the best mean score, then fewer rounds."""
    clean = [r for r in rows if r["violation_rate"] == 0 and r["score"] is not None]
    if not clean:
        return None
    return min(clean, key=lambda r: (-round(r["score"], 4), r["rounds"], r["name"]))


def criteria_section(results, personas) -> str:
    """The success criteria declared in docs/eval_round2_plan.md, checked and printed as they are."""
    impatient = {p.name for p in personas if "impatient" in p.tags}
    by_policy = defaultdict(list)
    for result in results:
        by_policy[result.policy].append(result)
    v1, v2, b3 = by_policy[HEADLINE], by_policy[ROUND2_HEADLINE], by_policy["b3_capped_ladder"]

    def part(runs, want_impatient):
        return [r for r in runs if (r.persona in impatient) == want_impatient]

    quick = paired_difference(part(v2, True), part(v1, True))
    other = paired_difference(part(v2, False), part(v1, False))
    violation = summarize(v2)["violation_rate"] if v2 else None

    def interval(d):
        if d["mean_diff"] is None:
            return "-"
        return f"{d['mean_diff']:+.3f} [{d['lo']:+.3f}, {d['hi']:+.3f}]"

    def verdict(ok):
        return "met" if ok else "not met"

    met_quick = quick["lo"] is not None and quick["lo"] > 0
    met_other = other["mean_diff"] is not None and other["mean_diff"] >= -0.05
    lines = [
        "## Round 2: success criteria (declared in docs/eval_round2_plan.md before tuning)",
        "",
        "| criterion | result | verdict |",
        "|---|---|---|",
        (
            "| v2 minus v1 on impatient sellers: 95% interval above zero "
            f"| {interval(quick)} | {verdict(met_quick)} |"
        ),
        (
            "| v2 minus v1 on the other sellers: point estimate not below -0.05 "
            f"| {interval(other)} | {verdict(met_other)} |"
        ),
        f"| v2 violation rate is 0 | {violation} | {verdict(violation == 0)} |",
        "",
        "## Score by seller (v1 = round 1 style)",
        "",
        "| seller | impatient | v1 | v2 | b3_capped_ladder |",
        "|---|---|---|---|---|",
    ]
    tables = [summarize_by(runs, "persona") for runs in (v1, v2, b3)]
    for persona in personas:
        cells = []
        for table in tables:
            score = table.get(persona.name, {}).get("mean_score")
            cells.append("-" if score is None else f"{score:.3f}")
        mark = "yes" if persona.name in impatient else "no"
        lines.append(f"| {persona.name} | {mark} | {' | '.join(cells)} |")
    lines += [
        "",
        "Limits: the round 2 sellers were written after the round 1 failure was known, so they",
        "are not blind to the hypothesis. Nine candidates were compared on dev. Six sellers give",
        "few independent cases. Round 1 (final_test_report.md) is unchanged and was the only",
        "fully blind test.",
        "",
    ]
    return "\n".join(lines)