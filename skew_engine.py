"""
skew_engine.py
Constant-Maturity 30-Day Volatility Smile Engine for SPX 25Δ Options:
  - Bracketing expiration selection (Near <= 30 DTE, Far > 30 DTE) & variance interpolation
  - Black-Scholes vol-adjusted ~25Δ wing + ATM strike targeting snapped to exchange chains
  - ATM-normalized Risk Reversal (RR / ATM IV), Put/Call Wing decomposition, 25Δ Butterfly curvature, and log-strike Slope
  - Local daily EOD skew history logging & empirical percentile rank once >= 20 sessions are collected
"""

import json
import math
import os
import time
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_SKEW_HISTORY_PATH = os.path.join(os.path.dirname(__file__), "data", "skew_history.json")
_HISTORY_WRITE_TIMESTAMPS: Dict[Tuple[str, str], float] = {}


def select_constant_30d_expirations(expirations: Iterable[str], today: date) -> Dict[str, Optional[Tuple[str, int]]]:
    """
    Select Near (T1 <= 30 DTE) and Far (T2 > 30 DTE) bracketing expirations for Constant-30D interpolation.
    Prefers 10..30 DTE for Near (fallback 7..30 DTE) and 31..65 DTE for Far (fallback 31..90 DTE).
    """
    parsed: List[Tuple[int, str]] = []
    seen_dtes = set()
    for raw in expirations or []:
        s = str(raw)[:8]
        if len(s) != 8 or not s.isdigit():
            continue
        try:
            dte = (datetime.strptime(s, "%Y%m%d").date() - today).days
        except ValueError:
            continue
        if dte < 7 or dte > 120 or dte in seen_dtes:
            continue
        seen_dtes.add(dte)
        parsed.append((dte, s))

    if not parsed:
        return {"near": None, "far": None}

    parsed.sort(key=lambda x: x[0])

    near_pool = [(dte, exp) for dte, exp in parsed if 10 <= dte <= 30]
    if not near_pool:
        near_pool = [(dte, exp) for dte, exp in parsed if 7 <= dte <= 30]
    near_sel = (near_pool[-1][1], near_pool[-1][0]) if near_pool else None

    far_pool = [(dte, exp) for dte, exp in parsed if 31 <= dte <= 65]
    if not far_pool:
        far_pool = [(dte, exp) for dte, exp in parsed if 31 <= dte <= 90]
    far_sel = (far_pool[0][1], far_pool[0][0]) if far_pool else None

    # Single-expiry fallback when only one side of 30 DTE exists
    if near_sel is None and far_sel is not None:
        return {"near": far_sel, "far": None}
    if near_sel is None and far_sel is None:
        closest = min(parsed, key=lambda x: abs(x[0] - 30))
        return {"near": (closest[1], closest[0]), "far": None}

    return {"near": near_sel, "far": far_sel}


def _snap_strike(target: float, sorted_strikes: Optional[List[float]], step: float) -> float:
    if sorted_strikes:
        return float(min(sorted_strikes, key=lambda x: (abs(x - target), abs(x))))
    s = step if step > 0 else 25.0
    return float(round(target / s) * s)


