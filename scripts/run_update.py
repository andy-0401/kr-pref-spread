"""
데이터 갱신 엔트리포인트 (삼성전자 본주–우선주 괴리율).

사용:
  python run_update.py --type close          # 종가 확정(15:40 KST)
  python run_update.py --type close --force  # 비거래일에도 강제 실행

동작:
  1) 본주·우선주 일봉(2005~) 수집 → 공통 거래일 괴리율 계산
  2) docs/data/history.json (일자별 시계열) 갱신
  3) docs/data/latest.json  (최신 스냅샷 + 3년/5년/전체 백분위) 갱신

※ 괴리율은 종가 기준 1회만 갱신한다(장중 폴링 없음).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from dataclasses import asdict
from pathlib import Path

import spread as S

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "docs" / "data"
HISTORY_PATH = DATA_DIR / "history.json"
LATEST_PATH = DATA_DIR / "latest.json"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", choices=["close"], default="close")
    ap.add_argument("--force", action="store_true", help="새 데이터가 없어도 강제 기록")
    args = ap.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    print("[update] 삼성전자 본주·우선주 일봉 수집 중...")
    points = S.fetch_history()

    # 갱신 여부: 새 거래일이 생겼거나, 소스 최신일이 오늘이면 갱신.
    latest_date = points[-1].date
    prev_committed = None
    if HISTORY_PATH.exists():
        try:
            prev = json.loads(HISTORY_PATH.read_text(encoding="utf-8"))
            prev_committed = prev[-1]["d"] if prev else None
        except Exception:  # noqa: BLE001
            prev_committed = None
    today = dt.datetime.now(S.KST).strftime("%Y-%m-%d")
    has_new = prev_committed is None or latest_date > prev_committed
    if not (has_new or latest_date == today) and not args.force:
        print(f"[update] 새 데이터 없음(최신: {latest_date}, 직전 커밋: {prev_committed}). 생략.")
        return 0

    records = S.history_to_records(points)
    HISTORY_PATH.write_text(
        json.dumps(records, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    size_kb = HISTORY_PATH.stat().st_size / 1024
    print(f"[update] history.json 저장: {len(records)} rows ({size_kb:.0f}KB)")

    snap = S.build_snapshot(points, run_type=args.type)
    LATEST_PATH.write_text(
        json.dumps(asdict(snap), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[update]   {snap.date} 괴리율 {snap.spread['value']}% "
          f"(본주 {snap.common['close']:,} / 우선주 {snap.pref['close']:,}) → {snap.zone_label}")
    for key, w in snap.percentile.items():
        print(f"[update]   {w['label']:>3} 기준: {w['pct']}%ile  평균 {w['mean']}%  "
              f"범위 {w['min']}~{w['max']}%  z {w['z']:+}  (n={w['n']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
