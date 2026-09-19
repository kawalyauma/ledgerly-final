from ledgerly_response_intelligence.models import Purpose
from ledgerly_response_intelligence.strategies import STRATEGIES, available_strategies, select_strategy


def test_strategy_library_is_broad() -> None:
    assert len(STRATEGIES) >= 15
    assert len(available_strategies(Purpose.analysis)) >= 8
    assert len(available_strategies(Purpose.account_for)) >= 5


def test_different_seeds_can_select_different_architectures() -> None:
    selected = {
        select_strategy(
            Purpose.analysis,
            seed=f"seed-{index}",
            has_comparison=True,
            has_relationships=True,
            has_limits=True,
            deep=True,
        ).strategy_id
        for index in range(30)
    }
    assert len(selected) >= 3
