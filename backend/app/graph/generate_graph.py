from decimal import Decimal
from backend.app.sim.personas import get_persona

from backend.app.graph.builder import build_graph
from backend.app.llm.fake import RuleBasedLLM
from backend.app.graph.ports import SimSellerPort
from backend.app.sim.seller import SimSeller
from PIL import Image
import io

llm = RuleBasedLLM()
seller = SimSellerPort(SimSeller(Decimal("1200"), persona=get_persona("flexible"), seed=0))

graph = build_graph(llm, seller, checkpointer=None, approve_close=False)

# Generate PNG image
img_bytes = graph.get_graph().draw_mermaid_png()
with open("graph.png", "wb") as f:
    f.write(img_bytes)