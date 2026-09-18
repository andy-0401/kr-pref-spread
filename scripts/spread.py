"""
삼성전자 본주–우선주 괴리율 계산 핵심 라이브러리.

괴리율(%) = (본주 종가 − 우선주 종가) ÷ 본주 종가 × 100
  → 값이 클수록 우선주가 본주 대비 싸게(= 괴리가 벌어져) 거래된다는 뜻.

우선주가 본주보다 싼 이유는 의결권이 없고 유통물량·유동성이 작기 때문이며,
괴리율은 배당정책·자사주 소각·지배구조 이벤트·수급에 따라 움직인다.

■ 설계 원칙 (사전 검증으로 확정)
  - 괴리율의 '정상 수준'은 시대마다 표류한다.
      2005~13 30~45% / 2014~19 ~18% / 2020~22 8~9% / 2023~26 18~35%
    따라서 고정 임계값(예: 30% 이상=저평가)은 쓰지 않는다.
  - 대신 '자기 역사 대비 백분위'로 위치를 표시하되, 창(window)을 하나만 고르면
    그 선택이 곧 결론이 되므로 3년·5년·전체 세 창을 항상 함께 낸다.
    (같은 24.9%가 3년 76%ile / 5년 86%ile / 21년 64%ile 로 읽힌다.)
  - 라벨은 '괴리 확대/축소' 같은 중립 서술만 쓴다. '저평가/고평가'는 가치판단이라 쓰지 않는다.
  - 본 트래커는 예측기가 아니라 국면 게이지다.

■ 데이터 소스(무료 공개)
  - 일봉 종가: Yahoo Finance(주 소스, 2005~ 21년 일괄) → 실패 시 pykrx(KRX 공식) 폴백
  - 반드시 '분할조정 종가(raw close)'를 쓴다. 배당조정가(adjclose)는 우선주 배당이
    본주보다 커서 비율을 왜곡시키므로 절대 쓰지 않는다.

  ※ Yahoo 를 주 소스로 둔 근거(2026-09-18 3자 교차검증):
      확정된 과거일(~09-11)은 Yahoo 와 pykrx 가 원 단위까지 완전 일치한다.
      그런데 최근 약 5거래일은 pykrx 만 값이 흔들렸고(예: 09-17 본주 256,000),
      Yahoo(252,500)는 stockanalysis.com(252,500)과 정확히 일치했다.
      2:1 로 Yahoo 가 정합해 주 소스로 두고 pykrx 를 폴백으로 둔다.
      또한 매 실행마다 전체 히스토리를 다시 받아 덮어쓰므로, 당일 잠정값이
      섞여도 다음 거래일 실행에서 확정값으로 자동 교정된다.
"""
from __future__ import annotations

import datetime as dt
import time
from dataclasses import dataclass, field
from typing import Optional
from zoneinfo import ZoneInfo

import requests

KST = ZoneInfo("Asia/Seoul")

# 수집 시작일 — 삼성전자 우선주 일봉이 확보되는 최초 시점(Yahoo 기준 2005-09-29)
HISTORY_START = "2005-01-01"

TICKERS = {
    "common": {"name": "삼성전자",   "code": "005930", "yahoo": "005930.KS"},
    "pref":   {"name": "삼성전자우", "code": "005935", "yahoo": "005935.KS"},
}

# 백분위 → 구간. 값이 클수록 '괴리가 벌어진' 쪽.
ZONES = [
    (80.0, "wide",   "괴리 확대"),
    (55.0, "semi",   "다소 확대"),
    (25.0, "mid",    "보통"),
    (0.0,  "narrow", "괴리 축소"),
]

# 백분위 창 정의 (키, 라벨, 연수). 연수 None = 전체 기간.
WINDOWS = [("y3", "3년", 3), ("y5", "5년", 5), ("all", "전체", None)]


@dataclass
class DailyPoint:
    date: str            # YYYY-MM-DD
    common: float        # 본주 종가
    pref: float          # 우선주 종가
    spread: float        # 괴리율 %


@dataclass
class WindowStat:
    key: str             # y3 | y5 | all
    label: str           # "3년"
    pct: float           # 현재값의 백분위(0~100)
    mean: float
    median: float
    min: float
    max: float
    z: float
    n: int               # 표본 거래일 수
    start: str           # 창 시작일
    rarer: int           # 지금보다 '더 벌어졌던' 날의 비율(%) = 화면의 "100일 중 N일"


