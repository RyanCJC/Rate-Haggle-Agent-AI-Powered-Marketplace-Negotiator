import math
import random
import statistics
from collections import defaultdict
from decimal import Decimal

from .runner import RunResult


def _rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def _ci95(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    return 1.96 * statistics.stdev(values) / math.sqrt(len(values))


def is_violation(result: RunResult) -> bool:
    return result.budget_violation or result.outbound_violations > 0


def run_score(result: RunResult) -> float:
    """The share of the seller's room to move that the buyer captured (1.0 = bought at the
    seller's hidden floor). No deal, a rule break or an impossible deal all score 0."""
    if (
        result.outcome != "deal"
        or is_violation(result)
        or not result.feasible
        or result.surplus is None
    ):
        return 0.0
    return result.surplus


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
        "violation_rate": _rate(sum(is_violation(r) for r in results), len(results)),
        "mean_surplus": statistics.fmean(surpluses) if surpluses else None,
        "surplus_ci95": _ci95(surpluses),
        "mean_score": statistics.fmean(run_score(r) for r in feasible) if feasible else None,
        "mean_rounds": statistics.fmean(rounds) if rounds else None,
    }


def summarize_by(results: list[RunResult], attribute: str) -> dict[str, dict]:
    groups: dict[str, list[RunResult]] = defaultdict(list)
    for result in results:
        groups[getattr(result, attribute)].append(result)
    return {key: summarize(group) for key, group in groups.items()}


def cluster_key(result: RunResult) -> tuple[str, str]:
    """Runs of one seller at one budget ratio behave alike (prices scale with the asking price),
    so they are ONE independent case, not many."""
    ratio = (result.budget / result.asking).quantize(Decimal("0.01"))
    return (result.persona, str(ratio))


def bootstrap_ci(values: list[float], n: int = 2000, seed: int = 0):
    """(mean, low, high) of a 95% bootstrap interval, or None for no data. Deterministic."""
    if not values:
        return None
    rng = random.Random(seed)
    means = sorted(statistics.fmean(rng.choices(values, k=len(values))) for _ in range(n))
    return statistics.fmean(values), means[int(0.025 * n)], means[int(0.975 * n) - 1]


def clustered_scores(results: list[RunResult], feasible_only: bool = True) -> list[float]:
    groups: dict[tuple[str, str], list[float]] = defaultdict(list)
    for r in results:
        if feasible_only and not r.feasible:
            continue
        groups[cluster_key(r)].append(run_score(r))
    return [statistics.fmean(values) for values in groups.values()]


def paired_difference(a: list[RunResult], b: list[RunResult], feasible_only: bool = True) -> dict:
    """Score of `a` minus score of `b` on the SAME negotiations, with a cluster bootstrap."""
    other = {(r.persona, r.asking, r.budget, r.seed): r for r in b}
    groups: dict[tuple[str, str], list[float]] = defaultdict(list)
    wins = ties = losses = 0
    for r in a:
        if feasible_only and not r.feasible:
            continue
        match = other.get((r.persona, r.asking, r.budget, r.seed))
        if match is None:
            continue
        diff = run_score(r) - run_score(match)
        groups[cluster_key(r)].append(diff)
        if diff > 1e-9:
            wins += 1
        elif diff < -1e-9:
            losses += 1
        else:
            ties += 1
    cluster_diffs = [statistics.fmean(values) for values in groups.values()]
    ci = bootstrap_ci(cluster_diffs)
    return {
        "cells": wins + ties + losses,
        "clusters": len(cluster_diffs),
        "wins": wins,
        "ties": ties,
        "losses": losses,
        "mean_diff": ci[0] if ci else None,
        "lo": ci[1] if ci else None,
        "hi": ci[2] if ci else None,
    }