/**
 * @file api/_shared/crypto.js
 * @description Utilitários de criptografia AES-GCM
 * Versão JavaScript puro (convertido de TypeScript)
 * 
 * ALGORITMO: AES-GCM (Galois/Counter Mode)
 * - IV de 12 bytes gerado aleatoriamente
 * - Chave de 256 bits (32 bytes) em base64
 * 
 * REQUISITOS:
 * - Node.js 18+ (Web Crypto API)
 * - ENCRYPTION_KEY em base64 (32 bytes)
 */

const crypto = require('crypto');

/**
 * Obtém chave de criptografia do ambiente
 * @returns {Uint8Array} Chave como Uint8Array
 * @throws {Error} Se ENCRYPTION_KEY ausente ou inválida
 */
function getKeyBytes() {
  const b64 = process.env.ENCRYPTION_KEY || '';
  if (!b64) throw new Error('Missing ENCRYPTION_KEY');
  try {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  } catch {
    throw new Error('Invalid ENCRYPTION_KEY: must be base64');
  }
}

/**
 * Importa chave para Web Crypto API
 * @returns {Promise<CryptoKey>} Promise com CryptoKey
 */
async function importKey() {
  const keyBytes = getKeyBytes();
  return crypto.webcrypto.subtle.importKey(
    'raw', 
    keyBytes, 
    { name: 'AES-GCM' }, 
    false, 
    ['encrypt', 'decrypt']
  );
}

/**
 * Criptografa string usando AES-GCM
 * @param {string} plain - Texto a criptografar
 * @returns {Promise<string>} Promise com texto em base64
 */
async function encryptToB64(plain) {
  const key = await importKey();
  const iv = crypto.webcrypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(String(plain));
  const cipher = await crypto.webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, 
    key, 
    enc
  );
  const payload = new Uint8Array(iv.length + cipher.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(cipher), iv.length);
  return Buffer.from(payload).toString('base64');
}

/**
 * Descriptografa string de base64 usando AES-GCM
 * @param {string} b64 - Texto criptografado em base64
 * @returns {Promise<string>} Promise com texto descriptografado
 * @throws {Error} Se input inválido ou descriptografia falhar
 */
async function decryptFromB64(b64) {
  try {
    if (!b64 || typeof b64 !== 'string') {
      throw new Error('Invalid input: b64 must be a non-empty string');
    }
    
    const key = await importKey();
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    
    if (bytes.length < 13) {
      throw new Error(`Invalid encrypted data: too short (${bytes.length} bytes, expected at least 13)`);
    }
    
    const iv = bytes.slice(0, 12);
    const data = bytes.slice(12);
    const plainBuf = await crypto.webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, 
      key, 
      data
    );
    return new TextDecoder().decode(plainBuf);
  } catch (e) {
    console.error('[crypto] decryptFromB64 error:', {
      error: e.message,
      hasKey: !!process.env.ENCRYPTION_KEY,
      inputLength: b64?.length,
      inputPreview: b64?.substring(0, 20) + '...'
    });
    throw new Error(`Decryption failed: ${e.message}`);
  }
}

module.exports = {
  encryptToB64,
  decryptFromB64
};
