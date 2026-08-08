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

export const initLocalDatabase = () => {
  // Execute the real schema on physical devices, ignore on web
  db.execSync(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id TEXT NOT NULL,
      sender_username TEXT NOT NULL,
      content TEXT NOT NULL,
      media_url TEXT,
      media_type TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

export const saveLocalMessage = (roomId: string, senderUsername: string, content: string, mediaUrl: string | null = null, mediaType: string | null = null) => {
  db.runSync(
    `INSERT INTO messages (room_id, sender_username, content, media_url, media_type) VALUES (?, ?, ?, ?, ?)`,
    [roomId, senderUsername, content, mediaUrl, mediaType]
  );
};

export const getLocalMessages = (roomId: string) => {
  return db.getAllSync(`SELECT * FROM messages WHERE room_id = ? ORDER BY timestamp ASC`, [roomId]);
};

// This query powers the WhatsApp-style Inbox preview!
export const getInboxPreviews = () => {
  return db.getAllSync(`
    SELECT room_id, sender_username, content, MAX(timestamp) as timestamp 
    FROM messages 
    GROUP BY room_id 
    ORDER BY timestamp DESC
  `);
};
export const getRecentConversations = (activeUsername: string) => {
  try {
    if (!activeUsername) return [];

    // 1. Query SQLite for all local messages involving the active user, ordered newest first
    const query = `
      SELECT room_id as roomId, sender_username, content as lastMessage, timestamp 
      FROM local_messages 
      WHERE room_id LIKE ? 
      ORDER BY id DESC
    `;
    
    const rows: any[] = db.getAllSync(query, [`%${activeUsername.toLowerCase().trim()}%`]);
    const seenRooms = new Set<string>();
    const result = [];

    // 2. Filter distinct room IDs so only the single latest message per room is kept
    for (const row of rows) {
      if (!seenRooms.has(row.roomId)) {
        seenRooms.add(row.roomId);
        
        // Extract the target (other user's) username from the roomId (format: user1_user2)
        const parts = row.roomId.split('_');
        const targetUser = parts[0] === activeUsername.toLowerCase().trim() ? parts[1] : parts[0];
        
        result.push({
          roomId: row.roomId,
          targetUser: targetUser,
          lastMessage: row.lastMessage,
          timestamp: row.timestamp
        });
      }
    }
    
    return result;
  } catch (e) {
    console.error("Failed to fetch recent conversations from SQLite:", e);
    return [];
  }
};