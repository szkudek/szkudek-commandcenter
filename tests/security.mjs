// Run with Node.js 22+: node --test tests/security.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = await readFile(new URL('../assets/dashboard.js', import.meta.url), 'utf8');
const context = vm.createContext({ URL });
const declarations = source.match(/const baseSectionIds = [^;]+;/)[0] + source.match(/const favoriteId = [^;]+;/)[0];
vm.runInContext(declarations + `const builtinIds = new Set(['builtin:https://example.com/', 'group:geogames']);` + source.slice(source.indexOf('    function text('), source.indexOf('    try {\n        const saved')), context);
const validate = value => context.validate(value);
const legacy = () => ({ version: 1, notes: [], activeNoteId: null, favorites: [], customTiles: [], layout: { order: {}, collapsed: [] } });

test('old settings and text-only notes migrate without losing data', () => {
    const settings = validate({ ...legacy(), notes: 'Moja stara notatka ♟' });
    assert.equal(settings.notes[0].body, 'Moja stara notatka ♟');
    assert.equal(settings.compact, false);
    assert.equal(settings.customSections.length, 0);
    assert.equal(settings.tasks.length, 0);
});
test('custom sections, moved built-ins, pinned notes and dated tasks survive validation', () => {
    const data = {
        ...legacy(), customSections: [{ id: 'section:test', name: 'Projekty' }],
        sectionNames: { 'socials-section': 'Kontakt' },
        tileSections: { 'builtin:https://example.com/': 'section:test' },
        customTiles: [{ id: 'custom:test', section: 'section:test', name: 'Test', url: 'https://example.org/', icon: '♟', description: '' }],
        notes: [{ id: 'note:test', title: 'Plan', body: 'Treść', category: 'Szachy', updatedAt: 1, pinned: true }],
        tasks: [{ id: 'task:test', title: 'Trening', date: '2026-11-01', done: true }],
        compact: true, layout: { order: { 'section:test': ['custom:test'] }, collapsed: ['section:test'] }
    };
    const checked = validate(data);
    assert.equal(checked.tileSections['builtin:https://example.com/'], 'section:test');
    assert.equal(checked.notes[0].pinned, true);
    assert.equal(checked.tasks[0].done, true);
    assert.equal(checked.customTiles[0].section, 'section:test');
    assert.equal(checked.layout.collapsed[0], 'section:test');
});
test('hostile URLs, unknown sections, duplicate IDs and invalid dates are rejected', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.org/']) {
        assert.throws(() => validate({ ...legacy(), customTiles: [{ id: 'custom:test', section: 'socials-section', name: 'Test', url, icon: '', description: '' }] }));
    }
    assert.throws(() => validate({ ...legacy(), customSections: [{ id: '__proto__', name: 'Test' }] }));
    assert.throws(() => validate({ ...legacy(), tileSections: { 'builtin:https://example.com/': 'missing' } }));
    const section = { id: 'section:test', name: 'Test' };
    assert.throws(() => validate({ ...legacy(), customSections: [section, section] }));
    const task = { id: 'task:test', title: 'Test', date: '2026-02-30', done: false };
    assert.throws(() => validate({ ...legacy(), tasks: [task] }));
    assert.throws(() => validate({ ...legacy(), tasks: [{ ...task, date: '2026-11-01' }, { ...task, date: '2026-11-01' }] }));
});

const sandbox = { window: {}, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob };
vm.runInNewContext(await readFile(new URL('../assets/backup.js', import.meta.url), 'utf8'), sandbox);
const backup = sandbox.window.CommandCenterBackup;
test('encrypted backups round-trip Unicode, use random salt/IV and reject tampering', async () => {
    const payload = { app: 'szkudek-commandcenter', notes: 'Zażółć gęślą ♟' };
    const password = 'Testowe-dlugie-haslo-123';
    const encrypted = await backup.encrypt(payload, password);
    assert.equal(JSON.stringify(await backup.decrypt(encrypted, password)), JSON.stringify(payload));
    const second = await backup.encrypt(payload, password);
    assert.notEqual(second.salt, encrypted.salt);
    assert.notEqual(second.iv, encrypted.iv);
    await assert.rejects(() => backup.decrypt(encrypted, 'Nieprawidlowe-haslo'));
    const altered = { ...encrypted, ciphertext: (encrypted.ciphertext[0] === 'A' ? 'B' : 'A') + encrypted.ciphertext.slice(1) };
    await assert.rejects(() => backup.decrypt(altered, password));
    await assert.rejects(() => backup.decrypt({ ...encrypted, iterations: 999999999 }, password));
    await assert.rejects(() => backup.encrypt(payload, 'krótkie'));
});
