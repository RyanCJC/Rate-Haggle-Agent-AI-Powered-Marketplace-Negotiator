"""Marketplace boundary: the only way the agent reaches a seller.

Run it with:  python -m backend.app.boundaries.marketplace_server
Stdout is the protocol channel, so nothing in here may print.
"""

import json
from decimal import Decimal

from mcp.server.mcpserver import MCPServer

from backend.app.graph.ports import SellerClosed, SimSellerPort
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

mcp = MCPServer("haggle-marketplace")
CONVERSATIONS: dict[str, SimSellerPort] = {}  # in memory: a real marketplace would persist this


def _reply(**data) -> str:
    return json.dumps(data)


def _send(conversation_id: str, turn: int, price: str | None, message: str) -> str:
    port = CONVERSATIONS.get(conversation_id)
    if port is None:
        raise ValueError(f"unknown conversation {conversation_id}")
    sent = len(port.sent)
    if turn < sent:  # a retry of a turn that already happened: answer again, send nothing
        return _reply(closed=False, text=port.log[turn].text, repeated=True)
    if turn > sent:
        raise ValueError(f"turn {turn} is out of order, expected {sent}")
    try:
        if price is None:
            text = port.send_message(message)
        else:
            text = port.send_offer(Decimal(price), message)
    except SellerClosed:
        return _reply(closed=True)
    return _reply(closed=False, text=text, repeated=False)


@mcp.tool()
def open_conversation(
    conversation_id: str, asking: str, persona: str, seed: int = 0, replay_json: str = "[]"
) -> str:
    """Open a conversation with a simulated seller and return the seller's opening message.

    Opening an id that already exists changes nothing. replay_json is a JSON list of earlier
    turns (a price string, or null for a question) used to rebuild the seller after a restart.
    """
    if conversation_id in CONVERSATIONS:
        return _reply(opening=None, resumed=True)
    turns = [None if t is None else Decimal(t) for t in json.loads(replay_json)]
    if turns:
        port = SimSellerPort.restore(
            Decimal(asking), get_persona(persona), seed, turns, with_opening=True
        )
        opening = None
    else:
        port = SimSellerPort(SimSeller(Decimal(asking), get_persona(persona), seed=seed))
        opening = port.opening_text()
    CONVERSATIONS[conversation_id] = port
    return _reply(opening=opening, resumed=False)


@mcp.tool()
def send_offer(conversation_id: str, turn: int, price: str, message: str) -> str:
    """Send an offer (price as a string) with a message. turn is the 0-based turn number:
    sending a turn twice returns the same reply and does not reach the seller again."""
    return _send(conversation_id, turn, price, message)


@mcp.tool()
def send_message(conversation_id: str, turn: int, message: str) -> str:
    """Send a message with no price (a question). Same turn rules as send_offer."""
    return _send(conversation_id, turn, None, message)


if __name__ == "__main__":
    mcp.run()