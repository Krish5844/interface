const $ = (id) => document.getElementById(id);

const chatMessages = $("chatMessages");
const historyList = $("historyList");
const historySearch = $("historySearch");

const newChatBtn = $("newChatBtn");
const sidebarToggle = $("sidebarToggle");
const mobileSidebarToggle = $("mobileSidebarToggle");

const bottomInput = $("bottomInput");
const sendBtn = $("sendBtn");
const attachBtn = $("attachBtn");
const addBtn = $("addBtn");
const fileInput = $("fileInput");
const attachmentChipBottom = $("attachmentChipBottom");

const LS_KEY = "VOID_chats_v1";
let state = {
  chats: [],
  currentChatId: null,
  mode: "default",
  bottomAttachment: null,
  isReplyStreaming: false,
  uiMode: "home",
};

function uid(prefix = "m") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function safeTitleFromText(text) {
  const cleaned = (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  if (!cleaned) return "New chat";
  const parts = cleaned.split(" ");
  const take = parts.slice(0, 4).join(" ");
  return take.length ? take : "New chat";
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed?.chats?.length) return;
    state.chats = parsed.chats;
    state.currentChatId = parsed.currentChatId || parsed.chats[0].id;
  } catch {
    // If localStorage fails, we just start fresh.
  }
}

function persistState() {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        chats: state.chats,
        currentChatId: state.currentChatId,
      })
    );
  } catch {
    // ignore
  }
}

function ensureInitialChat() {
  if (state.chats.length) return;
  const id = uid("c");
  const chat = {
    id,
    title: "New chat",
    messages: [],
  };
  state.chats = [chat];
  state.currentChatId = id;
  persistState();
}

function getCurrentChat() {
  return state.chats.find((c) => c.id === state.currentChatId) || state.chats[0];
}

function renderHistory(filterText = "") {
  const normalized = (filterText || "").trim().toLowerCase();
  historyList.innerHTML = "";

  const chats = state.chats.filter((c) => c.title.toLowerCase().includes(normalized));
  chats.forEach((chat) => {
    const li = document.createElement("li");
    li.className = `history-item${chat.id === state.currentChatId ? " is-active" : ""}`;

    const titleSpan = document.createElement("span");
    titleSpan.className = "history-title";
    titleSpan.textContent = chat.title;

    // Even in collapsed mode we keep a stable focus target.
    const dot = document.createElement("span");
    dot.className = "history-dot";
    dot.textContent = "•";
    dot.style.color = "rgba(51,199,255,0.9)";
    dot.style.marginRight = "8px";
    li.appendChild(dot);
    li.appendChild(titleSpan);

    li.addEventListener("click", () => {
      state.currentChatId = chat.id;
      persistState();
      renderHistory(historySearch.value);
      renderMessages();
      applyUiMode(chat.messages?.length ? "chat" : "home");
    });

    historyList.appendChild(li);
  });
}

function renderMessages() {
  const chat = getCurrentChat();
  chatMessages.innerHTML = "";

  chat.messages.forEach((msg) => {
    chatMessages.appendChild(renderMessageNode(msg));
  });

  scrollChatToBottom();
}

function applyUiMode(mode) {
  state.uiMode = mode === "chat" ? "chat" : "home";
  document.body.classList.toggle("chat-mode", state.uiMode === "chat");

  if (state.uiMode === "chat") {
    window.setTimeout(() => {
      scrollChatToBottom();
      bottomInput.focus();
    }, 120);
  } else {
    window.setTimeout(() => bottomInput.focus(), 120);
  }
}

function scrollChatToBottom() {
  chatMessages.scrollTo({
    top: chatMessages.scrollHeight,
    behavior: "smooth",
  });
}

function renderMessageNode(msg) {
  const row = document.createElement("div");
  row.className = `bubble-row ${msg.role}`;

  const bubble = document.createElement("div");
  bubble.className = `bubble ${msg.role}`;

  const text = document.createElement("div");
  text.textContent = msg.text || "";
  bubble.appendChild(text);

  if (msg.attachments?.length) {
    const attachments = document.createElement("div");
    attachments.className = "attachments";
    msg.attachments.forEach((att) => {
      const pill = document.createElement("div");
      pill.className = "attachment-pill";
      pill.textContent = att.name;
      attachments.appendChild(pill);
    });
    bubble.appendChild(attachments);
  }

  row.appendChild(bubble);
  return row;
}

function appendUserMessage({ text, attachments }) {
  const chat = getCurrentChat();
  const userMsg = {
    id: uid("u"),
    role: "user",
    text: text || "",
    createdAt: Date.now(),
    attachments: attachments || [],
  };
  chat.messages.push(userMsg);
  persistState();
  chatMessages.appendChild(renderMessageNode(userMsg));
  scrollChatToBottom();
}

