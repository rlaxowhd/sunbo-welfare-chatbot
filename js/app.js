// Main Application Logic
// Handles: Supabase Auth/DB Integration, STT (Speech-to-Text), TTS (Text-to-Speech), Chatbot RAG, Admin Dashboard

let supabaseClient = null;
let currentUser = null;
let currentRole = "user"; // 'user' or 'admin'
let recognition = null;
let isRecording = false;
let speechSynth = window.speechSynthesis;
let currentUtterance = null;
let ttsEnabled = true;

// Initialize Supabase
function initSupabase() {
  const config = window.APP_CONFIG || {};
  if (window.supabase && config.SUPABASE_URL && config.SUPABASE_ANON_KEY && !config.SUPABASE_URL.includes("YOUR_PROJECT_ID")) {
    try {
      supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
      console.log("Supabase Client initialized successfully.");
    } catch (e) {
      console.warn("Supabase initialization failed, falling back to LocalStorage demo mode.", e);
    }
  } else {
    console.info("Supabase is in Demo/LocalStorage mode. Update js/config.js with your project credentials to connect real Supabase.");
  }
}

// LocalStorage helpers for mock DB when Supabase credentials are placeholders
const LOCAL_DB = {
  getLogs: () => JSON.parse(localStorage.getItem("sb_chat_logs") || "[]"),
  addLog: (log) => {
    const logs = LOCAL_DB.getLogs();
    logs.unshift(log);
    localStorage.setItem("sb_chat_logs", JSON.stringify(logs.slice(0, 500)));
  },
  getUsers: () => JSON.parse(localStorage.getItem("sb_users") || "[]"),
  addUser: (user) => {
    const users = LOCAL_DB.getUsers();
    users.unshift(user);
    localStorage.setItem("sb_users", JSON.stringify(users.slice(0, 200)));
  }
};

// Seed initial logs if empty
if (LOCAL_DB.getLogs().length === 0) {
  const initialSeeds = [
    { id: 1, user_email: "hong@sunbo.co.kr", query: "자녀 대학교 입학 축하금은 얼마인가요?", answer: "자녀 대학교 입학 축하금은 3,000,000원입니다.", category: "교육/가족", created_at: new Date(Date.now() - 3600000 * 5).toISOString() },
    { id: 2, user_email: "kim@sunbo.co.kr", query: "의료비 지원 한도 알려줘", answer: "본인은 연간 500만원(50만원 초과분), 가족은 인당 300만원 한도로 지원됩니다.", category: "건강/의료", created_at: new Date(Date.now() - 3600000 * 2).toISOString() },
    { id: 3, user_email: "park@sunbo.co.kr", query: "가정의 날 조기퇴근 시간", answer: "매주 월, 수, 금요일 17시에 조기퇴근합니다.", category: "일생활균형", created_at: new Date(Date.now() - 3600000 * 1).toISOString() }
  ];
  localStorage.setItem("sb_chat_logs", JSON.stringify(initialSeeds));
}

// ---------------- STT Setup ----------------
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("Speech Recognition not supported in this browser.");
    return false;
  }
  recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    updateMicStatus(true);
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    document.getElementById("chat-input").value = transcript;
    sendChatMessage(transcript);
  };

  recognition.onerror = (event) => {
    console.error("STT Error:", event.error);
    isRecording = false;
    updateMicStatus(false);
    showToast("음성 인식 오류가 발생했습니다: " + event.error);
  };

  recognition.onend = () => {
    isRecording = false;
    updateMicStatus(false);
  };

  return true;
}

function updateMicStatus(active) {
  const micBtn = document.getElementById("mic-btn");
  const micIndicator = document.getElementById("mic-indicator");
  if (!micBtn) return;
  if (active) {
    micBtn.classList.add("recording");
    if (micIndicator) micIndicator.style.display = "flex";
  } else {
    micBtn.classList.remove("recording");
    if (micIndicator) micIndicator.style.display = "none";
  }
}

function toggleSpeechRecognition() {
  if (!recognition && !initSpeechRecognition()) {
    alert("현재 브라우저에서 마이크 음성 인식을 지원하지 않습니다. Chrome 또는 Edge 브라우저를 권장합니다.");
    return;
  }
  if (isRecording) {
    recognition.stop();
  } else {
    stopTTS();
    try {
      recognition.start();
    } catch (e) {
      console.warn("Recognition already started or error:", e);
    }
  }
}

