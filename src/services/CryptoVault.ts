import 'react-native-get-random-values';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient, API_ROUTES } from './api'; // 🟢 Added API_ROUTES

const PINNED_KEY_PREFIX = '@ghost_pinned_key:';

export const CRYPTO_VERSION = 2;

export class KeyChangedError extends Error {
  constructor(public username: string) {
    super(`The encryption key for @${username} has changed.`);
    this.name = 'KeyChangedError';
  }
}

export class NoKeyError extends Error {
  constructor(public username: string) {
    super(`@${username} has not published an encryption key yet.`);
    this.name = 'NoKeyError';
  }
}

// ---------------------------------------------------------------------------
// Helper: Resolve Active Username
// ---------------------------------------------------------------------------

const resolveUsername = async (overrideUser?: string): Promise<string> => {
  if (overrideUser && overrideUser.trim()) {
    return overrideUser.trim().toLowerCase();
  }
  const stored = await AsyncStorage.getItem('@active_username');
  return (stored || '').trim().toLowerCase();
};

// ---------------------------------------------------------------------------
// Device Identity (Per-Account Permanent Keys)
// ---------------------------------------------------------------------------

export const initializeDeviceKeys = async (usernameOverride?: string): Promise<string> => {
  const username = await resolveUsername(usernameOverride);
  if (!username) {
    throw new Error('Cannot initialize crypto keys without an active username.');
  }

  const pubKeyStorage = `@ghost_public_key_${username}`;
  const privKeyStorage = `@ghost_private_key_${username}`;

  // 1. Check for existing account key
  let existingPub = await AsyncStorage.getItem(pubKeyStorage);
  let existingPriv = await AsyncStorage.getItem(privKeyStorage);

  // 2. Fallback: Migrate legacy unscoped keys if available
  if (!existingPub || !existingPriv) {
    const legacyPub = await AsyncStorage.getItem('@ghost_public_key');
    const legacyPriv = await AsyncStorage.getItem('@ghost_private_key');
    if (legacyPub && legacyPriv) {
      existingPub = legacyPub;
      existingPriv = legacyPriv;
      await AsyncStorage.multiSet([
        [pubKeyStorage, existingPub],
        [privKeyStorage, existingPriv],
      ]);
    }
  }

  // 3. Return existing key without generating a new one
  if (existingPub && existingPriv) {
    return existingPub;
  }

  // 4. Generate keypair ONLY if no key exists for this username
  console.log(`[CryptoVault] Generating PERMANENT keypair for @${username}...`);
  const keypair = nacl.box.keyPair();
  const pub = util.encodeBase64(keypair.publicKey);
  const priv = util.encodeBase64(keypair.secretKey);

  await AsyncStorage.multiSet([
    [pubKeyStorage, pub],
    [privKeyStorage, priv],
  ]);

  return pub;
};

export const getMyPublicKey = async (usernameOverride?: string): Promise<string | null> => {
  const username = await resolveUsername(usernameOverride);
  if (!username) return null;
  return AsyncStorage.getItem(`@ghost_public_key_${username}`);
};

const getMyPrivateKey = async (usernameOverride?: string): Promise<Uint8Array> => {
  const username = await resolveUsername(usernameOverride);
  const b64 = await AsyncStorage.getItem(`@ghost_private_key_${username}`);
  if (!b64) throw new Error(`Device keys for @${username} not initialized.`);
  return util.decodeBase64(b64);
};

export const ensureKeysPublished = async (usernameOverride?: string): Promise<void> => {
  try {
    const username = await resolveUsername(usernameOverride);
    if (!username) return;

    const myPub = await initializeDeviceKeys(username);
    // 🟢 Centralized Route
    await apiClient.post(API_ROUTES.AUTH.PUBLISH_KEY, { publicKey: myPub });
  } catch (e: any) {
    console.warn('[CryptoVault] Could not publish public key:', e?.message);
  }
};

// ---------------------------------------------------------------------------
// Peer Keys & Trust-On-First-Use (TOFU) Pinning
// ---------------------------------------------------------------------------

