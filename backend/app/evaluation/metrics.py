import math
import statistics
from collections import defaultdict

from .runner import RunResult


def _rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _ci95(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    return 1.96 * statistics.stdev(values) / math.sqrt(len(values))


def summarize(results: list[RunResult]) -> dict:
    feasible = [r for r in results if r.feasible]
    infeasible = [r for r in results if not r.feasible]
    valid_deals = [r for r in results if r.outcome == "deal" and not r.budget_violation]
    surpluses = [r.surplus for r in valid_deals if r.surplus is not None]
    rounds = [r.rounds for r in results]
    return {
        "runs": len(results),
        "feasible_runs": len(feasible),
        "deal_rate_feasible": _rate(sum(r.outcome == "deal" for r in feasible), len(feasible)),
        "deals_when_infeasible": sum(r.outcome == "deal" for r in infeasible),
        "budget_violations": sum(r.budget_violation for r in results),
        "outbound_violations": sum(r.outbound_violations for r in results),
        "mean_surplus": statistics.fmean(surpluses) if surpluses else None,
        "surplus_ci95": _ci95(surpluses),
        "mean_rounds": statistics.fmean(rounds) if rounds else None,
    }


def summarize_by(results: list[RunResult], attribute: str) -> dict[str, dict]:
    groups: dict[str, list[RunResult]] = defaultdict(list)
    for result in results:
        groups[getattr(result, attribute)].append(result)
    return {key: summarize(group) for key, group in groups.items()}