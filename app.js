const LEVELS = {
  easy: { max: 5, label: "Easy" },
  medium: { max: 9, label: "Medium" },
  hard: { max: 12, label: "Hard" },
};

const QUESTION_MS = 30000;
const STORAGE_KEY = "suanshu-progress-v2";
const LEGACY_STATS_KEY = "suanshu-stats-v1";

const emptyStats = () => ({ total: 0, correct: 0, streak: 0, bestStreak: 0 });

function isPlainFactor(token) {
  return /^\d+$/.test(token) || /^0\.\d$/.test(token);
}

function isOralDecimalProblem(problem) {
  if (!problem) return false;
  const body = problem.text.replace(" = ?", "");
  const [left, right] = body.split(` ${problem.op} `);
  if (!left || !right) return false;
  if (problem.op === "×") return isPlainFactor(left) && isPlainFactor(right);
  return isPlainFactor(right);
}

function sanitizeProblem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const a = Number(raw.a);
  const b = Number(raw.b);
  const answer = Number(raw.answer);
  if (![a, b, answer].every(Number.isFinite)) return null;
  if (raw.op !== "×" && raw.op !== "÷") return null;
  const problem = {
    a,
    b,
    op: raw.op,
    answer,
    text: typeof raw.text === "string" ? raw.text : `${a} ${raw.op} ${b} = ?`,
    key: typeof raw.key === "string" ? raw.key : `${raw.op}-${a}-${b}`,
    retry: Boolean(raw.retry || raw.showHint),
    padded: Boolean(raw.padded),
    zeroCount: raw.padded ? sanitizeZeros(raw.zeroCount ?? 2) : 0,
    kind: raw.kind,
  };
  problem.kind = problemKind(problem);
  return problem;
}

function defaultSettings() {
  return {
    integers: { op: "mix", level: "easy", zeros: 0 },
    decimals: { op: "mix", level: "easy", zeros: 0 },
  };
}

function sanitizeZeros(value) {
  if (value === true) return 2;
  const count = Number(value);
  return count === 1 || count === 2 ? count : 0;
}

function sanitizeOp(value) {
  return value === "mul" || value === "div" ? value : "mix";
}

function sanitizeLevel(value) {
  return value in LEVELS ? value : "easy";
}

const KINDS = ["integers", "decimals"];

function sanitizeTracks(parsed) {
  if (Array.isArray(parsed.tracks)) {
    const tracks = KINDS.filter((kind) => parsed.tracks.includes(kind));
    if (tracks.length) return tracks;
  }
  if (parsed.track === "both") return [...KINDS];
  if (parsed.track === "decimals") return ["decimals"];
  return ["integers"];
}

function includedKinds() {
  return state.tracks;
}

function problemKind(problem) {
  if (problem.kind === "decimals" || problem.kind === "integers") return problem.kind;
  return /[.]/.test(problem.text) ? "decimals" : "integers";
}

function loadSettings(parsed) {
  const settings = defaultSettings();
  if (parsed.settings?.integers || parsed.settings?.decimals) {
    settings.integers.op = sanitizeOp(parsed.settings.integers?.op);
    settings.integers.level = sanitizeLevel(parsed.settings.integers?.level);
    settings.integers.zeros = sanitizeZeros(parsed.settings.integers?.zeros);
    settings.decimals.op = sanitizeOp(parsed.settings.decimals?.op);
    settings.decimals.level = sanitizeLevel(parsed.settings.decimals?.level);
    settings.decimals.zeros = sanitizeZeros(parsed.settings.decimals?.zeros);
    return { tracks: sanitizeTracks(parsed), settings };
  }
  const level = sanitizeLevel(parsed.level);
  if (parsed.mode === "dec") {
    settings.decimals.level = level;
    return { tracks: ["decimals"], settings };
  }
  settings.integers.op = sanitizeOp(parsed.mode);
  settings.integers.level = level;
  return { tracks: ["integers"], settings };
}

