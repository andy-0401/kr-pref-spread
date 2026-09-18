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

  let HISTORY = [], LATEST = null, priceChart, spreadChart;
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
    renderGauge(latest);

    if (HISTORY.length) {
      registerZoom();
      buildCharts(250);
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

  // ---- 기간별 위치: 게이지 핀 3개 + 요약 3열 ----
  function renderGauge(d) {
    const g = $("pgauge");
    [...g.querySelectorAll(".pin")].forEach((p) => p.remove());
    const keys = ["y3", "y5", "all"];
    keys.forEach((k, i) => {
      const w = d.percentile[k];
      if (!w) return;
      const pin = document.createElement("div");
      pin.className = `pin r${i}` + (k === d.zone_basis ? " on" : "");
      pin.style.left = Math.max(3, Math.min(97, w.pct)) + "%";
      pin.innerHTML = `<b>${w.label} ${Math.round(w.pct)}%ile</b><s></s>`;
      g.appendChild(pin);
    });

    $("winGrid").innerHTML = keys.map((k) => {
      const w = d.percentile[k];
      if (!w) return "";
      const z = zoneOf(w.pct);
      return `<div class="win ${k === d.zone_basis ? "basis" : ""}">
        <div class="wk">${w.label} 기준${k === d.zone_basis ? " · 대표" : ""}</div>
        <div class="wv dz-${z.key}">${Math.round(w.pct)}<span style="font-size:12px;font-weight:700">%ile</span></div>
        <div class="ws">평균 ${fmt(w.mean, 1)}% · 범위 ${fmt(w.min, 1)}~${fmt(w.max, 1)}%<br>z ${signed(w.z)} · ${fmt(w.n)}거래일</div>
      </div>`;
    }).join("");
  }

  function emptyState() {
    $("heroCard").innerHTML = `<div class="idx-card"><div class="idx-zone">데이터 불러오는 중…</div><p class="muted">데이터를 읽지 못했습니다. 잠시 후 새로고침 해주세요.</p></div>`;
  }

  // ---- 차트 (2단: 위 주가 / 아래 괴리율) ----
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const slice = (n) => (n && n > 0 ? HISTORY.slice(-n) : HISTORY);

  function median(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  const TIP = {
    backgroundColor: "#0b0f17", borderColor: "#222c3d", borderWidth: 1,
    titleColor: "#e7edf6", bodyColor: "#e7edf6", padding: 10,
  };
  const ZOOM = { pan: { enabled: true, mode: "x" }, zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" } };
  const xAxis = (show) => ({
    ticks: { color: css("--muted"), maxTicksLimit: 6, font: { size: 10 }, display: show },
    grid: { color: "#1c2535" },
  });

  function buildCharts(n) {
    const data = slice(n);
    const labels = data.map((d) => d.d);
    const commons = data.map((d) => d.c);
    const prefs = data.map((d) => d.p);
    const spreads = data.map((d) => d.v);
    const med = median(spreads);

    // 장기 구간(5Y·전체)은 주가가 수십 배 움직여 선형축이면 초기 구간이 바닥에 눌린다.
    // 이때만 로그축으로 바꾸고, 1Y 같은 단기는 선형을 유지해 등락폭이 그대로 보이게 한다.
    const all = commons.concat(prefs);
    const logScale = Math.max(...all) / Math.min(...all) > 8;

    if (priceChart) priceChart.destroy();
    priceChart = new Chart($("priceChart"), {
      type: "line",
      data: { labels, datasets: [
        { label: "삼성전자", data: commons, borderColor: css("--kospi"), borderWidth: 1.8, pointRadius: 0, tension: 0.15, fill: false },
        { label: "삼성전자우", data: prefs, borderColor: css("--kosdaq"), borderWidth: 1.8, pointRadius: 0, tension: 0.15, fill: false },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        onClick: (e, els, ch) => onPick(e, ch, labels),
        plugins: {
          legend: { display: false },
          tooltip: { ...TIP, callbacks: { label: (c) => `${c.dataset.label}: ${fmt(c.parsed.y)}원` } },
          zoom: ZOOM,
        },
        scales: {
          x: xAxis(false),
          y: {
            position: "right",
            type: logScale ? "logarithmic" : "linear",
            ticks: { color: css("--muted"), font: { size: 10 }, callback: (v) => fmt(v) },
            grid: { color: "#1c2535" },
          },
        },
      },
    });

    if (spreadChart) spreadChart.destroy();
    spreadChart = new Chart($("spreadChart"), {
      type: "line",
      data: { labels, datasets: [
        { label: "괴리율", data: spreads, borderColor: css("--correction"), borderWidth: 1.8, pointRadius: 0, tension: 0.15, fill: false },
        { label: "", data: labels.map(() => med), borderColor: css("--muted"), borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        onClick: (e, els, ch) => onPick(e, ch, labels),
        plugins: {
          legend: { display: false },
          tooltip: { ...TIP, filter: (i) => i.dataset.label !== "", callbacks: { label: (c) => `괴리율: ${fmt(c.parsed.y, 2)}%` } },
          zoom: ZOOM,
        },
        scales: {
          x: xAxis(true),
          y: {
            position: "right",
            ticks: { color: css("--muted"), font: { size: 10 }, callback: (v) => v + "%" },
            grid: { color: "#1c2535" },
          },
        },
      },
    });

    $("priceChart").ondblclick = () => { priceChart.resetZoom(); spreadChart.resetZoom(); };
    $("spreadChart").ondblclick = () => { priceChart.resetZoom(); spreadChart.resetZoom(); };
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
      buildCharts(+b.dataset.r);
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
