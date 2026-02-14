const SHEET_ID = "1TXQ_ogbnmRUAKCXSVn2WplBbJmS_uMj9VCMYltkC3d4";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

const COLOR_STYLES = {
  Blue: "#3b82f6",
  Green: "#22c55e",
  Grey: "#9ca3af",
  Black: "#111827",
  Yellow: "#facc15",
  Red: "#ef4444",
  Pink: "#f472b6",
  Purple: "#a855f7",
  White: "#f9fafb",
};

const statusEl = document.getElementById("status");
const colorValueEl = document.getElementById("colorValue");
const confidenceEl = document.getElementById("confidenceValue");
const noteEl = document.getElementById("note");
const swatchEl = document.getElementById("colorSwatch");
const statsGridEl = document.getElementById("statsGrid");
const statsNoteEl = document.getElementById("statsNote");
const prevSwatchEl = document.getElementById("prevSwatch");
const prevColorEl = document.getElementById("prevColor");
const prevDateEl = document.getElementById("prevDate");
const historyBodyEl = document.getElementById("historyBody");

const REFRESH_INTERVAL_MS = 1000;
let inFlight = false;
let lastRenderHash = "";

function getChicagoDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  });
  const parts = formatter.formatToParts(date);
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
    weekday: lookup.weekday,
    iso: `${lookup.year}-${lookup.month}-${lookup.day}`,
  };
}

function getChicagoWeekday(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "long",
  }).format(date);
}

function getNextStreamDate() {
  const now = new Date();
  let candidate = new Date(now);
  while (getChicagoWeekday(candidate) === "Saturday") {
    candidate = new Date(candidate.getTime() + 86400000);
  }
  return candidate;
}

function formatChicagoDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
}

