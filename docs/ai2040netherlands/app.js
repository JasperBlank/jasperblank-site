(() => {
  "use strict";

  const periodLabels = ["2024", "2025", "2026", "2027", "2028", "2029", "2030", "2031–34"];
  const nowIndex = 2;
  const finalIndex = periodLabels.length - 1;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const numberFormatter = new Intl.NumberFormat("nl-NL", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const metrics = [
    {
      title: "Economische groei",
      status: "realisatie + CPB-raming",
      values: [1.1, 1.9, 1.4, 1.1, 1.3, 1.2, 1.1, 0.8],
      detail: "Jaarlijkse volumegroei van het bruto binnenlands product. De waarden voor 2024–2030 staan in Bijlage 01 van het CEP 2026. Het laatste punt is het CPB-gemiddelde van 0,8% per jaar voor 2031–2034 uit tabel 2.1 op pagina 18.",
    },
    {
      title: "Beroepsbevolking",
      status: "realisatie + CPB-raming",
      values: [0.7, 0.6, 0.7, 1.2, 0.8, 0.7, 0.6, 0.2],
      detail: "Jaarlijkse groei van de beroepsbevolking. De reeks daalt van 0,6% in 2030 naar gemiddeld 0,2% per jaar in 2031–2034. Dit is de vertragende aanbodfactor die het CPB in de hoofdtekst benoemt.",
    },
    {
      title: "Werkgelegenheid in uren",
      status: "realisatie + CPB-raming",
      values: [1.3, -0.9, 0.6, 0.5, 0.4, 0.4, 0.4, 0.0],
      detail: "Jaarlijkse groei van het totale arbeidsvolume in uren. Na een daling van 0,9% in 2025 raamt het CPB 0,6% in 2026 en uiteindelijk gemiddeld 0,0% in 2031–2034.",
    },
    {
      title: "Arbeidsproductiviteit per uur",
      status: "realisatie + CPB-raming",
      values: [-0.1, 3.2, 0.9, 0.6, 0.8, 0.8, 0.7, 0.8],
      detail: "Jaarlijkse productiviteitsgroei bij bedrijven per gewerkt uur. Voor 2031–2034 rekent het CPB met gemiddeld 0,8% per jaar. Er staat in het CEP geen afzonderlijke variant waarin AI deze aanname verandert.",
    },
    {
      title: "Arbeidsinkomensquote bedrijven",
      status: "niveau · CPB-raming",
      values: [69.5, 69.2, 69.3, 70.0, 70.4, 70.3, 70.5, 71.3],
      detail: "Het aandeel van het inkomen van bedrijven dat aan arbeid wordt toegerekend. Dit is een niveaureeks: 69,2% in 2025, oplopend naar een door het CPB geraamde eindstand van 71,3% in 2034.",
    },
  ];

  const details = new Map();
  const els = {
    year: document.querySelector("#activeYear"),
    fixedMetrics: document.querySelector("#fixedMetrics"),
    baselineCanvas: document.querySelector("#baselineCanvas"),
    progress: document.querySelector(".reading-progress span"),
    dialog: document.querySelector("#detailsDialog"),
    dialogTitle: document.querySelector("#detailsDialog h2"),
    dialogContent: document.querySelector("#dialogContent"),
    seriesTab: document.querySelector("#seriesTab"),
    sourcesTab: document.querySelector("#sourcesTab"),
    seriesPanel: document.querySelector("#seriesPanel"),
    sourcesPanel: document.querySelector("#sourcesPanel"),
  };

  let targetReveal = nowIndex;
  let visualReveal = nowIndex;
  let activeIndex = nowIndex;
  let metricCanvases = [];

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    })[character]);
  }

  function formatValue(value) {
    return `${numberFormatter.format(value)}%`;
  }

  function buildMetrics() {
    els.fixedMetrics.innerHTML = metrics.map((metric, index) => {
      details.set(`metric-${index}`, metric);
      return `<button class="metric-series" type="button" data-detail="metric-${index}">
        <span class="series-copy"><span class="series-index">0${index + 1}</span><span class="series-title">${escapeHtml(metric.title)}</span><span class="series-status">${escapeHtml(metric.status)}</span></span>
        <strong class="series-value" data-value-index="${index}">${formatValue(metric.values[nowIndex])}</strong>
        <canvas class="series-canvas" data-series-index="${index}" aria-hidden="true"></canvas>
      </button>`;
    }).join("");
    metricCanvases = [...document.querySelectorAll(".series-canvas")];
  }

  function resizeCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { context, width, height };
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function interpolate(values, position) {
    const bounded = clamp(position, 0, values.length - 1);
    const start = Math.floor(bounded);
    const end = Math.min(values.length - 1, start + 1);
    const amount = bounded - start;
    return values[start] + (values[end] - values[start]) * amount;
  }

  function samplesBetween(values, start, end) {
    const boundedStart = clamp(start, 0, finalIndex);
    const boundedEnd = clamp(end, boundedStart, finalIndex);
    const samples = [{ time: boundedStart, value: interpolate(values, boundedStart) }];
    for (let index = Math.ceil(boundedStart); index <= Math.floor(boundedEnd); index += 1) {
      if (index > boundedStart + 0.001) samples.push({ time: index, value: values[index] });
    }
    if (boundedEnd > Math.floor(boundedEnd) + 0.001) {
      samples.push({ time: boundedEnd, value: interpolate(values, boundedEnd) });
    }
    return samples;
  }

  function geometry(left, right, reveal) {
    const visibleLimit = clamp(reveal, nowIndex, finalIndex);
    return {
      visibleLimit,
      xForTime: (time) => left + (right - left) * time / visibleLimit,
    };
  }

  function strokeSamples(context, samples, xForTime, yFor) {
    if (!samples.length) return;
    context.beginPath();
    samples.forEach((sample, index) => {
      const x = xForTime(sample.time);
      const y = yFor(sample.value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }

  function drawMetric(canvas, metric, reveal) {
    const { context, width, height } = resizeCanvas(canvas);
    context.clearRect(0, 0, width, height);
    const left = 2;
    const right = width - 2;
    const top = 3;
    const bottom = height - 3;
    const { visibleLimit, xForTime } = geometry(left, right, reveal);
    const seriesMinimum = Math.min(...metric.values);
    const seriesMaximum = Math.max(...metric.values);
    const span = Math.max(0.6, seriesMaximum - seriesMinimum);
    const minimum = seriesMinimum - span * 0.18;
    const maximum = seriesMaximum + span * 0.18;
    const yFor = (value) => bottom - (bottom - top) * (value - minimum) / (maximum - minimum);
    const nowX = xForTime(nowIndex);

    if (visibleLimit > nowIndex) {
      context.fillStyle = "rgba(139,0,0,.045)";
      context.fillRect(nowX, top, right - nowX, bottom - top);
    }

    context.strokeStyle = "rgba(31,27,25,.14)";
    context.lineWidth = 0.6;
    for (let index = 0; index <= Math.floor(visibleLimit); index += 1) {
      const x = xForTime(index);
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    }
    if (minimum < 0 && maximum > 0) {
      context.beginPath();
      context.moveTo(left, yFor(0));
      context.lineTo(right, yFor(0));
      context.stroke();
    }

    context.strokeStyle = "#1f1b19";
    context.lineWidth = 1.3;
    strokeSamples(context, samplesBetween(metric.values, 0, 1), xForTime, yFor);

    context.save();
    context.setLineDash([3, 2]);
    context.strokeStyle = "#8b0000";
    context.lineWidth = 1.4;
    strokeSamples(context, samplesBetween(metric.values, 1, visibleLimit), xForTime, yFor);
    context.restore();

    context.strokeStyle = "rgba(31,27,25,.7)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(nowX, top);
    context.lineTo(nowX, bottom);
    context.stroke();

    const cursorValue = interpolate(metric.values, visibleLimit);
    const cursorX = xForTime(visibleLimit);
    context.fillStyle = "#8b0000";
    context.beginPath();
    context.arc(cursorX, yFor(cursorValue), 2.5, 0, Math.PI * 2);
    context.fill();
  }

  function drawBaseline(reveal) {
    const { context, width, height } = resizeCanvas(els.baselineCanvas);
    context.clearRect(0, 0, width, height);
    const left = 4;
    const right = width - 4;
    const top = 3;
    const bottom = height - 18;
    const { visibleLimit, xForTime } = geometry(left, right, reveal);
    const yFor = (value) => bottom - (bottom - top) * (value + 1) / 4.5;
    const nowX = xForTime(nowIndex);

    if (visibleLimit > nowIndex) {
      context.fillStyle = "rgba(139,0,0,.05)";
      context.fillRect(nowX, top, right - nowX, bottom - top);
    }

    context.strokeStyle = "rgba(31,27,25,.18)";
    context.lineWidth = 0.6;
    context.beginPath();
    context.moveTo(left, yFor(0));
    context.lineTo(right, yFor(0));
    context.stroke();

    for (let index = 0; index <= Math.floor(visibleLimit); index += 1) {
      const x = xForTime(index);
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, bottom);
      context.stroke();
    }

    const plotted = [
      { values: metrics[0].values, color: "#ed1b24", dash: [] },
      { values: metrics[3].values, color: "#1f1b19", dash: [4, 3] },
      { values: metrics[2].values, color: "rgba(31,27,25,.52)", dash: [1, 3] },
    ];
    plotted.forEach((series) => {
      context.save();
      context.setLineDash(series.dash);
      context.strokeStyle = series.color;
      context.lineWidth = series === plotted[0] ? 2 : 1.25;
      strokeSamples(context, samplesBetween(series.values, 0, visibleLimit), xForTime, yFor);
      context.restore();
    });

    context.strokeStyle = "rgba(31,27,25,.78)";
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(nowX, top);
    context.lineTo(nowX, bottom);
    context.stroke();
    context.fillStyle = "#8b0000";
    context.font = "700 7px Arial, sans-serif";
    context.textAlign = "right";
    context.fillText("NU", Math.max(left + 16, nowX - 3), top + 7);

    const shown = [...new Set([0, nowIndex, Math.floor(visibleLimit)])];
    shown.forEach((index) => {
      const x = xForTime(index);
      context.fillStyle = "rgba(31,27,25,.65)";
      context.font = "7px Arial, sans-serif";
      context.textAlign = index === 0 ? "left" : index === Math.floor(visibleLimit) ? "right" : "center";
      context.fillText(periodLabels[index], x, height - 4);
    });
  }

  function storyReveal() {
    if (window.scrollY < 40) return nowIndex;
    const chapters = [...document.querySelectorAll(".chapter[data-step]")];
    if (!chapters.length) return nowIndex;
    const marker = window.scrollY + window.innerHeight * 0.4;
    const firstTop = chapters[0].offsetTop;
    const lastTop = chapters[chapters.length - 1].offsetTop;
    if (marker <= firstTop) return nowIndex;
    if (marker >= lastTop) return finalIndex;
    for (let index = 0; index < chapters.length - 1; index += 1) {
      const start = chapters[index].offsetTop;
      const end = chapters[index + 1].offsetTop;
      if (marker < end) {
        const chapterPosition = index + (marker - start) / Math.max(1, end - start);
        return nowIndex + (finalIndex - nowIndex) * chapterPosition / (chapters.length - 1);
      }
    }
    return finalIndex;
  }

  function updateReadouts(reveal) {
    activeIndex = clamp(Math.round(reveal), nowIndex, finalIndex);
    els.year.textContent = periodLabels[activeIndex];
    metrics.forEach((metric, index) => {
      const value = document.querySelector(`[data-value-index="${index}"]`);
      if (value) value.textContent = formatValue(interpolate(metric.values, reveal));
    });
    const denominator = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    els.progress.style.transform = `scaleX(${clamp(window.scrollY / denominator, 0, 1)})`;
  }

  function openDialog(item, kicker = "CPB-basisgegevens") {
    els.dialog.querySelector(".visible-index").textContent = kicker;
    els.dialogTitle.textContent = item.title;
    els.dialogContent.innerHTML = `<p>${escapeHtml(item.detail)}</p>`;
    els.dialog.showModal();
  }

  function setDashboardTab(tabName, focus = false) {
    const showSources = tabName === "sources";
    els.seriesTab.setAttribute("aria-selected", String(!showSources));
    els.sourcesTab.setAttribute("aria-selected", String(showSources));
    els.seriesTab.tabIndex = showSources ? -1 : 0;
    els.sourcesTab.tabIndex = showSources ? 0 : -1;
    els.seriesPanel.hidden = showSources;
    els.sourcesPanel.hidden = !showSources;
    if (focus) (showSources ? els.sourcesTab : els.seriesTab).focus();
    if (!showSources) {
      drawBaseline(visualReveal);
      metricCanvases.forEach((canvas, index) => drawMetric(canvas, metrics[index], visualReveal));
    }
  }

  buildMetrics();

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-detail]");
    if (target && details.has(target.dataset.detail)) {
      openDialog(details.get(target.dataset.detail), "reeks & bron");
    }
  });

  els.seriesTab?.addEventListener("click", () => setDashboardTab("series"));
  els.sourcesTab?.addEventListener("click", () => setDashboardTab("sources"));
  document.querySelector("#sourcesNavButton")?.addEventListener("click", () => {
    setDashboardTab("sources", true);
    if (window.matchMedia("(max-width: 900px)").matches) {
      document.querySelector("#dashboard").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    }
  });
  document.querySelector(".dashboard-tabs")?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const showSources = event.key === "ArrowRight" || event.key === "End";
    setDashboardTab(showSources ? "sources" : "series", true);
  });

  const baselineDetail = {
    title: "Het officiële basispad",
    detail: "Na 2030 bepaalt volgens het CPB de aanbodzijde hoeveel Nederland kan produceren. Voor 2031–2034 is de gemiddelde bbp-groei 0,8% per jaar, de groei van gewerkte uren 0,0% en de arbeidsproductiviteitsgroei 0,8%. Het CEP bevat geen afzonderlijke AI-variant voor productiviteit of arbeidsvraag.",
  };
  const methodDetail = {
    title: "Definities, perioden & brongebruik",
    detail: "Alle vijf grafieken gebruiken dezelfde acht punten. De jaarwaarden 2024–2030 komen uit Bijlage 01 van het CEP 2026. Het laatste punt komt uit tabel 2.1: voor groeireeksen is dit het gemiddelde van 2031–2034; voor de arbeidsinkomensquote is het de eindstand van 2034. 2024–2025 zijn realisaties, vanaf 2026 gaat het om de CPB-raming. Er zijn geen alternatieve paden of door ons verzonnen AI-waarden.",
  };
  document.querySelector("#baselinePanel")?.addEventListener("click", () => openDialog(baselineDetail, "CPB-basispad"));
  document.querySelector("#methodButton")?.addEventListener("click", () => openDialog(methodDetail, "methodiek"));
  document.querySelector("#detailsButton")?.addEventListener("click", () => openDialog(methodDetail, "methodiek"));
  document.querySelector("#dialogClose")?.addEventListener("click", () => els.dialog?.close());
  els.dialog?.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });

  document.querySelector("#yearPicker")?.addEventListener("click", () => {
    const chapters = [...document.querySelectorAll(".chapter[data-step]")];
    const marker = window.scrollY + window.innerHeight * 0.4;
    const currentChapter = chapters.findLastIndex((chapter) => chapter.offsetTop <= marker);
    const nextIndex = currentChapter >= chapters.length - 1 ? 0 : currentChapter + 1;
    chapters[nextIndex].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  });

  function animate() {
    targetReveal = storyReveal();
    visualReveal += (targetReveal - visualReveal) * (reducedMotion ? 1 : 0.08);
    if (Math.abs(targetReveal - visualReveal) < 0.0005) visualReveal = targetReveal;
    drawBaseline(visualReveal);
    metricCanvases.forEach((canvas, index) => drawMetric(canvas, metrics[index], visualReveal));
    updateReadouts(visualReveal);
    requestAnimationFrame(animate);
  }

  window.addEventListener("resize", () => {
    drawBaseline(visualReveal);
    metricCanvases.forEach((canvas, index) => drawMetric(canvas, metrics[index], visualReveal));
  }, { passive: true });
  requestAnimationFrame(animate);
})();
