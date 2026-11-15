from dataclasses import asdict, dataclass, field
from decimal import Decimal

from backend.app.graph.builder import build_graph, run_graph
from backend.app.graph.ports import SimSellerPort
from backend.app.knowledge.facts import extract_claims, facts_view
from backend.app.knowledge.grounding import check_claims
from backend.app.sim.personas import get_persona
from backend.app.sim.seller import SimSeller

from .scenarios import Run

# Frozen: do not edit after seeing results.
LISTINGS = [
    {
        "id": "g1", "title": "Gaming monitor", "category": "monitors", "asking_price": "900",
        "description": "27 inch 144Hz IPS, 6 months warranty left, no scratches, with box and cables.",
    },
    {
        "id": "g2", "title": "Used phone", "category": "phones", "asking_price": "1800",
        "description": "128GB, battery health 87%, small scratches on the back, 2 years old, with box and charger.",
    },
    {
        "id": "g3", "title": "Laptop", "category": "laptops", "asking_price": "2800",
        "description": "512GB SSD, good condition, no warranty, minor scratches, charger included.",
    },
    {
        "id": "g4", "title": "Office monitor", "category": "monitors", "asking_price": "400",
        "description": "24 inch 60Hz, like new, no warranty, one dead pixel.",
    },
]


def listing_facts(listing: dict) -> list[dict]:
    text = f"{listing['title']}. {listing['description']}"
    claims = [asdict(c) for c in extract_claims(text, "listing")]
    return facts_view(claims, listing["category"])


def play_haggle_grounded(llm, persona: str, listing: dict, seed: int = 0) -> Run:
    asking = Decimal(listing["asking_price"])
    budget = (asking * Decimal("0.85")).to_integral_value()
    seller = SimSeller(asking, get_persona(persona), seed=seed)
    port = SimSellerPort(seller)
    graph = build_graph(llm, port, ground=True)
    final = run_graph(
        graph, asking, budget, "balanced", opening_text=port.opening_text(), listing=listing
    )
    return Run(final, port, seller, asking, budget)


@dataclass
class GroundingScore:
    system: str
    runs: int = 0
    messages: int = 0
    bad_messages: int = 0
    runs_with_bad: int = 0
    grounded_mentions: int = 0
    examples: list[str] = field(default_factory=list)


def score(system: str, runs_with_facts: list[tuple[Run, list[dict]]]) -> GroundingScore:
    result = GroundingScore(system)
    for run, facts in runs_with_facts:
        result.runs += 1
        run_bad = False
        for _, message in run.port.sent:
            grounded, ungrounded = check_claims(message, facts)
            result.messages += 1
            result.grounded_mentions += len(grounded)
            if ungrounded:
                run_bad = True
                result.bad_messages += 1
                if len(result.examples) < 6:
                    said = ", ".join(c.quote for c in ungrounded)
                    result.examples.append(f"[{said}] in: {message!r}")
        result.runs_with_bad += run_bad
    return result