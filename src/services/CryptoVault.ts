import 'react-native-get-random-values'; // 🟢 Native polyfill handles PRNG now
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiClient } from './api';

const PRIVATE_KEY_STORAGE = '@ghost_private_key';
const PUBLIC_KEY_STORAGE = '@ghost_public_key';
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
// Device identity
// ---------------------------------------------------------------------------

/** Create this device's keypair if it does not exist yet. Idempotent. */
export const initializeDeviceKeys = async (): Promise<string> => {
  const existingPub = await AsyncStorage.getItem(PUBLIC_KEY_STORAGE);
  const existingPriv = await AsyncStorage.getItem(PRIVATE_KEY_STORAGE);

  if (existingPub && existingPriv) return existingPub;

  // 🟢 FIX: Uses native react-native-get-random-values automatically. No crashes.
  const keypair = nacl.box.keyPair();
  const pub = util.encodeBase64(keypair.publicKey);
  const priv = util.encodeBase64(keypair.secretKey);

  await AsyncStorage.multiSet([
    [PRIVATE_KEY_STORAGE, priv],
    [PUBLIC_KEY_STORAGE, pub],
  ]);

  return pub;
};

export const getMyPublicKey = async (): Promise<string | null> => {
  return AsyncStorage.getItem(PUBLIC_KEY_STORAGE);
};

const getMyPrivateKey = async (): Promise<Uint8Array> => {
  const b64 = await AsyncStorage.getItem(PRIVATE_KEY_STORAGE);
  if (!b64) throw new Error('Device keys not initialized. Call initializeDeviceKeys() first.');
  return util.decodeBase64(b64);
};

export const ensureKeysPublished = async (): Promise<void> => {
  const myPub = await initializeDeviceKeys();
  try {
    await apiClient.post('/v1/auth/keys', { publicKey: myPub });
  } catch (e: any) {
    console.warn('[crypto] Could not publish public key:', e?.message);
  }
};

// ---------------------------------------------------------------------------
// Peer keys, with trust-on-first-use pinning
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
    const res = await apiClient.get(`/v1/auth/keys/${encodeURIComponent(user)}`);
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
// Encrypt / decrypt
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
    console.warn(`[crypto] Sender key mismatch for @${senderUsername}. Rejecting message.`);
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

export const wipeCryptoState = async (): Promise<void> => {
  const all = await AsyncStorage.getAllKeys();
  const mine = all.filter(
    (k) => k === PRIVATE_KEY_STORAGE || k === PUBLIC_KEY_STORAGE || k.startsWith(PINNED_KEY_PREFIX)
  );
  if (mine.length) await AsyncStorage.multiRemove(mine);
};