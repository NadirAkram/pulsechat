const BACKEND_URL = "https://pulsechat-backend-6q1l.onrender.com";

let socket = null;
let currentUser = null;
let selectedContact = null;
let activeUsers = [];
let typingTimeout = null;

// Unread messages map: { "nadir2": 3, "check": 1 }
let unreadCounts = {};

// DOM Elements
const authModal = document.getElementById('authModal');
const usernameInput = document.getElementById('usernameInput');
const loginBtn = document.getElementById('loginBtn');
const authError = document.getElementById('authError');
const myAvatar = document.getElementById('myAvatar');
const myIdDisplay = document.getElementById('myIdDisplay');
const usersList = document.getElementById('usersList');
const searchUser = document.getElementById('searchUser');
const appShell = document.getElementById('appShell');
const backBtn = document.getElementById('backBtn');
const chatWithUser = document.getElementById('chatWithUser');
const chatAvatar = document.getElementById('chatAvatar');
const chatUserStatus = document.getElementById('chatUserStatus');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typingIndicator');
const typingLabel = document.getElementById('typingLabel');
const emojiDrawer = document.getElementById('emojiDrawer');
const emojiToggleBtn = document.getElementById('emojiToggleBtn');

function connectSocket() {
  socket = io(BACKEND_URL);

  socket.on('connect', () => {
    socket.emit('register_session', currentUser);
  });

  socket.on('user_directory', (roster) => {
    activeUsers = roster;
    renderUserList(searchUser.value);
  });

  socket.on('presence_change', (data) => {
    const idx = activeUsers.findIndex(u => u.id === data.userId);
    if (idx !== -1) {
      activeUsers[idx].is_online = data.isOnline ? 1 : 0;
      activeUsers[idx].last_seen = data.lastSeen;
    } else if (data.userId !== currentUser) {
      activeUsers.push({ id: data.userId, is_online: data.isOnline ? 1 : 0, last_seen: data.lastSeen });
    }
    renderUserList(searchUser.value);
    if (selectedContact === data.userId) updateChatHeaderPresence();
  });

  socket.on('new_message', (msg) => {
    if (selectedContact === msg.senderId) {
      appendMessageBubble(msg, false);
      socket.emit('mark_read', { contactId: msg.senderId });
    } else {
      // In WhatsApp style: increment unread count for this sender
      unreadCounts[msg.senderId] = (unreadCounts[msg.senderId] || 0) + 1;
      localStorage.setItem('pulse_unread_' + currentUser, JSON.stringify(unreadCounts));
      renderUserList(searchUser.value);
    }
  });

  socket.on('message_ack', ({ id, status }) => {
    updateTickDisplay(id, status);
  });

  socket.on('messages_read_receipt', ({ by, messageIds }) => {
    if (selectedContact === by) {
      messageIds.forEach(id => updateTickDisplay(id, 'read'));
    }
  });

  socket.on('user_typing', ({ senderId, isTyping }) => {
    if (selectedContact === senderId) {
      if (isTyping) {
        typingLabel.innerText = `${senderId} is typing...`;
        typingIndicator.style.display = 'flex';
        scrollToBottom();
      } else {
        typingIndicator.style.display = 'none';
      }
    }
  });
}

loginBtn.onclick = handleAuth;
usernameInput.addEventListener('keydown', (e) => e.key === 'Enter' && handleAuth());

async function handleAuth() {
  const val = usernameInput.value.trim().toLowerCase();
  if (!val) return;

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: val })
    });
    const data = await res.json();

    if (!res.ok) {
      authError.innerText = data.error || 'Connection failed';
      authError.style.display = 'block';
      return;
    }

    currentUser = data.userId;
    unreadCounts = JSON.parse(localStorage.getItem('pulse_unread_' + currentUser) || '{}');

    authModal.style.display = 'none';
    myIdDisplay.innerText = currentUser;
    myAvatar.innerText = currentUser.slice(0, 2);

    await fetchUsers();
    connectSocket();
  } catch (err) {
    authError.innerText = 'Cannot reach chat server.';
    authError.style.display = 'block';
  }
}

