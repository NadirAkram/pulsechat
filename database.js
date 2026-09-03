const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'chat.db'));

// High performance mode
db.pragma('journal_mode = WAL');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    is_online INTEGER DEFAULT 0,
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT CHECK(status IN ('sent', 'delivered', 'read')) NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY(sender_id) REFERENCES users(id),
    FOREIGN KEY(recipient_id) REFERENCES users(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_pair 
  ON messages(sender_id, recipient_id, timestamp);
`);

module.exports = {
  getUser: (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id),

  createUser: (id) => {
    const now = Date.now();
    db.prepare('INSERT INTO users (id, is_online, last_seen, created_at) VALUES (?, 1, ?, ?)')
      .run(id, now, now);
    return { id, is_online: 1, last_seen: now };
  },

  setUserOnlineStatus: (id, isOnline) => {
    const now = Date.now();
    db.prepare('UPDATE users SET is_online = ?, last_seen = ? WHERE id = ?')
      .run(isOnline ? 1 : 0, now, id);
    return now;
  },

  getAllUsers: (excludeId) => {
    return db.prepare('SELECT id, is_online, last_seen FROM users WHERE id != ? ORDER BY id ASC')
      .all(excludeId);
  },

  saveMessage: (msg) => {
    db.prepare(`
      INSERT INTO messages (id, sender_id, recipient_id, text, status, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(msg.id, msg.senderId, msg.recipientId, msg.text, msg.status, msg.timestamp);
  },

  updateMessageStatus: (msgId, status) => {
    db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, msgId);
  },

  markConversationAsRead: (senderId, recipientId) => {
    return db.prepare(`
      UPDATE messages 
      SET status = 'read' 
      WHERE sender_id = ? AND recipient_id = ? AND status != 'read'
      RETURNING id
    `).all(senderId, recipientId);
  },

  getConversation: (userA, userB) => {
    return db.prepare(`
      SELECT * FROM messages 
      WHERE (sender_id = ? AND recipient_id = ?) 
         OR (sender_id = ? AND recipient_id = ?)
      ORDER BY timestamp ASC
    `).all(userA, userB, userB, userA);
  }
};
