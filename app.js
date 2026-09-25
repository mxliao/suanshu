const LEVELS = {
  easy: { max: 5, label: "Easy" },
  medium: { max: 9, label: "Medium" },
  hard: { max: 12, label: "Hard" },
};

const STORAGE_KEY = "suanshu-progress-v2";
const LEGACY_STATS_KEY = "suanshu-stats-v1";

const emptyStats = () => ({ total: 0, correct: 0, streak: 0, bestStreak: 0 });

function sanitizeProblem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const a = Number(raw.a);
  const b = Number(raw.b);
  const answer = Number(raw.answer);
  if (![a, b, answer].every(Number.isFinite)) return null;
  if (raw.op !== "×" && raw.op !== "÷") return null;
  return {
    a,
    b,
    op: raw.op,
    answer,
    text: typeof raw.text === "string" ? raw.text : `${a} ${raw.op} ${b} = ?`,
    key: typeof raw.key === "string" ? raw.key : `${raw.op}-${a}-${b}`,
    showHint: Boolean(raw.showHint),
  };
}

function loadProgress() {
  const fallback = {
    mode: "mix",
    level: "easy",
    current: null,
    pendingRetries: [],
    lastPrompt: "",
    stats: emptyStats(),
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const mode = parsed.mode === "mul" || parsed.mode === "div" ? parsed.mode : "mix";
      const level = parsed.level in LEVELS ? parsed.level : "easy";
      const pendingRetries = Array.isArray(parsed.pendingRetries)
        ? parsed.pendingRetries
            .map((item) => {
              const problem = sanitizeProblem(item?.problem);
              if (!problem) return null;
              return { dueIn: Math.max(0, Number(item.dueIn) || 0), problem };
            })
            .filter(Boolean)
        : [];
      return {
        mode,
        level,
        current: sanitizeProblem(parsed.current),
        pendingRetries,
        lastPrompt: typeof parsed.lastPrompt === "string" ? parsed.lastPrompt : "",
        stats: {
          total: Number(parsed.stats?.total) || 0,
          correct: Number(parsed.stats?.correct) || 0,
          streak: Number(parsed.stats?.streak) || 0,
          bestStreak: Number(parsed.stats?.bestStreak) || 0,
        },
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

function saveProgress() {
  const payload = {
    mode: state.mode,
    level: state.level,
    current: state.current,
    pendingRetries: state.pendingRetries,
    lastPrompt: state.lastPrompt,
    stats: state.stats,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

const saved = loadProgress();

const state = {
  mode: saved.mode,
  level: saved.level,
  current: saved.current,
  pendingRetries: saved.pendingRetries,
  lastPrompt: saved.lastPrompt,
  locked: false,
  nextTimer: 0,
  stats: saved.stats,
};

const els = {
  prompt: document.getElementById("prompt"),
  hint: document.getElementById("hint"),
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
};

function renderStats() {
  els.total.textContent = String(state.stats.total);
  els.correct.textContent = String(state.stats.correct);
  els.streak.textContent = String(state.stats.streak);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOp() {
  if (state.mode === "mul") return "×";
  if (state.mode === "div") return "÷";
  return Math.random() < 0.5 ? "×" : "÷";
}

function makeProblem() {
  const max = LEVELS[state.level].max;
  const op = pickOp();
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

function hintFor(problem) {
  if (problem.op === "×") {
    if (problem.a <= 6) {
      const parts = Array.from({ length: problem.a }, () => String(problem.b));
      return `Hint: ${problem.a} groups of ${problem.b} → ${parts.join(" + ")}`;
    }
    return `Hint: first do ${problem.a} × ${problem.b - 1}, then add ${problem.b}`;
  }
  return `Hint: what times ${problem.b} equals ${problem.a}?`;
}

function nextDueRetry() {
  const ready = state.pendingRetries.find((item) => item.dueIn <= 0);
  if (!ready) return null;
  state.pendingRetries = state.pendingRetries.filter((item) => item !== ready);
  return ready.problem;
}

function tickRetries() {
  for (const item of state.pendingRetries) {
    item.dueIn -= 1;
  }
}

function enqueueRetry(problem) {
  const existing = state.pendingRetries.find((item) => item.problem.key === problem.key);
  if (existing) {
    existing.dueIn = 2;
    existing.problem.showHint = true;
    return;
  }
  state.pendingRetries.push({
    dueIn: 2,
    problem: { ...problem, showHint: true },
  });
}

function freshProblem() {
  for (let i = 0; i < 12; i += 1) {
    const problem = makeProblem();
    if (problem.text !== state.lastPrompt) return problem;
  }
  return makeProblem();
}

function showProblem(problem) {
  state.locked = false;
  state.current = problem;
  state.lastPrompt = problem.text;
  els.prompt.textContent = problem.text;
  els.kicker.textContent = problem.showHint ? "Try again" : "New";
  els.feedback.textContent = "";
  els.feedback.className = "feedback";
  els.card.classList.remove("is-good", "is-bad");
  els.answer.value = "";
  els.answer.focus();

  if (problem.showHint) {
    els.hint.hidden = false;
    els.hint.textContent = hintFor(problem);
  } else {
    els.hint.hidden = true;
    els.hint.textContent = "";
  }
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

function markWrong() {
  els.card.classList.remove("is-bad");
  void els.card.offsetWidth;
  els.card.classList.add("is-bad");
  els.feedback.className = "feedback bad";
  els.feedback.textContent = "Not yet — this one will come back soon";
}

function submitAnswer() {
  if (state.locked) return;
  const raw = els.answer.value.trim();
  if (raw === "") return;
  const value = Number(raw);
  if (!Number.isFinite(value)) return;
  state.locked = true;
  window.clearTimeout(state.nextTimer);

  const problem = state.current;
  const ok = value === problem.answer;

  state.stats.total += 1;
  if (ok) {
    state.stats.correct += 1;
    state.stats.streak += 1;
    state.stats.bestStreak = Math.max(state.stats.bestStreak, state.stats.streak);
    celebrate();
  } else {
    state.stats.streak = 0;
    enqueueRetry(problem);
    markWrong();
  }

  const upcoming = pickNextProblem();
  state.current = upcoming;
  state.lastPrompt = upcoming.text;
  saveProgress();
  renderStats();

  state.nextTimer = window.setTimeout(() => showProblem(upcoming), ok ? 650 : 900);
}

function syncPills() {
  document.querySelectorAll("[data-mode]").forEach((el) => {
    el.classList.toggle("is-on", el.dataset.mode === state.mode);
  });
  document.querySelectorAll("[data-level]").forEach((el) => {
    el.classList.toggle("is-on", el.dataset.level === state.level);
  });
}

document.querySelectorAll("[data-mode]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.mode = btn.dataset.mode;
    syncPills();
    saveProgress();
    nextCard();
  });
});

document.querySelectorAll("[data-level]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.level = btn.dataset.level;
    syncPills();
    saveProgress();
    nextCard();
  });
});

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
  } else if (els.answer.value.length < 4) {
    els.answer.value += key;
  }
  els.answer.focus();
});

els.reset.addEventListener("click", () => {
  window.clearTimeout(state.nextTimer);
  state.stats = emptyStats();
  state.pendingRetries = [];
  state.current = null;
  state.lastPrompt = "";
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
if (state.current) {
  showProblem(state.current);
} else {
  nextCard();
}
