from decimal import Decimal

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import ScriptedSellerPort, SimSellerPort
from backend.app.knowledge.facts import Claim, facts_view, merge_claims
from backend.app.llm.facts import FactProposal, verify_claims
from backend.app.llm.fake import RuleBasedLLM
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

LISTING = {
    "id": "1",
    "title": "Monitor",
    "category": "monitors",
    "asking_price": "1200",
    "description": "27 inch 144Hz, 6 months warranty left, no scratches",
}
KEYS = ("warranty", "refresh_rate", "defects")


def test_a_grounded_claim_is_kept():
    text = "It has  144Hz and only 3 MONTHS warranty left."
    proposals = [FactProposal(key="warranty", value="3 months warranty", quote="3 months warranty")]
    kept, dropped = verify_claims(proposals, text, KEYS)
    assert [(c.key, c.source) for c in kept] == [("warranty", "seller_chat")]
    assert dropped == []


def test_invented_claims_are_dropped_with_a_reason():
    text = "It has 144Hz and only 3 months warranty left."
    proposals = [
        FactProposal(key="warranty", value="2 years", quote="two years warranty included"),
        FactProposal(key="colour", value="red", quote="It has 144Hz"),
        FactProposal(key="warranty", value="6 months warranty", quote="3 months warranty"),
    ]
    kept, dropped = verify_claims(proposals, text, KEYS)
    assert kept == []
    assert len(dropped) == 3


def test_merge_skips_repeats_and_statuses_follow_the_sources():
    listing = [{"key": "warranty", "value": "6 months", "source": "listing", "quote": "6 months"}]
    seller = [Claim("warranty", "3 months", "seller_chat", "3 months")]
    merged = merge_claims(listing, seller)
    assert len(merge_claims(merged, seller)) == 2  # the repeat was skipped
    status = {f["key"]: f["status"] for f in facts_view(merged, "monitors")}
    assert status["warranty"] == "conflicting"


def test_seller_chat_confirms_and_contradicts_listing_claims():
    port = ScriptedSellerPort(["It has 144Hz and only 3 months warranty left. RM 1,150.", "RM 1,100."])
    graph = build_graph(RuleBasedLLM(), port, ground=True)
    final = run_graph(graph, Decimal(1200), Decimal(1000), listing=LISTING)
    status = {f["key"]: f["status"] for f in final["facts"]}
    assert status["refresh_rate"] == "confirmed"
    assert status["warranty"] == "conflicting"
    assert status["defects"] == "claimed"


class InventsFacts(RuleBasedLLM):
    def complete_json(self, system, user, schema, task=""):
        if task == "facts":
            made_up = [
                {"key": "warranty", "value": "2 years", "quote": "two years warranty included"},
                {"key": "colour", "value": "red", "quote": "It has 144Hz"},
            ]
            return schema.model_validate({"facts": made_up})
        return super().complete_json(system, user, schema, task)


def test_a_model_that_invents_facts_changes_nothing():
    port = ScriptedSellerPort(["It has 144Hz and nothing else to say. RM 1,150.", "RM 1,100."])
    graph = build_graph(InventsFacts(), port, ground=True)
    final = run_graph(graph, Decimal(1200), Decimal(1000), listing=LISTING)
    ingest = next(t for t in final["trace"] if t["node"] == "ingest")
    assert ingest["claims_kept"] == []
    assert len(ingest["claims_dropped"]) == 2
    assert {f["key"]: f["status"] for f in final["facts"]}["warranty"] == "claimed"


def test_clarify_tools_run_once_per_negotiation_and_search_returns_the_stub():
    stub = lambda query, category: [f"{category}.md: Check the battery health."]
    port = SimSellerPort(SimSeller(Decimal(1200), get_persona("evasive"), seed=1))
    graph = build_graph(RuleBasedLLM(), port, clarify=True, knowledge=stub)
    final = run_graph(graph, Decimal(1200), Decimal(1000), listing=LISTING)
    tools = [note.split(":")[0] for note in final["notes"]]
    assert tools.count("get_listing") == 1
    assert tools.count("get_market_stats") == 1
    assert tools.count("search_knowledge") == 1
    assert "search_knowledge: monitors.md: Check the battery health." in final["notes"]