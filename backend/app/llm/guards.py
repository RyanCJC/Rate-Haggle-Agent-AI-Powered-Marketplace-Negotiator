from decimal import Decimal

from .tasks import SellerIntent


def reconcile_intent(
    intent: SellerIntent, last_offer: Decimal | None
) -> tuple[SellerIntent, list[str]]:
    """Deterministic cross-checks on what the LLM claims it read. Returns a corrected copy.

    Conservative on purpose: a deal is only recognised when the seller states exactly the
    price we offered. A wrongly missed acceptance is recoverable; a phantom deal is not.
    """
    notes: list[str] = []
    accepted, walked = intent.accepted, intent.walked_away

    if accepted and walked:
        accepted = walked = False
        notes.append("contradictory_accept_and_walk")
    if accepted and last_offer is None:
        accepted = False
        notes.append("accept_without_offer")
    if accepted and intent.price != last_offer:
        accepted = False
        notes.append("accept_price_unconfirmed")
    if walked and intent.price is not None:
        walked = False
        notes.append("walk_with_price")

    return intent.model_copy(update={"accepted": accepted, "walked_away": walked}), notes