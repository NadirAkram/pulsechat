import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  update, 
  push, 
  onValue, 
  off,
  onDisconnect, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// ================= FIREBASE CONFIG =================
// Keep your Firebase project credentials here
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// State variables
let activeRecipient = null;
let currentMessagesRef = null;
let currentTypingRef = null;
let currentStatusRef = null;
let typingTimeout = null;
let isSending = false;

// DOM references
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const authForm = document.getElementById("auth-form");
const usernameInput = document.getElementById("auth-username");
const passwordInput = document.getElementById("auth-password");
const authProgress = document.getElementById("auth-progress");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authBtnText = document.getElementById("auth-btn-text");
const authError = document.getElementById("auth-error");
const logoutBtn = document.getElementById("logout-btn");

const appLayout = document.getElementById("app-layout");
const currentAvatar = document.getElementById("current-user-avatar");
const currentUserName = document.getElementById("current-user-name");
const searchInput = document.getElementById("search-input");
const usersList = document.getElementById("users-list");

const chatBackBtn = document.getElementById("chat-back-btn");
const recipientAvatar = document.getElementById("recipient-avatar");
const recipientName = document.getElementById("recipient-name");
const recipientStatus = document.getElementById("recipient-status");
const messagesViewport = document.getElementById("messages-viewport");
const messagesList = document.getElementById("messages-list");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const emojiToggleBtn = document.getElementById("emoji-toggle-btn");
const emojiPicker = document.getElementById("emoji-picker");

// SVG Double Tick Generator
const doubleTickSvg = (isRead) => `
  <span class="tick-svg ${isRead ? 'read' : 'delivered'}">
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 6L7 17l-5-5"></path>
      <path d="M22 10l-7.5 7.5-1.5-1.5"></path>
    </svg>
  </span>
`;

function getChatId(uid1, uid2) {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

function setAuthLoading(isLoading) {
  authSubmitBtn.disabled = isLoading;
  authProgress.style.display = isLoading ? "block" : "none";
  authBtnText.textContent = isLoading ? "Connecting..." : "Continue";
}

// ================= AUTHENTICATION =================
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";

  const rawId = usernameInput.value.trim().toLowerCase().replace(/\s+/g, '');
  const password = passwordInput.value;

  if (!rawId) {
    authError.textContent = "Please enter a valid User ID.";
    return;
  }
  if (password.length < 6) {
    authError.textContent = "Password must be at least 6 characters.";
    return;
  }

  setAuthLoading(true);
  const syntheticEmail = `${rawId}@pinktalk.app`;

  try {
    // Isolates sessions per tab to prevent multi-tab user collision on same device
    try {
      await setPersistence(auth, browserSessionPersistence);
    } catch (_) {
      // Fallback if browser policy restricts session persistence
    }

    // Attempt login
    await signInWithEmailAndPassword(auth, syntheticEmail, password);
  } catch (err) {
    if (
      err.code === "auth/user-not-found" || 
      err.code === "auth/invalid-credential" || 
      err.code === "auth/invalid-login-credentials"
    ) {
      try {
        // Auto-create account if user does not exist
        const cred = await createUserWithEmailAndPassword(auth, syntheticEmail, password);
        await set(ref(db, `users/${cred.user.uid}`), {
          uid: cred.user.uid,
          username: rawId,
          online: true,
          lastSeen: serverTimestamp()
        });
      } catch (regErr) {
        authError.textContent = regErr.message;
        setAuthLoading(false);
      }
    } else {
      authError.textContent = err.message;
      setAuthLoading(false);
    }
  }
});

logoutBtn.addEventListener("click", async () => {
  const currentUid = auth.currentUser?.uid;
  if (currentUid) {
    await update(ref(db, `users/${currentUid}`), {
      online: false,
      lastSeen: serverTimestamp()
    });
  }
  cleanupCurrentChat();
  await signOut(auth);
});

// Auth State Monitor
onAuthStateChanged(auth, async (user) => {
  setAuthLoading(false);

  if (user) {
    const snap = await get(ref(db, `users/${user.uid}`));
    const profile = snap.val() || { username: user.email.split("@")[0] };

    currentUserName.textContent = profile.username;
    currentAvatar.textContent = profile.username.charAt(0).toUpperCase();

    // Setup Presence
    const userRef = ref(db, `users/${user.uid}`);
    onDisconnect(userRef).update({
      online: false,
      lastSeen: serverTimestamp()
    });
    await update(userRef, { online: true });

    authScreen.classList.remove("active");
    appScreen.classList.add("active");
    loadUsersList();
  } else {
    appLayout.classList.remove("in-chat");
    appScreen.classList.remove("active");
    authScreen.classList.add("active");
    usersList.innerHTML = "";
  }
});

