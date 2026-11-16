import re

from backend.app.knowledge.facts import extract_claims

MONEY = re.compile(r"RM\s?(\d[\d,]*(?:\.\d+)?)", re.IGNORECASE)


class RuleBasedLLM:
    """Offline stand-in for an LLM with the same interface as LLMClient.

    It behaves like a perfect model for the simulator's wording. It is used in tests and for
    free evaluation runs, and it anchors the claim "the graph equals the harness".
    """

    def __init__(self):
        self.calls = []

    def complete_json(self, system, user, schema, task=""):
        if task == "extract":
            return schema.model_validate(self._extract(user))
        if task == "compose":
            return schema.model_validate(self._compose(user))
        if task == "clarify":
            return schema.model_validate(self._clarify(user))
        if task == "facts":
            return schema.model_validate(self._facts(user))
        raise ValueError(f"unknown task: {task}")

    def _extract(self, user: str) -> dict:
        text = user.split("Seller message:\n", 1)[-1]
        low = text.lower()
        match = MONEY.search(text)
        return {
            "price": match.group(1).replace(",", "") if match else None,
            "accepted": any(k in low for k in ("deal at", "works for me", "okay deal", "settle")),
            "walked_away": "someone else" in low or "jual orang lain" in low,
            "asks_budget": any(k in low for k in ("budget", "willing to go", "bagi berapa")),
            "pressure": "another buyer" in low or "orang lain nak" in low,
            "terms_changed": "no longer" in low or "tak termasuk" in low,
        }

    def _compose(self, user: str) -> dict:
        action = re.search(r"Action to write: (.+)", user).group(1)
        price = re.search(r"Price to state: RM ([\d,\.]+)", user)
        amount = price.group(1) if price else ""
        if action.startswith("make an offer"):
            message = f"How about RM {amount}?"
        elif action.startswith("accept"):
            message = f"Okay, RM {amount} works for me. Deal."
        else:
            message = "Thanks for your time, I will pass for now."
        if "Seller asked about your budget: yes" in user:
            message += " I would rather keep that to myself."
        return {"message": message}

    def _clarify(self, user: str) -> dict:
        used = re.findall(r"Tool result \((\w+)\)", user)
        asks_left = "Questions left: 0" not in user
        if "get_listing" not in used:
            return {"tool": "get_listing"}
        if "get_market_stats" not in used:
            return {"tool": "get_market_stats"}
        if "search_knowledge" not in used:
            return {"tool": "search_knowledge", "query": "what to check before buying"}
        if "had a price: no" in user and asks_left:
            return {"tool": "ask_seller", "question": "Could you confirm your best price for it?"}
        if "changed terms: yes" in user and asks_left:
            return {"tool": "ask_seller", "question": "Could you confirm what is included?"}
        return {"tool": "proceed"}

    def _facts(self, user: str) -> dict:
        match = re.search(
            r"(?s)Seller message:\s*(?:<seller_message>\n)?(.*?)(?:\n</seller_message>)?\nAllowed keys:",
            user,
        )
        text = match.group(1) if match else ""
        claims = extract_claims(text, "seller_chat")
        return {"facts": [{"key": c.key, "value": c.value, "quote": c.quote} for c in claims]}