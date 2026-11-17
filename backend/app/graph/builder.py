from decimal import Decimal

from langgraph.graph import END, START, StateGraph

from .nodes import (
    make_nodes,
    needs_clarification,
    route_after_clarify,
    route_after_execute,
    route_after_ingest,
    route_after_validate,
)
from .state import NegState, initial_state

RECURSION_LIMIT = 200  # LangGraph's default is too low for a long negotiation


def make_config(thread_id: str | None = None) -> dict:
    config: dict = {"recursion_limit": RECURSION_LIMIT}
    if thread_id:
        config["configurable"] = {"thread_id": thread_id}
    return config


def build_graph(
    llm,
    seller,
    checkpointer=None,
    approve_each_message: bool = False,
    clarify: bool = False,
    knowledge=None,
    ground: bool = False,
    calendar=None,
    approve_close: bool = False,
):

    if approve_close and checkpointer is None:
        raise ValueError("approve_close needs a checkpointer: a paused run must be stored")
    
    nodes = make_nodes(llm, seller, knowledge=knowledge, ground=ground, calendar=calendar, approve_close=approve_close)

    def route_after_plan(s: NegState) -> str:
        return "clarify" if clarify and needs_clarification(s) else "compose"

    def route_after_finalize(s: NegState) -> str:
        return "schedule" if calendar is not None and s.get("outcome") == "deal" else END

    graph = StateGraph(NegState)
    for name, fn in nodes.items():
        graph.add_node(name, fn)

    graph.add_edge(START, "plan")
    graph.add_conditional_edges(
        "plan", route_after_plan, {"clarify": "clarify", "compose": "compose"}
    )
    graph.add_conditional_edges(
        "clarify", route_after_clarify, {"compose": "compose", "validate": "validate"}
    )
    graph.add_edge("compose", "validate")
    graph.add_conditional_edges(
        "validate",
        route_after_validate,
        {"execute": "execute", "compose": "compose", "fallback": "fallback"},
    )
    graph.add_edge("fallback", "execute")
    graph.add_conditional_edges(
        "execute", route_after_execute, {"ingest": "ingest", "finalize": "finalize"}
    )
    graph.add_conditional_edges(
        "ingest", route_after_ingest, {"plan": "plan", "finalize": "finalize"}
    )
    graph.add_conditional_edges(
        "finalize", route_after_finalize, {"schedule": "schedule", END: END}
    )
    graph.add_edge("schedule", END)
    return graph.compile(
        checkpointer=checkpointer,
        interrupt_before=["execute"] if approve_each_message else None,
    )


def run_graph(
    graph,
    asking,
    budget,
    style: str = "balanced",
    opening_text: str | None = None,
    thread_id: str | None = None,
    listing: dict | None = None,
    comparables: list | None = None,
    memory_notes: list[str] | None = None,
    memory_prices: list | None = None,
):
    state = initial_state(
        Decimal(asking),
        Decimal(budget),
        style,
        opening_text,
        listing,
        comparables,
        run_id=thread_id,
        memory_notes=memory_notes,
        memory_prices=memory_prices,
    )
    return graph.invoke(state, config=make_config(thread_id))