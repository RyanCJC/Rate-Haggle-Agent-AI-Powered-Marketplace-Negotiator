from decimal import Decimal
from enum import Enum
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field


class Phase(str, Enum):
    OPENING = "opening"
    NEGOTIATING = "negotiating"
    CLOSING = "closing"
    DONE = "done"


# ---- Actions the LLM is allowed to PROPOSE (it never executes them) ----
class MakeOffer(BaseModel):
    kind: Literal["make_offer"] = "make_offer"
    price: Decimal = Field(gt=0)
    message: str = Field(min_length=1)


class AskQuestion(BaseModel):
    kind: Literal["ask_question"] = "ask_question"
    message: str = Field(min_length=1)


class Accept(BaseModel):
    kind: Literal["accept"] = "accept"
    price: Decimal = Field(gt=0)
    message: str = Field(min_length=1)


class WalkAway(BaseModel):
    kind: Literal["walk_away"] = "walk_away"
    message: str = Field(min_length=1)


class Wait(BaseModel):
    kind: Literal["wait"] = "wait"
    reason: str = ""


Action = Annotated[
    MakeOffer | AskQuestion | Accept | WalkAway | Wait,
    Field(discriminator="kind"),
]


# ---- What the validators know about the negotiation ----
class NegotiationContext(BaseModel):
    model_config = ConfigDict(frozen=True)

    max_budget: Decimal = Field(repr=False)  # PRIVATE: never put in a prompt or log
    asking_price: Decimal
    current_offer: Decimal | None = None  # our latest standing offer
    seller_last_price: Decimal | None = None  # seller's latest standing price
    phase: Phase = Phase.NEGOTIATING

    def public_view(self) -> dict:
        """The only version of the context that may ever be shown to an LLM."""
        return {
            "asking_price": str(self.asking_price),
            "current_offer": str(self.current_offer) if self.current_offer else None,
            "seller_last_price": (
                str(self.seller_last_price) if self.seller_last_price else None
            ),
            "phase": self.phase.value,
        }


# ---- Validation results ----
class Violation(BaseModel):
    code: str
    public_message: str  # safe for the LLM: never contains numbers or the budget
    private_detail: str = Field(default="", repr=False)  # for traces only


class ValidationResult(BaseModel):
    violations: list[Violation] = []

    @property
    def ok(self) -> bool:
        return not self.violations

    def feedback_for_llm(self) -> str:
        return " ".join(v.public_message for v in self.violations)