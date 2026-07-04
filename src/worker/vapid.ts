// VAPID JWT + RFC 8291 (aes128gcm) Web Push encryption
// Uses only Web Crypto API (SubtleCrypto) — no Node.js dependencies.

export function b64uEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function b64uDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function generateVapidKeys(): Promise<{
  privateJwk: JsonWebKey;
  publicKeyB64u: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  return { privateJwk, publicKeyB64u: b64uEncode(publicRaw) };
}

async function createVapidJwt(
  endpoint: string,
  privateJwk: JsonWebKey,
  subject: string
): Promise<string> {
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const enc = new TextEncoder();

  const header = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(
    enc.encode(JSON.stringify({ aud: origin, exp: now + 43200, sub: subject }))
  );
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(unsigned)
  );

  return `${unsigned}.${b64uEncode(sig)}`;
}

// RFC 8291 + RFC 8188 (aes128gcm) content encryption
async function encryptPushPayload(
  plaintext: string,
  p256dhB64u: string,
  authB64u: string
): Promise<{ body: Uint8Array }> {
  const enc = new TextEncoder();

  const uaPublicKeyRaw = b64uDecode(p256dhB64u);
  const uaAuth = b64uDecode(authB64u);

  // Generate ephemeral server ECDH key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const serverPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeyPair.publicKey)
  );

  // Import UA public key for ECDH
  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicKeyRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // ECDH shared secret
  const ecdhSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPublicKey },
    serverKeyPair.privateKey,
    256
  );

  // Random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Derive IKM via HKDF-SHA-256:
  // ikm = HKDF(salt=uaAuth, ikm=ecdhSecret, info="WebPush: info\0" + ua_pub + server_pub, L=32)
  const keyInfo = new Uint8Array([
    ...enc.encode("WebPush: info\0"),
    ...uaPublicKeyRaw,
    ...serverPublicKeyRaw,
  ]);

  const ecdhKey = await crypto.subtle.importKey("raw", ecdhSecret, "HKDF", false, [
    "deriveBits",
  ]);
  const ikm = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: uaAuth, info: keyInfo },
    ecdhKey,
    32 * 8
  );

  // Derive CEK (16 bytes) and nonce (12 bytes) from IKM
  const ikmKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);

  const [cek, nonce] = await Promise.all([
    crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: enc.encode("Content-Encoding: aes128gcm\0"),
      },
      ikmKey,
      16 * 8
    ),
    crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: enc.encode("Content-Encoding: nonce\0"),
      },
      ikmKey,
      12 * 8
    ),
  ]);

  // Pad plaintext: append 0x02 delimiter byte
  const plaintextBytes = enc.encode(plaintext);
  const padded = new Uint8Array(plaintextBytes.length + 1);
  padded.set(plaintextBytes, 0);
  padded[plaintextBytes.length] = 0x02;

  // AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey(
    "raw",
    cek,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    aesKey,
    padded
  );

  // RFC 8188 content-coding header: salt(16) + rs(4 BE) + idlen(1) + keyid(65) + ciphertext
  const header = new Uint8Array(16 + 4 + 1 + serverPublicKeyRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = serverPublicKeyRaw.length; // 65
  header.set(serverPublicKeyRaw, 21);

  const body = new Uint8Array(header.length + ciphertext.byteLength);
  body.set(header, 0);
  body.set(new Uint8Array(ciphertext), header.length);

  return { body };
}

export interface WebPushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
}

/**
 * Send a Web Push notification. Returns false if the subscription is expired/gone
 * (caller should delete it), true otherwise (including network errors — don't delete on transient failures).
 */
export async function sendWebPush(
  subscription: WebPushSubscription,
  payload: WebPushPayload,
  privateJwk: JsonWebKey,
  publicKeyB64u: string,
  subject: string
): Promise<boolean> {
  try {
    const jwt = await createVapidJwt(subscription.endpoint, privateJwk, subject);
    const { body } = await encryptPushPayload(
      JSON.stringify(payload),
      subscription.p256dh,
      subscription.auth
    );

    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${jwt},k=${publicKeyB64u}`,
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "aes128gcm",
        TTL: "86400",
      },
      body,
    });

    // 410 Gone / 404 Not Found = subscription is dead, caller should remove it
    if (res.status === 410 || res.status === 404) return false;
    return true;
  } catch {
    return true; // network error — keep subscription
  }
}
