(() => {
    'use strict';
    const iterations = 310000;
    const encode = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    const decode = value => {
        if (typeof value !== 'string' || value.length > 22 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Nieprawidłowy zaszyfrowany plik.');
        return Uint8Array.from(atob(value), char => char.charCodeAt(0));
    };
    const requireCrypto = () => {
        if (!globalThis.crypto?.subtle) throw new Error('Szyfrowanie wymaga HTTPS lub localhost oraz obsługiwanej przeglądarki.');
    };
    async function derive(password, salt) {
        requireCrypto();
        const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
        return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations, salt }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async function encrypt(data, password) {
        requireCrypto();
        if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Hasło musi mieć od 12 do 1024 znaków.');
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await derive(password, salt);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
        return { app: 'szkudek-commandcenter-encrypted', version: 1, algorithm: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations, salt: encode(salt), iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) };
    }
    async function decrypt(data, password) {
        requireCrypto();
        if (!data || data.app !== 'szkudek-commandcenter-encrypted' || data.version !== 1 || data.algorithm !== 'AES-GCM' || data.kdf !== 'PBKDF2-SHA256' || data.iterations !== iterations) throw new Error('Nieobsługiwany format szyfrowanej kopii.');
        if (typeof password !== 'string' || !password.length || password.length > 1024) throw new Error('Wpisz hasło kopii.');
        const salt = decode(data.salt), iv = decode(data.iv), ciphertext = decode(data.ciphertext);
        if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16) throw new Error('Nieprawidłowy zaszyfrowany plik.');
        const key = await derive(password, salt);
        let plain;
        try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext); }
        catch { throw new Error('Nieprawidłowe hasło lub uszkodzony plik kopii.'); }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
    }
    window.CommandCenterBackup = Object.freeze({ encrypt, decrypt });
})();
