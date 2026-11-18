HEADLINE = "haggle_balanced"  # round 1 headline, chosen before the test split was ever scored
BASELINES = ("b2_fixed_discount", "b3_capped_ladder")
ROUND2_HEADLINE = "haggle_balanced_v2"  # frozen by a commit before test2 existed in code
ROUND2_BASELINES = ("haggle_balanced", "b3_capped_ladder", "b2_fixed_discount")
FINAL_SPLITS = ("test", "test2")  # each is scored once, on committed code
ASKINGS = (600, 1200, 2400)
RATIOS = (0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.0)  # budget as a share of the asking price
DEFAULT_SEEDS = 5


def split_refusal(
    split: str, final: bool, force: bool, already_scored: bool, dirty: bool
) -> str | None:
    """Why this run must not happen, or None. A final split is scored once, on committed code."""
    if split not in FINAL_SPLITS:
        return None
    if not final:
        return f"the {split} split is the final score: pass --final to confirm the protocol is frozen"
    if already_scored and not force:
        return (
            f"the {split} split was already scored (see its report in eval/reports/). "
            "It is scored once; --force is only for a reproducibility rerun"
        )
    if dirty and not force:
        return "commit your changes first, so the report names the exact code that produced it"
    return None