import pytest

from backend.app.evaluation.scenarios import SCENARIOS, run_scenario
from backend.app.llm.fake import RuleBasedLLM


@pytest.mark.parametrize("scenario", SCENARIOS, ids=lambda s: s.name)
def test_regression_scenario(scenario):
    result = run_scenario(scenario, RuleBasedLLM)
    assert result.status == "PASS", f"{result.status}: {result.failures}"