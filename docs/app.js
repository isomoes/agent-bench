let allData = [];
let sortCol = "timestamp";
let sortAsc = false;
let scoreChart = null;
let currentVersion = "v1"; // "v0" | "v1"
const activeChartModels = new Set();

// ---------- version switching ----------

function setVersion(v) {
  currentVersion = v;
  document.querySelectorAll(".ver-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.ver === v);
  });
  // Show/hide V1-only columns (pass, judge_score, judge_model)
  const v1Cols = document.querySelectorAll(".col-v1");
  v1Cols.forEach((el) => (el.style.display = v === "v1" ? "" : "none"));
  // Show correct scoring panel
  document.getElementById("scoring-v0").style.display = v === "v0" ? "" : "none";
  document.getElementById("scoring-v1").style.display = v === "v1" ? "" : "none";
  // colspan adjustment
  const emptyColspan = v === "v1" ? 11 : 8;
  document.querySelectorAll(".empty-colspan").forEach((el) => {
    el.setAttribute("colspan", emptyColspan);
  });
  loadVersion(v);
}

async function loadVersion(v) {
  const file = v === "v1" ? "result-v1.json" : "result.json";
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allData = await res.json();
  } catch (e) {
    document.getElementById("tbody").innerHTML =
      `<tr><td colspan="10" class="empty empty-colspan">Could not load ${file}: ${e.message}</td></tr>`;
    return;
  }
  render();
}

// ---------- filters ----------

function populateFilters() {
  document.getElementById("filter-task-name").addEventListener("input", render);
  document.getElementById("filter-model").addEventListener("input", render);
}

function filtered() {
  const taskName = document.getElementById("filter-task-name").value.toLowerCase();
  const model = document.getElementById("filter-model").value.toLowerCase();
  return allData.filter(
    (d) =>
      (!taskName || d.task_id.toLowerCase().includes(taskName)) &&
      (!model || d.model_name.toLowerCase().includes(model)),
  );
}

// ---------- sorting ----------

function sorted(data) {
  return [...data].sort((a, b) => {
    let va =
      sortCol === "score"
        ? calcScore(a)
        : sortCol === "pass"
        ? (a.pass === false ? 0 : 1)
        : a[sortCol];
    let vb =
      sortCol === "score"
        ? calcScore(b)
        : sortCol === "pass"
        ? (b.pass === false ? 0 : 1)
        : b[sortCol];
    if (va == null) va = "";
    if (vb == null) vb = "";
    if (typeof va === "number") return sortAsc ? va - vb : vb - va;
    return sortAsc
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });
}

// ---------- scoring ----------

/**
 * V0: penalty-based score (legacy result.json).
 *   score = clamp(0, 100 − iterations×5 − duration×0.5 − tokens×0.0001, 100)
 *
 * V1: weighted average of three domains (0–100 each):
 *   quality = raw judge_score from result-v1.json
 *   speed   = 100 / (1 + duration_secs / 60)     half-life 60 s
 *   cost    = 100 / (1 + tokens_used  / 20000)   half-life 20k tokens
 *   score   = quality×0.6 + speed×0.2 + cost×0.2
 *
 * result-v1.json intentionally stores only raw judge_score; this function computes
 * the frontend display score.
 */
function calcScore(d) {
  if (currentVersion === "v0") {
    if (typeof d.score === "number") return d.score;
    const iterPenalty = (d.iterations ?? 0) * 5;
    const durPenalty  = (d.duration_secs ?? 0) * 0.5;
    const tokPenalty  = (d.tokens_used ?? 0) * 0.0001;
    return Math.max(0, Math.min(100, 100 - iterPenalty - durPenalty - tokPenalty));
  }
  if (d.pass === false) return 0;
  const quality  = d.judge_score ?? d.score ?? 0; // d.score fallback supports older V1 files
  if (quality === 0) return 0;
  const duration = d.duration_secs ?? 0;
  const tokens   = d.tokens_used   ?? 0;
  const speed = 100 / (1 + duration / 60);
  const cost  = 100 / (1 + tokens  / 20000);
  return Math.round((quality * 0.6 + speed * 0.2 + cost * 0.2) * 10) / 10;
}

function scoreClass(score) {
  if (score >= 70) return "score-high";
  if (score >= 40) return "score-mid";
  return "score-low";
}

function scoreCell(d) {
  const score = calcScore(d);
  const cls = scoreClass(score);
  const barW = Math.max(2, Math.round(score * 0.6));
  return `<td class="score ${cls}"><span class="score-bar"><span class="bar" style="width:${barW}px"></span>${score.toFixed(1)}</span></td>`;
}

function passCell(d) {
  const passed = d.pass !== false;
  const cls   = passed ? "pass-yes" : "pass-no";
  const label = passed ? "PASS" : "FAIL";
  return `<td class="pass-cell ${cls} col-v1">${label}</td>`;
}

function judgeCell(d) {
  const val = d.judge_model ?? "—";
  return `<td class="model col-v1" title="${esc(val)}">${esc(val)}</td>`;
}

function judgeScoreCell(d) {
  const val = d.judge_score ?? d.score ?? null;
  return `<td class="num col-v1">${val != null ? Number(val).toFixed(1) : "—"}</td>`;
}

// ---------- utils ----------