def compute_25d_smile_strikes(
    spot: float,
    vol_pct: float,
    dte: int,
    available_strikes: Optional[Iterable[float]] = None,
    step: float = 25.0,
) -> Tuple[float, float, float]:
    """
    Compute BS vol-adjusted ~25Δ Put, ATM, and ~25Δ Call strikes snapped to chain strikes (or `step`).
    Uses skew-adjusted wing vols (1.05 * sigma for puts, 0.85 * sigma for calls) so wings track ~±0.25Δ.
    """
    s_spot = float(spot) if spot and spot > 0 else 6000.0
    sigma = max(0.08, min(0.80, float(vol_pct or 20.0) / 100.0))
    t_yr = max(int(dte or 30), 1) / 365.0
    sqrt_t = math.sqrt(t_yr)

    sig_p = 1.05 * sigma
    sig_c = 0.85 * sigma

    raw_atm = s_spot
    raw_put = s_spot * math.exp(-0.6745 * sig_p * sqrt_t - 0.5 * sig_p * sig_p * t_yr)
    raw_call = s_spot * math.exp(0.6745 * sig_c * sqrt_t - 0.5 * sig_c * sig_c * t_yr)

    sorted_strikes: Optional[List[float]] = None
    if available_strikes is not None:
        cleaned = sorted({float(k) for k in available_strikes if k and float(k) > 0 and math.isfinite(float(k))})
        if len(cleaned) >= 3:
            sorted_strikes = cleaned

    atm_k = _snap_strike(raw_atm, sorted_strikes, step)
    put_k = _snap_strike(raw_put, sorted_strikes, step)
    call_k = _snap_strike(raw_call, sorted_strikes, step)

    # Guarantee strict ordering put_k < atm_k < call_k
    if put_k >= atm_k:
        if sorted_strikes:
            below = [k for k in sorted_strikes if k < atm_k]
            put_k = below[-1] if below else atm_k - step
        else:
            put_k = atm_k - step

    if call_k <= atm_k:
        if sorted_strikes:
            above = [k for k in sorted_strikes if k > atm_k]
            call_k = above[0] if above else atm_k + step
        else:
            call_k = atm_k + step

    return float(put_k), float(atm_k), float(call_k)


def classify_skew_regime(
    norm_rr: Optional[float],
    put_wing: Optional[float] = None,
    call_wing: Optional[float] = None,
    butterfly_norm: Optional[float] = None,
) -> Dict[str, Any]:
    """Classify ATM-normalized skew regime, Put vs Call wing driver, and Butterfly convexity."""
    if norm_rr is None or not math.isfinite(norm_rr):
        regime, badge = "NORMAL", "NORMAL"
    elif norm_rr >= 0.55:
        regime, badge = "EXTREME", "EXTREME"
    elif norm_rr >= 0.42:
        regime, badge = "ELEVATED", "ELEVATED"
    elif norm_rr < 0.22:
        regime, badge = "COMPLACENT", "COMPLACENT"
    else:
        regime, badge = "NORMAL", "NORMAL"

    put_share = 0.5
    driver = "BALANCED SMILE"
    if (
        put_wing is not None
        and call_wing is not None
        and math.isfinite(put_wing)
        and math.isfinite(call_wing)
    ):
        total_w = put_wing + call_wing
        if abs(total_w) > 0.2:
            if put_wing >= 0 and call_wing >= 0 and total_w > 0.2:
                put_share = max(0.0, min(1.0, put_wing / total_w))
            elif put_wing > 0 and call_wing <= 0:
                put_share = 1.0
            elif call_wing > 0 and put_wing <= 0:
                put_share = 0.0
            else:
                put_share = 0.5
            if put_share >= 0.62:
                driver = "PUT CRASH BID"
            elif put_share <= 0.38:
                driver = "CALL OVERWRITING"
            else:
                driver = "BALANCED SMILE"

    if butterfly_norm is None or not math.isfinite(butterfly_norm):
        convexity = "NORMAL CURVATURE"
    elif butterfly_norm >= 0.05:
        convexity = "FAT TAILS"
    elif butterfly_norm >= 0.02:
        convexity = "NORMAL CURVATURE"
    else:
        convexity = "LINEAR TILT"

    return {
        "regime": regime,
        "badge": badge,
        "driver": driver,
        "put_share": round(float(put_share), 3),
        "convexity": convexity,
    }