// ================= CONTACTS & UNREAD COUNTS =================
function loadUsersList() {
  const myUid = auth.currentUser?.uid;
  const usersRef = ref(db, "users");

  onValue(usersRef, (snapshot) => {
    const data = snapshot.val() || {};
    renderUsers(data, searchInput.value);

    searchInput.oninput = (e) => {
      renderUsers(data, e.target.value);
    };
  });
}

function renderUsers(usersData, query = "") {
  usersList.innerHTML = "";
  const myUid = auth.currentUser?.uid;
  const filter = query.trim().toLowerCase();

  Object.values(usersData).forEach((u) => {
    if (u.uid === myUid) return; // Prevent listing oneself
    if (filter && !u.username.toLowerCase().includes(filter)) return;

    const userDiv = document.createElement("div");
    userDiv.className = "contact-item";
    userDiv.id = `contact-${u.uid}`;

    userDiv.innerHTML = `
      <div class="avatar">${u.username.charAt(0).toUpperCase()}</div>
      <div class="contact-info">
        <div class="contact-top">
          <span class="contact-name">${u.username}</span>
        </div>
        <div class="contact-bottom">
          <span class="last-msg" id="preview-${u.uid}">No messages</span>
          <span class="unread-badge" id="badge-${u.uid}" style="display: none;">0</span>
        </div>
      </div>
    `;

    userDiv.addEventListener("click", () => openChat(u));
    usersList.appendChild(userDiv);

    listenContactSummary(u.uid);
  });
}

function listenContactSummary(otherUid) {
  const myUid = auth.currentUser?.uid;
  if (!myUid) return;

  const chatId = getChatId(myUid, otherUid);
  const msgsRef = ref(db, `messages/${chatId}`);

  onValue(msgsRef, (snapshot) => {
    const msgs = snapshot.val();
    let unreadCount = 0;
    let lastText = "No messages";

    if (msgs) {
      const msgList = Object.values(msgs);
      lastText = msgList[msgList.length - 1].text;

      msgList.forEach((m) => {
        if (m.sender !== myUid && m.read === false) {
          unreadCount++;
        }
      });
    }

    const badge = document.getElementById(`badge-${otherUid}`);
    const preview = document.getElementById(`preview-${otherUid}`);

    if (preview) preview.textContent = lastText;
    if (badge) {
      if (unreadCount > 0 && activeRecipient?.uid !== otherUid) {
        badge.textContent = unreadCount;
        badge.style.display = "flex";
      } else {
        badge.style.display = "none";
      }
    }
  });
}

// ================= CHAT CONVERSATION VIEW =================
function openChat(recipient) {
  activeRecipient = recipient;
  appLayout.classList.add("in-chat");

  recipientName.textContent = recipient.username;
  recipientAvatar.textContent = recipient.username.charAt(0).toUpperCase();

  const badge = document.getElementById(`badge-${recipient.uid}`);
  if (badge) badge.style.display = "none";

  cleanupCurrentChat();
  listenRecipientPresence(recipient.uid);
  listenMessages(recipient.uid);
}

chatBackBtn.addEventListener("click", () => {
  appLayout.classList.remove("in-chat");
  cleanupCurrentChat();
  activeRecipient = null;
});

function cleanupCurrentChat() {
  if (currentMessagesRef) off(currentMessagesRef);
  if (currentTypingRef) off(currentTypingRef);
  if (currentStatusRef) off(currentStatusRef);
  messagesList.innerHTML = "";
  typingIndicator.style.display = "none";
}

