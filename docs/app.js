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
      `<tr><td colspan="8" class="empty">Could not load result.json: ${e.message}</td></tr>`;
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
    let va = sortCol === "score" ? calcScore(a) : a[sortCol];
    let vb = sortCol === "score" ? calcScore(b) : b[sortCol];
    if (va == null) va = "";
    if (vb == null) vb = "";
    if (typeof va === "number") return sortAsc ? va - vb : vb - va;
    return sortAsc
      ? String(va).localeCompare(String(vb))
      : String(vb).localeCompare(String(va));
  });
}

/**
 * Penalty-based score: starts at 100, deducts for iterations, duration, tokens.
 *   - iterations:  5 pts each
 *   - duration:    0.5 pts per second
 *   - tokens:      0.0001 pts per token
 * Clamped to [0, 100].
 */
function calcScore(d) {
  const iterPenalty = (d.iterations ?? 0) * 5;
  const durPenalty = (d.duration_secs ?? 0) * 0.5;
  const tokPenalty = (d.tokens_used ?? 0) * 0.0001;
  return Math.max(0, Math.min(100, 100 - iterPenalty - durPenalty - tokPenalty));
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
    tbody.innerHTML = `<tr><td colspan="8" class="empty">No results match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map(
      (d) => `
      <tr>
        <td class="task-id">${esc(d.task_id)}</td>
        <td class="model" title="${esc(d.model_name)}">${esc(d.model_name)}</td>
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
