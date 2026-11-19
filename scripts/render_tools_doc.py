from pathlib import Path

from backend.app.tools import render_markdown

OUT = Path("docs/tools.md")


def main() -> None:
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(render_markdown(), encoding="utf-8", newline="\n")
    print(f"saved {OUT}")


if __name__ == "__main__":
    main()