function keepProblem(problem, tracks) {
  if (!problem) return null;
  if (problem.kind === "decimals" && !isOralDecimalProblem(problem)) return null;
  if (!tracks.includes(problem.kind)) return null;
  return problem;
}

function loadProgress() {
  const fallback = {
    tracks: ["integers"],
    settings: defaultSettings(),
    current: null,
    pendingRetries: [],
    lastPrompt: "",
    stats: emptyStats(),
    misses: [],
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const { tracks, settings } = loadSettings(parsed);
      const pendingRetries = Array.isArray(parsed.pendingRetries)
        ? parsed.pendingRetries
            .map((item) => {
              const problem = sanitizeProblem(item?.problem);
              if (!problem) return null;
              if (problem.kind === "decimals" && !isOralDecimalProblem(problem)) return null;
              return { dueIn: Math.max(0, Number(item.dueIn) || 0), problem };
            })
            .filter(Boolean)
        : [];
      return {
        tracks,
        settings,
        current: keepProblem(sanitizeProblem(parsed.current), tracks),
        pendingRetries,
        lastPrompt: typeof parsed.lastPrompt === "string" ? parsed.lastPrompt : "",
        stats: {
          total: Number(parsed.stats?.total) || 0,
          correct: Number(parsed.stats?.correct) || 0,
          streak: Number(parsed.stats?.streak) || 0,
          bestStreak: Number(parsed.stats?.bestStreak) || 0,
        },
        misses: sanitizeMisses(parsed.misses),
      };
    }

    const legacy = localStorage.getItem(LEGACY_STATS_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      fallback.stats = {
        total: Number(parsed.total) || 0,
        correct: Number(parsed.correct) || 0,
        streak: Number(parsed.streak) || 0,
        bestStreak: Number(parsed.bestStreak) || 0,
      };
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function sanitizeMisses(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const answer = Number(item?.answer);
      const at = Number(item?.at);
      const given = item?.given == null ? null : Number(item.given);
      if (!Number.isFinite(answer) || !Number.isFinite(at)) return null;
      if (given !== null && !Number.isFinite(given)) return null;
      if (typeof item.label !== "string" || typeof item.key !== "string") return null;
      return { key: item.key, label: item.label, answer, given, at };
    })
    .filter(Boolean)
    .slice(0, 300);
}