@dataclass
class Snapshot:
    date: str
    time: str
    type: str
    note: str
    updated_at: str
    common: dict = field(default_factory=dict)
    pref: dict = field(default_factory=dict)
    spread: dict = field(default_factory=dict)
    percentile: dict = field(default_factory=dict)
    zone: str = ""
    zone_label: str = ""
    zone_basis: str = "y5"
    zones: list = field(default_factory=list)


# --------------------------------------------------------------------------
# 과거 일봉 수집
# --------------------------------------------------------------------------
def fetch_closes_yahoo(key: str, start: str = HISTORY_START) -> dict[dt.date, float]:
    """Yahoo 일봉 종가. range= 대신 period1/period2(유닉스초)를 써야 일봉이 나온다.
    (range=max 는 월봉으로 떨어져서 못 씀)"""
    sym = TICKERS[key]["yahoo"]
    p1 = int(dt.datetime.fromisoformat(start).replace(tzinfo=KST).timestamp())
    p2 = int(time.time())
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
        f"?period1={p1}&period2={p2}&interval=1d"
    )
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    ts = res["timestamp"]
    closes = res["indicators"]["quote"][0]["close"]   # raw(분할조정) 종가. adjclose 아님.
    out: dict[dt.date, float] = {}
    for t, c in zip(ts, closes):
        if c is None:
            continue
        out[dt.datetime.fromtimestamp(t, KST).date()] = float(c)
    return out


def fetch_closes_pykrx(key: str, start: str = HISTORY_START) -> dict[dt.date, float]:
    """pykrx(KRX 공식) 일봉 종가. adjusted=True 로 액면분할(2018 50:1) 연속성 확보."""
    from pykrx import stock  # 지연 임포트

    code = TICKERS[key]["code"]
    fromdate = dt.date.fromisoformat(start).strftime("%Y%m%d")
    todate = dt.datetime.now(KST).date().strftime("%Y%m%d")
    df = stock.get_market_ohlcv_by_date(fromdate, todate, code, adjusted=True)
    if df is None or df.empty:
        raise RuntimeError(f"pykrx 응답이 비어 있음({code})")
    out: dict[dt.date, float] = {}
    for idx, row in df.iterrows():
        d = idx.date() if hasattr(idx, "date") else idx
        close = float(row["종가"])
        if close <= 0:
            continue
        out[d] = close
    return out


def fetch_history() -> list[DailyPoint]:
    """본주·우선주 일봉을 모아 공통 거래일만 남기고 괴리율을 계산한다.
    Yahoo 우선(21년을 한 번에 받아옴) → 실패 시 pykrx 폴백."""
    errors: list[str] = []
    for source, fn in (("yahoo", fetch_closes_yahoo), ("pykrx", fetch_closes_pykrx)):
        try:
            common = fn("common")
            pref = fn("pref")
            pts = _merge(common, pref)
            if len(pts) >= 250:
                print(f"[spread] 소스={source} 일봉 {len(pts)}개 ({pts[0].date} ~ {pts[-1].date})")
                return pts
            errors.append(f"{source} 데이터 부족({len(pts)}개)")
        except Exception as e:  # noqa: BLE001
            errors.append(f"{source} 실패: {e}")
    raise RuntimeError("일봉 수집 실패: " + " | ".join(errors))


def _merge(common: dict[dt.date, float], pref: dict[dt.date, float]) -> list[DailyPoint]:
    """두 종목의 공통 거래일만 사용(한쪽만 있는 날은 괴리율이 무의미)."""
    pts: list[DailyPoint] = []
    for d in sorted(set(common) & set(pref)):
        c, p = common[d], pref[d]
        if c <= 0 or p <= 0:
            continue
        pts.append(DailyPoint(
            date=d.strftime("%Y-%m-%d"),
            common=round(c),
            pref=round(p),
            spread=round((c - p) / c * 100, 2),
        ))
    return pts


# --------------------------------------------------------------------------
# 백분위 · 구간
# --------------------------------------------------------------------------
def _percentile_of(values: list[float], x: float) -> float:
    """values 분포에서 x 의 백분위(이하 비율). 0~100."""
    if not values:
        return 0.0
    return sum(1 for v in values if v <= x) / len(values) * 100


