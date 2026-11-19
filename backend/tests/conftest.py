import os

# The test suite must never call a real LLM: it burns quota and makes runs slow and flaky.
os.environ["HAGGLE_LLM"] = "offline"