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

  db.execSync(`
    CREATE TABLE IF NOT EXISTS blocked_users (
      username TEXT PRIMARY KEY,
      blocked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 🟢 NEW: Tombstone table to prevent deleted messages from syncing back
  db.execSync(`CREATE TABLE IF NOT EXISTS deleted_msg_ids (msg_id TEXT PRIMARY KEY);`);

  try { db.execSync(`ALTER TABLE messages ADD COLUMN msg_id TEXT;`); } catch { }
  try { db.execSync(`ALTER TABLE messages ADD COLUMN target_username TEXT;`); } catch { }
  try { db.execSync(`ALTER TABLE messages ADD COLUMN sent_at TEXT;`); } catch { }
  try { db.execSync(`ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0;`); } catch { }
  try { db.execSync(`ALTER TABLE messages ADD COLUMN status TEXT;`); } catch { } // 🟢 NEW: message status

  try { db.execSync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_msgid ON messages(msg_id) WHERE msg_id IS NOT NULL;`); } catch { }
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, sent_at);`);
  db.execSync(`CREATE INDEX IF NOT EXISTS idx_messages_recent ON messages(sent_at DESC);`);

  initialized = true;
};
// Inside LocalDB.ts

export const blockLocalUser = (username: string) => {
  if (isWeb) return;
  initLocalDatabase();
  db.runSync(`INSERT OR IGNORE INTO blocked_users (username) VALUES (?)`, [username.trim().toLowerCase()]);
  DeviceEventEmitter.emit('db_chats_updated'); // 🟢 Added Event Emitter
};
export const unblockLocalUser = (username: string) => {
  if (isWeb) return;
  initLocalDatabase();
  db.runSync(`DELETE FROM blocked_users WHERE username = ?`, [username.trim().toLowerCase()]);
  DeviceEventEmitter.emit('db_chats_updated'); // 🟢 Added Event Emitter
};
// 🟢 NEW: Fetch all blocked users for the BlockedUsersScreen
export const getBlockedUsers = (): string[] => {
  if (isWeb) return [];
  initLocalDatabase();
  try {
    const rows: any[] = db.getAllSync(`SELECT username FROM blocked_users ORDER BY blocked_at DESC`);
    return rows.map((r: any) => r.username);
  } catch {
    return [];
  }
};
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
  skipEmit: boolean = false, 
  isRead: boolean = false,
  status: string | null = null // 🟢 NEW
) => {
  if (Platform.OS === 'web') return;
  initLocalDatabase();

  db.runSync(
    `INSERT OR IGNORE INTO messages (msg_id, room_id, sender_username, target_username, content, media_url, media_type, sent_at, is_read, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [msgId, roomId, senderUsername, targetUsername, content, mediaUrl, mediaType, sentAt || new Date().toISOString(), isRead ? 1 : 0, status]
  );
  
  if (!skipEmit) {
    DeviceEventEmitter.emit('db_chats_updated');
  }
};

export const markRoomAsRead = (roomId: string) => {
  if (isWeb) return;
  initLocalDatabase();
  // 🟢 FIX: Only update rows that actually need it to prevent infinite UI re-render loops
  const res = db.runSync(`UPDATE messages SET is_read = 1 WHERE room_id = ? AND is_read = 0`, [roomId]);
  if (res.changes > 0) DeviceEventEmitter.emit('db_chats_updated');
};

const RANK: Record<string, number> = { failed: 1, pending: 1, sent: 2, delivered: 3, read: 4 };

// 🟢 NEW: Advances message statuses logically (ticks)
export const setMessageStatus = (msgId: string, status: string) => {
  if (isWeb || !msgId || !(status in RANK)) return;
  initLocalDatabase();
  const r = RANK[status];
  const res = db.runSync(
    `UPDATE messages SET status = ? WHERE msg_id = ? AND (
       (? = 'failed'  AND status = 'pending') OR
       (? = 'pending' AND status = 'failed')  OR
       (? >= 2 AND (CASE status WHEN 'read' THEN 4 WHEN 'delivered' THEN 3 WHEN 'sent' THEN 2 ELSE 1 END) < ?))`,
    [status, msgId, status, status, r, r]);
  if (res.changes > 0) DeviceEventEmitter.emit('db_chats_updated');
};

// 🟢 NEW: Fetches the outbox to retry sending
export const getPendingOutgoing = (me: string): any[] => {
  if (isWeb || !me) return [];
  initLocalDatabase();
  return db.getAllSync(
    `SELECT msg_id AS msgId, room_id AS roomId, target_username AS target, content, sent_at AS sentAt
     FROM messages WHERE sender_username = ? AND status = 'pending' AND msg_id IS NOT NULL ORDER BY id ASC`, [me]);
};

// 🟢 NEW: Identifies which messages need "blue ticks" sent back
export const getUnreadIncomingIds = (roomId: string, me: string): string[] => {
  if (isWeb) return [];
  initLocalDatabase();
  return (db.getAllSync(
    `SELECT msg_id FROM messages WHERE room_id = ? AND sender_username != ? AND is_read = 0 AND msg_id IS NOT NULL`,
    [roomId, me]) as any[]).map((r: any) => r.msg_id);
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

export const clearLocalMessages = (
  roomId: string, 
  keepInInbox: boolean = false, 
  targetUser: string = '', 
  activeUser: string = ''
) => {
  if (Platform.OS === 'web') return;
  initLocalDatabase();
  
  // 🟢 FIX: Tombstone deleted messages so they don't get pulled back from the server on next sync
  db.runSync(`INSERT OR IGNORE INTO deleted_msg_ids (msg_id) SELECT msg_id FROM messages WHERE room_id = ? AND msg_id IS NOT NULL`, [roomId]);
  
  // Wipe the history
  db.runSync(`DELETE FROM messages WHERE room_id = ?`, [roomId]);

  if (keepInInbox && targetUser && activeUser) {
    db.runSync(
      `INSERT INTO messages (room_id, sender_username, target_username, content, media_type, is_read) 
       VALUES (?, 'system', ?, '🚫 Chat cleared', 'system', 1)`,
      [roomId, targetUser]
    );
  }

  DeviceEventEmitter.emit('db_chats_updated'); 
};

export const hasLocalMessage = (msgId: string): boolean => {
  if (isWeb || !msgId) return false;
  initLocalDatabase();
  try {
    // 🟢 FIX: Include the tombstone table so deleted messages are flagged as "already seen"
    const row: any = db.getFirstSync(
      `SELECT 1 FROM messages WHERE msg_id = ? UNION ALL SELECT 1 FROM deleted_msg_ids WHERE msg_id = ? LIMIT 1`, 
      [msgId, msgId]
    );
    return !!row;
  } catch {
    return false;
  }
};

export const getLocalMessages = (roomId: string) => {
  if (isWeb) return [];
  initLocalDatabase();
  return db.getAllSync(
    // 🟢 FIX: Expose 'status' to the UI
    `SELECT msg_id AS msgId, room_id AS roomId, sender_username, target_username, content, media_url, media_type, status, COALESCE(sent_at, timestamp) AS timestamp FROM messages WHERE room_id = ? ORDER BY COALESCE(sent_at, timestamp) ASC, id ASC`,
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

      // 🟢 FIX: Route "system" messages correctly so cleared chats don't disappear
      if (sender === 'system') {
        targetUser = stored;
      } else if (sender && stored) {
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