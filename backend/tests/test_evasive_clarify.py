from backend.app.evaluation.scenarios import play
from backend.app.graph.nodes import MAX_ASKS
from backend.app.llm.fake import RuleBasedLLM


def test_with_a_perfect_model_the_evasive_seller_is_asked_a_question():
    runs = [play(RuleBasedLLM(), "evasive", 1000, seed=seed) for seed in range(8)]
    asked = [sum(1 for price, _ in r.port.sent if price is None) for r in runs]
    assert any(asked), "the clarify path never reached the seller"
    assert all(n <= MAX_ASKS for n in asked)