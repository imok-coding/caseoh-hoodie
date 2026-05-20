const SHEET_ID = "1TXQ_ogbnmRUAKCXSVn2WplBbJmS_uMj9VCMYltkC3d4";
const HOODIE_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
const GAMES_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Games`;
const ROBLOX_LOGO_SRC = "Roblox_(2025)_(App_Icon).svg.png";

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
const offDayCountEl = document.getElementById("offDayCount");
const tabEls = document.querySelectorAll(".tab");
const panelEls = document.querySelectorAll(".tab-panel");
const gamesStatusEl = document.getElementById("gamesStatus");
const gamesCountEl = document.getElementById("gamesCount");
const gamesBodyEl = document.getElementById("gamesBody");
const streamCountEl = document.getElementById("streamCount");
const topColorEl = document.getElementById("topColor");
const topColorShareEl = document.getElementById("topColorShare");
const offDayRateEl = document.getElementById("offDayRate");
const trackedDayCountEl = document.getElementById("trackedDayCount");
const insightTopColorEl = document.getElementById("insightTopColor");
const insightLastStreamEl = document.getElementById("insightLastStream");
const gamesLoggedCountEl = document.getElementById("gamesLoggedCount");
const latestGameEl = document.getElementById("latestGame");
const uniqueGameSummaryEl = document.getElementById("uniqueGameSummary");

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const FOCUS_REFRESH_COOLDOWN_MS = 60 * 1000;
let inFlight = false;
let gamesInFlight = false;
let lastRenderHash = "";
let lastGamesRenderHash = "";
let lastGamesCSV = "";
let lastRefreshAt = 0;

tabEls.forEach((tab) => {
  tab.addEventListener("click", () => {
    const target = tab.dataset.tab;
    tabEls.forEach((item) => {
      item.classList.toggle("active", item === tab);
    });
    panelEls.forEach((panel) => {
      panel.classList.toggle("active", panel.id === `${target}Panel`);
    });
  });
});

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
  // Treat sheet dates as date-only (not time-zone specific).
  // Use UTC noon to avoid any timezone offset shifting the calendar day.
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
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
  return colorKeys.some((key) => {
    const value = normalizeValue(row[key]);
    return value === "off" || value === "weekend";
  });
}

function hasExplicitOffMarker(row) {
  return Object.values(row).some((value) => {
    const normalized = normalizeValue(value);
    return normalized === "off" || normalized === "weekend";
  });
}

function isOffRow(row) {
  return normalizeValue(row.Date) === "off" || hasExplicitOffMarker(row);
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

function getColorCounts(entries, colorKeys) {
  const counts = Object.fromEntries(colorKeys.map((key) => [key, 0]));
  entries.forEach((entry) => {
    if (counts[entry.color] !== undefined) {
      counts[entry.color] += 1;
    }
  });
  return counts;
}

function getTopColor(counts) {
  return Object.entries(counts).reduce(
    (best, [color, count]) => count > best.count ? { color, count } : best,
    { color: null, count: 0 },
  );
}

function updateOverview(entries, colorKeys, offDays) {
  const total = entries.length;
  const trackedDays = total + offDays;
  const counts = getColorCounts(entries, colorKeys);
  const top = getTopColor(counts);
  const topPercent = total && top.count ? Math.round((top.count / total) * 100) : 0;
  const offPercent = trackedDays ? Math.round((offDays / trackedDays) * 100) : 0;
  const lastEntry = entries[entries.length - 1];

  streamCountEl.textContent = total;
  trackedDayCountEl.textContent = trackedDays;
  topColorEl.textContent = top.color || "—";
  topColorShareEl.textContent = top.color ? `${top.count} streams, ${topPercent}% share` : "Waiting on hoodie data";
  offDayCountEl.textContent = offDays;
  offDayRateEl.textContent = trackedDays ? `${offPercent}% of tracked days` : "Tracked from Hoodie";
  insightTopColorEl.textContent = top.color ? `${top.color} (${top.count})` : "—";
  insightLastStreamEl.textContent = lastEntry ? `${lastEntry.color} on ${formatSheetDate(lastEntry.date)}` : "—";
}

function updateStats(entries, colorKeys, offDays = 0) {
  const counts = getColorCounts(entries, colorKeys);
  const total = entries.length;
  statsGridEl.innerHTML = colorKeys.map((key) => {
    const count = counts[key];
    const percent = total ? Math.round((count / total) * 100) : 0;
    return `
      <div class="stat-card">
      <div class="stat-label">${key}</div>
      <div class="stat-value">${count}</div>
      <div class="stat-share">${percent}% share</div>
      </div>
    `;
  }).join("");

  const offDayText = `${offDays} off ${offDays === 1 ? "day" : "days"}`;
  statsNoteEl.textContent = total
    ? `Based on ${total} worn entries and ${offDayText}.`
    : `No worn entries yet. ${offDayText} tracked. Add WORN markers to populate stats.`;
}

function formatSheetDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  }).format(date);
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
    timeZone: "UTC",
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
  if (!entries.length) {
    historyBodyEl.innerHTML = "<tr><td>—</td><td>—</td></tr>";
    return;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "2-digit",
    year: "numeric",
  });

  const recent = entries.slice(-30).reverse();
  historyBodyEl.innerHTML = recent.map((entry) => `
    <tr>
      <td>${formatter.format(entry.date)}</td>
      <td>${escapeHTML(entry.color)}</td>
    </tr>
  `).join("");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rowValue(row, ...keys) {
  const entries = Object.entries(row);
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
    const normalizedKey = key.toLowerCase();
    const match = entries.find(([entryKey]) => entryKey.toLowerCase() === normalizedKey);
    if (match) return match[1];
  }
  return "";
}

function normalizeGameTitle(title) {
  return String(title ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function countUniqueGames(games) {
  const titles = new Set();
  games.forEach((game) => {
    const title = normalizeGameTitle(displayGameTitle(game.name));
    if (title) {
      titles.add(title);
    }
  });
  return titles.size;
}

function displayGameTitle(name) {
  const trimmed = String(name ?? "").trim();
  const match = trimmed.match(/^roblox\s*:\s*(.*)$/i);
  return match ? match[1].trim() || "Roblox" : trimmed;
}

function renderGameName(name) {
  const trimmed = String(name ?? "").trim();
  const match = trimmed.match(/^roblox\s*:\s*(.*)$/i);
  if (!match) return escapeHTML(trimmed || "—");

  const robloxTitle = match[1].trim();
  return `
    <span class="game-title">
      <img class="game-logo" src="${ROBLOX_LOGO_SRC}" alt="Roblox" />
      <span>${escapeHTML(robloxTitle || "Roblox")}</span>
    </span>
  `;
}

function renderGamesTable(games) {
  if (!games.length) {
    gamesBodyEl.innerHTML = "<tr><td>—</td><td>No games logged yet.</td><td>—</td><td>—</td></tr>";
    return;
  }

  gamesBodyEl.innerHTML = games.map((game) => {
    const videoCell = game.link
      ? `<a href="${escapeHTML(game.link)}" target="_blank" rel="noopener noreferrer">Open</a>`
      : "—";
    return `
      <tr>
      <td>${escapeHTML(game.date || "—")}</td>
      <td>${renderGameName(game.name)}</td>
      <td>${escapeHTML(game.channel || "—")}</td>
      <td>${videoCell}</td>
      </tr>
    `;
  }).join("");
}

async function loadGames(forceRefresh = false) {
  if (gamesInFlight) return;
  gamesInFlight = true;

  try {
    const response = await fetch(GAMES_CSV_URL, { cache: forceRefresh ? "no-store" : "default" });
    if (!response.ok) throw new Error("Games fetch failed");

    const text = await response.text();
    if (forceRefresh && text === lastGamesCSV) {
      gamesStatusEl.textContent = "Games ready";
      return;
    }
    lastGamesCSV = text;

    const rows = parseCSV(text);
    if (!rows.length) throw new Error("No games rows found");

    const headers = rows[0].map((h) => h.trim());
    const games = rows.slice(1)
      .map((cells) => {
        const row = {};
        headers.forEach((key, idx) => {
          row[key] = cells[idx] ?? "";
        });
        return {
          date: rowValue(row, "Date"),
          name: rowValue(row, "Game Name", "Game"),
          link: rowValue(row, "YouTube Link", "Youtube Link", "Link"),
          channel: rowValue(row, "Channel"),
        };
      })
      .filter((game) => game.date || game.name || game.link || game.channel);

    const hash = JSON.stringify(games);
    if (hash !== lastGamesRenderHash) {
      const uniqueCount = countUniqueGames(games);
      const latestGame = games[games.length - 1];
      gamesStatusEl.textContent = "Games ready";
      gamesCountEl.textContent = uniqueCount;
      gamesLoggedCountEl.textContent = games.length;
      latestGameEl.textContent = latestGame ? displayGameTitle(latestGame.name) || "—" : "—";
      uniqueGameSummaryEl.textContent = uniqueCount ? `${uniqueCount} unique titles` : "No games logged";
      renderGamesTable(games);
      lastGamesRenderHash = hash;
    }
  } catch (err) {
    gamesStatusEl.textContent = "Games unavailable";
    gamesCountEl.textContent = "—";
    gamesLoggedCountEl.textContent = "—";
    latestGameEl.textContent = "—";
    uniqueGameSummaryEl.textContent = "—";
    renderGamesTable([]);
  } finally {
    gamesInFlight = false;
  }
}

async function loadPrediction(forceRefresh = false) {
  if (inFlight) return;
  inFlight = true;

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
    const response = await fetch(HOODIE_CSV_URL, { cache: forceRefresh ? "no-store" : "default" });
    if (!response.ok) throw new Error("Sheet fetch failed");

    const text = await response.text();
    const rows = parseCSV(text);

    if (rows.length < 2) {
      throw new Error("No data rows found");
    }

    const headers = rows[0].map((h) => h.trim());
    const colorKeys = headers.slice(1).filter((key) => key);

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
      if (isOffRow(row)) {
        offDays += 1;
        return;
      }

      const date = parseDateFromSheet(row.Date);
      if (!date) return;

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
        offDays,
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
        updateStats(entries, colorKeys, offDays);
        updateOverview(entries, colorKeys, offDays);
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
    const lastDate = formatSheetDate(lastEntry.date);

    const renderState = {
      status: "Prediction ready",
      note: "",
      color: prediction.color || "No pick",
      confidence: prediction.color ? `Confidence: ${prediction.confidence}%` : "",
      lastDate: lastEntry.date.toISOString(),
      lastColor: lastEntry.color,
      offDays,
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
      updateStats(entries, colorKeys, offDays);
      updateOverview(entries, colorKeys, offDays);
      renderPrevious(lastEntry);
      renderHistoryTable(entries);
      lastRenderHash = hash;
    }
  } catch (err) {
    statusEl.textContent = "Data unavailable";
    noteEl.textContent = "Could not load the Google Sheet. Confirm it is public and uses text markers.";
    statsGridEl.innerHTML = "";
    statsNoteEl.textContent = "Stats unavailable.";
    offDayCountEl.textContent = "—";
    streamCountEl.textContent = "—";
    topColorEl.textContent = "—";
    topColorShareEl.textContent = "Waiting on data";
    offDayRateEl.textContent = "Tracked from Hoodie";
    trackedDayCountEl.textContent = "—";
    insightTopColorEl.textContent = "—";
    insightLastStreamEl.textContent = "—";
    renderPrevious(null);
    renderHistoryTable([]);
  } finally {
    inFlight = false;
  }
}

function refreshAll(forceRefresh = false) {
  lastRefreshAt = Date.now();
  loadPrediction(forceRefresh);
  loadGames(forceRefresh);
}

function refreshIfStale() {
  if (Date.now() - lastRefreshAt >= FOCUS_REFRESH_COOLDOWN_MS) {
    refreshAll(true);
  }
}

function startAutoRefresh() {
  refreshAll();
  setInterval(() => {
    refreshAll(true);
  }, REFRESH_INTERVAL_MS);

  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        refreshIfStale();
      }
    });
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("focus", refreshIfStale);
  }
}

startAutoRefresh();
