import argparse
from decimal import Decimal

from dotenv import load_dotenv

from backend.app.evaluation.b1 import play_b1
from backend.app.evaluation.grounding import (
    LISTINGS,
    listing_facts,
    play_haggle_grounded,
    score,
)
from backend.app.llm.client import LLMClient
from backend.app.llm.fake import RuleBasedLLM
from backend.app.llm.naive import NaiveBuyerLLM


def b1_runner(variant: str):
    def run(llm, persona, listing, seed):
        budget = int(Decimal(listing["asking_price"]) * Decimal("0.85"))
        return play_b1(llm, persona, budget, seed, variant, listing)

    return run


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="use the real LLM from .env")
    parser.add_argument("--seeds", type=int, default=None)
    parser.add_argument("--personas", nargs="+", default=["flexible", "mixed_my_en"])
    parser.add_argument("--variants", nargs="+", default=["careful"], choices=["basic", "careful"])
    args = parser.parse_args()

    load_dotenv()
    seeds = tuple(range(args.seeds or (1 if args.live else 2)))
    shared = LLMClient() if args.live else None

    def factory(offline_class):
        return (lambda: shared) if shared else offline_class

    systems = [("haggle", factory(RuleBasedLLM), play_haggle_grounded)]
    systems += [(f"b1_{v}", factory(NaiveBuyerLLM), b1_runner(v)) for v in args.variants]

    if not shared:
        print("OFFLINE: scripted test doubles. This checks the harness only. NOT results.\n")
    print(f"{len(LISTINGS)} listings x {len(args.personas)} sellers x {len(seeds)} seeds\n")
    print(f"{'system':<12}{'runs':>5}{'messages':>10}{'invented':>10}{'runs hit':>10}{'grounded':>10}")

    scores = []
    for name, make_llm, play_fn in systems:
        pairs = []
        for listing in LISTINGS:
            facts = listing_facts(listing)
            for persona in args.personas:
                for seed in seeds:
                    pairs.append((play_fn(make_llm(), persona, listing, seed), facts))
        s = score(name, pairs)
        scores.append(s)
        print(f"{s.system:<12}{s.runs:>5}{s.messages:>10}{s.bad_messages:>10}"
              f"{s.runs_with_bad:>10}{s.grounded_mentions:>10}")

    print("\ninvented  = messages stating an item detail that no known fact supports")
    print("grounded  = item details stated that a known fact supports (proof it still talks)")
    print("NOTE: haggle enforces this rule, so its 0 is by design. Judge the baseline row,")
    print("and read the examples yourself: a human reading them is the independent check.")
    for s in scores:
        if s.examples:
            print(f"\n{s.system} examples:")
            for example in s.examples:
                print(f"   {example}")


if __name__ == "__main__":
    main()