from collections import defaultdict

from .metrics import (
    bootstrap_ci,
    clustered_scores,
    paired_difference,
    summarize,
    summarize_by,
)

LEGEND = """## How to read this

- **score**: the share of the seller's room to move (asking price minus the seller's hidden floor)
  that the buyer captured, averaged over negotiations where a deal was possible. 1.0 means bought
  at the seller's floor. No deal, a broken rule (offer above the budget, a leaked limit) or an
  impossible deal counts as **0**, so a policy cannot look good by breaking rules.
- **deal rate**: deals closed, among negotiations where the seller's floor was within the budget.
- **violation rate**: negotiations with an offer above the budget or a leaking message.
- **surplus of clean deals**: the average over successful, rule-abiding deals only. It ignores
  every failure, so read it next to the score, never alone.
- **intervals**: 95% bootstrap over independent cases (seller x budget ratio), not over runs."""

CAVEATS = """## Caveats

- The sellers are rule-based simulators written by the author. These numbers describe behaviour
  against those rules, not against real people.
- This layer measures the price strategy and the safety checks without a language model. Wording,
  reading messages and honesty about item facts are evaluated separately.
- Prices scale with the asking price and most sellers are deterministic, so the effective sample
  is the number of seller x budget-ratio cases, not the number of runs.
- Dev sellers were used while building the strategy. The test sellers were scored once, on
  committed code.
- B2 ignores the budget on purpose, to show what the safety layer prevents. B3 is the fair
  baseline: a budget-aware fixed ladder."""


def pct(value) -> str:
    return "-" if value is None else f"{value:.0%}"


def num(value, digits: int = 2) -> str:
    return "-" if value is None else f"{value:.{digits}f}"


def render_report(results, split: str, headline: str, baselines, meta: dict) -> str:
    by_policy = defaultdict(list)
    for result in results:
        by_policy[result.policy].append(result)

    commit = meta.get("commit") or "unknown"
    dirty = " (**uncommitted changes**)" if meta.get("dirty") else ""
    per_policy = len(results) // max(1, len(by_policy))
    out = [
        f"# Evaluation on the {split} split",
        "",
        f"- Code version: `{commit}`{dirty}",
        f"- Sellers: {', '.join(meta['personas'])}",
        (
            f"- Grid: asking prices {list(meta['askings'])} x budget ratios "
            f"{list(meta['ratios'])} x {meta['seeds']} seeds "
            f"= {per_policy} negotiations per policy"
        ),
        "",
        LEGEND,
        "",
        "## Policies",
        "",
        (
            "| policy | runs | feasible | deal rate | score [95% CI] | violation rate "
            "| impossible deals | surplus of clean deals | rounds |"
        ),
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name, runs in by_policy.items():
        s = summarize(runs)
        ci = bootstrap_ci(clustered_scores(runs))
        score = "-" if ci is None else f"{ci[0]:.3f} [{ci[1]:.3f}, {ci[2]:.3f}]"
        label = f"{name} (headline)" if name == headline else name
        out.append(
            f"| {label} | {s['runs']} | {s['feasible_runs']} | {pct(s['deal_rate_feasible'])} "
            f"| {score} | {pct(s['violation_rate'])} | {s['deals_when_infeasible']} "
            f"| {num(s['mean_surplus'])} | {num(s['mean_rounds'], 1)} |"
        )

    out += [
        "",
        f"## {headline} against the baselines (paired: the same negotiation each time)",
        "",
        "| baseline | score difference [95% CI] | won / tied / lost | independent cases |",
        "|---|---|---|---|",
    ]
    for base in baselines:
        if base not in by_policy or headline not in by_policy:
            continue
        d = paired_difference(by_policy[headline], by_policy[base])
        diff = (
            "-"
            if d["mean_diff"] is None
            else f"{d['mean_diff']:+.3f} [{d['lo']:+.3f}, {d['hi']:+.3f}]"
        )
        out.append(f"| {base} | {diff} | {d['wins']} / {d['ties']} / {d['losses']} | {d['clusters']} |")

    if headline in by_policy:
        out += [
            "",
            f"## {headline} by seller",
            "",
            "| seller | runs | deal rate | score | violation rate |",
            "|---|---|---|---|---|",
        ]
        for persona, s in summarize_by(by_policy[headline], "persona").items():
            out.append(
                f"| {persona} | {s['runs']} | {pct(s['deal_rate_feasible'])} "
                f"| {num(s['mean_score'], 3)} | {pct(s['violation_rate'])} |"
            )

    out += ["", CAVEATS, ""]
    return "\n".join(out)