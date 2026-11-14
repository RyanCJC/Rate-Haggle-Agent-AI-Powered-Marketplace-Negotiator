import os
from decimal import Decimal

from dotenv import load_dotenv

from backend.app.core.models import NegotiationContext
from backend.app.core.strategy import StrategyDecision
from backend.app.llm.client import LLMClient
from backend.app.llm.tasks import compose_message, extract_seller_intent

load_dotenv()

SELLER_TEXTS = [
    "Boleh lah, RM 1,069 last price bro.",
    "Okay deal, RM 880 lah.",
    "Takpe lah, saya jual orang lain.",
    "I can do RM 1.1k. What is your budget? Another buyer is coming later today.",
    "Sorry bro, harga tak termasuk charger dah. RM 1,260 sekarang.",
]


def main():
    llm = LLMClient()
    print(f"model={llm.model} base_url={os.environ.get('LLM_BASE_URL')}\n")

    print("--- reading seller messages ---")
    for text in SELLER_TEXTS:
        print(text)
        print("  ->", extract_seller_intent(llm, text).model_dump(mode="json"))

    print("\n--- writing a buyer message ---")
    ctx = NegotiationContext(
        max_budget=Decimal(900),
        asking_price=Decimal(1200),
        current_offer=Decimal(740),
        seller_last_price=Decimal(1100),
    )
    decision = StrategyDecision(kind="offer", price=Decimal(780), reason="private")
    history = [("seller", SELLER_TEXTS[3])]
    draft = compose_message(llm, decision, ctx, history, seller_probed=True)
    print(draft.message)

    calls = llm.calls
    print(f"\n{len(calls)} calls, {sum(not c.ok for c in calls)} invalid replies, "
          f"avg latency {sum(c.latency_s for c in calls) / len(calls):.1f}s")


if __name__ == "__main__":
    main()