async function fetchUsers() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/users?exclude=${currentUser}`);
    if (res.ok) {
      activeUsers = await res.json();
      renderUserList(searchUser.value);
    }
  } catch (err) {
    console.error('Failed to fetch user directory', err);
  }
}

function renderUserList(filterText = '') {
  usersList.innerHTML = '';
  activeUsers
    .filter(u => u.id.includes(filterText.toLowerCase()))
    .forEach(u => {
      const isOnline = u.is_online === 1;
      const count = unreadCounts[u.id] || 0;
      const badgeHtml = count > 0 ? `<span class="unread-badge">${count}</span>` : '';

      const li = document.createElement('li');
      li.className = `user-card ${selectedContact === u.id ? 'active' : ''}`;
      li.innerHTML = `
        <div class="avatar">${u.id.slice(0, 2)}</div>
        <div class="user-card-info">
          <div class="user-card-top">
            <span class="user-card-name">${escapeHtml(u.id)}</span>
            <span class="user-status-indicator ${isOnline ? 'online' : ''}">${isOnline ? 'online' : 'offline'}</span>
          </div>
        </div>
        ${badgeHtml}
      `;
      li.onclick = () => openChat(u.id);
      usersList.appendChild(li);
    });
}

searchUser.addEventListener('input', (e) => renderUserList(e.target.value));

// Open Chat: Switch to screen 2
async function openChat(contactId) {
  selectedContact = contactId;
  appShell.classList.add('chat-open');

  // Clear unread count for this contact
  if (unreadCounts[contactId]) {
    unreadCounts[contactId] = 0;
    localStorage.setItem('pulse_unread_' + currentUser, JSON.stringify(unreadCounts));
    renderUserList(searchUser.value);
  }

  chatWithUser.innerText = contactId;
  chatAvatar.innerText = contactId.slice(0, 2);

  updateChatHeaderPresence();
  messagesContainer.innerHTML = '';

  try {
    const res = await fetch(`${BACKEND_URL}/api/messages?u1=${currentUser}&u2=${contactId}`);
    const messages = await res.json();
    messages.forEach(m => appendMessageBubble(m, m.sender_id === currentUser));
    scrollToBottom();
  } catch (err) {
    console.error('Failed to load history', err);
  }

  socket.emit('mark_read', { contactId });
}

// Back Button: Return to Screen 1
backBtn.onclick = () => {
  appShell.classList.remove('chat-open');
  selectedContact = null;
  renderUserList(searchUser.value);
};

function updateChatHeaderPresence() {
  if (!selectedContact) return;
  const user = activeUsers.find(u => u.id === selectedContact);
  if (user && user.is_online === 1) {
    chatUserStatus.innerText = 'online';
    chatUserStatus.style.color = '#10b981';
  } else {
    const time = user?.last_seen 
      ? new Date(user.last_seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'recently';
    chatUserStatus.innerText = `last seen at ${time}`;
    chatUserStatus.style.color = 'var(--text-muted)';
  }
}

function getTickSvg(status) {
  if (status === 'sent') {
    return `<span class="tick-icon"><svg viewBox="0 0 16 12"><path d="M1 6l4 4L14 1"/></svg></span>`;
  }
  if (status === 'delivered') {
    return `<span class="tick-icon"><svg viewBox="0 0 16 12"><path d="M1 6l4 4L14 1M6 6l3 3L16 2"/></svg></span>`;
  }
  if (status === 'read') {
    return `<span class="tick-icon blue"><svg viewBox="0 0 16 12"><path d="M1 6l4 4L14 1M6 6l3 3L16 2"/></svg></span>`;
  }
  return '';
}

function updateTickDisplay(msgId, status) {
  const row = document.getElementById(`msg-${msgId}`);
  if (row) {
    const tickWrap = row.querySelector('.tick-wrap');
    if (tickWrap) tickWrap.innerHTML = getTickSvg(status);
  }
}

function appendMessageBubble(m, isMe) {
  const row = document.createElement('div');
  row.className = `message-row ${isMe ? 'sent' : 'received'}`;
  row.id = `msg-${m.id}`;

  const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  row.innerHTML = `
    <div class="message-bubble">
      <div class="message-content">${escapeHtml(m.text)}</div>
      <div class="message-meta">
        <span>${timeStr}</span>
        ${isMe ? `<span class="tick-wrap">${getTickSvg(m.status)}</span>` : ''}
      </div>
    </div>
  `;
  messagesContainer.appendChild(row);
  scrollToBottom();
}

sendBtn.onclick = sendMessage;
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  } else {
    emitTyping();
  }
});

function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !selectedContact || !socket) return;

  const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const tempMsg = {
    id: msgId,
    senderId: currentUser,
    recipientId: selectedContact,
    text: text,
    status: 'sent',
    timestamp: Date.now()
  };

  appendMessageBubble(tempMsg, true);
  messageInput.value = '';

  socket.emit('send_message', tempMsg);
  socket.emit('typing_status', { recipientId: selectedContact, isTyping: false });
}

function emitTyping() {
  if (!selectedContact || !socket) return;
  socket.emit('typing_status', { recipientId: selectedContact, isTyping: true });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing_status', { recipientId: selectedContact, isTyping: false });
  }, 1500);
}

emojiToggleBtn.onclick = () => {
  emojiDrawer.style.display = emojiDrawer.style.display === 'flex' ? 'none' : 'flex';
};

document.querySelectorAll('.emoji-item').forEach(item => {
  item.onclick = () => {
    messageInput.value += item.innerText;
    messageInput.focus();
  };
});

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
}