export const getPeerPublicKey = async (
  username: string,
  opts: { acceptChange?: boolean } = {}
): Promise<string> => {
  const user = username.trim().toLowerCase();
  const pinKey = `${PINNED_KEY_PREFIX}${user}`;
  const pinned = await AsyncStorage.getItem(pinKey);

  let fetched: string | null = null;
  try {
    // 🟢 Centralized Route
    const res = await apiClient.get(API_ROUTES.AUTH.GET_KEY(user));
    fetched = res?.publicKey || null;
  } catch (e: any) {
    if (pinned) return pinned;
    throw new NoKeyError(user);
  }

  if (!fetched) {
    if (pinned) return pinned;
    throw new NoKeyError(user);
  }

  if (pinned && pinned !== fetched) {
    if (!opts.acceptChange) throw new KeyChangedError(user);
    await AsyncStorage.setItem(pinKey, fetched);
    return fetched;
  }

  if (!pinned) await AsyncStorage.setItem(pinKey, fetched);
  return fetched;
};

export const acceptPeerKeyChange = async (username: string): Promise<string> => {
  const user = username.trim().toLowerCase();
  await AsyncStorage.removeItem(`${PINNED_KEY_PREFIX}${user}`);
  return getPeerPublicKey(user, { acceptChange: true });
};

export const safetyNumber = async (peerUsername: string): Promise<string | null> => {
  const myPub = await getMyPublicKey();
  let theirPub: string | null = null;
  try {
    theirPub = await getPeerPublicKey(peerUsername);
  } catch {
    return null;
  }
  if (!myPub || !theirPub) return null;

  const combined = [myPub, theirPub].sort().join('');
  const digest = nacl.hash(util.decodeUTF8(combined)).slice(0, 15);

  const groups: string[] = [];
  for (let i = 0; i < 15; i += 3) {
    const n = (digest[i] << 16) | (digest[i + 1] << 8) | digest[i + 2];
    groups.push(String(n % 100000).padStart(5, '0'));
  }
  return groups.join(' ');
};

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

export interface EncryptedEnvelope {
  v: number;
  ciphertext: string; 
  iv: string; 
  senderPublicKey: string;
}

export const encryptForPeer = async (
  plaintext: string,
  peerUsername: string
): Promise<EncryptedEnvelope> => {
  const theirPubB64 = await getPeerPublicKey(peerUsername);
  const myPriv = await getMyPrivateKey();
  const myPub = await getMyPublicKey();

  const nonce = nacl.randomBytes(nacl.box.nonceLength); 
  const boxed = nacl.box(
    util.decodeUTF8(plaintext),
    nonce,
    util.decodeBase64(theirPubB64),
    myPriv
  );

  if (!boxed) throw new Error('Encryption failed.');

  return {
    v: CRYPTO_VERSION,
    ciphertext: util.encodeBase64(boxed),
    iv: util.encodeBase64(nonce),
    senderPublicKey: myPub!,
  };
};

export const decryptFromPeer = async (
  envelope: { v?: number; ciphertext: string; iv: string; senderPublicKey?: string },
  senderUsername: string
): Promise<string | null> => {
  if (!envelope?.ciphertext || !envelope?.iv) return null;
  if (envelope.v !== CRYPTO_VERSION) return null;

  let trustedSenderKey: string;
  try {
    trustedSenderKey = await getPeerPublicKey(senderUsername);
  } catch {
    return null;
  }

  if (envelope.senderPublicKey && envelope.senderPublicKey !== trustedSenderKey) {
    console.warn(`[CryptoVault] Sender key mismatch for @${senderUsername}. Rejecting message.`);
    return null;
  }

  try {
    const myPriv = await getMyPrivateKey();
    const opened = nacl.box.open(
      util.decodeBase64(envelope.ciphertext),
      util.decodeBase64(envelope.iv),
      util.decodeBase64(trustedSenderKey),
      myPriv
    );

    if (!opened) return null;
    return util.encodeUTF8(opened);
  } catch {
    return null;
  }
};

export const wipeCryptoState = async (targetUser?: string): Promise<void> => {
  const username = await resolveUsername(targetUser);
  if (!username) return;

  const pubKeyStorage = `@ghost_public_key_${username}`;
  const privKeyStorage = `@ghost_private_key_${username}`;

  const all = await AsyncStorage.getAllKeys();
  const mine = all.filter(
    (k) => k === pubKeyStorage || k === privKeyStorage || k.startsWith(PINNED_KEY_PREFIX)
  );
  if (mine.length) await AsyncStorage.multiRemove(mine);
};