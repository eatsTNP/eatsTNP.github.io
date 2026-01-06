/**
 * ✅ UX
 * (A) 채팅형 버튼 선택: 구 -> 동 -> 아파트 (선택할 때마다 내 말풍선)
 * (B) 하단 입력창에 아파트명(또는 별칭) 입력하면 바로 결과 출력(채팅 형식)
 *
 * ✅ 데이터는 Google Sheet(JSON)에서 읽어옵니다.
 * ✅ 시트 컬럼: gu, dong, apt, info, aliases
 */

// ===== Google Sheet API =====
const SHEET_API = "https://script.google.com/macros/s/AKfycbze48-AU36E1RkH8PujAg3NvvxsPCdKhw1jopInsVi_izPYB1pRfpMj7Af_FCDfE58AgA/exec";

let ROWS = [];                 // 시트 원본 rows
let APT_INDEX = new Map();     // normalize(name) -> row

async function loadSheetData() {
  const res = await fetch(SHEET_API);
  if (!res.ok) throw new Error("시트 데이터 로드 실패: " + res.status);
  ROWS = await res.json();
  buildIndex();
}

function buildIndex() {
  APT_INDEX.clear();

  ROWS.forEach((row) => {
    const apt = (row.apt || "").toString().trim();
    const aliases = (row.aliases || "").toString().trim();

    const names = [
      apt,
      ...aliases.split(",").map(s => s.trim()).filter(Boolean)
    ];

    names.forEach((name) => {
      const key = normalize(name);
      if (key) APT_INDEX.set(key, row);
    });
  });
}

// ===== DOM =====
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const resetBtn = document.getElementById("btnReset");
const datePill = document.getElementById("datePill");

// ===== State =====
const state = {
  selectedGu: null,
  selectedDong: null
};

// ===== Utils =====
function formatKoreanDate(d = new Date()) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function normalize(s) {
  return (s || "").toString().trim().toLowerCase().replace(/\s+/g, "");
}

function scrollToBottom() {
  chatEl.scrollTop = chatEl.scrollHeight;
}

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
  chatEl.appendChild(b);
  scrollToBottom();
}

function addMe(text) {
  const b = createBubble(text, "me");
  chatEl.appendChild(b);
  scrollToBottom();
}

// ===== Lookup: 입력으로 찾기 =====
function findByName(input) {
  const key = normalize(input);
  if (!key) return { type: "none" };

  // 1) 정확 매칭
  if (APT_INDEX.has(key)) {
    return { type: "hit", row: APT_INDEX.get(key) };
  }

  // 2) 부분 매칭 후보(최대 5개)
  const candidates = [];
  for (const [k, row] of APT_INDEX.entries()) {
    if (k.includes(key) || key.includes(k)) {
      candidates.push(row.apt);
    }
  }

  const uniq = [...new Set(candidates)].slice(0, 5);

  if (uniq.length === 1) {
    const row = APT_INDEX.get(normalize(uniq[0]));
    return { type: "hit", row, fuzzy: true };
  }

  if (uniq.length > 1) {
    return { type: "candidates", candidates: uniq };
  }

  return { type: "none" };
}

// ===== Guided flow: 구 -> 동 -> 아파트 =====
function startGuided() {
  state.selectedGu = null;
  state.selectedDong = null;

  const gus = [...new Set(ROWS.map(r => (r.gu || "").toString().trim()).filter(Boolean))];

  if (!gus.length) {
    addSys("구 목록이 비어 있어요. 시트 컬럼(gu)을 확인해 주세요.");
    return;
  }

  addSys("구를 선택해 주세요.", createQuickButtons(gus, pickGu));
}

function pickGu(gu) {
  state.selectedGu = gu;
  addMe(gu);

  const dongs = [...new Set(
    ROWS
      .filter(r => (r.gu || "").toString().trim() === gu)
      .map(r => (r.dong || "").toString().trim())
      .filter(Boolean)
  )];

  if (!dongs.length) {
    addSys("동 목록이 비어 있어요. 시트 컬럼(dong)을 확인해 주세요.");
    return;
  }

  addSys("동을 선택해 주세요.", createQuickButtons(dongs, pickDong));
}

function pickDong(dong) {
  state.selectedDong = dong;
  addMe(dong);

  const apts = ROWS
    .filter(r =>
      (r.gu || "").toString().trim() === state.selectedGu &&
      (r.dong || "").toString().trim() === dong
    )
    .map(r => (r.apt || "").toString().trim())
    .filter(Boolean);

  if (!apts.length) {
    addSys("아파트 목록이 비어 있어요. 시트 컬럼(apt)을 확인해 주세요.");
    return;
  }

  addSys("아파트를 선택해 주세요.", createQuickButtons(apts, pickApt));
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

  const info = (row.info || "").toString();
  addSys(`[${row.apt}]\n\n${info || "(등록된 info가 없어요)"}\n`);

  addSys("다시 조회할까요?", createQuickButtons(["선택해서 찾기", "그냥 입력하기"], (x) => {
    if (x === "선택해서 찾기") startGuided();
    else inputEl.focus();
  }));
}

// ===== Free text flow: 입력창으로 바로 조회 =====
function handleSend() {
  const msg = inputEl.value;
  if (!msg.trim()) return;

  addMe(msg);
  inputEl.value = "";

  if (!ROWS.length) {
    addSys("데이터가 아직 로드되지 않았어요. 잠시 후 다시 시도해 주세요.");
    return;
  }

  const res = findByName(msg);

  if (res.type === "hit") {
    const row = res.row;
    addSys(`[${row.apt}]${res.fuzzy ? " (유사 매칭)" : ""}\n\n${(row.info || "").toString()}`);
    return;
  }

  if (res.type === "candidates") {
    addSys("비슷한 아파트가 여러 개 있어요. 버튼으로 선택해 주세요.",
      createQuickButtons(res.candidates, (apt) => {
        addMe(apt);
        const row = APT_INDEX.get(normalize(apt));
        addSys(`[${row.apt}]\n\n${(row.info || "").toString()}`);
      })
    );
    return;
  }

  addSys("일치하는 아파트를 찾지 못했어요. (오타/띄어쓰기/별칭 확인)");
}

// ===== Reset =====
function resetAll() {
  chatEl.innerHTML = "";
  state.selectedGu = null;
  state.selectedDong = null;

  addSys(
    "원하는 방식으로 조회하세요.\n\n1) 버튼으로: 구 → 동 → 아파트\n2) 하단 입력창에 아파트명(또는 별칭) 입력",
    createQuickButtons(["선택해서 찾기"], () => startGuided())
  );

  scrollToBottom();
  setTimeout(() => inputEl.focus(), 100);
}

// ===== Events =====
sendBtn.addEventListener("click", handleSend);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSend();
});
resetBtn.addEventListener("click", resetAll);

// ===== Init =====
(async function init() {
  datePill.textContent = formatKoreanDate();
  try {
    await loadSheetData();  // ✅ 시트 로드 + 인덱스 빌드
    resetAll();
  } catch (err) {
    resetAll();
    addSys("시트 연동에 실패했어요.\n- SHEET_API 주소 확인\n- Apps Script 배포 권한(모든 사용자) 확인\n\n에러: " + String(err));
  }
})();
