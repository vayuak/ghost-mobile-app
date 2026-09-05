import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// Safely mock the synchronous DB methods if on the web
export const db = isWeb
  ? {
      execSync: (query: string) => console.log('Web Mock: execSync called'),
      runSync: (query: string, args: any[]) => console.log('Web Mock: runSync called'),
      getFirstSync: (query: string) => null,
      getAllSync: (query: string) => [],
    } as any
  : SQLite.openDatabaseSync('ghost_shield_secure.db');

let initialized = false;

export const initLocalDatabase = () => {
  if (isWeb || initialized) return;

  db.execSync(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      sender_username TEXT NOT NULL,
      target_username TEXT,
      content TEXT NOT NULL,
      media_url TEXT,
      media_type TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    db.execSync(`ALTER TABLE messages ADD COLUMN target_username TEXT;`);
  } catch {
    // column already exists
  }

  db.execSync(`CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, id);`);

  initialized = true;
};

export const saveLocalMessage = (
  roomId: string,
  senderUsername: string,
  content: string,
  mediaUrl: string | null = null,
  mediaType: string | null = null,
  targetUsername: string | null = null
) => {
  if (isWeb) return;
  initLocalDatabase();

  db.runSync(
    `INSERT INTO messages (room_id, sender_username, target_username, content, media_url, media_type) VALUES (?, ?, ?, ?, ?, ?)`,
    [roomId, senderUsername, targetUsername, content, mediaUrl, mediaType]
  );
};

export const getLocalMessages = (roomId: string) => {
  if (isWeb) return [];
  initLocalDatabase();
  return db.getAllSync(`SELECT * FROM messages WHERE room_id = ? ORDER BY id ASC`, [roomId]);
};

export const getInboxPreviews = () => {
  if (isWeb) return [];
  initLocalDatabase();
  return db.getAllSync(`
    SELECT room_id, sender_username, content, MAX(timestamp) as timestamp
    FROM messages
    GROUP BY room_id
    ORDER BY timestamp DESC
  `);
};

export const getRecentConversations = (activeUsername: string) => {
  if (isWeb) return [];

  try {
    const me = (activeUsername || '').trim().toLowerCase();
    if (!me) return [];

    initLocalDatabase();

    const rows: any[] = db.getAllSync(
      `SELECT room_id as roomId, sender_username, target_username, content as lastMessage, timestamp
       FROM messages
       ORDER BY id DESC`,
      []
    );

    const seenRooms = new Set<string>();
    const result = [];

    for (const row of rows) {
      if (seenRooms.has(row.roomId)) continue;

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

      seenRooms.add(row.roomId);
      result.push({
        roomId: row.roomId,
        targetUser,
        lastMessage: row.lastMessage,
        timestamp: row.timestamp
      });
    }

    return result;
  } catch (e) {
    console.error("Failed to fetch recent conversations from SQLite:", e);
    return [];
  }
};