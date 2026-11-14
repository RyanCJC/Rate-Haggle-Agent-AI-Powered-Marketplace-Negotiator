from decimal import Decimal

from pydantic import BaseModel

from backend.app.core.models import NegotiationContext, Phase
from backend.app.core.outbound import check_outbound
from backend.app.core.strategy import StrategyState
from backend.app.sim.personas import Persona
from backend.app.sim.seller import SimSeller

from .policies import Policy

MAX_TURNS = 30


class RunResult(BaseModel):
    persona: str
    split: str
    policy: str
    asking: Decimal
    budget: Decimal
    seed: int
    reservation: Decimal  # seller's hidden floor, kept for scoring only
    outcome: str  # deal | we_walk | seller_walks | timeout
    price: Decimal | None
    rounds: int
    feasible: bool  # a deal was possible: reservation <= budget
    budget_violation: bool
    outbound_violations: int
    probes_seen: int
    surplus: float | None


def run_negotiation(
    persona: Persona,
    policy_name: str,
    policy: Policy,
    asking: Decimal,
    budget: Decimal,
    seed: int = 0,
) -> RunResult:
    asking_d, budget_d = Decimal(asking), Decimal(budget)
    seller = SimSeller(asking_d, persona, seed=seed)
    state = StrategyState(asking_price=asking_d, max_budget=budget_d, seller_prices=[asking_d])

    outcome, price = "timeout", None
    outbound_violations = probes = 0
    budget_violation = False

    for _ in range(MAX_TURNS):
        decision = policy(state)
        if decision.kind == "walk_away":
            outcome = "we_walk"
            break
        if decision.kind == "accept":
            outcome, price = "deal", decision.price
            break

        offer = decision.price
        ctx = NegotiationContext(
            max_budget=budget_d,
            asking_price=asking_d,
            current_offer=state.our_offers[-1] if state.our_offers else None,
            seller_last_price=state.seller_last,
            phase=Phase.NEGOTIATING,
        )
        message = f"How about RM {offer:.2f}?"
        outbound_violations += len(check_outbound(message, ctx, ceiling=offer))
        if offer > budget_d:
            budget_violation = True

        reply = seller.respond(offer)
        state = state.model_copy(update={"our_offers": [*state.our_offers, offer]})
        probes += int(reply.probes_budget)
        if reply.accepted:
            outcome, price = "deal", reply.price
            break
        if reply.walked_away:
            outcome = "seller_walks"
            break
        if reply.price is not None:
            state = state.model_copy(
                update={"seller_prices": [*state.seller_prices, reply.price]}
            )

    if price is not None and price > budget_d:
        budget_violation = True

    surplus = None
    if price is not None and asking_d > seller.reservation:
        surplus = float((asking_d - price) / (asking_d - seller.reservation))

    return RunResult(
        persona=persona.name,
        split=persona.split,
        policy=policy_name,
        asking=asking_d,
        budget=budget_d,
        seed=seed,
        reservation=seller.reservation,
        outcome=outcome,
        price=price,
        rounds=state.round,
        feasible=seller.reservation <= budget_d,
        budget_violation=budget_violation,
        outbound_violations=outbound_violations,
        probes_seen=probes,
        surplus=surplus,
    )


def build_scenarios(
    personas,
    askings=(600, 1200, 2400),
    budget_ratios=(0.75, 0.85, 0.95, 1.0),
    seeds=(0, 1),
):
    scenarios = []
    for persona in personas:
        for asking in askings:
            for ratio in budget_ratios:
                for seed in seeds:
                    budget = (Decimal(asking) * Decimal(str(ratio))).quantize(Decimal(1))
                    scenarios.append((persona, Decimal(asking), budget, seed))
    return scenarios


def run_suite(policies: dict[str, Policy], scenarios) -> list[RunResult]:
    results = []
    for name, policy in policies.items():
        for persona, asking, budget, seed in scenarios:
            results.append(run_negotiation(persona, name, policy, asking, budget, seed))
    return results