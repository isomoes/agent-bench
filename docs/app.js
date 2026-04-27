let allData = [];
let sortCol = "timestamp";
let sortAsc = false;
let scoreChart = null;
const activeChartModels = new Set();

async function load() {
  try {
    const res = await fetch("result.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allData = await res.json();
  } catch (e) {
    document.getElementById("tbody").innerHTML =
      `<tr><td colspan="9" class="empty">Could not load result.json: ${e.message}</td></tr>`;
    return;
  }
  populateFilters();
  render();
}

function populateFilters() {
  document
    .getElementById("filter-task-name")
    .addEventListener("input", render);
  document.getElementById("filter-model").addEventListener("input", render);
}

function filtered() {
  const taskName = document
    .getElementById("filter-task-name")
    .value.toLowerCase();
  const model = document.getElementById("filter-model").value.toLowerCase();

  return allData.filter(
    (d) =>
      (!taskName || d.task_id.toLowerCase().includes(taskName)) &&
      (!model || d.model_name.toLowerCase().includes(model)),
  );
}

function sorted(data) {
  return [...data].sort((a, b) => {
    let va = sortCol === "score" ? calcScore(a) : sortCol === "pass" ? (a.pass === false ? 0 : 1) : a[sortCol];
    let vb = sortCol === "score" ? calcScore(b) : sortCol === "pass" ? (b.pass === false ? 0 : 1) : b[sortCol];
    if (va == null) va = "";
    if (vb == null) vb = "";
    if (typeof va === "number") return sortAsc ? va - vb : vb - va;
    return sortAsc
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });
}

/**
 * V1 composite score:
 *   - Failed runs (pass === false) always score 0.
 *   - Passed runs are scored on speed × cost efficiency (geometric mean), 0–100.
 *       speed_factor = 1 / (1 + duration_secs / 60)   half-life at 60 s
 *       cost_factor  = 1 / (1 + tokens_used  / 20000) half-life at 20 k tokens
 *       score        = 100 × √(speed_factor × cost_factor)
 *   - If the entry already has a pre-computed `score` field (from result.json),
 *     that value is used directly; otherwise the formula is applied on the fly.
 */
function calcScore(d) {
  if (d.pass === false) return 0;
  // Use pre-computed score when present
  if (typeof d.score === "number") return d.score;
  // Fallback: compute from raw metrics
  const duration = d.duration_secs ?? 0;
  const tokens   = d.tokens_used   ?? 0;
  const speed = 1 / (1 + duration / 60);
  const cost  = 1 / (1 + tokens  / 20000);
  return Math.round(100 * Math.sqrt(speed * cost) * 10) / 10;
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
  // d.pass may be a boolean (V1) or absent (legacy entries treated as passed)
  const passed = d.pass !== false;
  const cls  = passed ? "pass-yes" : "pass-no";
  const label = passed ? "PASS" : "FAIL";
  return `<td class="pass-cell ${cls}">${label}</td>`;
}

function fmt(ts) {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

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
    if (scoreChart) {
      scoreChart.destroy();
      scoreChart = null;
    }
    return;
  }

  const visibleModels = models.filter((model) => activeChartModels.has(model));

  if (!visibleModels.length) {
    canvas.style.display = "none";
    empty.style.display = "block";
    empty.textContent = "Select one or more models above to show score lines.";
    if (scoreChart) {
      scoreChart.destroy();
      scoreChart = null;
    }
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
    data: {
      labels: tasks,
      datasets,
    },
    options: {
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      plugins: {
        legend: {
          labels: {
            color: "#c9d1d9",
            boxWidth: 12,
          },
        },
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

function render() {
  const data = sorted(filtered());

  renderScoreChart(data);

  const tbody = document.getElementById("tbody");
  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty">No results match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map(
      (d) => `
      <tr>
        <td class="task-id">${esc(d.task_id)}</td>
        <td class="model" title="${esc(d.model_name)}">${esc(d.model_name)}</td>
        ${passCell(d)}
        <td class="num">${d.iterations}</td>
        <td class="num duration">${d.duration_secs.toFixed(2)}</td>
        <td class="num tokens">${d.tokens_used != null ? d.tokens_used.toLocaleString() : "—"}</td>
        ${scoreCell(d)}
        <td class="model">${esc(d.agent_version)}</td>
        <td>${fmt(d.timestamp)}</td>
      </tr>`,
    )
    .join("");

  document.getElementById("footer").textContent =
    `Last updated: ${fmt(new Date().toISOString())} · ${data.length} run(s) shown`;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

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

load();