function streamAiReply({ seedText, attachments }) {
  const chat = getCurrentChat();
  const aiMsgId = uid("ai");

  const row = document.createElement("div");
  row.className = "bubble-row ai";

  const bubble = document.createElement("div");
  bubble.className = "bubble ai";

  const textWrap = document.createElement("div");
  const contentSpan = document.createElement("span");
  contentSpan.textContent = "";
  const caret = document.createElement("span");
  caret.className = "typing-caret";
  caret.textContent = "▍";
  textWrap.appendChild(contentSpan);
  textWrap.appendChild(caret);
  bubble.appendChild(textWrap);

  let attachmentsEl = null;
  if (attachments?.length) {
    attachmentsEl = document.createElement("div");
    attachmentsEl.className = "attachments";
    attachments.forEach((att) => {
      const pill = document.createElement("div");
      pill.className = "attachment-pill";
      pill.textContent = att.name;
      attachmentsEl.appendChild(pill);
    });
    bubble.appendChild(attachmentsEl);
  }

  row.appendChild(bubble);
  chatMessages.appendChild(row);
  scrollChatToBottom();

  state.isReplyStreaming = true;
  sendBtn.disabled = true;

  const full = generateVoidReply(seedText, state.mode, attachments);

  const aiMessage = {
    id: aiMsgId,
    role: "ai",
    text: "",
    createdAt: Date.now(),
    attachments: attachments || [],
  };
  chat.messages.push(aiMessage);
  persistState();

  const speedBase = 5; // lower is faster
  let i = 0;
  const interval = window.setInterval(() => {
    i = Math.min(i + Math.max(1, Math.floor(Math.random() * 4)), full.length);
    contentSpan.textContent = full.slice(0, i);
    if (i % 40 === 0) scrollChatToBottom();

    if (i >= full.length) {
      window.clearInterval(interval);
      aiMessage.text = full;
      state.isReplyStreaming = false;
      sendBtn.disabled = false;
      caret.remove();
      scrollChatToBottom();
    }
  }, speedBase);
}

function generateVoidReply(userText, mode, attachments) {
  const t = (userText || "").trim();
  const hasAttachment = !!attachments?.length;
  const attNames = attachments?.map((a) => a.name).join(", ") || "";

  const introByMode = {
    default: "Acknowledged.",
    craft: "Craft mode engaged.",
    rewrite: "Rewrite engine online.",
    plan: "Planning matrix activated.",
    analyze: "Analysis protocol started.",
  };

  const vibe = introByMode[mode] || introByMode.default;

  // Keep this frontend demo deterministic-ish without being repetitive.
  const lower = t.toLowerCase();
  const wantsPlan = /roadmap|plan|steps|milestone/i.test(t) || mode === "plan";
  const wantsRewrite = /rewrite|rephrase|improve|tone|clarity/i.test(t) || mode === "rewrite";
  const wantsAnalyze = /analy[sz]e|audit|review|evaluate/i.test(t) || mode === "analyze";

  const attachmentLine = hasAttachment
    ? `I also see your attachment: ${attNames}. I will tailor the response around it.`
    : "";

  if (t.length < 3 && !hasAttachment) {
    return "Give me a little more context (a goal, audience, or constraints) and I’ll lock onto the right direction.";
  }

  if (wantsRewrite) {
    return `${vibe}\n\nHere is a tighter version of your idea:\n\n“${t}”\n\nIf you share the target audience and desired tone (friendly, bold, technical), I can produce 2-3 variants. ${
      attachmentLine ? `\n\n${attachmentLine}` : ""
    }`;
  }

  if (wantsPlan) {
    return `${vibe}\n\nProposed plan (fast + practical):\n1) Define the outcome and success metric.\n2) List the key sections and interaction moments.\n3) Produce a clean UI layout (desktop first, then responsive).\n4) Add delightful micro-interactions (hover, focus, motion).\n5) Validate accessibility + polish.\n\nTell me your timeline (days/weeks) and I’ll turn this into a more specific checklist. ${
      attachmentLine ? `\n\n${attachmentLine}` : ""
    }`;
  }

  if (wantsAnalyze) {
    return `${vibe}\n\nWhat I would analyze in your request:\n- Clarity: does the UI communicate purpose instantly?\n- Structure: are components visually grouped and scannable?\n- Motion: are animations subtle and purposeful?\n- Contrast & readability: are glows used without hurting legibility?\n- Responsiveness: does layout adapt cleanly?\n\nReply with what’s currently not working, and I’ll propose targeted fixes. ${
      attachmentLine ? `\n\n${attachmentLine}` : ""
    }`;
  }

  const craftLine =
    mode === "craft"
      ? "I’ll focus on typography, spacing, and futuristic glass layers."
      : "I’ll propose a clean, premium layout with neon depth.";

  const base = `${vibe}\n\nYour request: “${t}”\n\n${craftLine}\n\nNext step: tell me 1) the target device (mobile/desktop/both) and 2) the top 2 sections you care about most. ${
    attachmentLine ? `\n\n${attachmentLine}` : ""
  }`;

  return base;
}

