from langgraph.types import interrupt

from .ports import HumanStopped


class ManualSellerPort:
    """Copilot mode: the human relays messages to a real seller and pastes the replies back.

    Nothing is ever sent by this class. Each send pauses the run with the draft as the question;
    the resume value is the human's answer. All state lives in the checkpoint, so a restarted
    server can accept the reply days later.
    """

    def __init__(self, opening: str | None = None):
        self.opening = opening
        self.sent_text: str | None = None  # what the human really sent, if they edited the draft

    def opening_text(self) -> str | None:
        return self.opening

    def _ask(self, kind: str, price, draft: str) -> str:
        answer = interrupt(
            {
                "gate": "seller_reply",
                "kind": kind,
                "price": None if price is None else str(price),
                "draft": draft,
            }
        )
        if not isinstance(answer, dict) or answer.get("action") not in ("reply", "stop"):
            raise ValueError("a seller reply or a stop is needed here")
        if answer["action"] == "stop":
            raise HumanStopped
        self.sent_text = (answer.get("sent_text") or "").strip() or None
        return str(answer.get("reply", ""))

    def send_offer(self, price, text: str) -> str:
        return self._ask("offer", price, text)

    def send_message(self, text: str) -> str:
        return self._ask("question", None, text)