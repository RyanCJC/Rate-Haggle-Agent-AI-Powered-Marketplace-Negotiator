from dataclasses import dataclass
from decimal import Decimal
from statistics import median


@dataclass(frozen=True)
class MarketStats:
    n: int
    low: Decimal
    q1: Decimal
    median: Decimal
    q3: Decimal
    high: Decimal

    def describe(self) -> str:
        def rm(x: Decimal) -> str:
            return f"RM {int(x):,}"

        return (
            f"{self.n} similar items: low {rm(self.low)}, middle half {rm(self.q1)} "
            f"to {rm(self.q3)}, median {rm(self.median)}, high {rm(self.high)}"
        )


def market_stats(prices) -> MarketStats | None:
    ordered = sorted(Decimal(p) for p in prices)
    if not ordered:
        return None
    n = len(ordered)
    return MarketStats(
        n=n,
        low=ordered[0],
        q1=ordered[(n - 1) // 4],
        median=median(ordered),
        q3=ordered[(3 * (n - 1)) // 4],
        high=ordered[-1],
    )