function listenRecipientPresence(otherUid) {
  const myUid = auth.currentUser?.uid;
  if (!myUid) return;

  currentStatusRef = ref(db, `users/${otherUid}`);
  const chatId = getChatId(myUid, otherUid);
  currentTypingRef = ref(db, `typing/${chatId}/${otherUid}`);

  onValue(currentStatusRef, (snap) => {
    const user = snap.val();
    if (!user) return;

    onValue(currentTypingRef, (typingSnap) => {
      const isTyping = typingSnap.val();
      if (isTyping) {
        recipientStatus.textContent = "typing...";
        typingIndicator.style.display = "flex";
        messagesViewport.scrollTop = messagesViewport.scrollHeight;
      } else {
        typingIndicator.style.display = "none";
        if (user.online) {
          recipientStatus.textContent = "Online";
        } else if (user.lastSeen) {
          const time = new Date(user.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          recipientStatus.textContent = `Last seen at ${time}`;
        } else {
          recipientStatus.textContent = "Offline";
        }
      }
    });
  });
}

// ================= STRICT SENDER-VERIFIED MESSAGE RENDERING =================
function listenMessages(otherUid) {
  const myUid = auth.currentUser?.uid;
  if (!myUid) return;

  const chatId = getChatId(myUid, otherUid);
  currentMessagesRef = ref(db, `messages/${chatId}`);

  onValue(currentMessagesRef, (snapshot) => {
    const msgs = snapshot.val();
    if (!msgs) {
      messagesList.innerHTML = "";
      return;
    }

    const unreadUpdates = {};

    Object.entries(msgs).forEach(([msgKey, msg]) => {
      // Deterministic evaluation: Is this my message or recipient's message?
      const isMe = String(msg.sender).trim() === String(myUid).trim();

      // Queue read-receipt update if message was sent to me
      if (!isMe && msg.read === false) {
        unreadUpdates[`messages/${chatId}/${msgKey}/read`] = true;
      }

      let bubble = document.getElementById(`msg-${msgKey}`);
      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      if (bubble) {
        // Force correct bubble class dynamically
        bubble.className = isMe ? "bubble sent" : "bubble received";

        const tickContainer = bubble.querySelector(".tick-svg");
        if (tickContainer && isMe) {
          tickContainer.className = `tick-svg ${msg.read ? 'read' : 'delivered'}`;
        }
      } else {
        bubble = document.createElement("div");
        bubble.id = `msg-${msgKey}`;
        bubble.className = isMe ? "bubble sent" : "bubble received";

        const senderHeader = !isMe ? `<span class="bubble-sender">${escapeHtml(activeRecipient.username)}</span>` : "";
        const ticksHtml = isMe ? doubleTickSvg(msg.read) : "";

        bubble.innerHTML = `
          ${senderHeader}
          <span>${escapeHtml(msg.text)}</span>
          <div class="bubble-meta">
            <span class="msg-time">${time}</span>
            ${ticksHtml}
          </div>
        `;
        messagesList.appendChild(bubble);
      }
    });

    if (Object.keys(unreadUpdates).length > 0) {
      update(ref(db), unreadUpdates);
    }

    messagesViewport.scrollTop = messagesViewport.scrollHeight;
  });
}

// ================= SENDING MESSAGES =================
async function sendMessage() {
  if (isSending) return;
  const myUid = auth.currentUser?.uid;
  const text = messageInput.value.trim();

  if (!text || !activeRecipient || !myUid) return;

  isSending = true;
  messageInput.value = "";
  setTyping(false);

  const chatId = getChatId(myUid, activeRecipient.uid);
  const msgsRef = ref(db, `messages/${chatId}`);

  try {
    await push(msgsRef, {
      sender: myUid,
      text: text,
      timestamp: Date.now(),
      read: false
    });
  } finally {
    isSending = false;
    messageInput.focus();
  }
}

sendBtn.addEventListener("click", (e) => {
  e.preventDefault();
  sendMessage();
});

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

// Typing Handler
messageInput.addEventListener("input", () => {
  if (!activeRecipient) return;
  setTyping(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => setTyping(false), 2000);
});

function setTyping(isTyping) {
  const myUid = auth.currentUser?.uid;
  if (!activeRecipient || !myUid) return;
  const chatId = getChatId(myUid, activeRecipient.uid);
  set(ref(db, `typing/${chatId}/${myUid}`), isTyping);
}

// Emoji Handling
emojiToggleBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  emojiPicker.classList.toggle("show");
});

emojiPicker.addEventListener("click", (e) => {
  if (e.target.tagName === "SPAN") {
    messageInput.value += e.target.textContent;
    emojiPicker.classList.remove("show");
    messageInput.focus();
  }
});

document.addEventListener("click", (e) => {
  if (!emojiPicker.contains(e.target) && e.target !== emojiToggleBtn) {
    emojiPicker.classList.remove("show");
  }
});

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}
