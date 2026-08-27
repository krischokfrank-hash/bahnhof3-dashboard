import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const APARTMENTS = ["apt1", "apt2", "apt3", "apt4"];
const DEFAULT_APARTMENT_META = {
  apt1: { address: "Bahnhofstr. 3", floor: "EG", position: "links", label: "Bahnhofstr. 3 - EG links" },
  apt2: { address: "Bahnhofstr. 3", floor: "EG", position: "rechts", label: "Bahnhofstr. 3 - EG rechts" },
  apt3: { address: "Bahnhofstr. 3", floor: "1. OG", position: "links", label: "Bahnhofstr. 3 - 1. OG links" },
  apt4: { address: "Bahnhofstr. 3", floor: "1. OG", position: "rechts", label: "Bahnhofstr. 3 - 1. OG rechts" },
};
const RPC_TIMEOUT_MS = 60000;
const RPC_ROW_LIMIT = 500;
const YEAR_RPC_TIMEOUT_MS = 90000;
const YEAR_CHUNK_LIMIT = 2000;
const YEAR_CHUNK_DAYS = 10;


const elements = {
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  loginBtn: document.getElementById("loginBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  userInfo: document.getElementById("userInfo"),
  apartmentSelect: document.getElementById("apartmentSelect"),
  yearSelect: document.getElementById("yearSelect"),
  loadYearBtn: document.getElementById("loadYearBtn"),
  yearStatus: document.getElementById("yearStatus"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  loadBtn: document.getElementById("loadBtn"),
  statusText: document.getElementById("statusText"),
  yearSumApt: document.getElementById("yearSumApt"),
  yearSumNetz: document.getElementById("yearSumNetz"),
  yearSumWpv: document.getElementById("yearSumWpv"),
  monthlyTableBody: document.querySelector("#monthlyTable tbody"),
  mixChart: document.getElementById("mixChart"),
  mixCenterValue: document.getElementById("mixCenterValue"),
  dataTableHead: document.querySelector("#dataTable thead"),
  dataTableBody: document.querySelector("#dataTable tbody"),
};

let supabase;
let usageChart;
let usageMixChart;
let currentUser = null;
let currentProfile = null;
let cachedRows = [];
let loginInProgress = false;
let dataLoadInProgress = false;
let yearLoadInProgress = false;
let apartmentMetaByCode = new Map(
  APARTMENTS.map((code) => [code, { code, ...DEFAULT_APARTMENT_META[code] }])
);

function setStatus(message, isError = false) {
  elements.statusText.textContent = message;
  elements.statusText.style.color = isError ? "#a22" : "#655f50";
}

function setYearStatus(message, isError = false) {
  elements.yearStatus.textContent = message;
  elements.yearStatus.style.color = isError ? "#a22" : "#655f50";
}

function setUserInfo(message, isError = false) {
  elements.userInfo.textContent = message;
  elements.userInfo.style.color = isError ? "#a22" : "#655f50";
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(value, unit = "") {
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: 2 })}${unit}`;
}

function formatEnergy(value) {
  return formatNumber(value, " kWh");
}

function ensureClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Supabase Konfiguration fehlt.");
  }

  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }

  return supabase;
}

function translateAuthError(error) {
  const raw = (error?.message || "").toLowerCase();
  const status = Number(error?.status || 0);
  if (raw.includes("invalid login credentials")) {
    return "E-Mail oder Passwort sind nicht korrekt.";
  }
  if (raw.includes("email not confirmed")) {
    return "E-Mail ist noch nicht bestaetigt. Bitte Postfach pruefen.";
  }
  if (raw.includes("too many requests")) {
    return "Zu viele Versuche. Bitte kurz warten und erneut anmelden.";
  }
  if (status === 400) {
    return "Anmeldung fehlgeschlagen. Bitte Eingaben pruefen.";
  }
  return error?.message || "Unbekannter Login-Fehler.";
}

function formatDbError(error) {
  const code = error?.code ? ` [${error.code}]` : "";
  const message = error?.message ? ` ${error.message}` : "";
  const details = error?.details ? ` Details: ${error.details}` : "";
  const hint = error?.hint ? ` Hint: ${error.hint}` : "";
  return `${code}${message}${details}${hint}`.trim();
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function toIsoDateLocal(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getApartmentLabel(code) {
  const meta = apartmentMetaByCode.get(code);
  return meta?.label || code;
}

function renderApartmentOptions(codes = APARTMENTS) {
  elements.apartmentSelect.innerHTML = "";
  codes.forEach((code) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = getApartmentLabel(code);
    elements.apartmentSelect.appendChild(option);
  });
}

async function loadApartmentDirectory() {
  try {
    const { data, error } = await supabase
      .from("apartments")
      .select("code, address, floor, position, label")
      .order("code", { ascending: true });

    if (error || !Array.isArray(data) || !data.length) {
      renderApartmentOptions(APARTMENTS);
      return;
    }

    const mapped = data
      .map((row) => ({
        code: (row.code || "").toLowerCase(),
        address: row.address || "",
        floor: row.floor || "",
        position: row.position || "",
        label: row.label || `${row.address || ""} - ${row.floor || ""} ${row.position || ""}`.trim(),
      }))
      .filter((row) => APARTMENTS.includes(row.code));

    if (!mapped.length) {
      renderApartmentOptions(APARTMENTS);
      return;
    }

    apartmentMetaByCode = new Map(mapped.map((row) => [row.code, row]));
    renderApartmentOptions(mapped.map((row) => row.code));
  } catch (_err) {
    renderApartmentOptions(APARTMENTS);
  }
}

function ensureDefaultDateRange() {
  if (!elements.dateTo.value) {
    elements.dateTo.value = toIsoDateLocal(new Date());
  }
  if (!elements.dateFrom.value) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    elements.dateFrom.value = toIsoDateLocal(d);
  }
}

function populateYearOptions() {
  const currentYear = new Date().getFullYear();
  const startYear = 2025;
  elements.yearSelect.innerHTML = "";
  for (let y = currentYear; y >= startYear; y -= 1) {
    const option = document.createElement("option");
    option.value = String(y);
    option.textContent = String(y);
    elements.yearSelect.appendChild(option);
  }
  elements.yearSelect.value = String(currentYear);
}

function isAdmin() {
  return (currentProfile?.role || "") === "admin";
}

function getEffectiveApartment() {
  if (isAdmin()) {
    return elements.apartmentSelect.value;
  }
  return currentProfile?.apartment || "";
}

function clearOutput() {
  cachedRows = [];
  elements.monthlyTableBody.innerHTML = "";
  elements.dataTableHead.innerHTML = "";
  elements.dataTableBody.innerHTML = "";
  elements.yearSumApt.textContent = "-";
  elements.yearSumNetz.textContent = "-";
  elements.yearSumWpv.textContent = "-";
  elements.mixCenterValue.textContent = "-";
  setYearStatus("Bitte anmelden.");
  if (usageMixChart) {
    usageMixChart.destroy();
    usageMixChart = null;
  }
}

function applyProfile() {
  if (!currentProfile) {
    elements.apartmentSelect.disabled = true;
    setUserInfo("Nicht angemeldet.");
    return;
  }

  if (isAdmin()) {
    elements.apartmentSelect.disabled = false;
    if (APARTMENTS.includes(currentProfile.apartment)) {
      elements.apartmentSelect.value = currentProfile.apartment;
    }
    setUserInfo(`Angemeldet als Admin: ${currentUser.email}`);
    return;
  }

  if (!APARTMENTS.includes(currentProfile.apartment)) {
    elements.apartmentSelect.disabled = true;
    setUserInfo(
      `Profilfehler: apartment muss apt1..apt4 sein (aktuell: ${currentProfile.apartment || "leer"}).`,
      true
    );
    return;
  }

  elements.apartmentSelect.value = currentProfile.apartment;
  elements.apartmentSelect.disabled = true;
  setUserInfo(`Angemeldet: ${currentUser.email} (${getApartmentLabel(currentProfile.apartment)})`);
}

async function loadProfile() {
  const { data, error } = await supabase
    .from("tenant_profiles")
    .select("apartment, role")
    .eq("user_id", currentUser.id)
    .single();

  if (error) {
    const reason = formatDbError(error);
    throw new Error(
      "Kein tenant_profiles Eintrag gefunden oder Zugriff fehlt. Bitte SQL-Setup ausfuehren und Profil anlegen." +
        (reason ? ` Technischer Grund: ${reason}` : "")
    );
  }

  currentProfile = {
    apartment: (data.apartment || "").toLowerCase(),
    role: (data.role || "tenant").toLowerCase(),
  };
}

function renderTable(rows) {
  elements.dataTableHead.innerHTML = "";
  elements.dataTableBody.innerHTML = "";

  if (!rows.length) {
    return;
  }

  const columns = Object.keys(rows[0]);
  const headRow = document.createElement("tr");
  columns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.appendChild(th);
  });
  elements.dataTableHead.appendChild(headRow);

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    columns.forEach((column) => {
      const td = document.createElement("td");
      td.textContent = row[column] ?? "";
      tr.appendChild(td);
    });
    elements.dataTableBody.appendChild(tr);
  });
}

function calculateSums(rows) {
  return rows.reduce(
    (acc, row) => {
      acc.apt += toNumber(row.apt_value);
      acc.netzb += toNumber(row.netzb);
      acc.wpvanteil += toNumber(row.wpvanteil);
      return acc;
    },
    { apt: 0, netzb: 0, wpvanteil: 0 }
  );
}

function createEmptyMonthlySums() {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    apt: 0,
    netzb: 0,
    wpvanteil: 0,
  }));
}

function updateMonthlySums(monthlySums, rows) {
  rows.forEach((row) => {
    const stamp = String(row.reading_at || "");
    const month = Number(stamp.slice(5, 7));
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return;
    }
    const bucket = monthlySums[month - 1];
    bucket.apt += toNumber(row.apt_value);
    bucket.netzb += toNumber(row.netzb);
    bucket.wpvanteil += toNumber(row.wpvanteil);
  });
}

function renderMonthlyTable(monthlySums) {
  const monthLabels = ["Jan", "Feb", "Mrz", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  elements.monthlyTableBody.innerHTML = "";
  monthlySums.forEach((m, idx) => {
    const tr = document.createElement("tr");
    const values = [monthLabels[idx], formatEnergy(m.apt), formatEnergy(m.netzb), formatEnergy(m.wpvanteil)];
    values.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.appendChild(td);
    });
    elements.monthlyTableBody.appendChild(tr);
  });
}

function addSums(a, b) {
  return {
    apt: toNumber(a.apt) + toNumber(b.apt),
    netzb: toNumber(a.netzb) + toNumber(b.netzb),
    wpvanteil: toNumber(a.wpvanteil) + toNumber(b.wpvanteil),
  };
}

function getMonthlyRanges(year) {
  const ranges = [];
  for (let month = 0; month < 12; month += 1) {
    const start = new Date(year, month, 1, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 23, 59, 59);
    ranges.push({
      p_from: `${toIsoDateLocal(start)}T00:00:00`,
      p_to: `${toIsoDateLocal(end)}T23:59:59`,
    });
  }
  return ranges;
}

function getYearChunkRanges(year, chunkDays = YEAR_CHUNK_DAYS) {
  const ranges = [];
  let cursor = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);

  while (cursor <= yearEnd) {
    const start = new Date(cursor);
    const end = new Date(cursor);
    end.setDate(end.getDate() + (chunkDays - 1));
    if (end > yearEnd) {
      end.setTime(yearEnd.getTime());
    }

    ranges.push({
      p_from: `${toIsoDateLocal(start)}T00:00:00`,
      p_to: `${toIsoDateLocal(end)}T23:59:59`,
    });

    cursor.setDate(cursor.getDate() + chunkDays);
  }

  return ranges;
}

function getExpectedYearRows(year) {
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = isLeap ? 366 : 365;
  return days * 96;
}

function renderYearSums(sums) {
  elements.yearSumApt.textContent = formatEnergy(sums.apt);
  elements.yearSumNetz.textContent = formatEnergy(sums.netzb);
  elements.yearSumWpv.textContent = formatEnergy(sums.wpvanteil);
}

function renderMixChart(sums) {
  const netz = Math.max(0, toNumber(sums.netzb));
  const wpv = Math.max(0, toNumber(sums.wpvanteil));
  const total = netz + wpv;
  const hasData = total > 0;
  const netzPercent = hasData ? (netz / total) * 100 : 0;
  const solarPercent = hasData ? (wpv / total) * 100 : 0;
  elements.mixCenterValue.textContent = formatEnergy(total);

  const chartData = {
    labels: [
      `Netzbezug (${formatNumber(netzPercent)}%)`,
      `Strombezug Solaranlage (${formatNumber(solarPercent)}%)`,
    ],
    datasets: [
      {
        data: hasData ? [netz, wpv] : [1, 1],
        backgroundColor: ["#f2a65a", "#2f7d65"],
        borderColor: ["#ffffff", "#ffffff"],
        borderWidth: 2,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom" },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const value = hasData ? toNumber(ctx.raw) : 0;
            const percent = hasData ? (value / total) * 100 : 0;
            return `${ctx.label}: ${formatEnergy(value)} (${formatNumber(percent)}%)`;
          },
        },
      },
    },
  };

  if (usageMixChart) {
    usageMixChart.data = chartData;
    usageMixChart.options = chartOptions;
    usageMixChart.update();
    return;
  }

  usageMixChart = new Chart(elements.mixChart, {
    type: "doughnut",
    data: chartData,
    options: chartOptions,
  });
}

function renderChart(rows) {
  const labels = rows.map((r) => {
    const d = new Date(r.reading_at);
    if (Number.isNaN(d.getTime())) {
      return "-";
    }
    return d.toLocaleString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  });
  const aptValues = rows.map((r) => toNumber(r.apt_value));
  const netzValues = rows.map((r) => toNumber(r.netzb));
  const pvValues = rows.map((r) => toNumber(r.pvanteil));

  const chartData = {
    labels,
    datasets: [
      {
        label: "Stromverbrauch Wohnung",
        data: aptValues,
        borderColor: "#1d6b52",
        backgroundColor: "rgba(29,107,82,0.10)",
        tension: 0.25,
        fill: false,
        pointRadius: 1.5,
      },
      {
        label: "Netzbezug Wohnung",
        data: netzValues,
        borderColor: "#f2a65a",
        backgroundColor: "rgba(242,166,90,0.10)",
        tension: 0.25,
        fill: false,
        pointRadius: 1.5,
      },
      {
        label: "Produktion Solaranlage",
        data: pvValues,
        borderColor: "#4aa3d1",
        backgroundColor: "rgba(74,163,209,0.10)",
        tension: 0.25,
        fill: false,
        pointRadius: 1.5,
      },
    ],
  };

  if (usageChart) {
    usageChart.data = chartData;
    usageChart.update();
    return;
  }

  usageChart = new Chart(document.getElementById("usageChart"), {
    type: "line",
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: true } },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
      },
    },
  });
}

async function loadData() {
  if (dataLoadInProgress) {
    return;
  }

  if (!currentUser || !currentProfile) {
    setStatus("Bitte zuerst anmelden.", true);
    return;
  }

  const apartment = getEffectiveApartment();
  if (!APARTMENTS.includes(apartment)) {
    setStatus("Keine gueltige Wohnung im Profil gefunden.", true);
    return;
  }

  ensureDefaultDateRange();
  const p_from = elements.dateFrom.value ? `${elements.dateFrom.value}T00:00:00` : null;
  const p_to = elements.dateTo.value ? `${elements.dateTo.value}T23:59:59` : null;

  dataLoadInProgress = true;
  elements.loadBtn.disabled = true;
  setStatus("Lade Daten ueber RPC...");

  const rpcPayload = {
    p_from,
    p_to,
    p_limit: RPC_ROW_LIMIT,
    p_apartment: isAdmin() ? apartment : null,
  };

  let result;
  try {
    result = await withTimeout(
      supabase.rpc("get_my_energy_15min", rpcPayload),
      RPC_TIMEOUT_MS,
      "Zeitueberschreitung bei der Datenabfrage (>60s). Bitte Datumsbereich weiter verkuerzen."
    );
  } catch (err) {
    setStatus(`Fehler: ${err.message}`, true);
    dataLoadInProgress = false;
    elements.loadBtn.disabled = false;
    return;
  }

  const { data, error } = result;
  if (error) {
    setStatus(`Fehler: ${formatDbError(error)}`, true);
    dataLoadInProgress = false;
    elements.loadBtn.disabled = false;
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  cachedRows = rows;
  const sums = calculateSums(rows);
  renderMixChart(sums);
  renderChart(rows);
  renderTable(rows);
  setStatus(`${rows.length} Zeilen fuer ${getApartmentLabel(apartment)} geladen.`);
  dataLoadInProgress = false;
  elements.loadBtn.disabled = false;
}

async function loadYearData() {
  if (yearLoadInProgress) {
    return;
  }
  if (!currentUser || !currentProfile) {
    setYearStatus("Bitte zuerst anmelden.", true);
    return;
  }

  const apartment = getEffectiveApartment();
  if (!APARTMENTS.includes(apartment)) {
    setYearStatus("Keine gueltige Wohnung im Profil gefunden.", true);
    return;
  }

  const year = Number(elements.yearSelect.value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    setYearStatus("Ungueltiges Jahr.", true);
    return;
  }

  const ranges = getYearChunkRanges(year);
  const expectedRows = getExpectedYearRows(year);

  yearLoadInProgress = true;
  elements.loadYearBtn.disabled = true;
  setYearStatus(`Lade Jahreswerte fuer ${year}...`);

  let totalSums = { apt: 0, netzb: 0, wpvanteil: 0 };
  const monthlySums = createEmptyMonthlySums();
  let totalRows = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i];
    setYearStatus(`Lade Jahreswerte fuer ${year}... (${i + 1}/${ranges.length})`);
    const rpcPayload = {
      p_from: range.p_from,
      p_to: range.p_to,
      p_limit: YEAR_CHUNK_LIMIT,
      p_apartment: isAdmin() ? apartment : null,
    };

    let result;
    try {
      result = await withTimeout(
        supabase.rpc("get_my_energy_15min", rpcPayload),
        YEAR_RPC_TIMEOUT_MS,
        `Zeitueberschreitung bei den Jahreswerten fuer ${year} (Block ${i + 1}).`
      );
    } catch (err) {
      setYearStatus(`Fehler: ${err.message}`, true);
      yearLoadInProgress = false;
      elements.loadYearBtn.disabled = false;
      return;
    }

    const { data, error } = result;
    if (error) {
      setYearStatus(`Fehler: ${formatDbError(error)}`, true);
      yearLoadInProgress = false;
      elements.loadYearBtn.disabled = false;
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    totalRows += rows.length;
    updateMonthlySums(monthlySums, rows);
    totalSums = addSums(totalSums, calculateSums(rows));

    if (rows.length >= YEAR_CHUNK_LIMIT) {
      setYearStatus(
        `Warnung: Blocklimit ${YEAR_CHUNK_LIMIT} erreicht (Block ${i + 1}), Werte ggf. unvollstaendig.`,
        true
      );
      yearLoadInProgress = false;
      elements.loadYearBtn.disabled = false;
      return;
    }
  }

  renderYearSums(totalSums);
  renderMonthlyTable(monthlySums);
  if (totalRows !== expectedRows) {
    setYearStatus(
      `Jahreswerte fuer ${year} geladen (${totalRows} Zeilen, erwartet ${expectedRows}). Bitte Datenluecken pruefen.`,
      true
    );
  } else {
    setYearStatus(`Jahreswerte fuer ${year} geladen (${totalRows} Zeilen).`);
  }
  yearLoadInProgress = false;
  elements.loadYearBtn.disabled = false;
}

async function login() {
  if (loginInProgress) {
    return;
  }
  try {
    ensureClient();
  } catch (err) {
    setUserInfo(err.message, true);
    return;
  }
  const email = elements.email.value.trim();
  const password = elements.password.value;
  if (!email || !password) {
    setUserInfo("Bitte E-Mail und Passwort eingeben.", true);
    return;
  }
  loginInProgress = true;
  elements.loginBtn.disabled = true;
  setUserInfo("Anmeldung laeuft...");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setUserInfo("Login fehlgeschlagen: " + translateAuthError(error), true);
    loginInProgress = false;
    elements.loginBtn.disabled = false;
    return;
  }
  currentUser = data.user;
  try {
    await loadProfile();
    await loadApartmentDirectory();
  } catch (err) {
    await supabase.auth.signOut();
    currentUser = null;
    currentProfile = null;
    clearOutput();
    elements.apartmentSelect.disabled = true;
    setUserInfo("Login erfolgreich, aber Profil fehlt: " + err.message, true);
    setStatus(
      "Kein Zugriff ohne Profilzuordnung. Bitte Admin: tenant_profiles-Eintrag fuer diesen User anlegen.",
      true
    );
    loginInProgress = false;
    elements.loginBtn.disabled = false;
    return;
  }
  applyProfile();
  setStatus("Angemeldet. Jetzt Daten laden.");
  await loadYearData();
  loginInProgress = false;
  elements.loginBtn.disabled = false;
}

async function logout() {
  if (!supabase) {
    return;
  }

  await supabase.auth.signOut();
  currentUser = null;
  currentProfile = null;
  clearOutput();
  elements.apartmentSelect.disabled = true;
  setUserInfo("Nicht angemeldet.");
  setStatus("Abgemeldet.");
}

async function initSession() {
  try {
    ensureClient();
  } catch (err) {
    setStatus(err.message, true);
    return;
  }

  const { data, error } = await supabase.auth.getUser();
  if (!error && data.user) {
    currentUser = data.user;
    try {
      await loadProfile();
      await loadApartmentDirectory();
      applyProfile();
      setStatus("Session erkannt. Daten laden moeglich.");
      await loadYearData();
    } catch (errProfile) {
      setStatus(errProfile.message, true);
      setUserInfo(errProfile.message, true);
    }
  } else {
    elements.apartmentSelect.disabled = true;
    setUserInfo("Nicht angemeldet.");
  }

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user ?? null;
    if (currentUser) {
      try {
        await loadProfile();
        await loadApartmentDirectory();
        applyProfile();
      } catch (errProfile) {
        setStatus(errProfile.message, true);
        setUserInfo(errProfile.message, true);
      }
      return;
    }

    currentProfile = null;
    clearOutput();
    elements.apartmentSelect.disabled = true;
    setUserInfo("Nicht angemeldet.");
  });
}

elements.loginBtn.addEventListener("click", login);
elements.logoutBtn.addEventListener("click", logout);
elements.loadYearBtn.addEventListener("click", loadYearData);
elements.loadBtn.addEventListener("click", loadData);
elements.password.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    login();
  }
});

elements.apartmentSelect.addEventListener("change", () => {
  if (currentUser && isAdmin()) {
    loadYearData();
    loadData();
  }
});

elements.yearSelect.addEventListener("change", () => {
  if (currentUser) {
    loadYearData();
  }
});

setStatus("Bereit. Bitte anmelden.");
renderApartmentOptions(APARTMENTS);
populateYearOptions();
setYearStatus("Bitte anmelden.");
ensureDefaultDateRange();
initSession();