function fmt(ts) {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- chart ----------

function pickLatestPerTaskModel(data) {
  const map = new Map();
  for (const row of data) {
    const key = `${row.task_id}:::${row.model_name}`;
    const prev = map.get(key);
    if (!prev || new Date(row.timestamp) > new Date(prev.timestamp)) {
      map.set(key, row);
    }
  }
  return [...map.values()];
}

function modelColor(idx, total) {
  const hue = Math.round((idx * 360) / Math.max(total, 1));
  return `hsl(${hue} 80% 62%)`;
}

function renderChartModelControls(models) {
  const controls = document.getElementById("chart-model-controls");
  const modelSet = new Set(models);
  for (const model of [...activeChartModels]) {
    if (!modelSet.has(model)) activeChartModels.delete(model);
  }
  if (!models.length) {
    controls.innerHTML = `<span class="chart-controls-empty">No models available for the current filters.</span>`;
    return;
  }
  controls.innerHTML = models
    .map(
      (model) =>
        `<button class="model-toggle${activeChartModels.has(model) ? " active" : ""}" type="button" data-model="${esc(model)}" title="${esc(model)}">${esc(model)}</button>`,
    )
    .join("");
}

function renderScoreChart(data) {
  const canvas = document.getElementById("score-chart");
  const empty = document.getElementById("score-chart-empty");

  if (typeof Chart === "undefined") {
    canvas.style.display = "none";
    empty.style.display = "block";
    empty.textContent = "Chart.js failed to load, so the chart is unavailable.";
    return;
  }

  const latestRows = pickLatestPerTaskModel(data);
  const tasks = [...new Set(latestRows.map((d) => d.task_id))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const models = [...new Set(latestRows.map((d) => d.model_name))].sort();
  renderChartModelControls(models);

  if (!tasks.length || !models.length) {
    canvas.style.display = "none";
    empty.style.display = "block";
    empty.textContent = "No chart data for the current filters.";
    if (scoreChart) { scoreChart.destroy(); scoreChart = null; }
    return;
  }

  const visibleModels = models.filter((model) => activeChartModels.has(model));
  if (!visibleModels.length) {
    canvas.style.display = "none";
    empty.style.display = "block";
    empty.textContent = "Select one or more models above to show score lines.";
    if (scoreChart) { scoreChart.destroy(); scoreChart = null; }
    return;
  }

  const points = new Map(
    latestRows.map((d) => [`${d.task_id}:::${d.model_name}`, calcScore(d)]),
  );

  const datasets = visibleModels.map((model, idx) => {
    const color = modelColor(idx, visibleModels.length);
    return {
      label: model,
      data: tasks.map((taskId) => {
        const key = `${taskId}:::${model}`;
        return points.has(key) ? points.get(key) : null;
      }),
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 5,
      spanGaps: true,
      tension: 0.2,
    };
  });

  canvas.style.display = "block";
  empty.style.display = "none";
  if (scoreChart) scoreChart.destroy();
  scoreChart = new Chart(canvas, {
    type: "line",
    data: { labels: tasks, datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: "#c9d1d9", boxWidth: 12 } },
      },
      scales: {
        x: {
          ticks: { color: "#8b949e", maxRotation: 35, minRotation: 0 },
          grid: { color: "#21262d" },
          title: { display: true, text: "Tasks", color: "#8b949e" },
        },
        y: {
          min: 0,
          max: 100,
          ticks: { color: "#8b949e" },
          grid: { color: "#21262d" },
          title: { display: true, text: "Score", color: "#8b949e" },
        },
      },
    },
  });
}

// ---------- render ----------

function render() {
  const data = sorted(filtered());
  renderScoreChart(data);

  const tbody = document.getElementById("tbody");
  if (data.length === 0) {
    const cols = currentVersion === "v1" ? 11 : 8;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty">No results match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map((d) => {
      const v1cols = currentVersion === "v1"
        ? `${passCell(d)}${judgeScoreCell(d)}${judgeCell(d)}`
        : "";
      return `
      <tr>
        <td class="task-id">${esc(d.task_id)}</td>
        <td class="model" title="${esc(d.model_name)}">${esc(d.model_name)}</td>
        ${v1cols}
        <td class="num">${d.iterations ?? "—"}</td>
        <td class="num duration">${d.duration_secs != null ? d.duration_secs.toFixed(2) : "—"}</td>
        <td class="num tokens">${d.tokens_used != null ? d.tokens_used.toLocaleString() : "—"}</td>
        ${scoreCell(d)}
        <td class="model">${esc(d.agent_version)}</td>
        <td>${fmt(d.timestamp)}</td>
      </tr>`;
    })
    .join("");

  document.getElementById("footer").textContent =
    `Last updated: ${fmt(new Date().toISOString())} · ${data.length} run(s) shown`;
}

// ---------- event wiring ----------

document.querySelectorAll("th[data-col]").forEach((th) => {
  th.addEventListener("click", () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = col !== "timestamp";
    }
    document.querySelectorAll("th").forEach((h) => h.classList.remove("sorted"));
    th.classList.add("sorted");
    th.querySelector(".sort-icon").textContent = sortAsc ? "↑" : "↓";
    render();
  });
});

document.getElementById("chart-model-controls").addEventListener("click", (event) => {
  const button = event.target.closest(".model-toggle");
  if (!button) return;
  const model = button.dataset.model;
  if (activeChartModels.has(model)) {
    activeChartModels.delete(model);
  } else {
    activeChartModels.add(model);
  }
  render();
});

document.getElementById("version-toggle").addEventListener("click", (event) => {
  const btn = event.target.closest(".ver-btn");
  if (!btn || btn.dataset.ver === currentVersion) return;
  activeChartModels.clear();
  sortCol = "timestamp";
  sortAsc = false;
  document.querySelectorAll("th").forEach((h) => {
    h.classList.remove("sorted");
    const icon = h.querySelector(".sort-icon");
    if (icon) icon.textContent = "↕";
  });
  setVersion(btn.dataset.ver);
});

// ---------- init ----------

function init() {
  populateFilters();
  setVersion(currentVersion);
}

init();
