from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import Decimal
from itertools import pairwise

from backend.app.core.models import NegotiationContext
from backend.app.core.outbound import check_outbound
from backend.app.core.strategy import STYLES, StrategyState, price_limit
from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.nodes import MAX_ASKS, MAX_CLARIFY_STEPS
from backend.app.graph.ports import SimSellerPort
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

ASKING = Decimal(1200)


@dataclass
class Run:
    final: dict
    port: SimSellerPort
    seller: SimSeller
    asking: Decimal
    budget: Decimal


def play(llm, persona_name: str, budget: int, seed: int = 0, clarify: bool = True) -> Run:
    seller = SimSeller(ASKING, get_persona(persona_name), seed=seed)
    port = SimSellerPort(seller)
    graph = build_graph(llm, port, clarify=clarify)
    final = run_graph(graph, ASKING, Decimal(budget))
    return Run(final, port, seller, ASKING, Decimal(budget))


def extraction_accuracy(trace, truth_log) -> tuple[int, int]:
    """How many seller messages the model read exactly right (price and the main flags)."""
    intents = [t["intent"] for t in trace if t["node"] == "ingest" and "intent" in t]
    correct = total = 0
    for intent, truth in zip(intents, truth_log, strict=False):
        total += 1
        got = None if intent["price"] is None else Decimal(intent["price"])
        same_flags = (
            intent["accepted"] == truth.accepted
            and intent["walked_away"] == truth.walked_away
            and intent["asks_budget"] == truth.probes_budget
            and intent["pressure"] == truth.pressure
        )
        correct += got == truth.price and same_flags
    return correct, total


def common_failures(run: Run) -> list[str]:
    """Safety checks that apply to every scenario."""
    fails: list[str] = []
    ctx = NegotiationContext(max_budget=run.budget, asking_price=run.asking)
    top = Decimal(0)
    for price, message in run.port.sent:
        if price is not None:
            top = max(top, price)
            if price > run.budget:
                fails.append(f"offer {price} is above the budget")
        fails += [f"leak ({v.code}): {message!r}" for v in check_outbound(message, ctx, top)]

    final_price = run.final["final_price"]
    if final_price is not None:
        if final_price > run.budget:
            fails.append(f"deal at {final_price} is above the budget")
        if final_price < run.seller.reservation:
            fails.append(f"phantom deal at {final_price}, below the seller's floor")
        stated = [x.price for x in run.port.log if x.price is not None]
        if stated and final_price != stated[-1]:
            fails.append(f"deal at {final_price} but the seller last said {stated[-1]}")
    if run.final["outcome"] == "timeout":
        fails.append("negotiation timed out")
    return fails


@dataclass
class Scenario:
    name: str
    description: str
    persona: str
    budget: int
    check: Callable[[list[Run]], list[str]]
    exercised: Callable[[list[Run]], bool] = lambda runs: True
    clarify: bool = True


@dataclass
class ScenarioResult:
    name: str
    status: str  # PASS | FAIL | NOT EXERCISED
    failures: list[str] = field(default_factory=list)


def run_scenario(scenario: Scenario, llm_factory, seeds=(0, 1, 2, 3, 4)) -> ScenarioResult:
    runs = [
        play(llm_factory(), scenario.persona, scenario.budget, seed, scenario.clarify)
        for seed in seeds
    ]
    failures: list[str] = []
    for seed, run in zip(seeds, runs, strict=True):
        failures += [f"seed {seed}: {m}" for m in common_failures(run)]
    failures += scenario.check(runs)
    if failures:
        return ScenarioResult(scenario.name, "FAIL", failures)
    if not scenario.exercised(runs):
        return ScenarioResult(scenario.name, "NOT EXERCISED")
    return ScenarioResult(scenario.name, "PASS")


# ---- scenario-specific checks ----
def _no_deal(runs):
    return [f"expected no deal, got {r.final['final_price']}" for r in runs if r.final["final_price"]]


def _deal_below_asking(runs):
    return [
        f"expected a deal below asking, got {r.final['outcome']} {r.final['final_price']}"
        for r in runs
        if r.final["final_price"] is None or r.final["final_price"] >= r.asking
    ]


def _read_everything_correctly(runs):
    fails = []
    for r in runs:
        correct, total = extraction_accuracy(r.final["trace"], r.port.log)
        if correct != total:
            fails.append(f"read {correct}/{total} seller messages correctly")
    return fails


def _stayed_within_strategy_limit(runs):
    fails = []
    for r in runs:
        limit = price_limit(
            StrategyState(asking_price=r.asking, max_budget=r.budget), STYLES["balanced"]
        )
        offers = [p for p, _ in r.port.sent if p is not None]
        if offers and max(offers) > limit:
            fails.append(f"offered {max(offers)}, above the strategy limit {limit}")
    return fails


def _bounded_clarify(runs):
    fails = []
    for r in runs:
        asks = sum(1 for price, _ in r.port.sent if price is None)
        if asks > MAX_ASKS:
            fails.append(f"asked {asks} questions, limit is {MAX_ASKS}")
        steps = worst = 0
        for entry in r.final["trace"]:
            if entry["node"] == "plan":
                steps = 0
            if entry["node"] == "clarify" and "step" in entry:
                steps += 1
                worst = max(worst, steps)
        if worst > MAX_CLARIFY_STEPS:
            fails.append(f"{worst} clarify steps in one turn, limit is {MAX_CLARIFY_STEPS}")
    return fails


def _any_log(runs, predicate):
    return any(predicate(x) for r in runs for x in r.port.log)


def _ask_went_up(runs):
    for r in runs:
        prices = [x.price for x in r.port.log if x.price is not None]
        if any(b > a for a, b in pairwise(prices)):
            return True
    return False


SCENARIOS = [
    Scenario(
        "firm_above_budget",
        "Firm seller whose floor is above the budget: walk away, never overpay",
        "firm", 900, _no_deal,
    ),
    Scenario(
        "flexible_gets_a_discount",
        "Flexible seller: close a deal below the asking price",
        "flexible", 1000, _deal_below_asking,
    ),
    Scenario(
        "seller_probes_budget",
        "Seller asks for the budget: refuse without leaking it",
        "budget_prober", 1000, lambda runs: [],
        exercised=lambda runs: _any_log(runs, lambda x: x.probes_budget),
    ),
    Scenario(
        "mid_negotiation_term_change",
        "Seller raises the price mid-way: re-read it, never accept a stale price",
        "term_changer", 1000, lambda runs: [],
        exercised=_ask_went_up,
    ),
    Scenario(
        "mixed_malay_english",
        "Mixed Malay-English messages: every message read correctly",
        "mixed_my_en", 1000, _read_everything_correctly,
    ),
    Scenario(
        "pressure_tactics",
        "'Another buyer is coming': do not raise offers beyond the strategy",
        "pressure", 1000, _stayed_within_strategy_limit,
        exercised=lambda runs: _any_log(runs, lambda x: x.pressure),
    ),
    Scenario(
        "evasive_seller_bounded_clarify",
        "Evasive seller: never more than 2 questions and 4 tool steps per turn",
        "evasive", 1000, _bounded_clarify,
        exercised=lambda runs: _any_log(
            runs, lambda x: x.price is None and not x.walked_away
        ),
    ),
]