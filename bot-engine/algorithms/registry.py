"""
ALGO REGISTRY
=============
To add a new algorithm:
  1. Create your config file in algorithms/configs/my_algo.json
  2. Create your algo class in algorithms/my_algo.py (extends BaseAlgo)
  3. Add it to ALGO_REGISTRY below — one line
  4. From Admin Panel, assign it to a market

That's it. No other files need to change.
"""

from algorithms.crypto import CryptoAlgo
from algorithms.indian_markets import IndianMarketsAlgo
from algorithms.commodities import CommoditiesAlgo
from algorithms.global_general import GlobalAlgo

# ─────────────────────────────────────────────────────────────────────────────
# Map: market_type → AlgoClass
# To switch algorithm for a market: change the value below
# ─────────────────────────────────────────────────────────────────────────────
ALGO_REGISTRY = {
    "indian":      IndianMarketsAlgo,
    "crypto":      CryptoAlgo,
    "commodities": CommoditiesAlgo,
    "global":      GlobalAlgo,

    # Add your custom algos below:
    # "my_strategy": MyStrategyAlgo,
}

def get_algo_class(market_type: str):
    cls = ALGO_REGISTRY.get(market_type)
    if not cls:
        raise ValueError(f"No algorithm registered for market: {market_type}")
    return cls

def list_algos() -> list[str]:
    return list(ALGO_REGISTRY.keys())