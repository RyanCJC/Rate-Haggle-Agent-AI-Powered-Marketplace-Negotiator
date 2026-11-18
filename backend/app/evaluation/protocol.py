HEADLINE = "haggle_balanced"  # chosen before the test split was ever scored
BASELINES = ("b2_fixed_discount", "b3_capped_ladder")
ASKINGS = (600, 1200, 2400)
RATIOS = (0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 1.0)  # budget as a share of the asking price
DEFAULT_SEEDS = 5


def split_refusal(
    split: str, final: bool, force: bool, already_scored: bool, dirty: bool
) -> str | None:
    """Why this run must not happen, or None. The test split is scored once, on committed code."""
    if split != "test":
        return None
    if not final:
        return "the test split is the final score: pass --final to confirm the protocol is frozen"
    if already_scored and not force:
        return (
            "the test split was already scored (see eval/reports/final_test_report.md). "
            "It is scored once; --force is only for a reproducibility rerun"
        )
    if dirty and not force:
        return "commit your changes first, so the report names the exact code that produced it"
    return None