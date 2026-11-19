from pathlib import Path
from typing import get_args

from backend.app.boundaries.calendar_port import McpCalendarPort
from backend.app.graph.nodes import run_tool
from backend.app.graph.ports import InMemoryCalendar
from backend.app.llm.clarify import CLARIFY_SYSTEM, ClarifyStep
from backend.app.tools import CALENDAR, CLARIFY, TOOLS, render_markdown

ROOT = Path(__file__).resolve().parents[2]


def names(group: str) -> set[str]:
    return {tool.name for tool in TOOLS if tool.group == group}


def test_registry_entries_are_complete_and_unique():
    assert len({tool.name for tool in TOOLS}) == len(TOOLS)
    for tool in TOOLS:
        assert all(str(value).strip() for value in vars(tool).values()), tool.name


def test_clarify_tools_match_what_the_model_can_choose():
    allowed = set(get_args(ClarifyStep.model_fields["tool"].annotation))
    assert names(CLARIFY) == allowed
    for name in allowed:
        assert f"- {name}:" in CLARIFY_SYSTEM  # the prompt describes every registered tool


def test_every_lookup_tool_is_handled_by_the_runner():
    for name in ("get_listing", "get_market_stats", "search_knowledge"):
        assert not run_tool(name, {}).startswith("unknown tool"), name
    assert run_tool("not_a_tool", {}).startswith("unknown tool")


def test_calendar_tools_match_the_calendar_port():
    expected = names(CALENDAR)
    assert expected == {n for n in dir(InMemoryCalendar) if not n.startswith("_")}
    for name in expected:
        assert callable(getattr(McpCalendarPort, name)), name


def test_the_generated_tools_doc_is_current():
    doc = (ROOT / "docs" / "tools.md").read_text(encoding="utf-8").replace("\r\n", "\n")
    assert doc == render_markdown()