function saveProgress() {
  const payload = {
    tracks: state.tracks,
    settings: state.settings,
    current: state.current,
    pendingRetries: state.pendingRetries,
    lastPrompt: state.lastPrompt,
    stats: state.stats,
    misses: state.misses,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

const saved = loadProgress();

const state = {
  tracks: saved.tracks,
  settings: saved.settings,
  current: saved.current,
  pendingRetries: saved.pendingRetries,
  lastPrompt: saved.lastPrompt,
  locked: false,
  nextTimer: 0,
  tickTimer: 0,
  deadline: 0,
  remainingMs: QUESTION_MS,
  settingsOpen: false,
  settingsReturn: null,
  stats: saved.stats,
  misses: saved.misses,
};

const els = {
  prompt: document.getElementById("prompt"),
  kicker: document.getElementById("card-kicker"),
  form: document.getElementById("answer-form"),
  answer: document.getElementById("answer"),
  feedback: document.getElementById("feedback"),
  card: document.getElementById("card"),
  total: document.getElementById("stat-total"),
  correct: document.getElementById("stat-correct"),
  streak: document.getElementById("stat-streak"),
  keypad: document.getElementById("keypad"),
  reset: document.getElementById("reset-stats"),
  openMisses: document.getElementById("open-misses"),
  closeMisses: document.getElementById("close-misses"),
  misses: document.getElementById("misses"),
  missesEmpty: document.getElementById("misses-empty"),
  missSummary: document.getElementById("miss-summary"),
  missesRecentTitle: document.getElementById("misses-recent-title"),
  missLog: document.getElementById("miss-log"),
  timer: document.getElementById("timer"),
  timerFill: document.getElementById("timer-fill"),
  practice: document.getElementById("practice"),
  settings: document.getElementById("settings"),
  openSettings: document.getElementById("open-settings"),
  closeSettings: document.getElementById("close-settings"),
  practiceSetup: document.getElementById("practice-setup"),
};

function renderStats() {
  els.total.textContent = String(state.stats.total);
  els.correct.textContent = String(state.stats.correct);
  els.streak.textContent = String(state.stats.streak);
  const count = state.misses.length;
  els.openMisses.textContent = count ? `Missed problems (${count})` : "Missed problems";
}

function formatWhen(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function problemLabel(problem) {
  return problem.text.replace(" = ?", "");
}

function recordMiss(problem, given) {
  state.misses.unshift({
    key: problem.key,
    label: problemLabel(problem),
    answer: problem.answer,
    given,
    at: Date.now(),
  });
  if (state.misses.length > 300) state.misses.length = 300;
}

function summarizeMisses() {
  const groups = new Map();
  for (const miss of state.misses) {
    const group = groups.get(miss.key);
    if (!group) {
      groups.set(miss.key, {
        label: miss.label,
        answer: miss.answer,
        count: 1,
        lastGiven: miss.given,
        lastAt: miss.at,
      });
      continue;
    }
    group.count += 1;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
}

function renderMisses() {
  const groups = summarizeMisses();
  els.missesEmpty.hidden = groups.length > 0;
  els.missSummary.replaceChildren(
    ...groups.map((group) => {
      const item = document.createElement("li");
      item.className = "miss-item";
      const eq = document.createElement("p");
      eq.className = "miss-eq";
      eq.textContent = `${group.label} = ${group.answer}`;
      const meta = document.createElement("p");
      meta.className = "miss-meta";
      const times = group.count === 1 ? "1 time" : `${group.count} times`;
      const lastAnswer = group.lastGiven == null ? "time's up" : group.lastGiven;
      meta.textContent = `Missed ${times} · last answer ${lastAnswer} · ${formatWhen(group.lastAt)}`;
      item.append(eq, meta);
      return item;
    }),
  );

  const recent = state.misses.slice(0, 40);
  els.missesRecentTitle.hidden = recent.length === 0;
  els.missLog.replaceChildren(
    ...recent.map((miss) => {
      const item = document.createElement("li");
      item.className = "miss-try";
      const line = document.createElement("p");
      const wrote = miss.given == null ? "time's up" : `wrote ${miss.given}`;
      line.textContent = `${miss.label} → ${wrote}, answer ${miss.answer} · ${formatWhen(miss.at)}`;
      item.append(line);
      return item;
    }),
  );
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function numbersMatch(left, right) {
  return round2(left) === round2(right);
}

function formatScaled(intValue, places) {
  if (places === 0) return String(intValue);
  const digits = String(intValue).padStart(places + 1, "0");
  const whole = digits.slice(0, -places);
  const frac = digits.slice(-places).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

function decimalShiftChoices(left, right) {
  const choices = [];
  if (left <= 9) choices.push([1, 0]);
  if (right <= 9) choices.push([0, 1]);
  if (left <= 9 && right <= 9) choices.push([1, 1]);
  return choices;
}

function pickOp(kind) {
  const op = state.settings[kind].op;
  if (op === "mul") return "×";
  if (op === "div") return "÷";
  return Math.random() < 0.5 ? "×" : "÷";
}

function makeDecimalProblem() {
  const max = LEVELS[state.settings.decimals.level].max;
  let left = randInt(1, max);
  let right = randInt(1, max);
  let shifts = decimalShiftChoices(left, right);
  let guard = 0;
  while (shifts.length === 0 && guard < 20) {
    left = randInt(1, max);
    right = randInt(1, max);
    shifts = decimalShiftChoices(left, right);
    guard += 1;
  }
  if (shifts.length === 0) {
    left = randInt(1, Math.min(9, max));
    shifts = decimalShiftChoices(left, right);
  }
  const [leftPlaces, rightPlaces] = shifts[randInt(0, shifts.length - 1)];
  const leftText = formatScaled(left, leftPlaces);
  const rightText = formatScaled(right, rightPlaces);
  const productText = formatScaled(left * right, leftPlaces + rightPlaces);
  const multiply = pickOp("decimals") === "×";

  if (multiply) {
    const swap = Math.random() < 0.5;
    const aText = swap ? rightText : leftText;
    const bText = swap ? leftText : rightText;
    return {
      a: Number(aText),
      b: Number(bText),
      op: "×",
      answer: Number(productText),
      text: `${aText} × ${bText} = ?`,
      key: `×-${aText}-${bText}`,
    };
  }

  const divideByRight = Math.random() < 0.5;
  const divisorText = divideByRight ? rightText : leftText;
  const answerText = divideByRight ? leftText : rightText;
  return {
    a: Number(productText),
    b: Number(divisorText),
    op: "÷",
    answer: Number(answerText),
    text: `${productText} ÷ ${divisorText} = ?`,
    key: `÷-${productText}-${divisorText}`,
  };
}

function makeIntegerProblem() {
  const max = LEVELS[state.settings.integers.level].max;
  const op = pickOp("integers");
  const a = randInt(1, max);
  const b = randInt(1, max);

  if (op === "×") {
    return {
      a,
      b,
      op,
      answer: a * b,
      text: `${a} × ${b} = ?`,
      key: `×-${a}-${b}`,
    };
  }

  const product = a * b;
  return {
    a: product,
    b,
    op,
    answer: a,
    text: `${product} ÷ ${b} = ?`,
    key: `÷-${product}-${b}`,
  };
}

function appendZeros(text, count) {
  if (count === 0) return { text, multiplier: 1 };
  if (text.includes(".")) {
    return { text: text.replace(/^0\./, "") + "0".repeat(count), multiplier: 10 ** (count + 1) };
  }
  return { text: text + "0".repeat(count), multiplier: 10 ** count };
}

function answerIsNice(value) {
  const cents = Math.round(value * 100);
  return Math.abs(value * 100 - cents) < 1e-4;
}

function padProblem(problem, kind) {
  problem.padded = false;
  problem.zeroCount = 0;
  const maxZeros = state.settings[kind].zeros;
  if (!maxZeros) return problem;
  const body = problem.text.replace(" = ?", "");
  const [leftText, rightText] = body.split(` ${problem.op} `);
  const leftDec = leftText.includes(".");
  const rightDec = rightText.includes(".");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    let z1 = 0;
    let z2 = 0;
    if (kind === "decimals" && leftDec && rightDec) {
      if (Math.random() < 0.5) z1 = randInt(1, maxZeros);
      else z2 = randInt(1, maxZeros);
    } else if (kind === "decimals" && leftDec) {
      z2 = randInt(1, maxZeros);
    } else if (kind === "decimals" && rightDec) {
      z1 = randInt(1, maxZeros);
    } else {
      z1 = randInt(0, maxZeros);
      z2 = randInt(0, maxZeros);
      if (z1 + z2 === 0) {
        if (Math.random() < 0.5) z1 = randInt(1, maxZeros);
        else z2 = randInt(1, maxZeros);
      }
    }
    const left = appendZeros(leftText, z1);
    const right = appendZeros(rightText, z2);
    const scale = problem.op === "×" ? left.multiplier * right.multiplier : left.multiplier / right.multiplier;
    const answer = round2(problem.answer * scale);
    if (!answerIsNice(answer)) continue;
    if (kind === "integers" && !Number.isInteger(answer)) continue;
    return {
      ...problem,
      a: Number(left.text),
      b: Number(right.text),
      answer,
      text: `${left.text} ${problem.op} ${right.text} = ?`,
      key: `${problem.op}-${left.text}-${right.text}`,
      padded: true,
      zeroCount: Math.max(z1, z2),
    };
  }
  return problem;
}

function makeProblem() {
  const kinds = includedKinds();
  const kind = kinds[randInt(0, kinds.length - 1)];
  const problem = kind === "decimals" ? makeDecimalProblem() : makeIntegerProblem();
  problem.kind = kind;
  return padProblem(problem, kind);
}

function factorSize(token, padded) {
  const text = String(token);
  const tenth = text.match(/^0\.(\d)$/);
  if (tenth) return Number(tenth[1]);
  if (!/^\d+$/.test(text)) return null;
  if (!padded) return Number(text);
  const stripped = text.replace(/0+$/, "");
  return stripped ? Number(stripped) : null;
}

function matchesActiveSetup(problem) {
  if (!problem || !includedKinds().includes(problem.kind)) return false;
  const setup = state.settings[problem.kind];
  if (!setup) return false;
  if (problem.padded && (problem.zeroCount || 2) > setup.zeros) return false;
  if (setup.op === "mul" && problem.op !== "×") return false;
  if (setup.op === "div" && problem.op !== "÷") return false;
  const max = LEVELS[setup.level].max;
  const body = problem.text.replace(" = ?", "");
  const [left, right] = body.split(` ${problem.op} `);
  if (problem.op === "×") {
    const a = factorSize(left, problem.padded);
    const b = factorSize(right, problem.padded);
    return a != null && b != null && a <= max && b <= max;
  }
  const divisor = factorSize(right, problem.padded);
  const other = factorSize(problem.answer, problem.padded);
  return divisor != null && other != null && divisor <= max && other <= max;
}

function nextDueRetry() {
  const ready = state.pendingRetries.find((item) => item.dueIn <= 0 && matchesActiveSetup(item.problem));
  if (!ready) return null;
  state.pendingRetries = state.pendingRetries.filter((item) => item !== ready);
  return ready.problem;
}

function tickRetries() {
  for (const item of state.pendingRetries) {
    if (includedKinds().includes(item.problem.kind)) item.dueIn -= 1;
  }
}

function enqueueRetry(problem) {
  const existing = state.pendingRetries.find((item) => item.problem.key === problem.key);
  if (existing) {
    existing.dueIn = 2;
    existing.problem.retry = true;
    return;
  }
  state.pendingRetries.push({
    dueIn: 2,
    problem: { ...problem, retry: true },
  });
}

function freshProblem() {
  for (let i = 0; i < 12; i += 1) {
    const problem = makeProblem();
    if (problem.text !== state.lastPrompt) return problem;
  }
  return makeProblem();
}

function clearQuestionTimer() {
  window.clearInterval(state.tickTimer);
  state.tickTimer = 0;
}

function renderTimer() {
  const remainingMs = Math.max(0, state.deadline - Date.now());
  const seconds = Math.ceil(remainingMs / 1000);
  const low = seconds <= 10;
  els.timer.textContent = String(seconds);
  els.timer.classList.toggle("is-low", low);
  els.timer.setAttribute("aria-label", `${seconds} seconds left`);
  els.timerFill.style.transform = `scaleX(${remainingMs / QUESTION_MS})`;
  els.timerFill.classList.toggle("is-low", low);
}

function startQuestionTimer(remainingMs = QUESTION_MS) {
  clearQuestionTimer();
  state.remainingMs = remainingMs;
  state.deadline = Date.now() + remainingMs;
  renderTimer();
  state.tickTimer = window.setInterval(() => {
    if (Date.now() >= state.deadline) {
      timeUp();
      return;
    }
    renderTimer();
  }, 200);
}

function pauseQuestionTimer() {
  state.remainingMs = Math.max(0, state.deadline - Date.now());
  clearQuestionTimer();
}

function showProblem(problem) {
  window.clearTimeout(state.nextTimer);
  state.locked = false;
  state.current = problem;
  state.lastPrompt = problem.text;
  els.prompt.textContent = problem.text;
  els.kicker.textContent = problem.retry ? "Try again" : "New";
  els.feedback.textContent = "";
  els.feedback.className = "feedback";
  els.card.classList.remove("is-good", "is-bad");
  els.answer.value = "";
  suppressSystemKeyboard();
  startQuestionTimer();
  saveProgress();
}

function pickNextProblem() {
  tickRetries();
  const retry = nextDueRetry();
  return retry || freshProblem();
}

function nextCard() {
  showProblem(pickNextProblem());
}

function celebrate() {
  els.card.classList.add("is-good");
  els.feedback.className = "feedback good";
  els.feedback.textContent = "You got it!";
}

function markWrong(message) {
  els.card.classList.remove("is-bad");
  void els.card.offsetWidth;
  els.card.classList.add("is-bad");
  els.feedback.className = "feedback bad";
  els.feedback.textContent = message;
}

function finishRound(ok, given) {
  state.locked = true;
  clearQuestionTimer();
  window.clearTimeout(state.nextTimer);

  const problem = state.current;
  state.stats.total += 1;
  if (ok) {
    state.stats.correct += 1;
    state.stats.streak += 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
    celebrate();
  } else {
    state.stats.streak = 0;
    enqueueRetry(problem);
    recordMiss(problem, given);
    markWrong(
      given == null
        ? "Time's up — this one will come back soon"
        : "Not yet — this one will come back soon",
    );
  }

  const upcoming = pickNextProblem();
  state.current = upcoming;
  state.lastPrompt = upcoming.text;
  saveProgress();
  renderStats();

  state.nextTimer = window.setTimeout(() => showProblem(upcoming), ok ? 650 : 900);
}

function timeUp() {
  if (state.locked || !state.current) return;
  finishRound(false, null);
}

function submitAnswer() {
  if (state.locked) return;
  const raw = els.answer.value.trim();
  if (raw === "") return;
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  finishRound(numbersMatch(value, state.current.answer), value);
}

const OP_LABELS = { mix: "Mix", mul: "Multiply", div: "Divide" };
const LEVEL_LABELS = { easy: "Easy 1–5", medium: "Medium 1–9", hard: "Hard 1–12" };

function describeSetup(kind) {
  const setup = state.settings[kind];
  const name = kind === "decimals" ? "Decimals" : "Integers";
  const zeros = setup.zeros ? ` · ${setup.zeros === 1 ? "1 zero" : "2 zeros"}` : "";
  return `${name} · ${OP_LABELS[setup.op]} · ${LEVEL_LABELS[setup.level]}${zeros}`;
}

function renderSetup() {
  els.practiceSetup.textContent = includedKinds().map(describeSetup).join("\n");
}

function syncPills() {
  document.querySelectorAll("[data-track]").forEach((el) => {
    const on = state.tracks.includes(el.dataset.track);
    el.classList.toggle("is-on", on);
    el.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll("[data-panel]").forEach((el) => {
    el.classList.toggle("is-active", state.tracks.includes(el.dataset.panel));
  });
  document.querySelectorAll("[data-op]").forEach((el) => {
    el.classList.toggle("is-on", state.settings[el.dataset.setting].op === el.dataset.op);
  });
  document.querySelectorAll("[data-level]").forEach((el) => {
    el.classList.toggle("is-on", state.settings[el.dataset.setting].level === el.dataset.level);
  });
  document.querySelectorAll("[data-zeros]").forEach((el) => {
    el.classList.toggle("is-on", Number(el.dataset.zeros) === state.settings[el.dataset.setting].zeros);
  });
  renderSetup();
}

document.querySelectorAll("[data-track]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.track;
    if (state.tracks.includes(kind)) {
      if (state.tracks.length === 1) return;
      state.tracks = state.tracks.filter((item) => item !== kind);
    } else {
      state.tracks = KINDS.filter((item) => item === kind || state.tracks.includes(item));
    }
    syncPills();
    saveProgress();
  });
});

document.querySelectorAll("[data-op]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.settings[btn.dataset.setting].op = btn.dataset.op;
    syncPills();
    saveProgress();
  });
});

document.querySelectorAll("[data-level]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.settings[btn.dataset.setting].level = btn.dataset.level;
    syncPills();
    saveProgress();
  });
});

