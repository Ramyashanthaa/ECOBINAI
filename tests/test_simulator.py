"""Tests for the bin hardware simulator."""
import time
import pytest
from backend.hardware.simulator import BinSimulator, get_lid_states


def test_lid_opens():
    sim = BinSimulator()
    sim.open_lid("RECYCLABLE", duration=1)
    states = get_lid_states()
    assert states["RECYCLABLE"] is True


def test_lid_auto_closes():
    sim = BinSimulator()
    sim.open_lid("COMPOST", duration=1)
    time.sleep(1.3)
    states = get_lid_states()
    assert states["COMPOST"] is False


def test_invalid_bin_raises():
    sim = BinSimulator()
    with pytest.raises(ValueError):
        sim.open_lid("UNKNOWN_BIN")


def test_close_all():
    sim = BinSimulator()
    sim.open_lid("RECYCLABLE", duration=60)
    sim.open_lid("TRASH", duration=60)
    sim.close_all()
    states = get_lid_states()
    assert not any(states.values())


def test_websocket_event_broadcast():
    import asyncio
    from backend.hardware.simulator import subscribe, unsubscribe

    async def _test():
        q = subscribe()
        sim = BinSimulator()
        sim.open_lid("HAZARDOUS", duration=1)
        event = await asyncio.wait_for(q.get(), timeout=2.0)
        unsubscribe(q)
        return event

    event = asyncio.run(_test())
    assert event["type"] == "lid_open"
    assert event["bin"] == "HAZARDOUS"
