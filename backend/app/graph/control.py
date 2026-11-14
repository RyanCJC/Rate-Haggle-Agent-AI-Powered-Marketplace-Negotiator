from backend.app.core.models import Violation

from .builder import make_config
from .nodes import check_draft, context, decision_of


def pending(graph, thread_id: str) -> tuple[str, ...]:
    """Nodes waiting to run. Empty when the negotiation is finished."""
    return tuple(graph.get_state(make_config(thread_id)).next)


def current_state(graph, thread_id: str) -> dict:
    return graph.get_state(make_config(thread_id)).values


def approve(graph, thread_id: str):
    """Let the paused message go out and run until the next pause or the end."""
    return graph.invoke(None, config=make_config(thread_id))


def edit_draft(graph, thread_id: str, new_text: str) -> list[Violation]:
    """Replace the pending draft, but only if the new text passes the same validators."""
    values = current_state(graph, thread_id)
    violations = check_draft(decision_of(values), new_text, context(values))
    if violations:
        return violations
    graph.update_state(make_config(thread_id), {"draft": new_text}, as_node="validate")
    return []