document.querySelectorAll("[data-zeros]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.settings[btn.dataset.setting].zeros = sanitizeZeros(btn.dataset.zeros);
    syncPills();
    saveProgress();
  });
});

function openSettings() {
  if (state.settingsOpen) return;
  state.settingsOpen = true;
  state.settingsReturn = {
    tracks: state.tracks.join(","),
    integers: { ...state.settings.integers },
    decimals: { ...state.settings.decimals },
    fresh: state.locked,
  };
  if (state.locked) {
    window.clearTimeout(state.nextTimer);
  } else {
    pauseQuestionTimer();
  }
  els.practice.hidden = true;
  els.settings.hidden = false;
  els.openSettings.hidden = true;
}

function closeSettings() {
  const previous = state.settingsReturn;
  const changed =
    previous &&
    (previous.tracks !== state.tracks.join(",") ||
      includedKinds().some(
        (kind) =>
          previous[kind].op !== state.settings[kind].op ||
          previous[kind].level !== state.settings[kind].level ||
          previous[kind].zeros !== state.settings[kind].zeros,
      ));
  state.settingsOpen = false;
  state.settingsReturn = null;
  els.settings.hidden = true;
  els.practice.hidden = false;
  els.openSettings.hidden = false;

  if (changed) {
    nextCard();
    return;
  }
  if (previous?.fresh) {
    showProblem(state.current);
    return;
  }
  if (state.remainingMs <= 0) {
    timeUp();
    return;
  }
  startQuestionTimer(state.remainingMs);
  suppressSystemKeyboard();
}

