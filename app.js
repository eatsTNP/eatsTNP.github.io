// =====================================================
// 0) CONFIG
// =====================================================
const SHEET_API =
  "https://script.google.com/macros/s/AKfycbw_AfAAhUooWjVX0Jyne0B9M9_PdUHvg8UeKMNR05M1-A_J2SjHa9zwKrwpSdGsTR3tlw/exec";

// 캐시/로딩 UX 관련
const ENABLE_CACHE_BUST = true; // 즉시 반영 원하면 true
const SORT_LABELS = true;       // 버튼 목록 정렬

// =====================================================
// 1) DOM
// =====================================================
const el = {
  chat: document.getElementById("chat"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
  reset: document.getElementById("btnReset"),
  datePill: document.getElementById("datePill"),
};

// =====================================================
// 2) STATE + DATA
// =====================================================
const state = {
  selectedGu: null,
  selectedDong: null,
  isLoaded: false,
  isLoading: false,
};

let ROWS = [];               // 원본 rows
let APT_INDEX = new Map();   // normalize(name) -> row
let GROUPS = new Map();      // Map<gu, Map<dong, string[] apts>>
let loadPromise = null;      // ✅ 중복 로드 방지

// =====================================================
// 3) UTILS
// =====================================================
function formatKoreanDate(d = new Date()) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}
function normalize(s) {
  return (s || "").toString().trim().toLowerCase().replace(/\s+/g, "");
}
function uniq(arr) {
  return [...new Set(arr)];
}
function sortIfNeeded(arr) {
  return SORT_LABELS ? [...arr].sort((a, b) => a.localeCompare(b, "ko")) : arr;
}
function scrollToBottom() {
  el.chat.scrollTop = el.chat.scrollHeight;
}
// =====================================================
// 3-1)
// =====================================================
function findAptByUnit(unitInput) {
  const unit = parseInt(String(unitInput).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(unit)) return null;

  for (const row of ROWS) {
    if (!row.aliases) continue;

    // 예: "101-120,301-328"
    const ranges = String(row.aliases)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    for (const r of ranges) {
      const m = r.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!m) continue;

      const start = parseInt(m[1], 10);
      const end   = parseInt(m[2], 10);

      if (unit >= start && unit <= end) {
        return row.apt; // ✅ apt 반환
      }
    }
  }
  return null;
}
// =====================================================
// 4) UI (Chat render)
// =====================================================
function createBubble(text, who = "sys") {
  const bubble = document.createElement("article");
  bubble.className = `bubble ${who === "me" ? "bubble--me" : "bubble--sys"}`;
  bubble.textContent = text;
  return bubble;
}

function createQuickButtons(labels, onClick) {
  const wrap = document.createElement("div");
  wrap.className = "quick";

  labels.forEach((label) => {
    const btn = document.createElement("button");
    btn.className = "qbtn";
    btn.type = "button";
    btn.textContent = label;
    btn.addEventListener("click", () => onClick(label));
    wrap.appendChild(btn);
  });

  return wrap;
}

function addSys(text, buttons = null) {
  const b = createBubble(text, "sys");
  if (buttons) b.appendChild(buttons);
  el.chat.appendChild(b);
  scrollToBottom();
}

function addMe(text) {
  const b = createBubble(text, "me");
  el.chat.appendChild(b);
  scrollToBottom();
}

// =====================================================
// 5) DATA LOAD + INDEX (최적화 핵심)
// =====================================================
async function loadSheetDataOnce() {
  // ✅ 이미 로드 완료면 즉시 종료
  if (state.isLoaded) return true;

  // ✅ 이미 로드 중이면 같은 Promise 재사용
  if (loadPromise) return loadPromise;

  state.isLoading = true;

  loadPromise = (async () => {
    const url = ENABLE_CACHE_BUST ? `${SHEET_API}?t=${Date.now()}` : SHEET_API;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const rows = Array.isArray(json)
      ? json
      : (Array.isArray(json.data) ? json.data : null);

    if (!rows) throw new Error("시트 응답이 배열이 아닙니다.");

    ROWS = rows;
    buildIndexes(rows);

    state.isLoaded = true;
    state.isLoading = false;
    return true;
  })().catch((err) => {
    state.isLoaded = false;
    state.isLoading = false;
    loadPromise = null; // 다음 시도 가능
    throw err;
  });

  return loadPromise;
}

