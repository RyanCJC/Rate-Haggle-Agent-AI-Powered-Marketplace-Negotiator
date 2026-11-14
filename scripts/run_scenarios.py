import argparse
import sys

from dotenv import load_dotenv

from backend.app.evaluation.scenarios import SCENARIOS, run_scenario
from backend.app.llm.client import LLMClient
from backend.app.llm.fake import RuleBasedLLM


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="use the real LLM from .env")
    parser.add_argument("--seeds", type=int, default=None, help="seeds per scenario")
    args = parser.parse_args()

    load_dotenv()
    seeds = tuple(range(args.seeds or (1 if args.live else 5)))
    shared = LLMClient() if args.live else None
    factory = (lambda: shared) if args.live else RuleBasedLLM

    print(f"{'scenario':<34}{'status':<15}detail")
    failed = False
    for scenario in SCENARIOS:
        result = run_scenario(scenario, factory, seeds)
        failed |= result.status == "FAIL"
        detail = "; ".join(result.failures[:2]) if result.failures else scenario.description
        print(f"{result.name:<34}{result.status:<15}{detail}")
    if shared:
        calls = shared.calls
        print(f"\n{len(calls)} LLM calls, {sum(not c.ok for c in calls)} invalid replies")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()