def compute_tenor_smile(
    put_iv: Optional[float],
    atm_iv: Optional[float],
    call_iv: Optional[float],
    put_strike: Optional[float],
    atm_strike: Optional[float],
    call_strike: Optional[float],
    dte: Optional[int],
    expiration: str = "",
    put_mid: Optional[float] = None,
    atm_mid: Optional[float] = None,
    call_mid: Optional[float] = None,
    put_delta: Optional[float] = None,
    atm_delta: Optional[float] = None,
    call_delta: Optional[float] = None,
) -> Optional[Dict[str, Any]]:
    """Compute smile metrics for a single 3-leg (25Δ Put / ATM / 25Δ Call) expiration."""
    if put_iv is None or call_iv is None or put_iv <= 0 or call_iv <= 0:
        return None
    if not (math.isfinite(put_iv) and math.isfinite(call_iv)):
        return None

    atm_estimated = False
    if atm_iv is not None and math.isfinite(atm_iv) and atm_iv > 0:
        atm_iv_eff = float(atm_iv)
    else:
        atm_iv_eff = 0.5 * (float(put_iv) + float(call_iv))
        atm_estimated = True

    raw_rr = float(put_iv) - float(call_iv)
    norm_rr = raw_rr / atm_iv_eff if atm_iv_eff > 0 else 0.0
    skew_ratio = float(put_iv) / float(call_iv) if call_iv > 0 else 1.0

    put_wing = float(put_iv) - atm_iv_eff
    call_wing = atm_iv_eff - float(call_iv)
    put_wing_norm = put_wing / atm_iv_eff if atm_iv_eff > 0 else 0.0
    call_wing_norm = call_wing / atm_iv_eff if atm_iv_eff > 0 else 0.0

    butterfly = 0.5 * (float(put_iv) + float(call_iv)) - atm_iv_eff
    butterfly_norm = butterfly / atm_iv_eff if atm_iv_eff > 0 else 0.0

    raw_slope = None
    norm_slope = None
    if put_strike and call_strike and put_strike > 0 and call_strike > put_strike:
        span_pct = math.log(float(call_strike) / float(put_strike)) * 100.0
        if span_pct > 1e-6:
            raw_slope = raw_rr / span_pct
            norm_slope = norm_rr / span_pct

    net_credit = (float(put_mid) - float(call_mid)) if (put_mid is not None and call_mid is not None) else None

    return {
        "expiration": str(expiration or ""),
        "dte": int(dte) if dte is not None else None,
        "put_strike": float(put_strike) if put_strike is not None else None,
        "atm_strike": float(atm_strike) if atm_strike is not None else None,
        "call_strike": float(call_strike) if call_strike is not None else None,
        "put_iv": round(float(put_iv), 2),
        "atm_iv": round(float(atm_iv_eff), 2),
        "call_iv": round(float(call_iv), 2),
        "atm_estimated": atm_estimated,
        "put_mid": round(float(put_mid), 2) if put_mid is not None else None,
        "atm_mid": round(float(atm_mid), 2) if atm_mid is not None else None,
        "call_mid": round(float(call_mid), 2) if call_mid is not None else None,
        "put_delta": round(float(put_delta), 3) if put_delta is not None else None,
        "atm_delta": round(float(atm_delta), 3) if atm_delta is not None else None,
        "call_delta": round(float(call_delta), 3) if call_delta is not None else None,
        "net_credit": round(net_credit, 2) if net_credit is not None else None,
        "raw_rr": round(raw_rr, 2),
        "norm_rr": round(norm_rr, 4),
        "skew_ratio": round(skew_ratio, 3),
        "put_wing": round(put_wing, 2),
        "put_wing_norm": round(put_wing_norm, 4),
        "call_wing": round(call_wing, 2),
        "call_wing_norm": round(call_wing_norm, 4),
        "butterfly": round(butterfly, 2),
        "butterfly_norm": round(butterfly_norm, 4),
        "raw_slope": round(raw_slope, 4) if raw_slope is not None else None,
        "norm_slope": round(norm_slope, 5) if norm_slope is not None else None,
    }


def _var_interp_iv(iv1: float, d1: float, iv2: float, d2: float, w1: float, w2: float, target_dte: float) -> float:
    total_var_t = max(1e-6, (w1 * (iv1 * iv1) * d1 + w2 * (iv2 * iv2) * d2) / target_dte)
    return math.sqrt(total_var_t)


