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
  onDisconnect, 
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-database.js";

// ================= FIREBASE CONFIG =================
// Replace placeholders with your Firebase credentials
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

// State
let currentUser = null;
let activeRecipient = null;
let messagesUnsubscribe = null;
let typingTimeout = null;

// DOM Elements
const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const authForm = document.getElementById("auth-form");
const usernameInput = document.getElementById("auth-username");
const passwordInput = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const logoutBtn = document.getElementById("logout-btn");

const currentAvatar = document.getElementById("current-user-avatar");
const currentUserName = document.getElementById("current-user-name");
const searchInput = document.getElementById("search-input");
const usersList = document.getElementById("users-list");

const appLayout = document.querySelector(".app-layout");
const emptyState = document.getElementById("empty-state");
const activeChat = document.getElementById("active-chat");
const chatBackBtn = document.getElementById("chat-back-btn");
const recipientAvatar = document.getElementById("recipient-avatar");
const recipientName = document.getElementById("recipient-name");
const recipientStatus = document.getElementById("recipient-status");
const messagesList = document.getElementById("messages-list");
const messagesViewport = document.getElementById("messages-viewport");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const typingIndicator = document.getElementById("typing-indicator");
const emojiToggleBtn = document.getElementById("emoji-toggle-btn");
const emojiPicker = document.getElementById("emoji-picker");

// ================= AUTH FLOW =================
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  const rawId = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  // Turn simple username into a standard email pattern
  const syntheticEmail = `${rawId}@pinktalk.app`;

  try {
    // Attempt Direct Login
    await signInWithEmailAndPassword(auth, syntheticEmail, password);
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try {
        // Auto-Register if Account Doesn't Exist
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

// Watch Auth Status
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    const snap = await get(ref(db, `users/${user.uid}`));
    const profile = snap.val() || { username: user.email.split("@")[0] };

    currentUserName.textContent = profile.username;
    currentAvatar.textContent = profile.username.charAt(0);

    // Track Presence
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

// ================= USERS & UNREAD COUNT =================
function getChatId(uid1, uid2) {
  return uid1 < uid2 ? `${uid1}_${uid2}` : `${uid2}_${uid1}`;
}

function loadUsersList() {
  const usersRef = ref(db, "users");
  onValue(usersRef, (snapshot) => {
    const data = snapshot.val() || {};
    renderUsers(data, searchInput.value);

    // Search Listener
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
    userDiv.className = `user-item ${activeRecipient?.uid === u.uid ? "active" : ""}`;
    userDiv.id = `user-item-${u.uid}`;

    userDiv.innerHTML = `
      <div class="avatar">${u.username.charAt(0)}</div>
      <div class="user-item-info">
        <div class="user-item-top">
          <span class="user-item-name">${u.username}</span>
        </div>
        <div class="user-item-bottom">
          <span class="last-msg-preview" id="preview-${u.uid}">...</span>
          <span class="unread-badge" id="badge-${u.uid}" style="display: none;">0</span>
        </div>
      </div>
    `;

    userDiv.addEventListener("click", () => openChat(u));
    usersList.appendChild(userDiv);

    // Track unread messages & preview
    attachUnreadListener(u.uid);
  });
}

function attachUnreadListener(otherUid) {
  const chatId = getChatId(currentUser.uid, otherUid);
  const msgsRef = ref(db, `messages/${chatId}`);

  onValue(msgsRef, (snapshot) => {
    const msgs = snapshot.val();
    let unreadCount = 0;
    let lastMessageText = "No messages";

    if (msgs) {
      const msgList = Object.values(msgs);
      lastMessageText = msgList[msgList.length - 1].text;

      msgList.forEach((m) => {
        if (m.sender !== currentUser.uid && m.read === false) {
          unreadCount++;
        }
      });
    }

    const badge = document.getElementById(`badge-${otherUid}`);
    const preview = document.getElementById(`preview-${otherUid}`);

    if (preview) preview.textContent = lastMessageText;
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

// ================= ACTIVE CHAT & STATUS =================
function openChat(recipient) {
  activeRecipient = recipient;
  emptyState.style.display = "none";
  activeChat.style.display = "flex";
  appLayout.classList.add("in-chat");

  recipientName.textContent = recipient.username;
  recipientAvatar.textContent = recipient.username.charAt(0);

  // Monitor Recipient Presence & Typing
  listenRecipientStatus(recipient.uid);
  listenMessages(recipient.uid);
}

chatBackBtn.addEventListener("click", () => {
  appLayout.classList.remove("in-chat");
  activeRecipient = null;
});

function listenRecipientStatus(otherUid) {
  const statusRef = ref(db, `users/${otherUid}`);
  onValue(statusRef, (snap) => {
    const user = snap.val();
    if (!user) return;

    const chatId = getChatId(currentUser.uid, otherUid);
    const typingRef = ref(db, `typing/${chatId}/${otherUid}`);

    onValue(typingRef, (typingSnap) => {
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

// ================= MESSAGING, READ TICKS & DELIVERY =================
function listenMessages(otherUid) {
  if (messagesUnsubscribe) messagesUnsubscribe();

  const chatId = getChatId(currentUser.uid, otherUid);
  const msgsRef = ref(db, `messages/${chatId}`);

  messagesUnsubscribe = onValue(msgsRef, (snapshot) => {
    messagesList.innerHTML = "";
    const msgs = snapshot.val();

    if (!msgs) return;

    Object.entries(msgs).forEach(([msgKey, msg]) => {
      // Mark as read if received by current user
      if (msg.sender !== currentUser.uid && msg.read === false) {
        update(ref(db, `messages/${chatId}/${msgKey}`), { read: true });
      }

      const bubble = document.createElement("div");
      const isMe = msg.sender === currentUser.uid;
      bubble.className = `message-bubble ${isMe ? "sent" : "received"}`;

      const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      // WhatsApp-Style Tick Representation
      let ticksHtml = "";
      if (isMe) {
        if (msg.read) {
          // Double Blue Tick
          ticksHtml = `<span class="tick-icon read">✓✓</span>`;
        } else {
          // Double Grey Tick (Delivered to Server)
          ticksHtml = `<span class="tick-icon">✓✓</span>`;
        }
      }

      bubble.innerHTML = `
        <div>${escapeHtml(msg.text)}</div>
        <div class="meta-info">
          <span class="timestamp">${time}</span>
          ${ticksHtml}
        </div>
      `;

      messagesList.appendChild(bubble);
    });

    messagesViewport.scrollTop = messagesViewport.scrollHeight;
  });
}

// Send Message
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !activeRecipient) return;

  const chatId = getChatId(currentUser.uid, activeRecipient.uid);
  const msgsRef = ref(db, `messages/${chatId}`);

  messageInput.value = "";
  setTyping(false);

  await push(msgsRef, {
    sender: currentUser.uid,
    text: text,
    timestamp: Date.now(),
    read: false
  });
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// Typing Handler
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

// Emoji Handling
emojiToggleBtn.addEventListener("click", () => {
  emojiPicker.classList.toggle("show");
});

emojiPicker.addEventListener("click", (e) => {
  if (e.target.tagName === "SPAN") {
    messageInput.value += e.target.textContent;
    emojiPicker.classList.remove("show");
    messageInput.focus();
  }
});

function escapeHtml(string) {
  const div = document.createElement("div");
  div.textContent = string;
  return div.innerHTML;
}