// ---------------- TTS Setup ----------------
function speakText(text) {
  if (!ttsEnabled || !speechSynth) return;
  stopTTS();

  // Clean markdown syntax for speech
  const cleanText = text
    .replace(/[•\*\#\_\`]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/\n+/g, " ")
    .trim();

  currentUtterance = new SpeechSynthesisUtterance(cleanText);
  currentUtterance.lang = "ko-KR";
  currentUtterance.rate = 1.05;
  currentUtterance.pitch = 1.0;

  // Select Korean voice if available
  const voices = speechSynth.getVoices();
  const koVoice = voices.find(v => v.lang.includes("ko") || v.lang.includes("KR"));
  if (koVoice) currentUtterance.voice = koVoice;

  currentUtterance.onstart = () => {
    document.getElementById("tts-indicator")?.classList.add("speaking");
  };
  currentUtterance.onend = () => {
    document.getElementById("tts-indicator")?.classList.remove("speaking");
  };
  currentUtterance.onerror = () => {
    document.getElementById("tts-indicator")?.classList.remove("speaking");
  };

  speechSynth.speak(currentUtterance);
}

function stopTTS() {
  if (speechSynth && speechSynth.speaking) {
    speechSynth.cancel();
  }
  document.getElementById("tts-indicator")?.classList.remove("speaking");
}

// ---------------- Knowledge Base Search (RAG Engine) ----------------
function searchWelfareDB(query) {
  const terms = query.toLowerCase().trim().split(/\s+/);
  const data = window.WELFARE_DATA || [];
  
  let bestMatch = null;
  let highestScore = 0;

  for (const item of data) {
    let score = 0;
    // Check in keywords
    for (const kw of item.keywords) {
      for (const t of terms) {
        if (t.includes(kw) || kw.includes(t)) {
          score += 4;
        }
      }
    }
    // Check in title
    for (const t of terms) {
      if (item.title.toLowerCase().includes(t)) score += 3;
    }
    // Check in details
    for (const t of terms) {
      if (t.length > 1 && item.details.toLowerCase().includes(t)) score += 1;
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = item;
    }
  }

  if (highestScore >= 3 && bestMatch) {
    return {
      category: bestMatch.category,
      title: bestMatch.title,
      text: `**[${bestMatch.title}]**\n${bestMatch.details.trim()}`,
      found: true
    };
  }

  // Fallback response with helpful guide
  return {
    category: "기타/일반문의",
    title: "안내",
    text: `질문하신 내용과 꼭 일치하는 복지 항목을 찾지 못했습니다.\n\n• **추천 검색어 예시**: 의료비 지원, 건강검진 대상, 난임시술비, 자녀 대학등록금, 초중고 입학축하금, 경조사비, 장기근속 포상, 가정의 날 조기퇴근, 복지수당 신청, 휴양사택, 주택마련 대출 등\n• 구체적인 담당부서 안내는 **재무인사팀** 또는 **총무팀**으로 문의해 주시기 바랍니다.`,
    found: false
  };
}

// ---------------- Chat UI & Message Handling ----------------
function appendMessage(sender, text, category = "") {
  const chatMessages = document.getElementById("chat-messages");
  const msgDiv = document.createElement("div");
  msgDiv.className = `message ${sender}-message`;

  const timeStr = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });

  let badgeHtml = category ? `<span class="badge category-badge">${category}</span>` : "";
  let soundBtnHtml = sender === "bot" ? `<button class="sound-repeat-btn" onclick="speakText(this.getAttribute('data-text'))" data-text="${text.replace(/"/g, '&quot;')}"><i class="fas fa-volume-up"></i></button>` : "";

  // Convert simple markdown to HTML
  let formattedText = text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");

  msgDiv.innerHTML = `
    <div class="message-bubble">
      ${badgeHtml}
      <div class="message-content">${formattedText}</div>
      <div class="message-meta">
        <span class="time">${timeStr}</span>
        ${soundBtnHtml}
      </div>
    </div>
  `;

  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function sendChatMessage(overrideQuery = null) {
  const inputEl = document.getElementById("chat-input");
  const query = (overrideQuery || inputEl.value).trim();
  if (!query) return;

  // Clear input
  if (!overrideQuery) inputEl.value = "";

  // Render User Message
  appendMessage("user", query);

  // Show Typing Indicator
  const typingEl = document.getElementById("typing-indicator");
  if (typingEl) typingEl.style.display = "flex";

  // Simulate thinking delay for natural feel
  setTimeout(async () => {
    const result = searchWelfareDB(query);
    if (typingEl) typingEl.style.display = "none";

    appendMessage("bot", result.text, result.category);

    // Speak response via TTS
    speakText(result.text);

    // Save Log to Supabase or LocalStorage
    saveInteractionLog({
      user_email: currentUser ? currentUser.email : "guest@sunbo.co.kr",
      user_name: currentUser ? currentUser.name : "익명 임직원",
      query: query,
      answer: result.text.substring(0, 150) + "...",
      category: result.category,
      created_at: new Date().toISOString()
    });
  }, 450);
}

// ---------------- Log Saving & Supabase Sync ----------------
async function saveInteractionLog(logData) {
  LOCAL_DB.addLog(logData);

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient.from("chat_logs").insert([logData]);
      if (error) console.warn("Supabase log insert error:", error);
    } catch (e) {
      console.error("Supabase insert exception:", e);
    }
  }

  // If currently on admin analytics tab, refresh
  if (currentRole === "admin" && document.getElementById("admin-view")?.style.display !== "none") {
    loadAdminAnalytics();
  }
}

