from app.services.scheduling import MIN_TRIM_MM, Demand, blank_size, manual_plan, optimize


def _demands():
    specs = [(1, 450, 350, 250, "B-1", 5000), (2, 300, 200, 150, "B-1", 3000), (3, 500, 300, 200, "B-1", 2000),
             (4, 400, 250, 300, "C-1", 4000), (5, 350, 250, 100, "C-1", 1000)]
    out = []
    for key, l, w, h, spec, qty in specs:
        bw, bl = blank_size(l, w, h)
        out.append(Demand(key, f"BX{key}", spec, bw, bl, qty))
    return out


def test_all_demand_covered_and_min_trim_respected():
    ds = _demands()
    plan = optimize(ds)
    produced: dict[int, int] = {}
    for r in plan.runs:
        assert r.trim_mm >= MIN_TRIM_MM
        assert len({s.item_code for s in r.slots}) == len(r.slots) <= 2
        assert len({r.board_spec}) == 1
        for s in r.slots:
            produced[s.key] = produced.get(s.key, 0) + s.ups * r.cuts
    for d in ds:
        assert produced[d.key] >= d.sheets


def test_optimized_beats_manual_baseline():
    ds = _demands()
    assert optimize(ds).trim_rate < manual_plan(ds).trim_rate