els.openSettings.addEventListener("click", openSettings);
els.closeSettings.addEventListener("click", closeSettings);

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAnswer();
});

els.keypad.addEventListener("click", (event) => {
  const btn = event.target.closest("button");
  if (!btn) return;
  const key = btn.dataset.key;
  if (key === "clear") {
    els.answer.value = "";
  } else if (key === "back") {
    els.answer.value = els.answer.value.slice(0, -1);
  } else if (key === ".") {
    if (!els.answer.value.includes(".")) {
      els.answer.value = els.answer.value === "" ? "0." : `${els.answer.value}.`;
    }
  } else if (els.answer.value.length < 8) {
    els.answer.value += key;
  }
  suppressSystemKeyboard();
});

function suppressSystemKeyboard() {
  els.answer.setAttribute("readonly", "readonly");
  els.answer.setAttribute("inputmode", "none");
  if (document.activeElement === els.answer) els.answer.blur();
}

els.answer.addEventListener("pointerdown", (event) => {
  event.preventDefault();
});
els.answer.addEventListener("focus", suppressSystemKeyboard);

els.openMisses.addEventListener("click", () => {
  renderMisses();
  els.misses.showModal();
});

els.closeMisses.addEventListener("click", () => {
  els.misses.close();
});

els.misses.addEventListener("click", (event) => {
  if (event.target === els.misses) els.misses.close();
});

els.reset.addEventListener("click", () => {
  clearQuestionTimer();
  window.clearTimeout(state.nextTimer);
  state.stats = emptyStats();
  state.pendingRetries = [];
  state.misses = [];
  state.current = null;
  state.lastPrompt = "";
  if (els.misses.open) els.misses.close();
  saveProgress();
  renderStats();
  nextCard();
});

window.addEventListener("pagehide", saveProgress);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveProgress();
});

syncPills();
renderStats();
if (state.current && !matchesActiveSetup(state.current)) state.current = null;
if (state.current) {
  showProblem(state.current);
} else {
  nextCard();
}
