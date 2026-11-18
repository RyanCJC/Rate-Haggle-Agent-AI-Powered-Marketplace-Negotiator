from pydantic import BaseModel, ConfigDict


class Persona(BaseModel):
    model_config = ConfigDict(frozen=True)

    name: str
    split: str  # "dev" (tune on these) or "test" (score once at the end)
    reservation_ratio: float  # hidden floor = ratio x asking price
    concede_share: float  # share of the gap to the buyer's offer closed each round
    close_gap: float  # accept if offer >= ask x (1 - close_gap) and >= reservation
    max_rounds: int  # buyer offers the seller tolerates before walking away
    lowball_ratio: float  # offers below ask x ratio are brushed off, no concession
    language: str = "en"  # "en" or "ms_en"
    evasive_rate: float = 0.0  # chance a reply states no price
    probes_budget: bool = False
    pressure: bool = False
    term_change_round: int | None = None
    term_change_ratio: float = 0.0  # ask rises by this share at term_change_round
    tags: tuple[str, ...] = ()
    serious_ratio: float = 0.85  # seller only concedes to offers >= reservation x this
    accept_premium: float = 0.05  # share above reservation demanded at round 1, fades to 0


DEV_PERSONAS = [
    Persona(name="firm", split="dev", reservation_ratio=0.85, concede_share=0.10,
            close_gap=0.02, max_rounds=8, lowball_ratio=0.60, tags=("firm",)),
    Persona(name="flexible", split="dev", reservation_ratio=0.72, concede_share=0.55,
            close_gap=0.05, max_rounds=10, lowball_ratio=0.45, tags=("flexible",)),
    Persona(name="evasive", split="dev", reservation_ratio=0.80, concede_share=0.25,
            close_gap=0.03, max_rounds=8, lowball_ratio=0.55, evasive_rate=0.4,
            tags=("evasive",)),
    Persona(name="pressure", split="dev", reservation_ratio=0.78, concede_share=0.35,
            close_gap=0.04, max_rounds=5, lowball_ratio=0.50, pressure=True,
            tags=("pressure",)),
    Persona(name="mixed_my_en", split="dev", reservation_ratio=0.78, concede_share=0.40,
            close_gap=0.04, max_rounds=8, lowball_ratio=0.50, language="ms_en",
            tags=("mixed_language",)),
    Persona(name="budget_prober", split="dev", reservation_ratio=0.80, concede_share=0.30,
            close_gap=0.03, max_rounds=8, lowball_ratio=0.50, probes_budget=True,
            tags=("probes_budget",)),
    Persona(name="term_changer", split="dev", reservation_ratio=0.78, concede_share=0.35,
            close_gap=0.04, max_rounds=8, lowball_ratio=0.50, term_change_round=2,
            term_change_ratio=0.05, tags=("term_change",)),
    Persona(name="dishonest", split="dev", reservation_ratio=0.75, concede_share=0.30,
            close_gap=0.03, max_rounds=8, lowball_ratio=0.50, tags=("dishonest",)),
    Persona(name="walker_2", split="dev", reservation_ratio=0.80, concede_share=0.30,
            close_gap=0.03, max_rounds=2, lowball_ratio=0.50, tags=("impatient",)),
    Persona(name="walker_3", split="dev", reservation_ratio=0.84, concede_share=0.20,
            close_gap=0.03, max_rounds=3, lowball_ratio=0.55, tags=("impatient",)),
    Persona(name="walker_4", split="dev", reservation_ratio=0.76, concede_share=0.30,
            close_gap=0.04, max_rounds=4, lowball_ratio=0.50, tags=("impatient",)),
]

TEST_PERSONAS = [
    Persona(name="firm_pressure", split="test", reservation_ratio=0.88, concede_share=0.08,
            close_gap=0.02, max_rounds=6, lowball_ratio=0.60, pressure=True,
            tags=("firm", "pressure")),
    Persona(name="flexible_prober", split="test", reservation_ratio=0.70, concede_share=0.50,
            close_gap=0.05, max_rounds=10, lowball_ratio=0.40, probes_budget=True,
            tags=("flexible", "probes_budget")),
    Persona(name="stubborn_ms", split="test", reservation_ratio=0.90, concede_share=0.05,
            close_gap=0.015, max_rounds=7, lowball_ratio=0.60, language="ms_en",
            tags=("firm", "mixed_language")),
    Persona(name="quick_walker", split="test", reservation_ratio=0.80, concede_share=0.30,
            close_gap=0.03, max_rounds=3, lowball_ratio=0.50, tags=("impatient",)),
]

TEST2_PERSONAS = [
    Persona(name="short_fuse", split="test2", reservation_ratio=0.82, concede_share=0.35,
            close_gap=0.03, max_rounds=2, lowball_ratio=0.50, tags=("impatient",)),
    Persona(name="brisk_mid", split="test2", reservation_ratio=0.78, concede_share=0.25,
            close_gap=0.03, max_rounds=3, lowball_ratio=0.55, tags=("impatient",)),
    Persona(name="brisk_firm", split="test2", reservation_ratio=0.88, concede_share=0.12,
            close_gap=0.02, max_rounds=3, lowball_ratio=0.60, tags=("impatient",)),
    Persona(name="moderate", split="test2", reservation_ratio=0.84, concede_share=0.20,
            close_gap=0.03, max_rounds=5, lowball_ratio=0.55, tags=("moderate",)),
    Persona(name="patient_soft", split="test2", reservation_ratio=0.75, concede_share=0.30,
            close_gap=0.03, max_rounds=8, lowball_ratio=0.50, tags=("patient",)),
    Persona(name="patient_firm", split="test2", reservation_ratio=0.90, concede_share=0.10,
            close_gap=0.02, max_rounds=8, lowball_ratio=0.60, tags=("patient",)),
]

PERSONAS = DEV_PERSONAS + TEST_PERSONAS + TEST2_PERSONAS


def get_persona(name: str) -> Persona:
    for persona in PERSONAS:
        if persona.name == name:
            return persona
    raise KeyError(name)