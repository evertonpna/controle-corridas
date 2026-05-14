(function () {
  "use strict";

  const STORAGE_KEY = "controleCorridas_v1";

  const $ = (sel, root = document) => root.querySelector(sel);

  const defaultCar = () => ({
    apelido: "",
    kmPorLitro: 12,
    precoLitro: 5.89,
    custoExtraKm: 0.12,
    metaLucroDia: 200,
    metaLucroSemana: 1200,
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { car: defaultCar(), entries: [] };
      const data = JSON.parse(raw);
      return {
        car: { ...defaultCar(), ...(data.car || {}) },
        entries: Array.isArray(data.entries) ? data.entries : [],
      };
    } catch {
      return { car: defaultCar(), entries: [] };
    }
  }

  function saveState(state) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ car: state.car, entries: state.entries })
    );
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function toISODateLocal(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function startOfWeekMondayFromDate(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dow = x.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    x.setDate(x.getDate() + offset);
    return x;
  }

  function addDays(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  function calendarWeekRangeContaining(date) {
    const start = startOfWeekMondayFromDate(date);
    const end = addDays(start, 6);
    return { start: toISODateLocal(start), end: toISODateLocal(end) };
  }

  function calendarMonthRangeContaining(date) {
    const y = date.getFullYear();
    const m = date.getMonth();
    const start = `${y}-${pad2(m + 1)}-01`;
    const last = new Date(y, m + 1, 0).getDate();
    const end = `${y}-${pad2(m + 1)}-${pad2(last)}`;
    return { start, end };
  }

  function inDateRange(iso, start, end) {
    return iso >= start && iso <= end;
  }

  function parseNum(v) {
    if (v === "" || v == null) return 0;
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }

  function money(n) {
    return n.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function calcDay(car, row) {
    const km = Math.max(0, row.kmDia);
    const receita = Math.max(0, row.receita);
    const despesasExtras = Math.max(0, row.despesasExtras);
    const kmL = Math.max(0.01, car.kmPorLitro);
    const precoL = Math.max(0, car.precoLitro);
    const extraKm = Math.max(0, car.custoExtraKm || 0);

    const litros = km / kmL;
    const custoCombustivel = litros * precoL;
    const custoExtraTotal = km * extraKm;
    const custoTotal = custoCombustivel + custoExtraTotal + despesasExtras;
    const lucroLiquido = receita - custoTotal;
    const lucroPorKm = km > 0 ? lucroLiquido / km : 0;
    const horas = row.horas > 0 ? row.horas : 0;
    const lucroPorHora = horas > 0 ? lucroLiquido / horas : null;

    return {
      litros,
      custoCombustivel,
      custoExtraTotal,
      custoTotal,
      lucroLiquido,
      lucroPorKm,
      lucroPorHora,
    };
  }

  function aggregate(entries, car) {
    let lucro = 0;
    let km = 0;
    let receita = 0;
    let horas = 0;
    entries.forEach((e) => {
      const s = calcDay(car, e);
      lucro += s.lucroLiquido;
      km += e.kmDia || 0;
      receita += e.receita || 0;
      if (e.horas > 0) horas += e.horas;
    });
    const n = entries.length;
    return {
      lucro,
      km,
      receita,
      horas,
      days: n,
      lucroPorHora: horas > 0 ? lucro / horas : null,
      lucroPorDia: n > 0 ? lucro / n : null,
    };
  }

  function averageLucroPorKm(entries, car, excludeId) {
    const vals = entries
      .filter((e) => e.id !== excludeId)
      .map((e) => calcDay(car, e).lucroPorKm)
      .filter((v) => Number.isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  function verdict(car, row, stats, avgLucroKmHistory) {
    const meta = Math.max(0, car.metaLucroDia || 0);
    const lucro = stats.lucroLiquido;
    const rkm = stats.lucroPorKm;
    const horas = row.horas > 0 ? row.horas : null;

    let level = "warn";
    let title = "Dia mediano";
    let lines = [];

    if (lucro < 0) {
      level = "bad";
      title = "Dia ruim";
      lines.push(
        "O custo estimado (combustível + extras + despesas) passou da receita. Vale revisar km vazio, preço do litro ou despesas do dia."
      );
    } else if (meta > 0 && lucro >= meta * 1.1) {
      level = "good";
      title = "Dia muito bom";
      lines.push(
        `Lucro líquido estimado de ${money(lucro)} ficou bem acima da sua meta (${money(meta)}).`
      );
    } else if (meta > 0 && lucro >= meta) {
      level = "good";
      title = "Dia bom";
      lines.push(
        `Lucro líquido estimado de ${money(lucro)} atingiu ou passou a meta de ${money(meta)}.`
      );
    } else if (meta > 0 && lucro >= meta * 0.7) {
      level = "warn";
      title = "Dia razoável";
      lines.push(
        `Faltou um pouco para a meta (${money(meta)}). Lucro estimado: ${money(lucro)}.`
      );
    } else if (meta > 0) {
      level = "warn";
      title = "Dia fraco";
      lines.push(
        `Abaixo da meta de ${money(meta)}. Lucro estimado: ${money(lucro)} — confira se o km rodado ou a receita batem com o esperado.`
      );
    } else {
      lines.push(
        `Lucro líquido estimado: ${money(lucro)}. Defina uma meta em "Dados do carro" para comparar automaticamente.`
      );
      if (lucro >= 150) {
        level = "good";
        title = "Dia positivo";
      } else if (lucro < 50 && row.kmDia > 80) {
        level = "warn";
        title = "Atenção";
        lines.push(
          "Muitos km com lucro baixo: pode valer escolher região/horário com demanda melhor."
        );
      } else {
        title = "Dia ok";
      }
    }

    if (row.kmDia > 0) {
      lines.push(`Lucro por km: ${money(rkm)}.`);
    }
    if (horas && stats.lucroPorHora != null) {
      lines.push(`Lucro por hora online (estimado): ${money(stats.lucroPorHora)}.`);
    }

    if (avgLucroKmHistory != null && row.kmDia > 0) {
      if (rkm >= avgLucroKmHistory * 1.08) {
        lines.push("Melhor que sua média recente de lucro por km — bom sinal.");
      } else if (rkm <= avgLucroKmHistory * 0.85) {
        lines.push("Abaixo da sua média recente de lucro por km.");
      }
    }

    return { level, title, lines };
  }

  const DOW_NAMES = [
    "domingos",
    "segundas-feiras",
    "terças-feiras",
    "quartas-feiras",
    "quintas-feiras",
    "sextas-feiras",
    "sábados",
  ];

  function dowInsightHtml(entries, car) {
    const sums = Array.from({ length: 7 }, () => ({ total: 0, n: 0 }));
    entries.forEach((e) => {
      const [y, m, d] = e.data.split("-").map(Number);
      if (!y) return;
      const dt = new Date(y, m - 1, d);
      const dow = dt.getDay();
      sums[dow].total += calcDay(car, e).lucroLiquido;
      sums[dow].n += 1;
    });
    const avgs = sums.map((s, i) => ({
      dow: i,
      avg: s.n ? s.total / s.n : null,
      n: s.n,
    }));
    const valid = avgs.filter((x) => x.n >= 2 && x.avg != null);
    if (valid.length < 2) {
      return {
        html: "<p>Quando tiver pelo menos 2 registros em dois dias da semana diferentes, mostramos uma comparação aqui.</p>",
        weak: true,
      };
    }
    valid.sort((a, b) => b.avg - a.avg);
    const best = valid[0];
    const worst = valid[valid.length - 1];
    const namesShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const lines = valid
      .slice()
      .sort((a, b) => a.dow - b.dow)
      .map(
        (x) =>
          `<span class="dow-chip">${namesShort[x.dow]}: <strong>${money(
            x.avg
          )}</strong> média (${x.n} dias)</span>`
      )
      .join(" · ");
    let main = "";
    if (best.dow !== worst.dow) {
      main = `<p><strong>Padrão:</strong> em média, <strong>${DOW_NAMES[best.dow]}</strong> (${money(
        best.avg
      )}) têm melhor lucro que <strong>${DOW_NAMES[worst.dow]}</strong> (${money(
        worst.avg
      )}) — com base em todos os seus registros.</p>`;
    } else {
      main = "<p>Médias por dia da semana:</p>";
    }
    return { html: `${main}<p class="dow-chips">${lines}</p>`, weak: false };
  }

  function iconFor(level) {
    if (level === "good") return "✓";
    if (level === "bad") return "✕";
    return "◐";
  }

  let state = loadState();
  let editingId = null;
  let filterMode = "all";
  let filterDe = "";
  let filterAte = "";
  let toastTimer = null;
  let installPromptEvent = null;

  const formCar = $("#formCar");
  const formDay = $("#formDay");
  const previewCard = $("#previewCard");
  const previewMetrics = $("#previewMetrics");
  const verdictBox = $("#verdictBox");
  const historyBody = $("#historyBody");
  const emptyState = $("#emptyState");
  const tableWrap = $("#tableWrap");
  const entryCount = $("#entryCount");
  const btnExport = $("#btnExport");
  const btnImport = $("#btnImport");
  const importFile = $("#importFile");
  const dashGrid = $("#dashGrid");
  const dowInsightEl = $("#dowInsight");
  const filterModeEl = $("#filterMode");
  const filterCustomEl = $("#filterCustom");
  const filterDeEl = $("#filterDe");
  const filterAteEl = $("#filterAte");
  const chartBars = $("#chartBars");
  const chartEmpty = $("#chartEmpty");
  const chartSubtitle = $("#chartSubtitle");
  const btnDaySubmit = $("#btnDaySubmit");
  const btnCancelEdit = $("#btnCancelEdit");
  const editHint = $("#editHint");
  const filterEmpty = $("#filterEmpty");
  const toastEl = $("#toast");
  const installBanner = $("#installBanner");
  const btnInstallPwa = $("#btnInstallPwa");
  const btnInstallDismiss = $("#btnInstallDismiss");
  const iosPwaHint = $("#iosPwaHint");
  const updateHint = $("#updateHint");

  function showToast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.hidden = true;
    }, 3400);
  }

  const CHART_EMPTY_MSG = "Nenhum dia no período selecionado.";
  const CHART_DATES_MSG =
    "Selecione as datas \"De\" e \"Até\" para ver o gráfico e o histórico filtrado.";

  function fillCarForm() {
    const c = state.car;
    formCar.apelido.value = c.apelido || "";
    formCar.kmPorLitro.value = c.kmPorLitro ?? "";
    formCar.precoLitro.value = c.precoLitro ?? "";
    formCar.custoExtraKm.value = c.custoExtraKm ?? "";
    formCar.metaLucroDia.value = c.metaLucroDia ?? "";
    formCar.metaLucroSemana.value =
      c.metaLucroSemana !== undefined && c.metaLucroSemana !== null
        ? c.metaLucroSemana
        : "";
  }

  function setTodayDefault() {
    const d = new Date();
    formDay.data.value = toISODateLocal(d);
  }

  function getFilterRange() {
    const now = new Date();
    if (filterMode === "week") return calendarWeekRangeContaining(now);
    if (filterMode === "month") return calendarMonthRangeContaining(now);
    if (filterMode === "custom") {
      const a = filterDeEl.value;
      const b = filterAteEl.value;
      if (a && b && a <= b) return { start: a, end: b };
      return null;
    }
    return null;
  }

  function getFilteredEntries() {
    if (filterMode === "custom") {
      const r = getFilterRange();
      if (!r) return [];
      return state.entries.filter((e) => inDateRange(e.data, r.start, r.end));
    }
    const r = getFilterRange();
    if (!r) return [...state.entries];
    return state.entries.filter((e) => inDateRange(e.data, r.start, r.end));
  }

  function metaClass(frac) {
    if (frac >= 1) return "dash-card__meta--good";
    if (frac >= 0.7) return "dash-card__meta--warn";
    return "dash-card__meta--bad";
  }

  function renderDashboard() {
    if (!dashGrid) return;
    const now = new Date();
    const wk = calendarWeekRangeContaining(now);
    const mo = calendarMonthRangeContaining(now);
    const entriesWeek = state.entries.filter((e) =>
      inDateRange(e.data, wk.start, wk.end)
    );
    const entriesMonth = state.entries.filter((e) =>
      inDateRange(e.data, mo.start, mo.end)
    );
    const aggW = aggregate(entriesWeek, state.car);
    const aggM = aggregate(entriesMonth, state.car);
    const metaSem = Math.max(0, state.car.metaLucroSemana || 0);
    const metaSemFrac = metaSem > 0 ? aggW.lucro / metaSem : null;

    let weekMetaLine = "";
    if (metaSem > 0) {
      const pct = Math.round((metaSemFrac || 0) * 100);
      const cls = metaClass(metaSemFrac || 0);
      weekMetaLine = `<div class="dash-card__meta ${cls}">Meta da semana: ${money(
        metaSem
      )} — você está em ${pct}%.</div>`;
    }

    const insight = dowInsightHtml(state.entries, state.car);
    if (dowInsightEl) {
      dowInsightEl.innerHTML = insight.html;
    }

    dashGrid.innerHTML = `
      <div class="dash-card">
        <div class="dash-card__label">Esta semana (${formatRangeBR(wk)})</div>
        <div class="dash-card__value num">${money(aggW.lucro)}</div>
        <div class="dash-card__meta">${aggW.days} dia(s) · ${aggW.km.toLocaleString("pt-BR", {
          maximumFractionDigits: 0,
        })} km</div>
        ${
          aggW.lucroPorHora != null
            ? `<div class="dash-card__meta">Média ${money(aggW.lucroPorHora)}/h online</div>`
            : ""
        }
        ${weekMetaLine}
      </div>
      <div class="dash-card">
        <div class="dash-card__label">Este mês (${formatRangeBR(mo)})</div>
        <div class="dash-card__value num">${money(aggM.lucro)}</div>
        <div class="dash-card__meta">${aggM.days} dia(s) · ${aggM.km.toLocaleString("pt-BR", {
          maximumFractionDigits: 0,
        })} km</div>
        ${
          aggM.lucroPorDia != null && aggM.days > 0
            ? `<div class="dash-card__meta">Média ${money(aggM.lucroPorDia)}/dia</div>`
            : ""
        }
        ${
          aggM.lucroPorHora != null
            ? `<div class="dash-card__meta">Média ${money(aggM.lucroPorHora)}/h online</div>`
            : ""
        }
      </div>
    `;
  }

  function formatRangeBR(r) {
    return `${formatDateBR(r.start)} – ${formatDateBR(r.end)}`;
  }

  function formatDateBR(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y) return iso;
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("pt-BR");
  }

  function groupLucroByDate(entries, car) {
    const map = new Map();
    entries.forEach((e) => {
      const luc = calcDay(car, e).lucroLiquido;
      map.set(e.data, (map.get(e.data) || 0) + luc);
    });
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }

  function renderChart() {
    if (filterMode === "custom" && (!filterDeEl.value || !filterAteEl.value)) {
      chartBars.innerHTML = "";
      chartEmpty.hidden = false;
      chartEmpty.textContent = CHART_DATES_MSG;
      chartSubtitle.textContent = "";
      return;
    }

    const filtered = getFilteredEntries();
    const pairs = groupLucroByDate(filtered, state.car);
    chartBars.innerHTML = "";

    const labels = {
      all: "Todos os dias registrados",
      week: "Esta semana",
      month: "Este mês",
      custom: "Intervalo escolhido",
    };
    chartSubtitle.textContent = labels[filterMode] || "";

    if (!pairs.length) {
      chartEmpty.hidden = false;
      chartEmpty.textContent = CHART_EMPTY_MSG;
      return;
    }
    chartEmpty.textContent = CHART_EMPTY_MSG;
    chartEmpty.hidden = true;

    const maxAbs = Math.max(...pairs.map((p) => Math.abs(p[1])), 1);
    pairs.forEach(([date, lucro]) => {
      const pct = (Math.abs(lucro) / maxAbs) * 100;
      const col = document.createElement("div");
      col.className = "chart__col";
      col.title = `${formatDateBR(date)}: ${money(lucro)}`;
      const wrap = document.createElement("div");
      wrap.className = "chart__bar-wrap";
      const bar = document.createElement("div");
      bar.className =
        "chart__bar " + (lucro >= 0 ? "chart__bar--pos" : "chart__bar--neg");
      bar.style.height = pct + "%";
      wrap.appendChild(bar);
      const lab = document.createElement("div");
      lab.className = "chart__label";
      const [yy, mm, dd] = date.split("-");
      lab.textContent = `${dd}/${mm}`;
      col.appendChild(wrap);
      col.appendChild(lab);
      chartBars.appendChild(col);
    });
  }

  function renderPreview(car, row, excludeId) {
    const stats = calcDay(car, row);
    const avg = averageLucroPorKm(state.entries, car, excludeId);
    const v = verdict(car, row, stats, avg);

    previewCard.hidden = false;
    previewMetrics.innerHTML = `
      <div class="metric"><div class="metric__label">Custo combustível</div><div class="metric__value num">${money(
        stats.custoCombustivel
      )}</div></div>
      <div class="metric"><div class="metric__label">Custo extra (km)</div><div class="metric__value num">${money(
        stats.custoExtraTotal
      )}</div></div>
      <div class="metric"><div class="metric__label">Despesas + custos</div><div class="metric__value num">${money(
        stats.custoTotal
      )}</div></div>
      <div class="metric"><div class="metric__label">Lucro líquido est.</div><div class="metric__value num">${money(
        stats.lucroLiquido
      )}</div></div>
      <div class="metric"><div class="metric__label">Litros gastos (est.)</div><div class="metric__value num">${stats.litros.toLocaleString(
        "pt-BR",
        { maximumFractionDigits: 2 }
      )} L</div></div>
    `;

    verdictBox.className = "verdict verdict--" + v.level;
    verdictBox.innerHTML = `
      <div class="verdict__title"><span class="verdict__icon" aria-hidden="true">${iconFor(
        v.level
      )}</span>${v.title}</div>
      <div>${v.lines.map((l) => `<p style="margin:0.35rem 0 0">${l}</p>`).join("")}</div>
    `;
  }

  function setEditingMode(on, entry) {
    editingId = on ? entry.id : null;
    editHint.hidden = !on;
    btnCancelEdit.hidden = !on;
    btnDaySubmit.textContent = on ? "Salvar alterações" : "Adicionar ao histórico";
    if (on && entry) {
      formDay.data.value = entry.data;
      formDay.kmDia.value = entry.kmDia;
      formDay.receita.value = entry.receita;
      formDay.despesasExtras.value = entry.despesasExtras || "";
      formDay.horas.value = entry.horas || "";
      formDay.notas.value = entry.notas || "";
    } else if (!on) {
      formDay.kmDia.value = "";
      formDay.receita.value = "";
      formDay.despesasExtras.value = "";
      formDay.horas.value = "";
      formDay.notas.value = "";
      setTodayDefault();
    }
    const km = formDay.querySelector('[name="kmDia"]');
    if (km) km.focus();
  }

  function renderHistory() {
    const filtered = getFilteredEntries();
    const sorted = [...filtered].sort((a, b) => (a.data < b.data ? 1 : -1));
    historyBody.innerHTML = "";
    sorted.forEach((e) => {
      const s = calcDay(state.car, e);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="num">${formatDateBR(e.data)}</td>
        <td class="num">${e.kmDia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td>
        <td class="num">${money(e.receita)}</td>
        <td class="num">${money(s.lucroLiquido)}</td>
        <td class="num">${money(s.lucroPorKm)}</td>
        <td class="cell-actions">
          <button type="button" class="btn btn--ghost btn--small" data-edit="${e.id}">Editar</button>
          <button type="button" class="btn btn--danger btn--small" data-del="${e.id}">Excluir</button>
        </td>
      `;
      historyBody.appendChild(tr);
    });

    const total = state.entries.length;
    const n = filtered.length;
    if (filterEmpty) {
      filterEmpty.hidden = !(total > 0 && n === 0);
    }
    if (filterMode === "all" || n === total) {
      entryCount.textContent = total === 1 ? "1 dia" : `${total} dias`;
    } else {
      entryCount.textContent = `${n} de ${total} dias no período`;
    }
    emptyState.hidden = total > 0;
    if (tableWrap) tableWrap.hidden = total === 0;
  }

  function refreshUI() {
    renderDashboard();
    renderChart();
    renderHistory();
  }

  formCar.addEventListener("submit", (ev) => {
    ev.preventDefault();
    state.car = {
      apelido: formCar.apelido.value.trim(),
      kmPorLitro: parseNum(formCar.kmPorLitro.value) || defaultCar().kmPorLitro,
      precoLitro: parseNum(formCar.precoLitro.value),
      custoExtraKm: parseNum(formCar.custoExtraKm.value),
      metaLucroDia: parseNum(formCar.metaLucroDia.value),
      metaLucroSemana: parseNum(formCar.metaLucroSemana.value),
    };
    saveState(state);
    fillCarForm();
    refreshUI();
    showToast("Dados do carro salvos.");
  });

  function mergeCarFromForms() {
    const kmL = parseNum(formCar.kmPorLitro.value) || defaultCar().kmPorLitro;
    const pL = parseNum(formCar.precoLitro.value);
    if (!kmL || pL <= 0) return null;
    state.car = {
      apelido: formCar.apelido.value.trim(),
      kmPorLitro: kmL,
      precoLitro: pL,
      custoExtraKm: parseNum(formCar.custoExtraKm.value),
      metaLucroDia: parseNum(formCar.metaLucroDia.value),
      metaLucroSemana: parseNum(formCar.metaLucroSemana.value),
    };
    return state.car;
  }

  formDay.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const wasEditing = !!editingId;
    const car = mergeCarFromForms();
    if (!car) {
      alert("Informe consumo (km/L) e preço do combustível (R$/L) nos dados do carro.");
      return;
    }

    const row = {
      id: editingId || crypto.randomUUID(),
      data: formDay.data.value,
      kmDia: parseNum(formDay.kmDia.value),
      receita: parseNum(formDay.receita.value),
      despesasExtras: parseNum(formDay.despesasExtras.value),
      horas: parseNum(formDay.horas.value),
      notas: formDay.notas.value.trim(),
    };

    if (editingId) {
      const idx = state.entries.findIndex((e) => e.id === editingId);
      if (idx === -1) {
        setEditingMode(false);
        return;
      }
      state.entries[idx] = row;
    } else {
      state.entries.push(row);
    }

    saveState(state);
    const saved = state.entries.find((e) => e.id === row.id) || row;
    renderPreview(state.car, saved, saved.id);
    setEditingMode(false);
    refreshUI();
    formDay.despesasExtras.value = "";
    formDay.notas.value = "";
    setTodayDefault();
    showToast(
      wasEditing ? "Dia atualizado no histórico." : "Dia adicionado ao histórico."
    );
  });

  btnCancelEdit.addEventListener("click", () => {
    setEditingMode(false);
    previewCard.hidden = true;
  });

  historyBody.addEventListener("click", (ev) => {
    const del = ev.target.closest("[data-del]");
    if (del) {
      const id = del.getAttribute("data-del");
      if (!confirm("Excluir este dia do histórico?")) return;
      state.entries = state.entries.filter((e) => e.id !== id);
      if (editingId === id) setEditingMode(false);
      saveState(state);
      refreshUI();
      previewCard.hidden = true;
      return;
    }
    const ed = ev.target.closest("[data-edit]");
    if (ed) {
      const id = ed.getAttribute("data-edit");
      const entry = state.entries.find((e) => e.id === id);
      if (!entry) return;
      setEditingMode(true, entry);
      previewCard.hidden = true;
      window.scrollTo({ top: formDay.offsetTop - 24, behavior: "smooth" });
    }
  });

  filterModeEl.addEventListener("change", () => {
    filterMode = filterModeEl.value;
    filterCustomEl.hidden = filterMode !== "custom";
    refreshUI();
  });

  function syncFilterInputsFromState() {
    filterModeEl.value = filterMode;
    filterCustomEl.hidden = filterMode !== "custom";
    filterDeEl.value = filterDe || "";
    filterAteEl.value = filterAte || "";
  }

  [filterDeEl, filterAteEl].forEach((el) => {
    el.addEventListener("change", () => {
      filterDe = filterDeEl.value;
      filterAte = filterAteEl.value;
      refreshUI();
    });
  });

  btnExport.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `controle-corridas-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  btnImport.addEventListener("click", () => importFile.click());

  importFile.addEventListener("change", () => {
    const file = importFile.files?.[0];
    importFile.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data.car || !Array.isArray(data.entries)) {
          alert("Arquivo inválido.");
          return;
        }
        state = {
          car: { ...defaultCar(), ...data.car },
          entries: data.entries,
        };
        saveState(state);
        fillCarForm();
        setEditingMode(false);
        previewCard.hidden = true;
        refreshUI();
        showToast("Backup importado com sucesso.");
      } catch {
        alert("Não foi possível ler o arquivo.");
      }
    };
    reader.readAsText(file);
  });

  fillCarForm();
  setTodayDefault();
  syncFilterInputsFromState();
  refreshUI();

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPromptEvent = e;
    if (installBanner) installBanner.hidden = false;
  });

  btnInstallPwa?.addEventListener("click", async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => {});
    installPromptEvent = null;
    if (installBanner) installBanner.hidden = true;
  });

  btnInstallDismiss?.addEventListener("click", () => {
    if (installBanner) installBanner.hidden = true;
  });

  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (isIOS && !isStandalone && iosPwaHint) iosPwaHint.hidden = false;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      const manifestLink = document.querySelector('link[rel="manifest"]');
      const baseHref = manifestLink
        ? manifestLink.href
        : new URL("./", window.location.href).href;
      const swUrl = new URL("sw.js", baseHref).href;
      const scopeUrl = new URL("./", baseHref).href;
      navigator.serviceWorker
        .register(swUrl, { scope: scopeUrl })
        .then((reg) => {
          reg.addEventListener("updatefound", () => {
            const nw = reg.installing;
            if (!nw) return;
            nw.addEventListener("statechange", () => {
              if (
                nw.state === "installed" &&
                navigator.serviceWorker.controller &&
                updateHint
              ) {
                updateHint.hidden = false;
                updateHint.textContent =
                  "Nova versão disponível. Feche o app por completo e abra de novo para atualizar.";
              }
            });
          });
        })
        .catch(() => {});
    });
  }
})();
