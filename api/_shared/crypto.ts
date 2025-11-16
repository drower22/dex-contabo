/**
 * @file dex-contabo/api/_shared/crypto.ts
 * @description Utilitários de criptografia AES-GCM para Contabo deployment
 * 
 * Versão simplificada do crypto.ts principal, sem JSDoc extenso.
 * Fornece funções básicas para criptografar/descriptografar tokens.
 * 
 * ALGORITMO: AES-GCM (Galois/Counter Mode)
 * - IV de 12 bytes gerado aleatoriamente
 * - Chave de 256 bits (32 bytes) em base64
 * 
 * REQUISITOS:
 * - Node.js 18+ (Web Crypto API)
 * - ENCRYPTION_KEY em base64 (32 bytes)
 */

import { webcrypto } from 'node:crypto';

// Use Node.js Web Crypto API
const crypto = webcrypto;

/**
 * Obtém chave de criptografia do ambiente.
 * @returns Chave como Uint8Array
 * @throws Se ENCRYPTION_KEY ausente ou inválida
 */
function getKeyBytes(): Uint8Array {
  const b64 = process.env.ENCRYPTION_KEY || '';
  if (!b64) throw new Error('Missing ENCRYPTION_KEY');
  try {
    return Uint8Array.from(Buffer.from(b64, 'base64'));
  } catch {
    throw new Error('Invalid ENCRYPTION_KEY: must be base64');
  }
}

/**
 * Importa chave para Web Crypto API.
 * @returns Promise com CryptoKey
 */
async function importKey() {
  const keyBytes = getKeyBytes();
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Criptografa string usando AES-GCM.
 * @param plain - Texto a criptografar
 * @returns Promise com texto em base64
 */
export async function encryptToB64(plain: string): Promise<string> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(String(plain));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
  const payload = new Uint8Array(iv.length + (cipher as ArrayBuffer).byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(cipher as ArrayBuffer), iv.length);
  return Buffer.from(payload).toString('base64');
}

/**
 * Descriptografa string de base64 usando AES-GCM.
 * @param b64 - Texto criptografado em base64
 * @returns Promise com texto descriptografado
 * @throws Se input inválido ou descriptografia falhar
 */
export async function decryptFromB64(b64: string): Promise<string> {
  try {
    if (!b64 || typeof b64 !== 'string') {
      throw new Error('Invalid input: b64 must be a non-empty string');
    }
    
    const key = await importKey();
    
    // Use atob() like Supabase Edge Functions for compatibility
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64').toString('binary'), (c) => c.charCodeAt(0));
    
    if (bytes.length < 13) {
      throw new Error(`Invalid encrypted data: too short (${bytes.length} bytes, expected at least 13)`);
    }
    
    const iv = bytes.slice(0, 12);
    const data = bytes.slice(12);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return new TextDecoder().decode(plainBuf);
  } catch (e: any) {
    console.error('[crypto] decryptFromB64 error:', {
      error: e.message,
      hasKey: !!process.env.ENCRYPTION_KEY,
      inputLength: b64?.length,
      inputPreview: b64?.substring(0, 20) + '...',
      stack: e.stack,
    });
    throw new Error(`Decryption failed: ${e.message}`);
  }
}
