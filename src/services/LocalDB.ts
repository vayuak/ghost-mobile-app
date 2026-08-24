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

  // Migration for databases created before target_username existed.
  // SQLite has no ADD COLUMN IF NOT EXISTS, so a failure here just means the
  // column is already present.
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

/**
 * Recent conversations for the inbox.
 *
 * TWO BUGS FIXED HERE:
 *
 * 1. The old query used `WHERE room_id LIKE '%username%'`, a substring match.
 *    User "bob" matched room "bobby_carl", so unrelated conversations leaked
 *    into the inbox. Room ids are now decomposed by exact segment equality.
 *
 * 2. The old code derived the other participant with roomId.split('_'), which
 *    breaks for any username containing an underscore. We now prefer the
 *    stored target_username / sender_username columns and only fall back to
 *    parsing when neither is available (rows written by an older build).
 */
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
        // Both participants are recorded on the row. Pick whichever is not us.
        if (sender === me) targetUser = stored;
        else if (stored === me) targetUser = sender;
        else continue; // room does not involve the active user
      } else {
        // Legacy row: fall back to splitting the room id, but require an exact
        // segment match rather than a substring match.
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
