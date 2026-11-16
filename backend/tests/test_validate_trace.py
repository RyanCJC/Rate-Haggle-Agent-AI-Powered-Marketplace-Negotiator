"""Trace shape assertions for the validation gate.

Uses an existing test double (LeakThenFix from test_graph) that provokes a
validation rejection, then recovers on a later attempt. The leaked draft is
rejected by code and never sent to the seller: the user's limit never reaches
the AI.
"""

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import SimSellerPort
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller
from backend.tests.test_graph import LeakThenFix

ASKING = 1200
BUDGET = 900
LEAKED_DRAFT = "My max budget is RM 900, so how about RM 700?"


def _run(llm, persona="flexible", budget=BUDGET, seed=0):
    seller = SimSeller(ASKING, get_persona(persona), seed=seed)
    port = SimSellerPort(seller)
    final = run_graph(build_graph(llm, port), ASKING, budget)
    return final, port


def test_leaked_draft_is_rejected_and_never_sent():
    final, port = _run(LeakThenFix(), seed=0)
    validates = [entry for entry in final["trace"] if entry["node"] == "validate"]
    assert validates, "the trace should contain at least one validate entry"

    rejected = [entry for entry in validates if entry["ok"] is False]
    assert rejected, "LeakThenFix should provoke at least one validation rejection"

    for entry in rejected:
        assert entry["ok"] is False
        assert isinstance(entry["codes"], list) and len(entry["codes"]) > 0
        assert "rejected_draft" in entry
        assert entry["rejected_draft"] == LEAKED_DRAFT
        assert len(entry["rejected_draft"]) <= 300

    for entry in validates:
        if entry["ok"] is True:
            assert entry["codes"] == []
            assert "rejected_draft" not in entry

    # The leaked draft is blocked by code and never reaches the seller.
    sent = [message for _, message in port.sent]
    assert sent
    assert all("budget" not in message.lower() for message in sent)
