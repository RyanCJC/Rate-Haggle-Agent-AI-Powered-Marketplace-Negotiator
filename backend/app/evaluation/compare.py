from collections import Counter
from dataclasses import dataclass, field
from decimal import Decimal

from backend.app.core.models import NegotiationContext
from backend.app.core.outbound import check_outbound

from .scenarios import SCENARIOS, Run, common_failures

CASES = [(s.persona, s.budget) for s in SCENARIOS]  # the same 7 sellers as the regression suite


def outbound_problems(run: Run) -> list[tuple[str, str]]:
    ctx = NegotiationContext(max_budget=run.budget, asking_price=run.asking)
    top, found = Decimal(0), []
    for price, message in run.port.sent:
        if price is not None:
            top = max(top, price)
        found += [(v.code, message) for v in check_outbound(message, ctx, top)]
    return found


def budget_breach(run: Run) -> bool:
    offers = [p for p, _ in run.port.sent if p is not None]
    final_price = run.final["final_price"]
    return any(p > run.budget for p in offers) or (
        final_price is not None and final_price > run.budget
    )


@dataclass
class Summary:
    system: str
    runs: int = 0
    feasible: int = 0
    clean_deals: int = 0
    deals_when_infeasible: int = 0
    budget_breaches: int = 0
    runs_with_violations: int = 0
    messages: int = 0
    bad_messages: int = 0
    llm_calls: int = 0
    savings: list[float] = field(default_factory=list)
    codes: Counter = field(default_factory=Counter)
    examples: list[str] = field(default_factory=list)

    @property
    def avg_saving(self) -> float:
        return sum(self.savings) / len(self.savings) if self.savings else 0.0


def summarize(system: str, runs: list[Run]) -> Summary:
    s = Summary(system)
    for run in runs:
        s.runs += 1
        feasible = run.seller.reservation <= run.budget
        s.feasible += feasible
        outcome, price = run.final["outcome"], run.final["final_price"]

        if outcome == "deal" and not feasible:
            s.deals_when_infeasible += 1
        if budget_breach(run):
            s.budget_breaches += 1

        problems = outbound_problems(run)
        s.messages += len(run.port.sent)
        s.bad_messages += len({message for _, message in problems})
        s.runs_with_violations += bool(problems)
        for code, message in problems:
            s.codes[code] += 1
            example = f"{code}: {message!r}"
            if example not in s.examples and len(s.examples) < 4:
                s.examples.append(example)

        if outcome == "deal" and not common_failures(run):
            if feasible:
                s.clean_deals += 1
            s.savings.append(float((run.asking - price) / run.asking))
    return s