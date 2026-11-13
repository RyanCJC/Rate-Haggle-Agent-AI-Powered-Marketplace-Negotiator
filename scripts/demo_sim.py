from decimal import Decimal

from backend.app.core.strategy import STYLES, StrategyState, decide
from backend.app.sim.personas import PERSONAS
from backend.app.sim.seller import SimSeller


def negotiate(persona, style="balanced", asking=1200, budget=1000, seed=0):
    seller = SimSeller(Decimal(asking), persona, seed=seed)
    params = STYLES[style]
    state = StrategyState(
        asking_price=Decimal(asking),
        max_budget=Decimal(budget),
        seller_prices=[Decimal(asking)],
    )
    for _ in range(30):
        decision = decide(state, params)
        if decision.kind == "walk_away":
            return "we_walk", None, state.round, seller
        if decision.kind == "accept":
            return "deal", decision.price, state.round, seller
        reply = seller.respond(decision.price)
        state = state.model_copy(update={"our_offers": [*state.our_offers, decision.price]})
        if reply.accepted:
            return "deal", reply.price, state.round, seller
        if reply.walked_away:
            return "seller_walks", None, state.round, seller
        if reply.price is not None:
            state = state.model_copy(update={"seller_prices": [*state.seller_prices, reply.price]})
    return "timeout", None, state.round, seller


if __name__ == "__main__":
    asking, budget = 1200, 1000
    print(f"asking RM {asking}, buyer budget RM {budget}, style balanced")
    header = f"{'persona':<16}{'split':<6}{'reserve':>8}  {'outcome':<13}{'price':>7}{'rounds':>7}{'surplus':>9}"
    print(header)
    for persona in PERSONAS:
        outcome, price, rounds, seller = negotiate(persona, asking=asking, budget=budget)
        if price is not None:
            surplus = (Decimal(asking) - price) / (Decimal(asking) - seller.reservation)
            price_text, surplus_text = f"{price:.0f}", f"{surplus:.2f}"
        else:
            price_text, surplus_text = "-", "-"
        print(
            f"{persona.name:<16}{persona.split:<6}{seller.reservation:>8.0f}  {outcome:<13}"
            f"{price_text:>7}{rounds:>7}{surplus_text:>9}"
        )