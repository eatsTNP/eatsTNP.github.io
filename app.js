/**
 * ✅ 너가 원하는 UX
 * - (A) 채팅형 버튼 선택: 구 -> 동 -> 아파트
 *   버튼 누를 때마다 "내 말풍선"으로 선택값 출력
 *   다음 선택지는 "봇 말풍선 + 버튼"으로 출력
 *   마지막에 결과(코드 텍스트)를 봇 말풍선로 출력
 *
 * - (B) 하단 입력창에 "아파트명" 입력하면 바로 결과 출력(채팅 형식)
 *
 * ⚠️ 데이터는 예시. 나중에 엑셀/시트/DB로 교체 가능.
 */

// ===== 예시 데이터 =====

const SHEET_API = "https://script.google.com/macros/s/AKfycbze48-AU36E1RkH8PujAg3NvvxsPCdKhw1jopInsVi_izPYB1pRfpMj7Af_FCDfE58AgA/exec";

let ROWS = [];

async function loadSheetData() {
    const res = await fetch(SHEET_API);
    ROWS = await res.json();
}

// ===== DOM =====
const chatEl = document.getElementById("chat");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("send");
const resetBtn = document.getElementById("btnReset");
const datePill = document.getElementById("datePill");

// ===== State =====
const state = {
  step: "idle",        // idle | picking_gu | picking_dong | picking_apt
  selectedGu: null,
  selectedDong: null
};

// ===== Utils =====
function formatKoreanDate(d = new Date()) {
  return `${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일`;
}

function normalize(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, "");
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
  labels.forEach(label => {
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

// ===== Lookup helpers =====
function buildAptIndex() {
  // aptName (normalized) -> { gu, dong, apt, text }
  const idx = new Map();
  for (const gu of Object.keys(DATA)) {
    for (const dong of Object.keys(DATA[gu])) {
      for (const apt of Object.keys(DATA[gu][dong])) {
        idx.set(normalize(apt), { gu, dong, apt, text: DATA[gu][dong][apt] });
      }
    }
  }
  return idx;
}

const APT_INDEX = buildAptIndex();

function findAptByName(input) {
  const key = normalize(input);

  // 1) exact normalize match
  if (APT_INDEX.has(key)) return { type: "hit", ...APT_INDEX.get(key) };

  // 2) simple partial match suggestions (top 5)
  const candidates = [];
  for (const [k, v] of APT_INDEX.entries()) {
    if (k.includes(key) || key.includes(k)) candidates.push(v.apt);
  }
  const uniq = [...new Set(candidates)].slice(0, 5);
  if (uniq.length === 1) {
    const v = APT_INDEX.get(normalize(uniq[0]));
    return { type: "hit", ...v, fuzzy: true };
  }
  if (uniq.length > 1) return { type: "candidates", candidates: uniq };

  return { type: "none" };
}

// ===== Guided flow (구 -> 동 -> 아파트) =====
function startGuided() {
  state.step = "picking_gu";
  state.selectedGu = null;
  state.selectedDong = null;

  const gus = Object.keys(DATA);
  addSys("구를 선택해 주세요.", createQuickButtons(gus, (gu) => pickGu(gu)));
}

function pickGu(gu) {
  state.selectedGu = gu;
  state.step = "picking_dong";
  addMe(gu);

  const dongs = Object.keys(DATA[gu] || {});
  addSys("동을 선택해 주세요.", createQuickButtons(dongs, (dong) => pickDong(dong)));
}

function pickDong(dong) {
  state.selectedDong = dong;
  state.step = "picking_apt";
  addMe(dong);

  const apts = Object.keys((DATA[state.selectedGu] || {})[dong] || {});
  addSys("아파트를 선택해 주세요.", createQuickButtons(apts, (apt) => pickApt(apt)));
}

function pickApt(apt) {
  addMe(apt);

  const text = (DATA[state.selectedGu] || {})[state.selectedDong]?.[apt];
  if (!text) {
    addSys("정보를 찾지 못했어요. 다시 시도해 주세요.");
    state.step = "idle";
    return;
  }

  addSys(`[${apt}]\n\n${text}`);

  // 다음 행동 제안
  state.step = "idle";
  addSys("다시 조회할까요?", createQuickButtons(["선택해서 찾기", "그냥 입력하기"], (x) => {
    if (x === "선택해서 찾기") startGuided();
    else inputEl.focus();
  }));
}

// ===== Free text flow (아파트명 입력) =====
function handleSend() {
  const msg = inputEl.value;
  if (!msg.trim()) return;

  addMe(msg);
  inputEl.value = "";

  const res = findAptByName(msg);

  if (res.type === "hit") {
    addSys(`[${res.apt}]${res.fuzzy ? " (유사 매칭)" : ""}\n\n${res.text}`);
    return;
  }

  if (res.type === "candidates") {
    addSys("비슷한 아파트가 여러 개 있어요. 버튼으로 선택해 주세요.", createQuickButtons(res.candidates, (apt) => {
      // 버튼 선택도 “내 말풍선”으로 찍히게
      addMe(apt);
      const hit = APT_INDEX.get(normalize(apt));
      addSys(`[${hit.apt}]\n\n${hit.text}`);
    }));
    return;
  }

  addSys("일치하는 아파트를 찾지 못했어요. (오타/띄어쓰기 확인)");
}

// ===== Reset =====
function resetAll() {
  chatEl.innerHTML = "";
  state.step = "idle";
  state.selectedGu = null;
  state.selectedDong = null;

  addSys(
    "원하는 방식으로 조회하세요.\n\n1) 아래 버튼으로: 구 → 동 → 아파트\n2) 하단 입력창에 아파트명 바로 입력",
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
  await loadSheetData();   // ✅ 여기
  resetAll();
})();
