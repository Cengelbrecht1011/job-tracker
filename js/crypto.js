// The login works by decryption, not by comparison: the GitHub token and repo details
// are AES-GCM encrypted under a key derived from username + password. A wrong login
// simply fails to decrypt, so there is no client-side check to bypass.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const KDF_ITERATIONS = 600000;

export function bytesToB64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function b64ToBytes(b64) {
  const binary = atob(String(b64).replace(/\s/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function deriveKey(username, password, salt, iterations) {
  const material = encoder.encode(`${String(username).trim().toLowerCase()}\n${password}`);
  const base = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptConfig(config, username, password, iterations = KDF_ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(username, password, salt, iterations);
  const plaintext = encoder.encode(JSON.stringify(config));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    ciphertext: bytesToB64(ciphertext),
  };
}

// Resolves to null on a wrong username/password.
export async function decryptConfig(envelope, username, password) {
  if (!envelope || envelope.v !== 1) throw new Error("Unsupported login file format.");
  const key = await deriveKey(username, password, b64ToBytes(envelope.salt), envelope.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(envelope.iv) },
      key,
      b64ToBytes(envelope.ciphertext),
    );
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    return null;
  }
}