function setBottomAttachment(file) {
  state.bottomAttachment = file ? { name: file.name } : null;
  if (state.bottomAttachment) {
    attachmentChipBottom.textContent = `Attached: ${state.bottomAttachment.name}`;
    attachmentChipBottom.hidden = false;
  } else {
    attachmentChipBottom.hidden = true;
    attachmentChipBottom.textContent = "";
  }
}

function clearAttachments() {
  state.bottomAttachment = null;
  fileInput.value = "";
  setBottomAttachment(null);
}

function commitSend({ source }) {
  if (state.isReplyStreaming) return;
  const inputEl = bottomInput;
  const sendText = (inputEl.value || "").trim();
  const attachment = state.bottomAttachment;
  const attachments = attachment ? [attachment] : [];

  if (!sendText && attachments.length === 0) return;

  if (state.uiMode !== "chat") {
    applyUiMode("chat");
  }

  appendUserMessage({ text: sendText, attachments });
  inputEl.value = "";

  const userTextForReply = sendText || "Received an attachment—please analyze.";
  streamAiReply({ seedText: userTextForReply, attachments });

  setBottomAttachment(null);
  fileInput.value = "";
  state.bottomAttachment = null;
}

function initComposerEvents() {
  newChatBtn.addEventListener("click", () => {
    const id = uid("c");
    state.chats.unshift({
      id,
      title: "New chat",
      messages: [],
    });
    state.currentChatId = id;
    persistState();
    renderHistory(historySearch.value);
    renderMessages();
    clearAttachments();
    applyUiMode("home");
  });

  sidebarToggle.addEventListener("click", () => {
    document.body.classList.toggle("with-collapsed-sidebar");
  });

  if (mobileSidebarToggle) {
    mobileSidebarToggle.addEventListener("click", () => {
      document.body.classList.toggle("with-collapsed-sidebar");
    });
  }

  historySearch.addEventListener("input", (e) => {
    renderHistory(e.target.value);
  });

  attachBtn.addEventListener("click", () => fileInput.click());
  if (addBtn) addBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0] || null;
    setBottomAttachment(f);
  });

  sendBtn.addEventListener("click", () => commitSend({ source: "bottom" }));

  bottomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commitSend({ source: "bottom" });
  });
}

function wireChatTitleOnFirstUserMessage() {
  const observer = new MutationObserver(() => {
    const chat = getCurrentChat();
    if (!chat?.messages?.length) return;

    const hasUser = chat.messages.some((m) => m.role === "user");
    const firstUser = chat.messages.find((m) => m.role === "user");
    if (!hasUser || !firstUser) return;

    if (!chat.title || chat.title === "New chat") {
      chat.title = safeTitleFromText(firstUser.text);
      persistState();
      renderHistory(historySearch.value);
    }
  });

  observer.observe(chatMessages, { childList: true, subtree: true });
}

function initVoidTitleEntrance() {
  const el = document.getElementById("voidTitle");
  if (!el) return;
  const staggerSec = 0.12;
  const letterSec = 0.68;
  const n = el.querySelectorAll(".void-char").length || 4;
  const totalMs = Math.round(((n - 1) * staggerSec + letterSec) * 1000) + 24;
  window.setTimeout(() => {
    el.classList.add("void-title--ready");
    // Reinforce final state if the class is applied mid-frame.
    el.querySelectorAll(".void-char").forEach((c) => {
      c.style.opacity = "1";
      c.style.transform = "translateY(0)";
    });
  }, totalMs);
}

function boot() {
  loadState();
  ensureInitialChat();
  // Start with the sidebar off-canvas on small screens.
  if (window.matchMedia && window.matchMedia("(max-width: 980px)").matches) {
    document.body.classList.add("with-collapsed-sidebar");
  }
  initComposerEvents();
  renderHistory();
  renderMessages();
  applyUiMode("home");
  wireChatTitleOnFirstUserMessage();
  initVoidTitleEntrance();
}

boot();