def _stats(values: list[float]) -> tuple[float, float, float]:
    """(평균, 표준편차(모집단), 중앙값)"""
    n = len(values)
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    srt = sorted(values)
    mid = n // 2
    median = srt[mid] if n % 2 else (srt[mid - 1] + srt[mid]) / 2
    return mean, var ** 0.5, median


def compute_windows(points: list[DailyPoint]) -> list[WindowStat]:
    """3년·5년·전체 각 창에서 현재 괴리율의 위치를 계산한다."""
    cur = points[-1].spread
    last_date = dt.date.fromisoformat(points[-1].date)
    out: list[WindowStat] = []
    for key, label, years in WINDOWS:
        if years is None:
            sub = points
        else:
            cutoff = last_date - dt.timedelta(days=365 * years)
            sub = [p for p in points if dt.date.fromisoformat(p.date) >= cutoff]
        vals = [p.spread for p in sub]
        if not vals:
            continue
        mean, sd, median = _stats(vals)
        # "100일 중 N일"은 반올림된 백분위에서 빼지 않고 원자료에서 직접 센다.
        # (백분위를 소수 1자리로 반올림한 뒤 100에서 빼면 35.5 같은 경계값이 화면마다 갈린다)
        rarer = round(sum(1 for v in vals if v > cur) / len(vals) * 100)
        out.append(WindowStat(
            key=key, label=label,
            pct=round(_percentile_of(vals, cur), 1),
            mean=round(mean, 1), median=round(median, 1),
            min=round(min(vals), 1), max=round(max(vals), 1),
            z=round((cur - mean) / sd, 2) if sd else 0.0,
            n=len(vals), start=sub[0].date, rarer=rarer,
        ))
    return out


def classify(pct: float) -> tuple[str, str]:
    """백분위 → (zone key, 중립 라벨)."""
    for floor, key, label in ZONES:
        if pct >= floor:
            return key, label
    return "narrow", "괴리 축소"


# --------------------------------------------------------------------------
# 스냅샷
# --------------------------------------------------------------------------
def build_snapshot(points: list[DailyPoint], run_type: str = "close") -> Snapshot:
    last = points[-1]
    prev = points[-2] if len(points) >= 2 else None
    wins = compute_windows(points)
    basis = next((w for w in wins if w.key == "y5"), wins[-1])
    zone, zone_label = classify(basis.pct)

    def _chg(cur: float, before: Optional[float]) -> tuple[Optional[float], Optional[float]]:
        if before is None or before == 0:
            return None, None
        return round(cur - before, 1), round((cur - before) / before * 100, 2)

    c_chg, c_pct = _chg(last.common, prev.common if prev else None)
    p_chg, p_pct = _chg(last.pref, prev.pref if prev else None)
    now = dt.datetime.now(KST)

    return Snapshot(
        date=last.date,
        time="15:40" if run_type == "close" else now.strftime("%H:%M"),
        type=run_type,
        note="장 마감 종가 기준 확정값입니다.",
        updated_at=f"{last.date}T15:40:00+09:00" if run_type == "close" else now.isoformat(timespec="seconds"),
        common={"name": TICKERS["common"]["name"], "code": TICKERS["common"]["code"],
                "close": last.common, "change": c_chg, "change_pct": c_pct},
        pref={"name": TICKERS["pref"]["name"], "code": TICKERS["pref"]["code"],
              "close": last.pref, "change": p_chg, "change_pct": p_pct},
        spread={"value": last.spread,
                "prev": prev.spread if prev else None,
                "diff": round(last.spread - prev.spread, 2) if prev else None,
                "gap_krw": round(last.common - last.pref)},
        percentile={w.key: {"label": w.label, "pct": w.pct, "rarer": w.rarer,
                            "mean": w.mean, "median": w.median,
                            "min": w.min, "max": w.max, "z": w.z, "n": w.n, "start": w.start}
                    for w in wins},
        zone=zone, zone_label=zone_label, zone_basis=basis.key,
        zones=[{"floor": f, "key": k, "label": l} for f, k, l in ZONES],
    )


def history_to_records(points: list[DailyPoint]) -> list[dict]:
    """history.json 용 압축 레코드. 키를 짧게(d/c/p/v) 써서 21년치 용량을 줄인다."""
    return [{"d": p.date, "c": p.common, "p": p.pref, "v": p.spread} for p in points]
