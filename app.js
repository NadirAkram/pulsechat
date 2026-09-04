import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged 
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
  apiKey: "AIzaSyARVhfGqtjKL8X320Bf5KdRf2dloHP1XlA",
  authDomain: "pinktalk-app.firebaseapp.com",
  databaseURL: "https://pinktalk-app-default-rtdb.firebaseio.com",
  projectId: "pinktalk-app",
  storageBucket: "pinktalk-app.firebasestorage.app",
  messagingSenderId: "328850289956",
  appId: "1:328850289956:web:86c1e2f715f57abe5e6fb1"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// State variables
let currentUser = null;
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

// SVG Tick Helpers
const doubleTickSvg = (isRead) => `
  <span class="tick-svg ${isRead ? 'read' : 'delivered'}">
    <svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 6L7 17l-5-5"></path>
      <path d="M22 10l-7.5 7.5-1.5-1.5"></path>
    </svg>
  </span>
`;

// Helper for consistent chatId
function getChatId(uid1, uid2) {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

// ================= AUTHENTICATION =================
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  const rawId = usernameInput.value.trim().toLowerCase().replace(/\s+/g, '');
  const password = passwordInput.value;

  if (!rawId || password.length < 6) {
    authError.textContent = "Password must be at least 6 characters.";
    return;
  }

  const syntheticEmail = `${rawId}@pinktalk.app`;

  try {
    // Attempt login
    await signInWithEmailAndPassword(auth, syntheticEmail, password);
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try {
        // Auto-register new user
        const cred = await createUserWithEmailAndPassword(auth, syntheticEmail, password);
        await set(ref(db, `users/${cred.user.uid}`), {
          uid: cred.user.uid,
          username: rawId,
          online: true,
          lastSeen: serverTimestamp()
        });
      } catch (regErr) {
        authError.textContent = regErr.message;
      }
    } else {
      authError.textContent = err.message;
    }
  }
});

logoutBtn.addEventListener("click", async () => {
  if (currentUser) {
    await update(ref(db, `users/${currentUser.uid}`), {
      online: false,
      lastSeen: serverTimestamp()
    });
  }
  await signOut(auth);
});

// Auth state tracker
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const snap = await get(ref(db, `users/${user.uid}`));
    const profile = snap.val() || { username: user.email.split("@")[0] };

    currentUserName.textContent = profile.username;
    currentAvatar.textContent = profile.username.charAt(0).toUpperCase();

    // Presence management
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
    currentUser = null;
    appScreen.classList.remove("active");
    authScreen.classList.add("active");
  }
});

// ================= CONTACT LIST & UNREAD BADGES =================
function loadUsersList() {
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
  const filter = query.trim().toLowerCase();

  Object.values(usersData).forEach((u) => {
    if (u.uid === currentUser.uid) return;
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

    // Watch unread counter for this contact
    listenContactSummary(u.uid);
  });
}

function listenContactSummary(otherUid) {
  const chatId = getChatId(currentUser.uid, otherUid);
  const msgsRef = ref(db, `messages/${chatId}`);

  onValue(msgsRef, (snapshot) => {
    const msgs = snapshot.val();
    let unreadCount = 0;
    let lastText = "No messages";

    if (msgs) {
      const msgList = Object.values(msgs);
      lastText = msgList[msgList.length - 1].text;

      msgList.forEach((m) => {
        if (m.sender !== currentUser.uid && m.read === false) {
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

// ================= ACTIVE CHAT & MOBILE TRANSITION =================
function openChat(recipient) {
  activeRecipient = recipient;

  // Mobile navigation slide
  appLayout.classList.add("in-chat");

  recipientName.textContent = recipient.username;
  recipientAvatar.textContent = recipient.username.charAt(0).toUpperCase();

  // Clear unread badge immediately
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

// Presence & typing indicator
function listenRecipientPresence(otherUid) {
  currentStatusRef = ref(db, `users/${otherUid}`);
  const chatId = getChatId(currentUser.uid, otherUid);
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

// ================= DEDUPLICATED MESSAGE LISTENER =================
function listenMessages(otherUid) {
  const chatId = getChatId(currentUser.uid, otherUid);
  currentMessagesRef = ref(db, `messages/${chatId}`);

  onValue(currentMessagesRef, (snapshot) => {
    const msgs = snapshot.val();
    if (!msgs) {
      messagesList.innerHTML = "";
      return;
    }

    const unreadUpdates = {};

    Object.entries(msgs).forEach(([msgKey, msg]) => {
      const isMe = msg.sender === currentUser.uid;

      // Queue read receipts (without recursive firing)
      if (!isMe && msg.read === false) {
        unreadUpdates[`messages/${chatId}/${msgKey}/read`] = true;
      }

      // Check if message DOM node already exists (avoids duplication)
      let bubble = document.getElementById(`msg-${msgKey}`);
      if (bubble) {
        // Only update tick mark if delivery/read status changed
        const tickContainer = bubble.querySelector(".tick-svg");
        if (tickContainer && isMe) {
          if (msg.read) {
            tickContainer.className = "tick-svg read";
          } else {
            tickContainer.className = "tick-svg delivered";
          }
        }
      } else {
        // Create new bubble
        bubble = document.createElement("div");
        bubble.id = `msg-${msgKey}`;
        bubble.className = `bubble ${isMe ? 'sent' : 'received'}`;

        const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const ticksHtml = isMe ? doubleTickSvg(msg.read) : "";

        bubble.innerHTML = `
          <span>${escapeHtml(msg.text)}</span>
          <div class="bubble-meta">
            <span class="msg-time">${time}</span>
            ${ticksHtml}
          </div>
        `;
        messagesList.appendChild(bubble);
      }
    });

    // Execute atomic read update if any unread messages exist
    if (Object.keys(unreadUpdates).length > 0) {
      update(ref(db), unreadUpdates);
    }

    messagesViewport.scrollTop = messagesViewport.scrollHeight;
  });
}

// ================= SENDING & COMPOSER =================
async function sendMessage() {
  if (isSending) return;
  const text = messageInput.value.trim();
  if (!text || !activeRecipient) return;

  isSending = true;
  messageInput.value = "";
  setTyping(false);

  const chatId = getChatId(currentUser.uid, activeRecipient.uid);
  const msgsRef = ref(db, `messages/${chatId}`);

  try {
    await push(msgsRef, {
      sender: currentUser.uid,
      text: text,
      timestamp: Date.now(),
      read: false
    });
  } finally {
    isSending = false;
    messageInput.focus();
  }
}

sendBtn.addEventListener("click", sendMessage);

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    sendMessage();
  }
});

// Typing tracker
messageInput.addEventListener("input", () => {
  if (!activeRecipient) return;
  setTyping(true);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => setTyping(false), 2000);
});

function setTyping(isTyping) {
  if (!activeRecipient) return;
  const chatId = getChatId(currentUser.uid, activeRecipient.uid);
  set(ref(db, `typing/${chatId}/${currentUser.uid}`), isTyping);
}

// Emoji toggle
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
