import argparse
import json
import subprocess
from pathlib import Path

from backend.app.evaluation.policies import default_policies
from backend.app.evaluation.protocol import (
    ASKINGS,
    BASELINES,
    DEFAULT_SEEDS,
    HEADLINE,
    RATIOS,
    ROUND2_BASELINES,
    ROUND2_HEADLINE,
    split_refusal,
)
from backend.app.evaluation.report import render_report
from backend.app.evaluation.round2 import criteria_section
from backend.app.evaluation.runner import build_scenarios, run_suite
from backend.app.sim.personas import DEV_PERSONAS, TEST2_PERSONAS, TEST_PERSONAS

OUT = Path("eval/reports")

# split -> (file prefix, sellers, headline policy, baselines)
SPLITS = {
    "dev": ("dev", DEV_PERSONAS, HEADLINE, BASELINES),
    "test": ("final_test", TEST_PERSONAS, HEADLINE, BASELINES),
    "test2": ("round2_test", TEST2_PERSONAS, ROUND2_HEADLINE, ROUND2_BASELINES),
}


def git(*args: str) -> str:
    try:
        done = subprocess.run(["git", *args], capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return ""
    return done.stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", choices=list(SPLITS), default="dev")
    parser.add_argument("--seeds", type=int, default=DEFAULT_SEEDS)
    parser.add_argument("--final", action="store_true", help="confirm a frozen final-split run")
    parser.add_argument("--force", action="store_true", help="rerun a scored final split")
    args = parser.parse_args()

    prefix, personas, headline, baselines = SPLITS[args.split]
    report_file = OUT / f"{prefix}_report.md"
    runs_file = OUT / f"{prefix}_runs.json"
    commit = git("rev-parse", "--short", "HEAD")
    dirty = bool(git("status", "--porcelain"))
    reason = split_refusal(args.split, args.final, args.force, report_file.exists(), dirty)
    if reason:
        raise SystemExit(f"REFUSED: {reason}")

    seeds = tuple(range(args.seeds))
    results = run_suite(default_policies(), build_scenarios(personas, ASKINGS, RATIOS, seeds))
    meta = {
        "commit": commit,
        "dirty": dirty,
        "personas": [p.name for p in personas],
        "askings": ASKINGS,
        "ratios": RATIOS,
        "seeds": args.seeds,
    }
    report = render_report(results, args.split, headline, baselines, meta)
    if args.split == "test2":
        report += "\n" + criteria_section(results, personas)

    OUT.mkdir(parents=True, exist_ok=True)
    runs_file.write_text(json.dumps([r.model_dump(mode="json") for r in results]))
    report_file.write_text(report, encoding="utf-8")
    print(report)
    print(f"saved {report_file} and {runs_file}")


if __name__ == "__main__":
    main()