// ---------------- Auth Logic ----------------
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value.trim();
  const role = document.querySelector('input[name="login-role"]:checked')?.value || "user";

  if (!email) {
    alert("이메일을 입력해 주세요.");
    return;
  }

  // Supabase Auth attempt if configured
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (!error && data?.user) {
        currentUser = { email: data.user.email, name: email.split("@")[0], role: role };
      }
    } catch (err) {
      console.warn("Supabase Auth not configured, continuing with mock user login.", err);
    }
  }

  // Fallback to local session
  if (!currentUser) {
    currentUser = {
      email: email,
      name: email.split("@")[0],
      role: role
    };
  }

  currentRole = role;
  LOCAL_DB.addUser({
    email: currentUser.email,
    name: currentUser.name,
    role: currentRole,
    login_time: new Date().toISOString()
  });

  applyUserSession();
}

function handleGuestLogin() {
  currentUser = { email: "employee@sunbo.co.kr", name: "선보가족", role: "user" };
  currentRole = "user";
  applyUserSession();
}

function handleAdminQuickLogin() {
  currentUser = { email: "admin@sunbo.co.kr", name: "최고관리자", role: "admin" };
  currentRole = "admin";
  applyUserSession();
}

function applyUserSession() {
  document.getElementById("auth-modal").style.display = "none";
  document.getElementById("user-profile-badge").style.display = "flex";
  document.getElementById("user-display-name").innerText = `${currentUser.name} (${currentRole === 'admin' ? '관리자' : '임직원'})`;

  if (currentRole === "admin") {
    document.getElementById("admin-nav-btn").style.display = "inline-flex";
    showToast("관리자 권한으로 로그인되었습니다. 관리자 분석 탭을 이용할 수 있습니다.");
  } else {
    document.getElementById("admin-nav-btn").style.display = "none";
    showToast(`${currentUser.name}님 환영합니다! 복지 가이드 챗봇에 무엇이든 물어보세요.`);
  }

  switchView("chat");
}

function handleLogout() {
  currentUser = null;
  currentRole = "user";
  document.getElementById("user-profile-badge").style.display = "none";
  document.getElementById("admin-nav-btn").style.display = "none";
  document.getElementById("auth-modal").style.display = "flex";
  switchView("chat");
  showToast("로그아웃 되었습니다.");
}

function switchView(viewName) {
  const chatView = document.getElementById("chat-view");
  const adminView = document.getElementById("admin-view");
  const navChat = document.getElementById("nav-chat-btn");
  const navAdmin = document.getElementById("admin-nav-btn");

  if (viewName === "admin") {
    if (currentRole !== "admin") {
      alert("관리자만 접근할 수 있는 페이지입니다.");
      return;
    }
    chatView.style.display = "none";
    adminView.style.display = "block";
    navChat?.classList.remove("active");
    navAdmin?.classList.add("active");
    loadAdminAnalytics();
  } else {
    chatView.style.display = "flex";
    adminView.style.display = "none";
    navChat?.classList.add("active");
    navAdmin?.classList.remove("active");
  }
}

