import 'react-native-get-random-values';
import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PRIVATE_KEY_STORAGE = '@ghost_private_key';
const PUBLIC_KEY_STORAGE = '@ghost_public_key';

// 1. Generate keys when the user logs in/registers
export const initializeDeviceKeys = async () => {
  const existingKey = await AsyncStorage.getItem(PRIVATE_KEY_STORAGE);
  if (existingKey) return; // Keys already exist for this device

  const keypair = nacl.box.keyPair();
  
  await AsyncStorage.setItem(PRIVATE_KEY_STORAGE, util.encodeBase64(keypair.secretKey));
  await AsyncStorage.setItem(PUBLIC_KEY_STORAGE, util.encodeBase64(keypair.publicKey));
  
  // Note: You will send the Public Key to the backend via an API call so others can fetch it!
};

export const getMyPublicKey = async () => {
  return await AsyncStorage.getItem(PUBLIC_KEY_STORAGE);
};

// 2. ECDH: Mathematically derive the shared secret using THEIR public key and OUR private key
export const deriveSharedSecret = async (targetPublicKeyBase64: string) => {
  const myPrivateKeyBase64 = await AsyncStorage.getItem(PRIVATE_KEY_STORAGE);
  if (!myPrivateKeyBase64) throw new Error("Device keys not initialized");

  const myPrivateKey = util.decodeBase64(myPrivateKeyBase64);
  const targetPublicKey = util.decodeBase64(targetPublicKeyBase64);

  // X25519 Diffie-Hellman Key Agreement
  // This generates a 32-byte secret that only you and the target can compute
  const sharedSecret = nacl.scalarMult(myPrivateKey, targetPublicKey);
  
  // Return as a string to be used as your AES master key for this specific room
  return util.encodeBase64(sharedSecret);
};