def interpolate_constant_30d(
    near_smile: Optional[Dict[str, Any]],
    far_smile: Optional[Dict[str, Any]],
    target_dte: float = 30.0,
) -> Optional[Dict[str, Any]]:
    """
    Total-variance interpolate Near (T1 < 30D) and Far (T2 > 30D) 3-leg smiles to Constant 30-Day maturity.
    Gracefully falls back to single valid tenor if one side is unavailable.
    """
    if near_smile is None and far_smile is None:
        return None

    can_interp = (
        near_smile is not None
        and far_smile is not None
        and near_smile.get("dte") is not None
        and far_smile.get("dte") is not None
        and float(near_smile["dte"]) < target_dte < float(far_smile["dte"])
    )

    if can_interp:
        d1 = float(near_smile["dte"])
        d2 = float(far_smile["dte"])
        w2 = (target_dte - d1) / (d2 - d1)
        w1 = 1.0 - w2

        put_iv_30 = _var_interp_iv(near_smile["put_iv"], d1, far_smile["put_iv"], d2, w1, w2, target_dte)
        atm_iv_30 = _var_interp_iv(near_smile["atm_iv"], d1, far_smile["atm_iv"], d2, w1, w2, target_dte)
        call_iv_30 = _var_interp_iv(near_smile["call_iv"], d1, far_smile["call_iv"], d2, w1, w2, target_dte)

        raw_rr = put_iv_30 - call_iv_30
        norm_rr = raw_rr / atm_iv_30 if atm_iv_30 > 0 else 0.0
        skew_ratio = put_iv_30 / call_iv_30 if call_iv_30 > 0 else 1.0
        put_wing = put_iv_30 - atm_iv_30
        call_wing = atm_iv_30 - call_iv_30
        put_wing_norm = put_wing / atm_iv_30 if atm_iv_30 > 0 else 0.0
        call_wing_norm = call_wing / atm_iv_30 if atm_iv_30 > 0 else 0.0
        butterfly = 0.5 * (put_iv_30 + call_iv_30) - atm_iv_30
        butterfly_norm = butterfly / atm_iv_30 if atm_iv_30 > 0 else 0.0

        norm_slope = None
        if near_smile.get("norm_slope") is not None and far_smile.get("norm_slope") is not None:
            norm_slope = w1 * float(near_smile["norm_slope"]) + w2 * float(far_smile["norm_slope"])
        raw_slope = None
        if near_smile.get("raw_slope") is not None and far_smile.get("raw_slope") is not None:
            raw_slope = w1 * float(near_smile["raw_slope"]) + w2 * float(far_smile["raw_slope"])

        atm_est = bool(near_smile.get("atm_estimated") or far_smile.get("atm_estimated"))
        cls_info = classify_skew_regime(norm_rr, put_wing, call_wing, butterfly_norm)

        return {
            "current": round(raw_rr, 2),
            "raw_rr": round(raw_rr, 2),
            "norm_rr": round(norm_rr, 4),
            "skew_ratio": round(skew_ratio, 3),
            "put_iv": round(put_iv_30, 2),
            "atm_iv": round(atm_iv_30, 2),
            "call_iv": round(call_iv_30, 2),
            "atm_estimated": atm_est,
            "put_wing": round(put_wing, 2),
            "put_wing_norm": round(put_wing_norm, 4),
            "call_wing": round(call_wing, 2),
            "call_wing_norm": round(call_wing_norm, 4),
            "butterfly": round(butterfly, 2),
            "butterfly_norm": round(butterfly_norm, 4),
            "raw_slope": round(raw_slope, 4) if raw_slope is not None else None,
            "norm_slope": round(norm_slope, 5) if norm_slope is not None else None,
            "call_mid": near_smile.get("call_mid"),
            "atm_mid": near_smile.get("atm_mid"),
            "put_mid": near_smile.get("put_mid"),
            "call_delta": near_smile.get("call_delta"),
            "atm_delta": near_smile.get("atm_delta"),
            "put_delta": near_smile.get("put_delta"),
            "net_credit": near_smile.get("net_credit"),
            "call_strike": near_smile.get("call_strike"),
            "atm_strike": near_smile.get("atm_strike"),
            "put_strike": near_smile.get("put_strike"),
            "expiration": near_smile.get("expiration", ""),
            "dte": int(round(target_dte)),
            "is_constant_maturity": True,
            "weights": {"near": round(w1, 3), "far": round(w2, 3)},
            "tenors": {"near": near_smile, "far": far_smile},
            **cls_info,
        }

    # Single-tenor fallback (pick closer to target_dte if both exist outside bracket)
    if near_smile is not None and far_smile is not None:
        d_n = abs(float(near_smile.get("dte") or 30) - target_dte)
        d_f = abs(float(far_smile.get("dte") or 30) - target_dte)
        primary = near_smile if d_n <= d_f else far_smile
    else:
        primary = near_smile if near_smile is not None else far_smile

    assert primary is not None
    cls_info = classify_skew_regime(
        primary.get("norm_rr"),
        primary.get("put_wing"),
        primary.get("call_wing"),
        primary.get("butterfly_norm"),
    )
    out = dict(primary)
    out["current"] = primary["raw_rr"]
    out["is_constant_maturity"] = bool(primary.get("dte") == int(round(target_dte)))
    out["weights"] = {"near": 1.0 if near_smile is primary else 0.0, "far": 1.0 if far_smile is primary else 0.0}
    out["tenors"] = {"near": near_smile, "far": far_smile}
    out.update(cls_info)
    return out


