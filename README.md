# 삼성전자 우선주 괴리율 트래커 (시즌3)

삼성전자 본주(005930)와 우선주(005935)의 **괴리율**을 매 거래일 종가 기준으로 추적하는 정적 페이지.

- 라이브: https://andy-0401.github.io/kr-pref-spread/
- 공유용 단축 주소: https://kospi-ma.netlify.app/kospipref

```
괴리율(%) = (본주 종가 − 우선주 종가) ÷ 본주 종가 × 100
```

## 설계 원칙

괴리율의 '정상 수준'은 시대마다 표류한다(2005~13 30~45% / 2020~22 8~9% / 2023~26 18~37%).
그래서 **고정 임계값을 쓰지 않고**, 자기 역사 대비 백분위로 위치만 표시한다.

기준 기간을 하나만 고르면 그 선택이 곧 결론이 되므로(같은 24.9%가 3년 76%ile · 5년 86%ile ·
21년 64%ile 로 읽힘) **3년·5년·전체 세 창을 항상 함께** 낸다. 라벨도 '저평가/고평가' 같은
가치판단 대신 '괴리 확대/축소' 중립 서술만 쓴다.

**예측 도구가 아니라 위치를 보여주는 게이지다.** (검증 결과 6개월 이내 방향 예측력은 사실상 없음)

## 구조

| 경로 | 역할 |
|---|---|
| `docs/` | 정적 사이트 (GitHub Pages publish 루트) |
| `docs/data/latest.json` | 최신 스냅샷 + 3년/5년/전체 백분위 |
| `docs/data/history.json` | 2005~ 일자별 시계열 (`d`/`c`/`p`/`v` 압축 키) |
| `scripts/spread.py` | 수집·계산 엔진 |
| `scripts/run_update.py` | 갱신 엔트리포인트 |

```bash
pip install -r scripts/requirements.txt
python scripts/run_update.py --type close --force
```

## 데이터

- **Yahoo Finance** 주 소스(2005~ 21년 일괄), **pykrx(KRX)** 폴백.
- 반드시 분할조정 종가(raw close)를 쓴다. 배당조정가(adjclose)는 우선주 배당이 커서 비율을 왜곡한다.
- 매 실행마다 전체 히스토리를 다시 받아 덮어쓰므로, 당일 잠정값이 섞여도 다음 거래일에 자동 교정된다.

## 갱신

매 거래일 **15:40 KST 종가 1회**. 정시성은 `kospi-ma-disparity` 레포의 Netlify 예약함수가
`repository_dispatch[close]` 로 깨워서 담당하고, 이 레포의 cron 은 지연 백업이다.

## 형제 페이지

- [코스피 50일 이격도](https://kospi-ma.netlify.app) (시즌1)
- [코스피·코스닥 MDD](https://andy-0401.github.io/kr-mdd/) (시즌2)