function buildIndexes(rows) {
  // 1) apt/alias 인덱스
  APT_INDEX = new Map();

  rows.forEach((row) => {
    const apt = (row.apt || "").toString().trim();
    const aliases = (row.aliases || "").toString().trim();

    const names = [
      apt,
      ...aliases.split(",").map(s => s.trim()).filter(Boolean),
    ];

    names.forEach((name) => {
      const key = normalize(name);
      if (key) APT_INDEX.set(key, row);
    });
  });

  // 2) 구->동->아파트 그룹
  GROUPS = new Map();

  rows.forEach((r) => {
    const gu = (r.gu || "").toString().trim();
    const dong = (r.dong || "").toString().trim();
    const apt = (r.apt || "").toString().trim();
    if (!gu || !dong || !apt) return;

    if (!GROUPS.has(gu)) GROUPS.set(gu, new Map());
    const dongMap = GROUPS.get(gu);

    if (!dongMap.has(dong)) dongMap.set(dong, []);
    dongMap.get(dong).push(apt);
  });

  // 중복 제거
  for (const [gu, dongMap] of GROUPS.entries()) {
    for (const [dong, apts] of dongMap.entries()) {
      dongMap.set(dong, uniq(apts));
    }
  }
}

// =====================================================
// 6) SEARCH (free text)
// =====================================================
function findByName(input) {
  const key = normalize(input);
  if (!key) return { type: "none" };

  // 1) 정확 매칭
  const exact = APT_INDEX.get(key);
  if (exact) return { type: "hit", row: exact };

  // 2) 부분 매칭 후보(최대 5개)
  const candidates = [];
  for (const [k, row] of APT_INDEX.entries()) {
    if (k.includes(key) || key.includes(k)) candidates.push(row.apt);
  }

  const uniqCandidates = uniq(candidates).slice(0, 5);

  if (uniqCandidates.length === 1) {
    const row = APT_INDEX.get(normalize(uniqCandidates[0]));
    return { type: "hit", row, fuzzy: true };
  }
  if (uniqCandidates.length > 1) {
    return { type: "candidates", candidates: uniqCandidates };
  }
  return { type: "none" };
}

function handleSend() {
  const msg = el.input.value;
  if (!msg.trim()) return;

  addMe(msg);
  el.input.value = "";

  if (!state.isLoaded) {
    addSys("데이터 로드 중입니다. 잠시 후 다시 시도해주세요.");
    return;
  }

// ✅ 1️⃣ 숫자만 입력 → 호수 검색
  if (/^\d+$/.test(msg.trim())) {
    const apt = findAptByUnit(msg);
    if (apt) {
      addSys(`[${apt}] 입니다`);
    } else {
      addSys("해당 호수를 찾지 못했어요.");
    }
    return;
  }

  const res = findByName(msg);

  if (res.type === "hit") {
    const row = res.row;
    const info = (row.info ?? row.txt ?? "").toString();
    addSys(`[${row.apt}]${res.fuzzy ? " (유사 매칭)" : ""}\n\n${info || "(등록된 내용이 없어요)"}`);
    return;
  }

  if (res.type === "candidates") {
    addSys(
      "비슷한 항목이 여러 개 있어요. 버튼으로 선택해 주세요.",
      createQuickButtons(res.candidates, (apt) => {
        addMe(apt);
        const row = APT_INDEX.get(normalize(apt));
        const info = (row?.info ?? row?.txt ?? "").toString();
        addSys(`[${row?.apt || apt}]\n\n${info || "(등록된 내용이 없어요)"}`);
      })
    );
    return;
  }

  addSys("일치하는 항목을 찾지 못했어요. (오타/띄어쓰기/별칭 확인)");
}

// =====================================================
// 7) GUIDED FLOW (구 -> 동 -> 아파트)
// =====================================================
function startGuided() {
  state.selectedGu = null;
  state.selectedDong = null;

  if (!state.isLoaded) {
    addSys("데이터 로드 중… ⏳");
    return;
  }

  const gus = sortIfNeeded([...GROUPS.keys()]);
  addSys("구를 선택해 주세요.", createQuickButtons(gus, pickGu));
}