def _load_skew_history_file(history_path: str) -> Dict[str, Any]:
    if not history_path or not os.path.exists(history_path):
        return {}
    try:
        with open(history_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def get_skew_percentile(
    norm_rr: Optional[float],
    history_path: str = DEFAULT_SKEW_HISTORY_PATH,
    exclude_date: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Return empirical percentile (0..100) of `norm_rr` against saved EOD history once >= 20 sessions exist.
    Always returns `history_days` count.
    """
    hist = _load_skew_history_file(history_path)
    vals: List[float] = []
    for d_str, rec in hist.items():
        if exclude_date and d_str == exclude_date:
            continue
        if isinstance(rec, dict) and isinstance(rec.get("norm_rr"), (int, float)):
            v = float(rec["norm_rr"])
            if math.isfinite(v):
                vals.append(v)

    n = len(vals)
    if norm_rr is None or not math.isfinite(norm_rr) or n < 20:
        return {"history_days": n, "percentile": None}

    below_eq = sum(1 for v in vals if v <= float(norm_rr))
    pct = round(below_eq / n * 100.0, 1)
    return {"history_days": n, "percentile": pct}


def record_skew_history(
    date_str: str,
    summary_dict: Optional[Dict[str, Any]],
    history_path: str = DEFAULT_SKEW_HISTORY_PATH,
    min_interval_sec: float = 300.0,
    force: bool = False,
) -> Dict[str, Any]:
    """
    Persist one EOD/latest skew record per date in `data/skew_history.json` (throttled to `min_interval_sec`),
    then return current history_days and empirical percentile.
    """
    if not date_str or not summary_dict or summary_dict.get("norm_rr") is None:
        return get_skew_percentile(summary_dict.get("norm_rr") if summary_dict else None, history_path=history_path)

    key = (history_path, date_str)
    now_ts = time.time()
    last_ts = _HISTORY_WRITE_TIMESTAMPS.get(key, 0.0)
    if force or (now_ts - last_ts) >= min_interval_sec:
        hist = _load_skew_history_file(history_path)
        hist[date_str] = {
            "norm_rr": round(float(summary_dict["norm_rr"]), 4),
            "raw_rr": round(float(summary_dict.get("raw_rr", summary_dict.get("current", 0.0))), 2),
            "atm_iv": round(float(summary_dict["atm_iv"]), 2) if summary_dict.get("atm_iv") is not None else None,
            "put_wing": round(float(summary_dict["put_wing"]), 2) if summary_dict.get("put_wing") is not None else None,
            "call_wing": round(float(summary_dict["call_wing"]), 2) if summary_dict.get("call_wing") is not None else None,
            "butterfly": round(float(summary_dict["butterfly"]), 2) if summary_dict.get("butterfly") is not None else None,
            "butterfly_norm": round(float(summary_dict["butterfly_norm"]), 4) if summary_dict.get("butterfly_norm") is not None else None,
            "regime": summary_dict.get("regime"),
        }
        # Trim to most recent ~504 trading days
        if len(hist) > 504:
            for old_d in sorted(hist.keys())[:-504]:
                hist.pop(old_d, None)
        try:
            os.makedirs(os.path.dirname(history_path), exist_ok=True)
            tmp_path = history_path + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(hist, f, indent=2, sort_keys=True)
            os.replace(tmp_path, history_path)
            _HISTORY_WRITE_TIMESTAMPS[key] = now_ts
        except Exception:
            pass

    return get_skew_percentile(summary_dict.get("norm_rr"), history_path=history_path, exclude_date=date_str)
