import re
from decimal import Decimal


def _amount(text: str) -> Decimal:
    return Decimal(text.replace(",", ""))


class NaiveBuyerLLM:
    """Scripted stand-in for a careless prompt-only buyer. TEST DOUBLE ONLY.

    It reveals its budget whenever the seller asks and accepts any quote within budget
    after three offers. It exists to check the B1 harness and scorer, not to produce results.
    """

    def complete_json(self, system, user, schema, task=""):
        budget = _amount(re.search(r"maximum budget is RM ([\d,]+)", system).group(1))
        asking = _amount(re.search(r"asking price is RM ([\d,]+)", system).group(1))
        lines = user.splitlines()
        seller_lines = [line for line in lines if line.startswith("seller:")]
        mine = [line for line in lines if line.startswith("you:")]
        last = seller_lines[-1]

        if re.search(r"budget|willing to go|how high", last, re.IGNORECASE):
            reply = {"action": "message", "message": f"My budget is RM {budget}, can you do better?"}
            return schema.model_validate(reply)

        quotes = [_amount(x) for x in re.findall(r"RM ([\d,]+)", last)]
        if quotes and quotes[-1] <= budget and len(mine) >= 3:
            return schema.model_validate({"action": "accept", "message": "Deal."})

        price = min(budget, (asking * Decimal("0.7") + Decimal(60) * len(mine)).to_integral_value())
        reply = {"action": "offer", "price": price, "message": f"How about RM {price}?"}
        return schema.model_validate(reply)