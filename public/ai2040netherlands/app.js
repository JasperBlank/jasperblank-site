(() => {
  "use strict";

  const years = [2026, 2028, 2030, 2034, 2037, 2040];
  const visibleChapters = () => [...document.querySelectorAll(".chapter[data-year]")].filter((chapter) => chapter.offsetParent !== null);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const metrics = [
    {
      title: "AI-compute op NL bodem",
      status: "scenario · EZ-bronanker beschikbaar",
      low: [3, 10, 19, 38, 58, 76], mid: [8, 20, 34, 60, 80, 100], high: [18, 33, 50, 78, 95, 100],
      values: ["40k–400k H100e", "×6 t.o.v. ’26", "×32 t.o.v. ’26", "×512 t.o.v. ’26", "×4,1k t.o.v. ’26", "×32,8k t.o.v. ’26"],
      detail: "De uitgangsrange 40.000–400.000 H100-equivalenten is een werkhypothese, geen officiële telling. Een rapport in opdracht van EZ inventariseert circa 22.798 aangeboden GPU’s, maar zegt dat veel aantallen indirect zijn geschat en verschillende generaties omvatten. Na 2026 toont de grafiek alleen een illustratief groeipad.",
    },
    {
      title: "Onder Nederlandse zeggenschap",
      status: "scenario · eigendomsproxy beschikbaar",
      low: [40, 35, 29, 20, 14, 10], mid: [62, 57, 51, 42, 35, 28], high: [80, 76, 70, 61, 53, 45],
      values: ["40–80%", "35–76%", "29–70%", "20–61%", "14–53%", "10–45%"],
      detail: "Zeggenschap betekent hier meer dan eigendom: juridische controle, operationele toegang en de mogelijkheid capaciteit tijdens schaarste te alloceren. De percentages zijn scenario-aannames en mogen niet als gemeten Nederlands aandeel worden gelezen.",
    },
    {
      title: "Nieuwe AI-compute geraakt door NL tech",
      status: "scenario · EUV-proxy beschikbaar",
      low: [75, 70, 64, 52, 44, 35], mid: [90, 88, 84, 75, 68, 60], high: [100, 100, 98, 92, 86, 80],
      values: ["75–100%", "70–100%", "64–98%", "52–92%", "44–86%", "35–80%"],
      detail: "Deze reeks verbeeldt de potentiële Nederlandse ketenhefboom: welk aandeel van nieuwe mondiale AI-compute tijdens productie afhankelijk was van Nederlandse lithografie, onderdelen of kennis. Er bestaat nog geen transparante noemer of openbare tijdreeks; alle waarden zijn illustratieve scenario-intervallen.",
    },
    {
      title: "Serviceerbare installed base",
      status: "scenario · omzetanker beschikbaar",
      low: [60, 55, 48, 36, 28, 20], mid: [82, 78, 72, 61, 52, 43], high: [100, 100, 96, 86, 76, 67],
      values: ["60–100%", "55–100%", "48–96%", "36–86%", "28–76%", "20–67%"],
      detail: "De relevante beleidsmaat is het aandeel van de geïnstalleerde productiebasis waarop service, onderdelen, software of upgrades nog Nederlandse invloed geven. De publieke installed-basegegevens bieden deze doorsnede niet; het getoonde verloop is een scenario.",
    },
    {
      title: "Toezichtdekking t.o.v. de opgave",
      status: "scenario · fte-anker beschikbaar",
      low: [5, 6, 8, 10, 12, 14], mid: [16, 19, 22, 27, 31, 35], high: [28, 32, 36, 42, 47, 52],
      values: ["5–28%", "6–32%", "8–36%", "10–42%", "12–47%", "14–52%"],
      detail: "Toezichtdekking is bedoeld als verhouding tussen relevante zaken en daadwerkelijk technisch beoordeelbare zaken — niet als losse FTE-telling. Omdat beide Nederlandse tijdreeksen ontbreken, laat de grafiek uitsluitend een illustratief verbeterpad zien dat de groeiende opgave niet bijhoudt.",
    },
  ];

  const capability = [16, 27, 40, 65, 84, 100];
  const response = [16, 22, 28, 38, 46, 53];
  const scenarioPaths = {
    regie: {
      label: "PLAN R · BOUW REGIE",
      note: "Nederland maakt compute, eigendom en netimpact zichtbaar, bouwt een technisch inspectiekorps en organiseert de servicehefboom met Europese partners. De optionality gap groeit nog steeds, maar beduidend langzamer.",
      response: [47, 55, 63],
      metrics: [
        [[38, 58, 76], [60, 80, 100], [78, 95, 100], ["×512 t.o.v. ’26", "×4,1k t.o.v. ’26", "×32,8k t.o.v. ’26"]],
        [[34, 32, 30], [49, 48, 48], [64, 63, 62], ["34–64%", "32–63%", "30–62%"]],
        [[61, 59, 56], [80, 77, 74], [95, 92, 89], ["61–95%", "59–92%", "56–89%"]],
        [[48, 47, 46], [72, 68, 64], [90, 87, 84], ["48–90%", "47–87%", "46–84%"]],
        [[22, 34, 46], [38, 50, 64], [55, 68, 80], ["22–55%", "34–68%", "46–80%"]],
      ],
    },
    markt: {
      label: "PLAN M · VOLG DE MARKT",
      note: "Nederland vertrouwt vooral op bestaande vergunningen, vrijwillige rapportage en correcties wanneer knelpunten zichtbaar worden. Compute groeit door; zicht en uitvoeringscapaciteit verbeteren slechts incrementeel.",
      response: [38, 43, 47],
      metrics: [
        [[38, 58, 76], [60, 80, 100], [78, 95, 100], ["×512 t.o.v. ’26", "×4,1k t.o.v. ’26", "×32,8k t.o.v. ’26"]],
        [[20, 14, 10], [42, 35, 28], [61, 53, 45], ["20–61%", "14–53%", "10–45%"]],
        [[52, 44, 35], [75, 68, 60], [92, 86, 80], ["52–92%", "44–86%", "35–80%"]],
        [[36, 28, 20], [61, 52, 43], [86, 76, 67], ["36–86%", "28–76%", "20–67%"]],
        [[10, 12, 14], [27, 31, 35], [42, 47, 52], ["10–42%", "12–47%", "14–52%"]],
      ],
    },
    uitstel: {
      label: "PLAN U · STEL UIT",
      note: "Nederland wacht op Europese uitvoering en internationale overeenstemming. De technische basis groeit wel door, terwijl nationale zeggenschap, service-invloed en toetsbare toezichtdekking versneld achterblijven.",
      response: [31, 24, 18],
      metrics: [
        [[38, 58, 76], [60, 80, 100], [78, 95, 100], ["×512 t.o.v. ’26", "×4,1k t.o.v. ’26", "×32,8k t.o.v. ’26"]],
        [[16, 8, 4], [35, 23, 14], [53, 39, 28], ["16–53%", "8–39%", "4–28%"]],
        [[42, 30, 20], [65, 52, 38], [84, 73, 61], ["42–84%", "30–73%", "20–61%"]],
        [[27, 16, 9], [50, 35, 22], [74, 56, 41], ["27–74%", "16–56%", "9–41%"]],
        [[7, 6, 5], [22, 19, 17], [35, 32, 29], ["7–35%", "6–32%", "5–29%"]],
      ],
    },
  };
  const details = new Map();
  const els = {
    year: document.querySelector("#activeYear"), fixedMetrics: document.querySelector("#fixedMetrics"),
    gapCanvas: document.querySelector("#gapCanvas"), gapValue: document.querySelector("#gapValue"),
    progress: document.querySelector(".reading-progress span"), dialog: document.querySelector("#detailsDialog"),
    dialogTitle: document.querySelector("#detailsDialog h2"), dialogContent: document.querySelector("#dialogContent"),
    postChoice: document.querySelector("#postChoice"), choiceGate: document.querySelector("#choiceGate"),
    choiceHint: document.querySelector("#choiceHint"), branchNote: document.querySelector("#scenarioBranchNote"),
    selectedPlan: document.querySelector("#selectedPlan"),
    scenarioTab: document.querySelector("#scenarioTab"), sourcesTab: document.querySelector("#sourcesTab"),
    scenarioPanel: document.querySelector("#scenarioPanel"), sourcesPanel: document.querySelector("#sourcesPanel"),
  };
  let targetPosition = 0;
  let visualPosition = 0;
  let activeIndex = 0;
  let metricCanvases = [];
  let selectedScenario = null;
  let scenarioReveal = 0;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
  }

  function buildMetrics() {
    els.fixedMetrics.innerHTML = metrics.map((metric, index) => {
      details.set(`metric-${index}`, metric);
      return `<button class="metric-series" type="button" data-detail="metric-${index}">
        <span class="series-copy"><span class="series-index">0${index + 1}</span><span class="series-title">${escapeHtml(metric.title)}</span><span class="series-status">${escapeHtml(metric.status)}</span></span>
        <strong class="series-value" data-value-index="${index}">${escapeHtml(metric.values[0])}</strong>
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
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { context, width, height };
  }

  function interpolate(values, position) {
    const start = Math.max(0, Math.min(values.length - 1, Math.floor(position)));
    const end = Math.min(values.length - 1, start + 1);
    const amount = Math.max(0, Math.min(1, position - start));
    return values[start] + (values[end] - values[start]) * amount;
  }

  function visibleSamples(values, position) {
    const capped = Math.max(0, Math.min(years.length - 1, position));
    const whole = Math.floor(capped);
    const samples = [];
    for (let index = 0; index <= whole; index += 1) samples.push({ time: index, value: values[index] });
    if (whole < years.length - 1 && capped - whole > 0.001) samples.push({ time: capped, value: interpolate(values, capped) });
    return samples;
  }

  function timelineGeometry(left, right, position) {
    if (selectedScenario) {
      const visibleLimit = 2 + 3 * scenarioReveal;
      const domainEnd = Math.max(2, visibleLimit);
      return {
        visibleLimit,
        cursorTime: Math.min(position, visibleLimit),
        xForTime: (time) => left + (right - left) * time / domainEnd,
      };
    }
    const visibleLimit = Math.min(2, position);
    return {
      visibleLimit,
      cursorTime: visibleLimit,
      xForTime: (time) => right - (visibleLimit - time) * (right - left) / 2,
    };
  }

  function samplePath(context, samples, xForTime, yFor) {
    context.beginPath();
    samples.forEach((sample, index) => {
      const x = xForTime(sample.time);
      const y = yFor(sample.value);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
  }

  function drawVisibleBand(context, low, high, visibleLimit, xForTime, yFor, fill) {
    const lowSamples = visibleSamples(low, visibleLimit);
    const highSamples = visibleSamples(high, visibleLimit);
    if (highSamples.length === 1) {
      const x = xForTime(highSamples[0].time);
      context.strokeStyle = "rgba(139,0,0,.4)";
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(x, yFor(highSamples[0].value)); context.lineTo(x, yFor(lowSamples[0].value)); context.stroke();
      return;
    }
    context.beginPath();
    highSamples.forEach((sample, index) => {
      if (index === 0) context.moveTo(xForTime(sample.time), yFor(sample.value));
      else context.lineTo(xForTime(sample.time), yFor(sample.value));
    });
    for (let index = lowSamples.length - 1; index >= 0; index -= 1) context.lineTo(xForTime(lowSamples[index].time), yFor(lowSamples[index].value));
    context.closePath(); context.fillStyle = fill; context.fill();
  }

  function drawMetric(canvas, metric, position) {
    const { context, width, height } = resizeCanvas(canvas);
    context.clearRect(0, 0, width, height);
    const padX = 2;
    const top = 2;
    const bottom = height - 4;
    const right = width - padX;
    const geometry = timelineGeometry(padX, right, position);
    const { visibleLimit, cursorTime, xForTime } = geometry;
    const yFor = (value) => bottom - (bottom - top) * value / 100;
    context.strokeStyle = "rgba(31,27,25,.15)";
    context.lineWidth = 0.6;
    const lastWholeYear = Math.floor(visibleLimit);
    years.forEach((year, index) => {
      if (index > lastWholeYear) return;
      context.beginPath(); context.moveTo(xForTime(index), top); context.lineTo(xForTime(index), bottom); context.stroke();
    });
    context.beginPath(); context.moveTo(xForTime(0), bottom); context.lineTo(right, bottom); context.stroke();
    drawVisibleBand(context, metric.low, metric.high, visibleLimit, xForTime, yFor, "rgba(139,0,0,.13)");
    context.save(); context.setLineDash([3, 3]); context.strokeStyle = "#8b0000"; context.lineWidth = 1.25;
    samplePath(context, visibleSamples(metric.mid, visibleLimit), xForTime, yFor); context.stroke(); context.restore();
    const cursorX = xForTime(cursorTime);
    context.strokeStyle = "rgba(31,27,25,.75)"; context.lineWidth = 0.8;
    context.beginPath(); context.moveTo(cursorX, top); context.lineTo(cursorX, bottom); context.stroke();
    context.fillStyle = "#8b0000"; context.beginPath(); context.arc(cursorX, yFor(interpolate(metric.mid, cursorTime)), 2.5, 0, Math.PI * 2); context.fill();
  }

  function drawGap(position) {
    const { context, width, height } = resizeCanvas(els.gapCanvas);
    context.clearRect(0, 0, width, height);
    const left = 4, right = width - 4, top = 3, bottom = height - 17;
    const geometry = timelineGeometry(left, right, position);
    const { visibleLimit, cursorTime, xForTime } = geometry;
    const yFor = (value) => bottom - (bottom - top) * value / 100;
    context.strokeStyle = "rgba(31,27,25,.16)"; context.lineWidth = 0.6;
    years.forEach((year, index) => {
      if (index > Math.floor(visibleLimit)) return;
      const x = xForTime(index);
      context.beginPath(); context.moveTo(x, top); context.lineTo(x, bottom); context.stroke();
      context.fillStyle = "rgba(31,27,25,.68)"; context.font = "7px Arial, sans-serif";
      context.textAlign = index === 0 ? "left" : index === Math.floor(visibleLimit) && Math.abs(visibleLimit - index) < 0.01 ? "right" : "center";
      context.fillText(String(year), x, height - 4);
    });
    const capabilitySamples = visibleSamples(capability, visibleLimit);
    const responseSamples = visibleSamples(response, visibleLimit);
    if (capabilitySamples.length > 1) {
      context.save(); context.beginPath();
      capabilitySamples.forEach((sample, index) => { if (index === 0) context.moveTo(xForTime(sample.time), yFor(sample.value)); else context.lineTo(xForTime(sample.time), yFor(sample.value)); });
      for (let index = responseSamples.length - 1; index >= 0; index -= 1) context.lineTo(xForTime(responseSamples[index].time), yFor(responseSamples[index].value));
      context.closePath(); context.fillStyle = "rgba(237,27,36,.19)"; context.fill(); context.clip();
      context.strokeStyle = "rgba(139,0,0,.34)"; context.lineWidth = 0.7;
      for (let x = -height; x < width + height; x += 7) { context.beginPath(); context.moveTo(x, bottom + 10); context.lineTo(x + height, top - 10); context.stroke(); }
      context.restore();
    }
    context.strokeStyle = "#ed1b24"; context.lineWidth = 2.2; samplePath(context, capabilitySamples, xForTime, yFor); context.stroke();
    context.save(); context.setLineDash([4, 3]); context.strokeStyle = "#1f1b19"; context.lineWidth = 1.3; samplePath(context, responseSamples, xForTime, yFor); context.stroke(); context.restore();
    const cursorX = xForTime(cursorTime);
    const capabilityNow = interpolate(capability, cursorTime);
    const responseNow = interpolate(response, cursorTime);
    context.strokeStyle = "rgba(31,27,25,.82)"; context.lineWidth = 0.8;
    context.beginPath(); context.moveTo(cursorX, top); context.lineTo(cursorX, bottom); context.stroke();
    context.fillStyle = "#ed1b24"; context.beginPath(); context.arc(cursorX, yFor(capabilityNow), 3, 0, Math.PI * 2); context.fill();
    context.fillStyle = "#1f1b19"; context.beginPath(); context.arc(cursorX, yFor(responseNow), 2.5, 0, Math.PI * 2); context.fill();
    context.strokeStyle = "#8b0000"; context.lineWidth = 2;
    context.beginPath(); context.moveTo(cursorX - 5, yFor(capabilityNow)); context.lineTo(cursorX - 5, yFor(responseNow)); context.stroke();
    context.fillStyle = "#8b0000"; context.font = "700 7px Arial, sans-serif"; context.textAlign = "right";
    context.fillText("NU", Math.min(right - 3, cursorX - 3), top + 7);
    if (selectedScenario) {
      context.fillStyle = "rgba(31,27,25,.58)";
      context.fillText("GEKOZEN PAD", right - 3, bottom - 3);
    }
    els.gapValue.textContent = `+${Math.round(Math.max(0, capabilityNow - responseNow))}`;
  }

  function calculatePosition() {
    if (window.scrollY < 50) return 0;
    const chapters = visibleChapters();
    const marker = window.scrollY + window.innerHeight * 0.38;
    const tops = chapters.map((chapter) => chapter.offsetTop);
    if (marker <= tops[0]) return 0;
    for (let index = 0; index < Math.min(2, tops.length - 1); index += 1) {
      if (marker < tops[index + 1]) return index + (marker - tops[index]) / Math.max(1, tops[index + 1] - tops[index]);
    }
    if (!selectedScenario || tops.length < 4 || marker < tops[3]) return 2;
    for (let index = 3; index < tops.length - 1; index += 1) {
      if (marker < tops[index + 1]) return index + (marker - tops[index]) / Math.max(1, tops[index + 1] - tops[index]);
    }
    return Math.min(years.length - 1, chapters.length - 1);
  }

  function updateReadouts(position) {
    activeIndex = Math.max(0, Math.min(years.length - 1, Math.floor(position + 0.42)));
    els.year.textContent = String(years[activeIndex]);
    metrics.forEach((metric, index) => {
      const value = document.querySelector(`[data-value-index="${index}"]`);
      if (value) value.textContent = metric.values[activeIndex];
    });
    const denominator = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    els.progress.style.transform = `scaleX(${Math.max(0, Math.min(1, window.scrollY / denominator))})`;
  }

  function openDialog(item, kicker = "scenario") {
    els.dialog.querySelector(".visible-index").textContent = kicker;
    els.dialogTitle.textContent = item.title;
    els.dialogContent.innerHTML = `<p>${escapeHtml(item.detail)}</p>`;
    els.dialog.showModal();
  }

  function chooseScenario(key) {
    const path = scenarioPaths[key];
    if (!path) return;
    selectedScenario = key;
    scenarioReveal = reducedMotion ? 1 : 0;
    path.metrics.forEach((series, metricIndex) => {
      const [low, mid, high, values] = series;
      metrics[metricIndex].low.splice(3, 3, ...low);
      metrics[metricIndex].mid.splice(3, 3, ...mid);
      metrics[metricIndex].high.splice(3, 3, ...high);
      metrics[metricIndex].values.splice(3, 3, ...values);
    });
    response.splice(3, 3, ...path.response);
    els.postChoice.hidden = false;
    document.body.classList.remove("scenario-locked");
    document.body.classList.add("scenario-unlocked");
    els.choiceGate.classList.add("is-resolved");
    document.querySelectorAll("[data-scenario]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.scenario === key));
    });
    els.choiceHint.textContent = `${path.label} is geladen. De tweede helft van de data wordt zichtbaar; scroll verder om het scenario te volgen.`;
    els.branchNote.innerHTML = `<strong>${escapeHtml(path.label)}</strong><br>${escapeHtml(path.note)}`;
    els.selectedPlan.textContent = path.label.split(" · ")[0];
  }

  function setDashboardTab(tabName, focus = false) {
    const showSources = tabName === "sources";
    els.scenarioTab.setAttribute("aria-selected", String(!showSources));
    els.sourcesTab.setAttribute("aria-selected", String(showSources));
    els.scenarioTab.tabIndex = showSources ? -1 : 0;
    els.sourcesTab.tabIndex = showSources ? 0 : -1;
    els.scenarioPanel.hidden = showSources;
    els.sourcesPanel.hidden = !showSources;
    if (focus) (showSources ? els.sourcesTab : els.scenarioTab).focus();
    if (!showSources) {
      drawGap(visualPosition);
      metricCanvases.forEach((canvas, index) => drawMetric(canvas, metrics[index], visualPosition));
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-detail]");
    if (target && details.has(target.dataset.detail)) openDialog(details.get(target.dataset.detail), "reeks & aannames");
    const explainer = event.target.closest("[data-explainer]");
    if (explainer) {
      const explainers = {
        optionality: ["Optieruimte", "De verzameling geloofwaardige keuzes die Nederland nog kan maken over toegang, eigendom, infrastructuur, toezicht en afhankelijkheid."],
        series: ["Waarom vijf reeksen?", "De vijf reeksen beantwoorden achtereenvolgens: hoeveel compute staat hier, wie kan erover beslissen, hoeveel mondiale hefboom heeft Nederlandse technologie, hoeveel daarvan blijft serviceerbaar en welk deel van de opgave kan de staat beoordelen?"],
        evidence: ["Wat is hier hard?", "De huidige grafieken zijn scenario-visualisaties, geen officiële tijdreeksen. De compute-baseline is een brede werkhypothese; voor de andere vier ontbreken de precieze publieke meetreeksen. Die status staat permanent bij iedere lijn."],
        unknowns: ["Datagat ≠ nul", "Een ontbrekende meetreeks betekent niet dat de werkelijke waarde nul is. De brede banden zijn expliciete scenario-aannames die later door bronnen of eigen onderzoek vervangen moeten worden."],
      };
      const [title, detail] = explainers[explainer.dataset.explainer];
      openDialog({ title, detail }, "begrip");
    }
  });

  document.querySelectorAll("[data-scenario]").forEach((button) => {
    button.addEventListener("click", () => chooseScenario(button.dataset.scenario));
  });

  els.scenarioTab.addEventListener("click", () => setDashboardTab("scenario"));
  els.sourcesTab.addEventListener("click", () => setDashboardTab("sources"));
  document.querySelector("#sourcesNavButton").addEventListener("click", () => setDashboardTab("sources", true));
  document.querySelector(".dashboard-tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const showSources = event.key === "ArrowRight" || event.key === "End";
    setDashboardTab(showSources ? "sources" : "scenario", true);
  });

  const gapDetail = {
    title: "De optionality gap",
    detail: "De rode bovenlijn is de relatieve groei van compute. De zwarte stippellijn is een samengestelde scenario-index van zeggenschap, ketenhefboom, servicehefboom en toezichtdekking. Het gearceerde vlak ertussen is de optionality gap: het deel van de technische ontwikkeling dat sneller groeit dan het Nederlandse vermogen om waar te nemen, te sturen en te handhaven. De +score is relatief en nadrukkelijk geen gemeten percentage.",
  };
  const methodDetail = {
    title: "Aannames, definities & onzekerheid",
    detail: "Alle vijf reeksen blijven zichtbaar zodat geen los cijfer de conclusie draagt. De bron-audit vond voor geen van de vijf exacte dashboardbanden een openbare nationale meetreeks. De tab Bronnen toont daarom per reeks het officiële anker of de beste proxy én het getal dat nog ontbreekt. Alle toekomstige waarden blijven expliciete scenario’s.",
  };
  document.querySelector("#gapPanel").addEventListener("click", () => openDialog(gapDetail, "samengestelde indicator"));
  document.querySelector("#methodButton").addEventListener("click", () => openDialog(methodDetail, "methodiek"));
  document.querySelector("#detailsButton").addEventListener("click", () => openDialog(methodDetail, "methodiek"));
  document.querySelector("#dialogClose").addEventListener("click", () => els.dialog.close());
  els.dialog.addEventListener("click", (event) => { if (event.target === els.dialog) els.dialog.close(); });
  document.querySelector("#yearPicker").addEventListener("click", () => {
    const chapters = visibleChapters();
    if (!selectedScenario && activeIndex >= 2) {
      els.choiceGate.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      return;
    }
    const next = (activeIndex + 1) % chapters.length;
    chapters[next].scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
  });

  function animate() {
    targetPosition = calculatePosition();
    visualPosition += (targetPosition - visualPosition) * (reducedMotion ? 1 : 0.08);
    if (Math.abs(targetPosition - visualPosition) < 0.0005) visualPosition = targetPosition;
    if (selectedScenario && scenarioReveal < 1) scenarioReveal = Math.min(1, scenarioReveal + 0.025);
    drawGap(visualPosition);
    metricCanvases.forEach((canvas, index) => drawMetric(canvas, metrics[index], visualPosition));
    updateReadouts(visualPosition);
    requestAnimationFrame(animate);
  }

  buildMetrics();
  window.addEventListener("resize", () => {
    drawGap(visualPosition);
    metricCanvases.forEach((canvas, index) => drawMetric(canvas, metrics[index], visualPosition));
  }, { passive: true });
  requestAnimationFrame(animate);
})();
