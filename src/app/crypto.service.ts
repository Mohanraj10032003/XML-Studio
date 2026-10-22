import { Injectable } from '@angular/core';

/**
 * CryptoService – AES-256-GCM via the browser's Web Crypto API.
 * The key comes from the passphrase the user types, stretched with
 * PBKDF2 (SHA-256, 200k iterations) and a random salt.
 *
 * File format:  EXMLv1:<base64( salt[16] | iv[12] | ciphertext+tag )>
 */
export const MAGIC = 'EXMLv1:';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private readonly enc = new TextEncoder();
  private readonly dec = new TextDecoder();
  private readonly ITER = 200_000;

  isEncrypted(text: string): boolean {
    return text.trimStart().startsWith(MAGIC);
  }

  async encrypt(plain: string, passphrase: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.derive(passphrase, salt);
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, this.enc.encode(plain))
    );
    const packed = new Uint8Array(salt.length + iv.length + ct.length);
    packed.set(salt, 0);
    packed.set(iv, 16);
    packed.set(ct, 28);
    return MAGIC + this.toB64(packed);
  }

  async decrypt(payload: string, passphrase: string): Promise<string> {
    const body = payload.trim().slice(MAGIC.length);
    const packed = this.fromB64(body);
    const salt = packed.slice(0, 16);
    const iv = packed.slice(16, 28);
    const ct = packed.slice(28);
    const key = await this.derive(passphrase, salt);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
      return this.dec.decode(plain);
    } catch {
      throw new Error('Unable to decrypt this file. Check the key and try again.');
    }
  }

  /**
   * Encode plain XML in the nibble-pair format used by the internal Python tool.
   * Its decoder reconstructs each byte as:
   * (input[2*i] & 0x0F) | (input[2*i+1] & 0xF0)
   */
  encryptCompatible(plain: string): Uint8Array {
    const source = this.enc.encode(plain);
    const output = new Uint8Array(source.length * 2);
    for (let i = 0; i < source.length; i++) {
      const value = source[i];
      output[i * 2] = 0x40 | (value & 0x0F);
      output[i * 2 + 1] = value & 0xF0;
    }
    return output;
  }

  /** Decode the internal application's nibble-pair key format. */
  decryptCompatible(buffer: ArrayBuffer): string {
    const input = new Uint8Array(buffer);
    if (input.length === 0 || input.length % 2 !== 0) {
      throw new Error('This key file has an invalid length for the internal key format.');
    }
    const output = new Uint8Array(input.length / 2);
    for (let i = 0; i < output.length; i++) {
      output[i] = (input[i * 2] & 0x0F) | (input[i * 2 + 1] & 0xF0);
    }
    return this.dec.decode(output);
  }

  /** Strong random key: XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX */
  generateKey(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let out = '';
    bytes.forEach((b, i) => {
      out += chars[b % chars.length];
      if ((i + 1) % 8 === 0 && i < 31) out += '-';
    });
    return out;
  }

  /** 0-4 simple strength score */
  strength(pass: string): number {
    let s = 0;
    if (pass.length >= 8) s++;
    if (pass.length >= 14) s++;
    if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) s++;
    if (/\d/.test(pass) && /[^A-Za-z0-9]/.test(pass)) s++;
    return Math.min(s, 4);
  }

  private async derive(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const material = await crypto.subtle.importKey(
      'raw',
      this.enc.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: this.ITER, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private toB64(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  private fromB64(b64: string): Uint8Array {
    const bin = atob(b64.replace(/\s+/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
}
