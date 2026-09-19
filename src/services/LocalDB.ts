import * as SQLite from 'expo-sqlite';
import { Platform, DeviceEventEmitter } from 'react-native';

const isWeb = Platform.OS === 'web';

export const db = isWeb
  ? {
      execSync: (query: string) => {},
      runSync: (query: string, args: any[]) => {},
      getFirstSync: (query: string) => null,
      getAllSync: (query: string) => [],
    } as any
  : SQLite.openDatabaseSync('gossips_chat.db');

let initialized = false;

export const initLocalDatabase = () => {
  if (isWeb || initialized) return;

  db.execSync(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      msg_id TEXT,
      room_id TEXT NOT NULL,
      sender_username TEXT NOT NULL,
      target_username TEXT,
      content TEXT NOT NULL,
      media_url TEXT,
      media_type TEXT,
      sent_at TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_read INTEGER DEFAULT 0
    );
  `);

  // 🟢 NEW: Local Blocklist Table
  db.execSync(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      username TEXT PRIMARY KEY,
      blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try { db.execSync(`ALTER TABLE messages ADD COLUMN msg_id TEXT;`); } catch { }
  try { db.execSync(`ALTER TABLE messages ADD COLUMN target_username TEXT;`); } catch { }
  try { db.execSync(`ALTER TABLE messages ADD COLUMN sent_at TEXT;`); } catch { }
  try { db.execSync(`ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0;`); } catch { }

  try { db.execSync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_msgid ON messages(msg_id) WHERE msg_id IS NOT NULL;`); } catch { }
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, sent_at);`);
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_messages_recent ON messages(sent_at DESC);`);

  initialized = true;
};

// 🟢 NEW: Block a user locally
export const blockLocalUser = (username: string) => {
  if (isWeb) return;
  initLocalDatabase();
  db.runSync(`INSERT OR IGNORE INTO blocked_users (username) VALUES (?)`, [username.trim().toLowerCase()]);
};

// 🟢 NEW: Check if a user is blocked
export const isUserBlocked = (username: string): boolean => {
  if (isWeb || !username) return false;
  initLocalDatabase();
  try {
    const row = db.getFirstSync(`SELECT 1 FROM blocked_users WHERE username = ?`, [username.trim().toLowerCase()]);
    return !!row;
  } catch {
    return false;
  }
};

export const saveLocalMessage = (
  roomId: string,
  senderUsername: string,
  content: string,
  mediaUrl: string | null = null,
  mediaType: string | null = null,
  targetUsername: string | null = null,
  msgId: string | null = null,
  sentAt: string | null = null,
  skipEmit: boolean = false // 🟢 NEW: Allow silent saves for bulk processing
) => {
  if (Platform.OS === 'web') return;
  initLocalDatabase();

  db.runSync(
    `INSERT OR IGNORE INTO messages (msg_id, room_id, sender_username, target_username, content, media_url, media_type, sent_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [msgId, roomId, senderUsername, targetUsername, content, mediaUrl, mediaType, sentAt || new Date().toISOString()]
  );
  
  // 🟢 Only emit if we aren't bulk syncing
  if (!skipEmit) {
    DeviceEventEmitter.emit('db_chats_updated');
  }
};

export const markRoomAsRead = (roomId: string) => {
  if (isWeb) return;
  initLocalDatabase();
  db.runSync(`UPDATE messages SET is_read = 1 WHERE room_id = ?`, [roomId]);
  DeviceEventEmitter.emit('db_chats_updated');
};

export const getUnreadChatsCount = (activeUsername: string): number => {
  if (isWeb || !activeUsername) return 0;
  initLocalDatabase();
  try {
    const me = activeUsername.trim().toLowerCase();
    const row: any = db.getFirstSync(
      `SELECT COUNT(DISTINCT room_id) as count FROM messages WHERE sender_username != ? AND is_read = 0`,
      [me]
    );
    return row?.count || 0;
  } catch {
    return 0;
  }
};

// 🟢 ENHANCED: Deletes the chat completely and fires the event to clear UI
export const clearLocalMessages = (roomId: string) => {
  if (isWeb) return;
  initLocalDatabase();
  db.runSync(`DELETE FROM messages WHERE room_id = ?`, [roomId]);
  DeviceEventEmitter.emit('db_chats_updated'); 
};

export const hasLocalMessage = (msgId: string): boolean => {
  if (isWeb || !msgId) return false;
  initLocalDatabase();
  try {
    const row: any = db.getFirstSync(`SELECT 1 AS present FROM messages WHERE msg_id = ?`, [msgId]);
    return !!row;
  } catch {
    return false;
  }
};

export const getLocalMessages = (roomId: string) => {
  if (isWeb) return [];
  initLocalDatabase();
  return db.getAllSync(
    `SELECT msg_id AS msgId, room_id AS roomId, sender_username, target_username, content, media_url, media_type, COALESCE(sent_at, timestamp) AS timestamp FROM messages WHERE room_id = ? ORDER BY COALESCE(sent_at, timestamp) ASC, id ASC`,
    [roomId]
  );
};

export const getRecentConversations = (activeUsername: string) => {
  if (isWeb) return [];

  try {
    const me = (activeUsername || '').trim().toLowerCase();
    if (!me) return [];

    initLocalDatabase();

    const rows: any[] = db.getAllSync(
      `SELECT m.room_id AS roomId, m.sender_username, m.target_username, m.content AS lastMessage, m.media_type, COALESCE(m.sent_at, m.timestamp) AS timestamp,
       (SELECT COUNT(*) FROM messages WHERE room_id = m.room_id AND sender_username != ? AND is_read = 0) as unreadCount
       FROM messages m 
       INNER JOIN (SELECT room_id, MAX(COALESCE(sent_at, timestamp)) AS newest FROM messages GROUP BY room_id) latest 
       ON latest.room_id = m.room_id AND COALESCE(m.sent_at, m.timestamp) = latest.newest 
       ORDER BY timestamp DESC`,
      [me]
    );

    const seen = new Set<string>();
    const result: any[] = [];

    for (const row of rows) {
      if (seen.has(row.roomId)) continue;

      const sender = (row.sender_username || '').trim().toLowerCase();
      const stored = (row.target_username || '').trim().toLowerCase();

      let targetUser = '';

      if (sender && stored) {
        if (sender === me) targetUser = stored;
        else if (stored === me) targetUser = sender;
        else continue;
      } else {
        const parts = String(row.roomId).split('_');
        const idx = parts.indexOf(me);
        if (idx === -1) continue;
        targetUser = parts.filter((_: string, i: number) => i !== idx).join('_');
        if (!targetUser) continue;
      }

      // 🟢 SILENT FILTER: Do not show blocked users in the inbox
      if (isUserBlocked(targetUser)) continue;

      seen.add(row.roomId);
      result.push({
        roomId: row.roomId,
        targetUser,
        lastMessage: row.media_type ? '📎 Attachment' : row.lastMessage,
        timestamp: row.timestamp,
        unreadCount: row.unreadCount || 0
      });
    }

    return result;
  } catch (e) {
    return [];
  }
};