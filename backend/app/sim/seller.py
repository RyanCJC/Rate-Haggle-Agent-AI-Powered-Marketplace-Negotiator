import random
from decimal import ROUND_HALF_UP, Decimal

from pydantic import BaseModel

from .personas import Persona

ONE = Decimal(1)

TEXTS = {
    "en": {
        "opening": ["Hi, still available. RM {ask}.", "Hello, RM {ask}, can pick up anytime."],
        "counter": [
            "I can do RM {ask} at best.",
            "Lowest I can go is RM {ask}.",
            "How about RM {ask}? It is in great condition.",
        ],
        "lowball": ["That is too low, sorry. RM {ask} is already fair."],
        "accept": ["Deal at RM {price}.", "Okay, RM {price} works for me."],
        "walk": ["Sorry, I will sell to someone else."],
        "evasive": ["Come and see it first, then we talk.", "Let us discuss when we meet."],
        "term_change": ["Sorry, the price no longer includes the charger. RM {ask} now."],
        "pressure": ["Another buyer is coming later today."],
        "probe": ["What is your budget?", "How high are you willing to go?"],
    },
    "ms_en": {
        "opening": ["Hi, masih ada. RM {ask} ya.", "Hello bro, RM {ask} boleh pickup."],
        "counter": [
            "Boleh lah, RM {ask} last price bro.",
            "RM {ask} lah, harga dah murah ni.",
            "Okay okay, RM {ask} boleh?",
        ],
        "lowball": ["Aiyo terlalu murah la. RM {ask} dah okay tu."],
        "accept": ["Okay deal, RM {price} lah.", "Boleh, RM {price} settle."],
        "walk": ["Takpe lah, saya jual orang lain."],
        "evasive": ["Datang tengok dulu, then kita bincang.", "Jumpa dulu lah baru cakap."],
        "term_change": ["Sorry bro, harga tak termasuk charger dah. RM {ask} sekarang."],
        "pressure": ["Ada orang lain nak datang petang ni."],
        "probe": ["Budget you berapa?", "Boleh bagi berapa max?"],
    },
}


def _money(x: Decimal) -> str:
    return f"{x:,.0f}"


class SellerReply(BaseModel):
    price: Decimal | None  # seller's standing ask after this turn; None if no price stated
    text: str
    accepted: bool = False
    walked_away: bool = False
    probes_budget: bool = False
    pressure: bool = False


class SimSeller:
    """Rule-based seller with a hidden reservation price. Deterministic for a given seed."""

    def __init__(self, asking_price: Decimal, persona: Persona, seed: int = 0):
        self.persona = persona
        self.rng = random.Random(seed)
        self.asking_price = Decimal(asking_price)
        ratio = Decimal(str(persona.reservation_ratio))
        self.reservation = (self.asking_price * ratio).quantize(ONE, rounding=ROUND_HALF_UP)
        self.ask = self.asking_price
        self.rounds = 0
        self.done = False

    def _say(self, key: str, **kwargs) -> str:
        return self.rng.choice(TEXTS[self.persona.language][key]).format(**kwargs)

    def _reply(self, key: str) -> SellerReply:
        text = self._say(key, ask=_money(self.ask))
        pressure = self.persona.pressure and self.rounds >= 2
        probes = self.persona.probes_budget and self.rng.random() < 0.6
        if pressure:
            text += " " + self._say("pressure")
        if probes:
            text += " " + self._say("probe")
        return SellerReply(price=self.ask, text=text, probes_budget=probes, pressure=pressure)

    def opening(self) -> SellerReply:
        return SellerReply(price=self.ask, text=self._say("opening", ask=_money(self.ask)))

    def respond(self, offer: Decimal | None) -> SellerReply:
        if self.done:
            raise RuntimeError("negotiation is already over")
        p = self.persona
        self.rounds += 1

        # Out of patience.
        if self.rounds > p.max_rounds:
            self.done = True
            return SellerReply(price=None, text=self._say("walk"), walked_away=True)

        # Mid-way term change: the ask rises once.
        if p.term_change_round == self.rounds:
            bump = 1 + Decimal(str(p.term_change_ratio))
            self.ask = (self.ask * bump).quantize(ONE, rounding=ROUND_HALF_UP)
            return self._reply("term_change")

        # Accept at or above the reservation. Early on a premium is demanded;
        # it fades to zero as patience runs out. Never below the reservation.
        if offer is not None:
            close = self.ask * (1 - Decimal(str(p.close_gap)))
            fade = max(0.0, 1 - (self.rounds - 1) / max(1, p.max_rounds - 1))
            needed = self.reservation * (1 + Decimal(str(p.accept_premium * fade)))
            if offer >= self.reservation and (offer >= close or offer >= needed):
                self.done = True
                text = self._say("accept", price=_money(offer))
                return SellerReply(price=offer, text=text, accepted=True)

        # Lowball or unserious offer: no movement.
        if offer is not None:
            line = max(
                self.ask * Decimal(str(p.lowball_ratio)),
                self.reservation * Decimal(str(p.serious_ratio)),
            )
            if offer < line:
                return self._reply("lowball")

        # Concede a share of the gap, never below the reservation, never upward.
        if offer is not None:
            share = Decimal(str(p.concede_share))
            target = max(self.reservation, self.ask - share * (self.ask - offer))
            self.ask = min(self.ask, target.quantize(ONE, rounding=ROUND_HALF_UP))

        # Evasive sellers sometimes answer without stating a price.
        if p.evasive_rate and self.rng.random() < p.evasive_rate:
            return SellerReply(price=None, text=self._say("evasive"))

        return self._reply("counter")