function pickGu(gu) {
  state.selectedGu = gu;
  addMe(gu);

  const dongMap = GROUPS.get(gu);
  const dongs = dongMap ? sortIfNeeded([...dongMap.keys()]) : [];

  if (!dongs.length) {
    addSys("동 목록이 비어 있어요. 시트 데이터를 확인해 주세요.");
    return;
  }

  addSys("동을 선택해 주세요.", createQuickButtons(dongs, pickDong));
}

function pickDong(dong) {
  state.selectedDong = dong;
  addMe(dong);

  const dongMap = GROUPS.get(state.selectedGu);
  const apts = dongMap?.get(dong) || [];

  if (!apts.length) {
    addSys("아파트 목록이 비어 있어요. 시트 데이터를 확인해 주세요.");
    return;
  }

  addSys("아파트를 선택해 주세요.", createQuickButtons(sortIfNeeded(apts), pickApt));
}

function pickApt(apt) {
  addMe(apt);

  const row = ROWS.find(r =>
    (r.gu || "").toString().trim() === state.selectedGu &&
    (r.dong || "").toString().trim() === state.selectedDong &&
    (r.apt || "").toString().trim() === apt
  );

  if (!row) {
    addSys("정보를 찾지 못했어요. 다시 시도해 주세요.");
    return;
  }

  const info = (row.info ?? row.txt ?? "").toString();
  addSys(`[${row.apt}]\n\n${info || "(등록된 내용이 없어요)"}\n`);

  addSys(
    "다시 조회할까요?",
    createQuickButtons(["선택해서 찾기", "그냥 입력하기"], (x) => {
      if (x === "선택해서 찾기") startGuided();
      else el.input.focus();
    })
  );
}

// =====================================================
// 8) HOME / RESET (UX 순서 고정)
// =====================================================
function renderHome() {
  addSys(
    "원하는 방식으로 조회하세요.\n\n" +
    "1) 선택해서 찾기: 구 → 동 → 아파트\n" +
    "2) 하단 입력창에 아파트명(또는 별칭) 입력\n" +
    "3) 하단 입력창에 하이투모로 호수 입력",
    createQuickButtons(["선택해서 찾기"], startGuided)
  );
}

function renderLoading() {
  addSys("데이터 로드 중… ⏳");
}

/**
 * ✅ 초기화 UX:
 * - 로드 완료 후: 홈 안내 보여줌
 * - 로드 전/로딩 중: 로딩 문구 보여줌
 */
function resetAll() {
  el.chat.innerHTML = "";
  state.selectedGu = null;
  state.selectedDong = null;

  if (state.isLoaded) renderHome();
  else renderLoading();

  scrollToBottom();
  setTimeout(() => el.input.focus(), 100);
}

// =====================================================
// 9) EVENTS
// =====================================================
function bindEvents() {
  el.send.addEventListener("click", handleSend);
  el.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });

  // 초기화 버튼도 UX 유지 (로드 완료면 홈, 아니면 로딩)
  el.reset.addEventListener("click", resetAll);
}

// =====================================================
// 10) BOOT (로드 완료 → 안내 멘트 순서 고정)
// =====================================================
window.addEventListener("DOMContentLoaded", async () => {
  el.datePill.textContent = formatKoreanDate();
  bindEvents();

  // 0) 처음엔 로딩만 보여주기
  el.chat.innerHTML = "";
  renderLoading();

  try {
    // 1) 데이터 로드
    await loadSheetDataOnce();

    // 2) ✅ 로드 완료 → 홈 안내 순서
    el.chat.innerHTML = "";
    addSys("데이터 로드 완료 ✅");
    renderHome();

  } catch (err) {
    addSys(
      "시트 연동 실패 ❌\n" +
      "- SHEET_API 주소 확인\n" +
      "- Apps Script 웹앱 권한(모든 사용자)\n" +
      "- 시트 탭/응답 확인\n\n" +
      "에러: " + String(err)
    );
    console.error(err);
  }
});