// ---------------- Admin Analytics Dashboard ----------------
async function loadAdminAnalytics() {
  let logs = [];

  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.from("chat_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (!error && data) logs = data;
    } catch (e) {
      console.warn("Could not fetch from Supabase, using Local DB:", e);
    }
  }

  if (logs.length === 0) {
    logs = LOCAL_DB.getLogs();
  }

  const users = LOCAL_DB.getUsers();

  // Metrics calculation
  document.getElementById("metric-total-queries").innerText = logs.length;
  document.getElementById("metric-total-users").innerText = Math.max(users.length, new Set(logs.map(l => l.user_email)).size);

  // Category distribution
  const catCount = {};
  logs.forEach(l => {
    const c = l.category || "기타/일반문의";
    catCount[c] = (catCount[c] || 0) + 1;
  });

  const topCategory = Object.entries(catCount).sort((a, b) => b[1] - a[1])[0];
  document.getElementById("metric-top-category").innerText = topCategory ? `${topCategory[0]} (${topCategory[1]}회)` : "-";

  // Render Category Breakdown Bars
  const catListEl = document.getElementById("category-stats-list");
  if (catListEl) {
    catListEl.innerHTML = "";
    const sortedCats = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
    sortedCats.forEach(([cat, count]) => {
      const pct = Math.round((count / (logs.length || 1)) * 100);
      const row = document.createElement("div");
      row.className = "cat-bar-item";
      row.innerHTML = `
        <div class="cat-bar-header">
          <span>${cat}</span>
          <span><strong>${count}건</strong> (${pct}%)</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: ${pct}%"></div>
        </div>
      `;
      catListEl.appendChild(row);
    });
  }

  // Render Recent Logs Table
  const tbody = document.getElementById("logs-table-body");
  if (tbody) {
    tbody.innerHTML = "";
    logs.slice(0, 30).forEach(l => {
      const tr = document.createElement("tr");
      const dateStr = new Date(l.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      tr.innerHTML = `
        <td><span class="timestamp">${dateStr}</span></td>
        <td><strong>${l.user_email || "임직원"}</strong></td>
        <td><span class="badge ${getBadgeClass(l.category)}">${l.category}</span></td>
        <td class="query-cell">${escapeHtml(l.query)}</td>
        <td class="answer-cell">${escapeHtml(l.answer || "-")}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function getBadgeClass(cat) {
  if (!cat) return "category-badge";
  if (cat.includes("건강")) return "badge-health";
  if (cat.includes("교육")) return "badge-edu";
  if (cat.includes("경조사")) return "badge-life";
  if (cat.includes("워라밸") || cat.includes("일생활")) return "badge-worklife";
  if (cat.includes("복지수당")) return "badge-welfare";
  return "category-badge";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function showToast(msg) {
  let toast = document.getElementById("toast-msg");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast-msg";
    document.body.appendChild(toast);
  }
  toast.innerText = msg;
  toast.className = "show";
  setTimeout(() => { toast.className = toast.className.replace("show", ""); }, 3000);
}

// ---------------- Initialize on DOM Load ----------------
document.addEventListener("DOMContentLoaded", () => {
  initSupabase();

  // STT Toggle
  document.getElementById("mic-btn")?.addEventListener("click", toggleSpeechRecognition);

  // Send message on Enter or Button click
  document.getElementById("send-btn")?.addEventListener("click", () => sendChatMessage());
  document.getElementById("chat-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  // TTS Toggle Switch
  document.getElementById("tts-toggle-btn")?.addEventListener("click", () => {
    ttsEnabled = !ttsEnabled;
    const btn = document.getElementById("tts-toggle-btn");
    if (ttsEnabled) {
      btn.innerHTML = '<i class="fas fa-volume-up"></i> 음성출력 켜짐';
      btn.classList.add("btn-primary");
      btn.classList.remove("btn-secondary");
      showToast("음성 답변(TTS)이 켜졌습니다.");
    } else {
      stopTTS();
      btn.innerHTML = '<i class="fas fa-volume-mute"></i> 음성출력 꺼짐';
      btn.classList.remove("btn-primary");
      btn.classList.add("btn-secondary");
      showToast("음성 답변(TTS)이 꺼졌습니다.");
    }
  });

  // Quick chips click
  document.querySelectorAll(".quick-chip").forEach(chip => {
    chip.addEventListener("click", function() {
      const q = this.getAttribute("data-query");
      sendChatMessage(q);
    });
  });

  // Auth events
  document.getElementById("login-form")?.addEventListener("submit", handleLogin);
  document.getElementById("guest-login-btn")?.addEventListener("click", handleGuestLogin);
  document.getElementById("admin-quick-btn")?.addEventListener("click", handleAdminQuickLogin);
  document.getElementById("logout-btn")?.addEventListener("click", handleLogout);

  // Navigation
  document.getElementById("nav-chat-btn")?.addEventListener("click", () => switchView("chat"));
  document.getElementById("admin-nav-btn")?.addEventListener("click", () => switchView("admin"));

  // Check speech recognition capability
  initSpeechRecognition();
});