function parseDateFromSheet(value) {
  if (!value) return null;
  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

function parseCSV(text) {
  const rows = [];
  let current = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(current);
      if (row.length > 1 || row[0] !== "") {
        rows.push(row);
      }
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current.length || row.length) {
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

function detectOffDay(row, colorKeys) {
  const dateCell = normalizeValue(row.Date);
  if (dateCell.includes("off") || dateCell.includes("weekend")) return true;
  return colorKeys.every((key) => normalizeValue(row[key]) === "");
}

function detectWornColor(row, colorKeys) {
  for (const key of colorKeys) {
    const value = normalizeValue(row[key]);
    if (!value) continue;
    if (value === "dark red 1" || value === "no" || value === "not worn") {
      continue;
    }
    if (value === "worn" || value === "yes" || value === "true" || value === "green" || value === "1") {
      return key;
    }
    return key;
  }
  return null;
}

function scoreRecency(entries, colorKeys) {
  const scores = Object.fromEntries(colorKeys.map((key) => [key, 0]));
  if (!entries.length) return scores;

  const latestDate = entries[entries.length - 1].date;
  const halfLifeDays = 21;
  const decay = Math.log(2) / halfLifeDays;

  entries.forEach((entry) => {
    const diffDays = Math.max(0, (latestDate - entry.date) / 86400000);
    const weight = Math.exp(-decay * diffDays);
    scores[entry.color] += weight;
  });

  return scores;
}

function scoreOverall(entries, colorKeys) {
  const scores = Object.fromEntries(colorKeys.map((key) => [key, 0]));
  entries.forEach((entry) => {
    scores[entry.color] += 1;
  });
  return scores;
}

function scoreTransitions(entries, colorKeys, order = 1) {
  const scores = Object.fromEntries(colorKeys.map((key) => [key, 0]));
  if (entries.length < order + 1) return scores;

  const transitionCounts = {};
  for (let i = order; i < entries.length; i += 1) {
    const prevKey = entries.slice(i - order, i).map((e) => e.color).join("|");
    const next = entries[i].color;
    if (!transitionCounts[prevKey]) transitionCounts[prevKey] = {};
    transitionCounts[prevKey][next] = (transitionCounts[prevKey][next] || 0) + 1;
  }

  const lastKey = entries.slice(entries.length - order).map((e) => e.color).join("|");
  const fromLast = transitionCounts[lastKey] || {};
  colorKeys.forEach((key) => {
    scores[key] = fromLast[key] || 0;
  });

  return scores;
}

function normalize(scores) {
  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);
  if (!total) return scores;
  const normalized = {};
  Object.entries(scores).forEach(([key, value]) => {
    normalized[key] = value / total;
  });
  return normalized;
}

function blendScores(weightedScores) {
  const blended = {};
  weightedScores.forEach(({ scores, weight }) => {
    const normalized = normalize(scores);
    Object.entries(normalized).forEach(([key, value]) => {
      blended[key] = (blended[key] || 0) + value * weight;
    });
  });
  return blended;
}

function pickPrediction(scores) {
  let top = null;
  let topScore = -Infinity;
  let total = 0;

  for (const [color, score] of Object.entries(scores)) {
    total += score;
    if (score > topScore) {
      topScore = score;
      top = color;
    }
  }

  const confidence = total > 0 ? Math.round((topScore / total) * 100) : 0;
  return { color: top, confidence, total };
}

function setSwatch(colorName) {
  const hex = COLOR_STYLES[colorName] || "#e5e7eb";
  swatchEl.style.background = `linear-gradient(140deg, ${hex}, rgba(255,255,255,0.05))`;
  swatchEl.style.boxShadow = `0 0 30px ${hex}55`;
}

function updateStats(entries, colorKeys) {
  const counts = Object.fromEntries(colorKeys.map((key) => [key, 0]));
  entries.forEach((entry) => {
    if (counts[entry.color] !== undefined) {
      counts[entry.color] += 1;
    }
  });

  const total = entries.length;
  statsGridEl.innerHTML = "";

  colorKeys.forEach((key) => {
    const count = counts[key];
    const percent = total ? Math.round((count / total) * 100) : 0;
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="stat-label">${key}</div>
      <div class="stat-value">${count}</div>
      <div class="stat-share">${percent}% share</div>
    `;
    statsGridEl.appendChild(card);
  });

  statsNoteEl.textContent = total
    ? `Based on ${total} worn entries.`
    : "No worn entries yet. Add WORN markers to populate stats.";
}

function pickFallbackColor(colorKeys, date) {
  if (!colorKeys.length) return null;
  const seed =
    date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
  const index = seed % colorKeys.length;
  return colorKeys[index];
}

function renderPrevious(entry) {
  if (!entry) {
    prevColorEl.textContent = "—";
    prevDateEl.textContent = "—";
    prevSwatchEl.style.background = "";
    return;
  }

  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(entry.date);

  prevColorEl.textContent = entry.color;
  prevDateEl.textContent = formatted;
  const hex = COLOR_STYLES[entry.color] || "#e5e7eb";
  prevSwatchEl.style.background = `linear-gradient(140deg, ${hex}, rgba(255,255,255,0.05))`;
}

function renderHistoryTable(entries) {
  historyBodyEl.innerHTML = "";
  if (!entries.length) {
    historyBodyEl.innerHTML = "<tr><td>—</td><td>—</td></tr>";
    return;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });

  const recent = entries.slice(-30).reverse();
  recent.forEach((entry) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${formatter.format(entry.date)}</td>
      <td>${entry.color}</td>
    `;
    historyBodyEl.appendChild(row);
  });
}

async function loadPrediction(forceRefresh = false) {
  if (inFlight) return;
  inFlight = true;
  if (forceRefresh) {
    statusEl.textContent = "Syncing sheet…";
  }

  const chicago = getChicagoDateParts();
  const nextStreamDate = getNextStreamDate();
  const nextStreamLabel = formatChicagoDate(nextStreamDate);
  statusEl.textContent = `Next stream: ${nextStreamLabel}`;
  const weekendMode = chicago.weekday === "Saturday";
  if (weekendMode) {
    noteEl.textContent = "Case's Weekend begins now, come back tomorrow for color";
    colorValueEl.textContent = "—";
    confidenceEl.textContent = "";
    swatchEl.style.background = "";
  } else {
    noteEl.textContent = "";
  }

  try {
    const response = await fetch(CSV_URL, { cache: forceRefresh ? "no-store" : "default" });
    if (!response.ok) throw new Error("Sheet fetch failed");

    const text = await response.text();
    const rows = parseCSV(text);

    if (rows.length < 2) {
      throw new Error("No data rows found");
    }

    const headers = rows[0].map((h) => h.trim());
    const colorKeys = headers.slice(1);

    const dataRows = rows.slice(1).map((cells) => {
      const row = {};
      headers.forEach((key, idx) => {
        row[key] = cells[idx] ?? "";
      });
      return row;
    });

    const entries = [];
    let offDays = 0;

    dataRows.forEach((row) => {
      const date = parseDateFromSheet(row.Date);
      if (!date) return;

      if (detectOffDay(row, colorKeys)) {
        offDays += 1;
        return;
      }

      const worn = detectWornColor(row, colorKeys);
      if (!worn) return;

      entries.push({ date, color: worn });
    });

    entries.sort((a, b) => a.date - b.date);

    if (!entries.length) {
      const fallback = pickFallbackColor(colorKeys, nextStreamDate);
      const displayColor = weekendMode ? "—" : fallback || "No pick";
      const displayConfidence = weekendMode ? "" : fallback ? "Confidence: Low (no worn entries yet)" : "";
      const renderState = {
        status: statusEl.textContent,
        note: noteEl.textContent ||
          "No worn color entries detected yet. Add WORN markers to the sheet for real predictions.",
        color: displayColor,
        confidence: displayConfidence,
        counts: entries.length,
      };

      const hash = JSON.stringify(renderState);
      if (hash !== lastRenderHash) {
        colorValueEl.textContent = renderState.color;
        confidenceEl.textContent = renderState.confidence;
        if (!weekendMode) {
          setSwatch(fallback);
        }
        if (!noteEl.textContent) {
          noteEl.textContent = renderState.note;
        }
        updateStats(entries, colorKeys);
        renderPrevious(entries[entries.length - 1]);
        renderHistoryTable(entries);
        lastRenderHash = hash;
      }
      return;
    }

    const recencyScores = scoreRecency(entries, colorKeys);
    const overallScores = scoreOverall(entries, colorKeys);
    const transition1 = scoreTransitions(entries, colorKeys, 1);
    const transition2 = scoreTransitions(entries, colorKeys, 2);
    const scores = blendScores([
      { scores: transition2, weight: 0.35 },
      { scores: transition1, weight: 0.2 },
      { scores: recencyScores, weight: 0.3 },
      { scores: overallScores, weight: 0.15 },
    ]);
    const prediction = pickPrediction(scores);

    const lastEntry = entries[entries.length - 1];
    const lastDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "short",
      day: "2-digit",
      year: "numeric",
    }).format(lastEntry.date);

    const renderState = {
      status: "Prediction ready",
      note: "",
      color: prediction.color || "No pick",
      confidence: prediction.color ? `Confidence: ${prediction.confidence}%` : "",
      lastDate: lastEntry.date.toISOString(),
      lastColor: lastEntry.color,
    };

    const noteText = `Last seen on ${lastDate}: ${lastEntry.color}. Prediction updates as your sheet grows.`;
    const hash = JSON.stringify({ ...renderState, note: noteText });
    if (hash !== lastRenderHash) {
      statusEl.textContent = renderState.status;
      colorValueEl.textContent = weekendMode ? "—" : renderState.color;
      confidenceEl.textContent = weekendMode ? "" : renderState.confidence;
      if (!weekendMode) {
        setSwatch(prediction.color);
      }
      noteEl.textContent = noteText;
      updateStats(entries, colorKeys);
      renderPrevious(lastEntry);
      renderHistoryTable(entries);
      lastRenderHash = hash;
    }
  } catch (err) {
    statusEl.textContent = "Data unavailable";
    noteEl.textContent = "Could not load the Google Sheet. Confirm it is public and uses text markers.";
    statsGridEl.innerHTML = "";
    statsNoteEl.textContent = "Stats unavailable.";
    renderPrevious(null);
    renderHistoryTable([]);
  } finally {
    inFlight = false;
  }
}

function startAutoRefresh() {
  loadPrediction();
  setInterval(() => {
    loadPrediction(true);
  }, REFRESH_INTERVAL_MS);
}

startAutoRefresh();
