const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./database');

const app = express();
const server = http.createServer(app);

// Allow cross-origin requests from GitHub Pages and CodePen
app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Map of userId -> Set of active socket ids
const userSockets = new Map();

// API: Register or verify user
app.post('/api/auth', (req, res) => {
  const { userId } = req.body;
  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'Valid user ID is required' });
  }

  const cleanId = userId.trim().toLowerCase();
  const existing = db.getUser(cleanId);

  if (userSockets.has(cleanId) && userSockets.get(cleanId).size > 0) {
    return res.status(409).json({ error: 'User ID is active in another session' });
  }

  if (!existing) {
    db.createUser(cleanId);
  } else {
    db.setUserOnlineStatus(cleanId, true);
  }

  res.json({ success: true, userId: cleanId });
});

// API: Fetch message history
app.get('/api/messages', (req, res) => {
  const { u1, u2 } = req.query;
  if (!u1 || !u2) return res.status(400).json({ error: 'Missing user parameters' });
  const messages = db.getConversation(u1.toLowerCase(), u2.toLowerCase());
  res.json(messages);
});

// Socket.io Real-Time Engine
io.on('connection', (socket) => {
  let boundUser = null;

  socket.on('register_session', (userId) => {
    boundUser = userId.toLowerCase();
    socket.join(boundUser);

    if (!userSockets.has(boundUser)) {
      userSockets.set(boundUser, new Set());
    }
    userSockets.get(boundUser).add(socket.id);

    db.setUserOnlineStatus(boundUser, true);

    io.emit('presence_change', {
      userId: boundUser,
      isOnline: true,
      lastSeen: Date.now()
    });

    const users = db.getAllUsers(boundUser);
    socket.emit('user_directory', users);
  });

  socket.on('send_message', (payload) => {
    const { id, recipientId, text } = payload;
    const recipientClean = recipientId.toLowerCase();
    const isRecipientConnected = userSockets.has(recipientClean) && userSockets.get(recipientClean).size > 0;

    const initialStatus = isRecipientConnected ? 'delivered' : 'sent';
    const messageRecord = {
      id,
      senderId: boundUser,
      recipientId: recipientClean,
      text,
      status: initialStatus,
      timestamp: Date.now()
    };

    db.saveMessage(messageRecord);

    socket.emit('message_ack', { id, status: initialStatus });

    if (isRecipientConnected) {
      io.to(recipientClean).emit('new_message', messageRecord);
    }
  });

  socket.on('mark_read', ({ contactId }) => {
    const contactClean = contactId.toLowerCase();
    const updatedMessages = db.markConversationAsRead(contactClean, boundUser);

    if (updatedMessages.length > 0) {
      const readIds = updatedMessages.map(m => m.id);
      io.to(contactClean).emit('messages_read_receipt', {
        by: boundUser,
        messageIds: readIds
      });
    }
  });

  socket.on('typing_status', ({ recipientId, isTyping }) => {
    io.to(recipientId.toLowerCase()).emit('user_typing', {
      senderId: boundUser,
      isTyping
    });
  });

  socket.on('disconnect', () => {
    if (!boundUser) return;

    const userSocketSet = userSockets.get(boundUser);
    if (userSocketSet) {
      userSocketSet.delete(socket.id);
      if (userSocketSet.size === 0) {
        userSockets.delete(boundUser);
        const lastSeen = db.setUserOnlineStatus(boundUser, false);
        io.emit('presence_change', {
          userId: boundUser,
          isOnline: false,
          lastSeen
        });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});
