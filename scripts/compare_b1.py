import argparse
from functools import partial

from dotenv import load_dotenv

from backend.app.evaluation.b1 import play_b1
from backend.app.evaluation.compare import CASES, summarize
from backend.app.evaluation.scenarios import play
from backend.app.llm.client import LLMClient
from backend.app.llm.fake import RuleBasedLLM
from backend.app.llm.naive import NaiveBuyerLLM


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="use the real LLM from .env")
    parser.add_argument("--seeds", type=int, default=None, help="seeds per case")
    parser.add_argument("--variants", nargs="+", default=["basic", "careful"],
                        choices=["basic", "careful"])
    args = parser.parse_args()

    load_dotenv()
    seeds = tuple(range(args.seeds or (1 if args.live else 3)))
    shared = LLMClient() if args.live else None

    def factory(offline_class):
        return (lambda: shared) if shared else offline_class

    systems = [("haggle", factory(RuleBasedLLM), play)]
    systems += [
        (f"b1_{v}", factory(NaiveBuyerLLM), partial(play_b1, variant=v)) for v in args.variants
    ]

    if not shared:
        print("OFFLINE: scripted test doubles. This checks the harness only. NOT results.\n")
    print(f"{len(CASES)} cases x {len(seeds)} seeds per system\n")
    print(f"{'system':<12}{'runs':>5}{'clean deals':>13}{'infeasible':>12}"
          f"{'breaches':>10}{'leaky runs':>12}{'saving':>9}")

    summaries = []
    for name, make_llm, play_fn in systems:
        before = len(shared.calls) if shared else 0
        runs = [
            play_fn(make_llm(), persona, budget, seed)
            for persona, budget in CASES
            for seed in seeds
        ]
        s = summarize(name, runs)
        s.llm_calls = (len(shared.calls) - before) if shared else 0
        summaries.append(s)
        clean = f"{s.clean_deals}/{s.feasible}"
        print(f"{s.system:<12}{s.runs:>5}{clean:>13}{s.deals_when_infeasible:>12}"
              f"{s.budget_breaches:>10}{s.runs_with_violations:>12}{s.avg_saving:>9.1%}")

    print("\nclean deals = feasible runs closed with no breach, leak or other failure")
    print("infeasible  = deals made when the seller's floor was above the budget")
    print("breaches    = runs with an offer or a deal above the budget")
    print("leaky runs  = runs where a message leaked the budget or claimed a limit")
    for s in summaries:
        print(f"\n{s.system}: {s.bad_messages}/{s.messages} messages broke a rule "
              f"{dict(s.codes)} ({s.llm_calls} LLM calls)")
        for example in s.examples:
            print(f"   {example}")


if __name__ == "__main__":
    main()