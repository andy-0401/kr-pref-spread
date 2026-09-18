/* 삼성전자 본주–우선주 괴리율 트래커 — 프런트엔드
 * 자체 파이프라인(scripts/)이 만든 docs/data/*.json 만 읽는다. (다른 페이지와 완전 독립) */
(function () {
  "use strict";

  const CFG = window.SITE_CONFIG || {};
  const track = (name, params) => {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  };

  const $ = (id) => document.getElementById(id);
  const fmt = (n, d = 0) =>
    n == null || isNaN(n) ? "—" : Number(n).toLocaleString("ko-KR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const signed = (n, d = 2) => (n == null || isNaN(n) ? "—" : (n > 0 ? "+" : "") + fmt(n, d));

  // 백분위 → 구간. latest.json 의 zones 로 덮어씀(백엔드가 단일 진실).
  let ZONES = [
    { floor: 80, key: "wide", label: "괴리 확대" },
    { floor: 55, key: "semi", label: "다소 확대" },
    { floor: 25, key: "mid", label: "보통" },
    { floor: 0, key: "narrow", label: "괴리 축소" },
  ];
  const zoneOf = (pct) => ZONES.find((z) => pct >= z.floor) || ZONES[ZONES.length - 1];

  let HISTORY = [], LATEST = null;
  let shownRows = 60;          // 표에 그린 행 수
  const PAGE = 60;
  let pickedDate = null;

  async function load() {
    wireTabs();
    wireTelegram();
    wireShare();
    const [hist, latest] = await Promise.all([
      fetchJSON("./data/history.json"),
      fetchJSON("./data/latest.json"),
    ]);

    HISTORY = (hist || []).filter((d) => d && d.v != null);
    LATEST = latest;
    if (!latest || !latest.spread) { emptyState(); return; }
    if (Array.isArray(latest.zones) && latest.zones.length) ZONES = latest.zones;

    $("updatedAt").textContent = `${latest.date} ${latest.time || "15:40"} 종가 기준`;
    checkStale(latest.date);
    renderHero(latest);
    renderPosition(latest);

    if (HISTORY.length) {
      registerZoom();
      renderToggle();
      buildChart(250);
      renderTable();
      wireRangeButtons();
      wireMore();
    }
  }

  // ---- 헤더 부가기능 (기존 두 페이지와 동일 동작) ----
  function wireShare() {
    const btn = $("shareBtn");
    if (!btn) return;
    const base = CFG.shareUrl || location.href;
    const url = base + (base.includes("?") ? "&" : "?") + "utm_source=share&utm_medium=button";
    const isTouch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    btn.addEventListener("click", async () => {
      track("share_click", {});
      if (isTouch && navigator.share) {
        try { await navigator.share({ title: document.title, url }); } catch (e) { /* 취소 무시 */ }
        return;
      }
      try { await navigator.clipboard.writeText(url); toast("링크가 복사됐어요 — 붙여넣기 하세요"); }
      catch (e) { toast("복사가 안 됐어요. 다시 눌러주세요"); }
    });
  }

  function toast(msg) {
    let t = $("toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // 갱신 지연 감지: 마지막 데이터일이 4일(주말 여유 포함) 넘게 지났으면 경고.
  function checkStale(dateStr) {
    if (!dateStr) return;
    const last = new Date(dateStr + "T00:00:00+09:00");
    const days = Math.floor((new Date() - last) / 86400000);
    if (days < 4) return;
    const row = document.querySelector(".updated-row");
    if (row && !$("staleWarn")) {
      const s = document.createElement("span");
      s.id = "staleWarn";
      s.className = "stale-warn";
      s.textContent = `⚠ 갱신 지연 — ${days}일 전 데이터`;
      row.appendChild(s);
    }
  }

  function wireTabs() {
    const join = (u, src) => u + (u.includes("?") ? "&" : "?") + "utm_source=" + src + "&utm_medium=tab";
    [["mddTab", CFG.mddUrl, "pref"], ["mddLink2", CFG.mddUrl, "pref"],
     ["dispTab", CFG.disparityUrl, "pref"], ["dispLink2", CFG.disparityUrl, "pref"]].forEach(([id, url, src]) => {
      const el = $(id);
      if (!el || !url) return;
      el.href = join(url, src);
      el.addEventListener("click", () => track("tab_click", { to: id }));
    });
  }

  function wireTelegram() {
    const url = CFG.telegramUrl || "";
    const l = $("tgLink");
    if (!url || !l) return;
    l.href = url;
    l.hidden = false;
    l.addEventListener("click", () => track("telegram_click", { url }));
  }

  // ---- 히어로: 현재 괴리율을 크게 ----
  function renderHero(d) {
    const sp = d.spread, basis = d.percentile[d.zone_basis] || {};
    const z = zoneOf(basis.pct != null ? basis.pct : 50);
    const diff = sp.diff;
    const dcls = diff > 0 ? "up" : diff < 0 ? "down" : "";
    const darrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "—";
    const chg = (o) => o.change == null ? "" :
      `<span class="chg ${o.change > 0 ? "up" : o.change < 0 ? "down" : ""}">${o.change > 0 ? "▲" : o.change < 0 ? "▼" : "—"} ${fmt(Math.abs(o.change))} (${signed(o.change_pct)}%)</span>`;

    $("heroCard").innerHTML = `<div class="idx-card solo">
      <div class="solo-main">
        <div class="idx-name">삼성전자 <span class="hint">본주 대비 우선주</span></div>
        <div class="dd-big dz-${z.key}">${fmt(sp.value, 1)}<span class="pct">%</span></div>
        <div class="idx-zone dz-${z.key}">${z.label}<span class="zsub">전일 대비 <b class="${dcls}">${darrow} ${fmt(Math.abs(diff), 2)}%p</b></span></div>
      </div>
      <div class="idx-stats">
        <div class="row"><span class="k">기준일</span><span class="v">${d.date}</span></div>
        <div class="row"><span class="k">${d.common.name} <span class="hint">${d.common.code}</span></span><span class="v">${fmt(d.common.close)}원 ${chg(d.common)}</span></div>
        <div class="row"><span class="k">${d.pref.name} <span class="hint">${d.pref.code}</span></span><span class="v">${fmt(d.pref.close)}원 ${chg(d.pref)}</span></div>
        <div class="row"><span class="k">차액</span><span class="v">${fmt(sp.gap_krw)}원</span></div>
      </div>
    </div>`;
  }

  // ---- 지금 괴리율의 위치 ----
  // 설계 의도: %ile·z-score 같은 통계 용어를 화면에서 걷어내고 "100일 중 며칠"로 바꾼다.
  //   백분위 86%ile = 지금보다 더 벌어졌던 날이 100일 중 14일 → 후자가 설명 없이 읽힌다.
  //   기간을 하나로 좁히지 않는다는 원칙(3·5·21년 병기)은 그대로 두되,
  //   "왜 기간마다 다른가"는 접이식으로 내려 평소엔 화면을 가볍게 유지한다.
  const ORDER = ["y3", "y5", "all"];
  // 지금보다 더 벌어졌던 날의 비율(%). 백엔드가 원자료에서 직접 센 값을 쓴다.
  const rarer = (w) => (w.rarer != null ? w.rarer : Math.round(100 - w.pct));

  function renderPosition(d) {
    const cur = d.spread.value;
    const basis = d.percentile[d.zone_basis] || d.percentile.y5;
    const z = zoneOf(basis.pct);
    const gap = +(cur - basis.median).toFixed(1);

    // 결론 한 줄: 대표 기간(5년) 보통 수준과 견줘 방향을 말한다.
    const lead = gap >= 2 ? "평소보다 벌어져 있습니다"
               : gap <= -2 ? "평소보다 좁혀져 있습니다"
               : "평소와 비슷한 수준입니다";
    const tail = gap >= 2 ? `평소보다 <b>${fmt(Math.abs(gap), 1)}%p 더</b> 벌어진 셈입니다.`
               : gap <= -2 ? `평소보다 <b>${fmt(Math.abs(gap), 1)}%p 더</b> 좁혀진 셈입니다.`
               : "평소와 큰 차이가 없습니다.";

    const rows = ORDER.map((k) => {
      const w = d.percentile[k];
      if (!w) return "";
      const n = rarer(w);
      const zk = zoneOf(w.pct);
      return `<div class="frow">
        <span class="fk">${w.label === "전체" ? "전체 " + yearsOf(w) + "년" : "최근 " + w.label}</span>
        <span class="fb"><i class="z-${zk.key}" style="width:${Math.max(2, n)}%"></i></span>
        <span class="fv">100일 중 <b class="dz-${zk.key}">${n}일</b></span>
      </div>`;
    }).join("");

    const ns = ORDER.map((k) => d.percentile[k] && rarer(d.percentile[k])).filter((v) => v != null);
    const lo = Math.min(...ns), hi = Math.max(...ns);
    const allMax = d.percentile.all ? d.percentile.all.max : basis.max;

    $("posBox").innerHTML = `
      <p class="pos-lead dz-${z.key}">${lead}</p>
      <p class="pos-sub">${d.pref.name}가 본주보다 <b>${fmt(cur, 1)}%</b> 싸게 거래되고 있습니다.<br>
        최근 ${basis.label} 보통 수준은 <b>${fmt(basis.median, 1)}%</b>였으니, ${tail}</p>
      <p class="pos-q">지금보다 더 벌어졌던 날이 얼마나 있었나?</p>
      ${rows}
      <div class="pos-note">막대가 짧을수록 <b>지금이 드문 상태</b>라는 뜻입니다.
        기준 기간에 따라 <b>${lo}~${hi}일</b>로 갈리는데, 어느 기준으로 봐도
        ${lo >= 50 ? "평소보다 좁혀진 편" : "평소보단 벌어진 편"}이고,
        역대 최고(${fmt(allMax, 1)}%)와는 아직 거리가 있습니다.</div>`;

    renderWhy(d, cur);
  }

  // 전체 기간이 몇 년치인지(라벨용)
  function yearsOf(w) {
    if (!w.start) return "";
    return Math.round((new Date(LATEST.date) - new Date(w.start)) / 31557600000);
  }

  // 접이식: 같은 눈금 위에 기간별 범위를 겹쳐 "왜 숫자가 갈리는지"를 보여준다.
  function renderWhy(d, cur) {
    const maxAll = Math.ceil(Math.max(...ORDER.map((k) => (d.percentile[k] || {}).max || 0)) / 2) * 2;
    const pos = (v) => (v / maxAll) * 100;
    const bars = ORDER.map((k) => {
      const w = d.percentile[k];
      if (!w) return "";
      const label = w.label === "전체" ? "전체 " + yearsOf(w) + "년" : "최근 " + w.label;
      return `<div class="rrow">
        <span class="rk">${label}</span>
        <span class="rwrap">
          <i class="rbar" style="left:${pos(w.min)}%;width:${pos(w.max) - pos(w.min)}%"></i>
          <i class="rmed" style="left:${pos(w.median)}%"></i>
          <i class="rnow" style="left:${pos(cur)}%"></i>
        </span>
        <span class="rlab">${fmt(w.min, 1)} ~ ${fmt(w.max, 1)}%</span>
      </div>`;
    }).join("");
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
      `<span style="left:${f * 100}%">${Math.round(maxAll * f)}%</span>`).join("");

    $("whyBox").innerHTML = `
      <div class="rax-head"><span class="rk"></span><span class="rax">${ticks}</span><span class="rlab"></span></div>
      ${bars}
      <p class="pos-note">회색 막대 = 그 기간에 괴리율이 오갔던 범위, 회색 선 = 그 기간의 보통 수준,
        <b class="now">노란 선 = 오늘(${fmt(cur, 1)}%)</b>.<br>
        오늘 숫자는 <b>하나인데</b> 기간마다 막대 길이가 달라서 <b>위치가 달라 보입니다.</b>
        그래서 어느 한 기간만 보여주지 않고 셋을 나란히 둡니다.</p>`;
  }

  function emptyState() {
    $("heroCard").innerHTML = `<div class="idx-card"><div class="idx-zone">데이터 불러오는 중…</div><p class="muted">데이터를 읽지 못했습니다. 잠시 후 새로고침 해주세요.</p></div>`;
  }

  // ---- 차트 (단일 · 좌축 주가 / 우축 괴리율) ----
  // 괴리율을 '가격 흐름과 겹쳐' 보고 싶다는 요구 때문에 두 패널을 하나로 합쳤다.
  // 단위가 달라 축을 둘로 나누되(좌 원 / 우 %), 범례를 눌러 시리즈를 끄면
  // 그 축도 같이 사라지게 해서 '괴리율만 / 주가만' 볼 때는 축이 하나만 남게 한다.
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const slice = (n) => (n && n > 0 ? HISTORY.slice(-n) : HISTORY);

  // 이 페이지의 주인공은 괴리율이므로 굵게(2.8) + 맨 위에 그리고,
  // 주가 두 선은 배경 맥락이라 얇게(1.3) 깔아 한눈에 구분되게 한다.
  //   order 가 클수록 나중에 그려져 위로 올라온다.
  const SERIES = [
    { key: "spread", name: "괴리율(%)", axis: "y1", color: "--correction", w: 2.8, order: 2, pick: (d) => d.v },
    { key: "common", name: "삼성전자",   axis: "y",  color: "--kospi",     w: 1.3, order: 1, pick: (d) => d.c },
    { key: "pref",   name: "삼성전자우", axis: "y",  color: "--kosdaq",    w: 1.3, order: 1, pick: (d) => d.p },
  ];
  const shown = { spread: true, common: true, pref: true };
  let mainChart, curRange = 250;

  function buildChart(n) {
    curRange = n;
    const data = slice(n);
    const labels = data.map((d) => d.d);
    const prices = data.flatMap((d) => [d.c, d.p]);
    // 장기 구간은 주가가 수십 배 움직여 선형축이면 초기 구간이 바닥에 눌린다.
    const logScale = Math.max(...prices) / Math.min(...prices) > 8;

    if (mainChart) mainChart.destroy();
    mainChart = new Chart($("mainChart"), {
      type: "line",
      data: {
        labels,
        datasets: SERIES.map((s) => ({
          label: s.name,
          data: data.map(s.pick),
          yAxisID: s.axis,
          borderColor: css(s.color),
          borderWidth: s.w,
          order: s.order,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: css(s.color),
          pointHoverBorderColor: "#0b0f17",
          pointHoverBorderWidth: 2,
          tension: 0.15,
          fill: false,
          hidden: !shown[s.key],
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        onClick: (e, els, ch) => onPick(e, ch, labels),
        plugins: {
          legend: { display: false },   // 범례는 아래 커스텀 칩으로 대체
          tooltip: {
            backgroundColor: "#0b0f17", borderColor: "#222c3d", borderWidth: 1,
            titleColor: "#e7edf6", bodyColor: "#e7edf6", padding: 10,
            callbacks: {
              label: (c) => c.dataset.yAxisID === "y1"
                ? `괴리율: ${fmt(c.parsed.y, 2)}%`
                : `${c.dataset.label}: ${fmt(c.parsed.y)}원`,
            },
          },
          zoom: {
            pan: { enabled: true, mode: "x" },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
          },
        },
        scales: {
          x: { ticks: { color: css("--muted"), maxTicksLimit: 6, font: { size: 10 } }, grid: { color: "#1c2535" } },
          y: {   // 좌축 — 주가(원)
            position: "left",
            display: shown.common || shown.pref,
            type: logScale ? "logarithmic" : "linear",
            ticks: { color: css("--muted"), font: { size: 10 }, callback: (v) => fmt(v) },
            grid: { color: "#1c2535" },
          },
          y1: {  // 우축 — 괴리율(%)
            position: "right",
            display: shown.spread,
            ticks: { color: css("--correction"), font: { size: 10 }, callback: (v) => v + "%" },
            grid: { drawOnChartArea: false },
          },
        },
      },
    });
    $("mainChart").ondblclick = () => mainChart.resetZoom();
  }

  // 범례 칩: 눌러서 시리즈 on/off. 마지막 하나는 못 끄게 막는다(빈 차트 방지).
  function renderToggle() {
    const box = $("seriesToggle");
    box.innerHTML = SERIES.map((s) => `
      <button class="stog ${shown[s.key] ? "" : "off"}" type="button" data-k="${s.key}"
              aria-pressed="${shown[s.key]}">
        <i style="background:${css(s.color)};height:${s.key === "spread" ? 4 : 2}px"></i><span class="sname">${s.name}</span>
      </button>`).join("");
    box.querySelectorAll(".stog").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.k;
        if (shown[k] && Object.values(shown).filter(Boolean).length === 1) {
          toast("하나는 켜 두세요");
          return;
        }
        shown[k] = !shown[k];
        track("series_toggle", { series: k, on: shown[k] });
        renderToggle();
        buildChart(curRange);
      });
    });
  }

  // 차트 클릭 → 그날 수치 요약 + 표에서 해당 행으로 이동·강조
  function onPick(evt, chart, labels) {
    const native = evt && (evt.native || evt);
    const pts = chart.getElementsAtEventForMode(native, "index", { intersect: false }, true);
    if (!pts || !pts.length) return;
    const date = labels[pts[0].index];
    const row = HISTORY.find((h) => h.d === date);
    if (!row) return;
    pickedDate = date;

    const box = $("picked");
    box.hidden = false;
    box.innerHTML = `<span class="pd">${row.d}</span>
      <span class="pi">삼성전자<b>${fmt(row.c)}원</b></span>
      <span class="pi">삼성전자우<b>${fmt(row.p)}원</b></span>
      <span class="pi">차액<b>${fmt(row.c - row.p)}원</b></span>
      <span class="pi">괴리율<b class="pv dz-${zoneOf(pctOf(row.v)).key}">${fmt(row.v, 2)}%</b></span>
      <button class="goto-btn" type="button" id="gotoRow">표에서 보기 ↓</button>`;
    track("chart_pick", { date });

    // 표의 해당 행을 강조해 두되, 화면을 멋대로 끌고 가지는 않는다.
    // (차트를 보다가 갑자기 표로 튀면 맥락을 잃으므로, 이동은 사용자가 누를 때만)
    revealRow(date, false);
    const go = $("gotoRow");
    if (go) go.addEventListener("click", () => { revealRow(date, true); track("goto_row", { date }); });
  }

  // 해당 날짜가 표에 안 그려져 있으면 그 지점까지 펼치고, 강조한다. scroll=true 면 이동까지.
  function revealRow(date, scroll) {
    const idxFromEnd = HISTORY.length - 1 - HISTORY.findIndex((h) => h.d === date);
    if (idxFromEnd + 1 > shownRows) shownRows = Math.ceil((idxFromEnd + 1) / PAGE) * PAGE;
    renderTable();
    const tr = document.querySelector(`#histTable tbody tr[data-d="${date}"]`);
    if (tr && scroll) tr.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // 전체 기간 대비 백분위 (색상용 근사치)
  function pctOf(v) {
    const all = HISTORY.map((h) => h.v);
    return all.filter((x) => x <= v).length / all.length * 100;
  }

  function registerZoom() {
    if (!window.Chart) return;
    const z = window.ChartZoom || window.chartjsPluginZoom || window["chartjs-plugin-zoom"];
    if (z && (z.id === "zoom" || z.default)) {
      try { window.Chart.register(z.default || z); } catch (e) { /* 이미 등록됨 */ }
    }
  }

  function wireRangeButtons() {
    const box = $("rangeBtns");
    if (!box) return;
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      [...box.children].forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      buildChart(+b.dataset.r);
      track("range_change", { range: b.dataset.r });
    });
  }

  function wireMore() {
    const btn = $("moreBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      shownRows += PAGE;
      renderTable();
      track("table_more", { rows: shownRows });
    });
  }

  // ---- 일자별 표 ----
  function renderTable() {
    const tb = $("histTable").querySelector("tbody");
    const rows = HISTORY.slice(-shownRows).reverse();
    tb.innerHTML = rows.map((d, i) => {
      const prev = rows[i + 1];
      const diff = prev ? d.v - prev.v : null;
      const dc = diff > 0 ? "c-up" : diff < 0 ? "c-down" : "";
      const da = diff == null ? "—" : `${diff > 0 ? "▲" : diff < 0 ? "▼" : "—"} ${fmt(Math.abs(diff), 2)}%p`;
      return `<tr data-d="${d.d}" class="${d.d === pickedDate ? "hi" : ""}">
        <td class="c-date">${d.d}</td>
        <td>${fmt(d.c)}</td>
        <td>${fmt(d.p)}</td>
        <td>${fmt(d.c - d.p)}</td>
        <td class="c-disp"><b>${fmt(d.v, 2)}%</b></td>
        <td class="${dc}">${da}</td>
      </tr>`;
    }).join("");
    const btn = $("moreBtn");
    if (btn) btn.hidden = shownRows >= HISTORY.length;
  }

  async function fetchJSON(url) {
    try {
      const sep = url.includes("?") ? "&" : "?";
      const r = await fetch(url + sep + "v=" + Date.now());
      if (!r.ok) return null;
      const t = (await r.text()).trim();
      return t ? JSON.parse(t) : null;
    } catch (e) { return null; }
  }

  load();
})();
