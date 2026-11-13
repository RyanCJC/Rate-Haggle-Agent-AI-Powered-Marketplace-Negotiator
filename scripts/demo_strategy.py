from decimal import Decimal

from backend.app.core.strategy import STYLES, StrategyState, decide


def run(style: str, asking="1200", budget="900", seller_drop=0.03):
    params = STYLES[style]
    asking_d = Decimal(asking)
    state = StrategyState(
        asking_price=asking_d, max_budget=Decimal(budget), seller_prices=[asking_d]
    )
    seller = asking_d
    print(f"\n=== {style}: asking RM {asking}, budget RM {budget}, seller drops {seller_drop:.0%}")
    for _ in range(12):
        d = decide(state, params)
        print(f"  round {state.round}: seller RM {seller:.2f} -> {d.kind} {d.price or ''}  ({d.reason})")
        if d.kind != "offer":
            return
        seller = (seller * Decimal(repr(round(1 - seller_drop, 4)))).quantize(Decimal("0.01"))
        state = state.model_copy(
            update={
                "our_offers": [*state.our_offers, d.price],
                "seller_prices": [*state.seller_prices, seller],
            }
        )


if __name__ == "__main__":
    for style in STYLES:
        run(style)
    run("balanced", seller_drop=0.0)  # a seller who never moves