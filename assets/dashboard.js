(() => {
    'use strict';
    const get = id => document.getElementById(id);
    const storageKey = 'szkudek-dashboard-v1';
    const sectionIds = ['chess-section', 'learn-section', 'gaming-section', 'socials-section', 'shops-section'];
    const favoriteId = 'favorites-section';
    const allSectionIds = [favoriteId, ...sectionIds];
    const grids = new Map();
    const tiles = new Map();
    const sections = get('sections');
    const search = get('search');
    const geoPanel = get('geo-games');
    const geoToggle = get('geo-toggle');
    let geoManuallyOpen = false;
    let editMode = false;
    let editingTile = null;
    let noteSaveTimer;
    let dragged;
    let state;
    const node = (tag, className, text) => {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    };
    const notify = text => { get('dashboard-status').textContent = text; };
    const defaults = () => ({
        version: 1, notes: '', favorites: [], customTiles: [],
        layout: { order: {}, collapsed: [] },
        timer: { phase: 'focus', focusMinutes: 25, breakMinutes: 5, remainingMs: 1500000, deadline: null }
    });

    const favorites = node('section', 'category');
    favorites.id = favoriteId;
    const favoriteHeader = node('div', 'category-header');
    favoriteHeader.append(node('span', 'category-icon', '★'), node('h2', '', 'Ulubione'), node('span', 'category-count', '★ / FAVORITES'));
    const favoriteGrid = node('div', 'grid chess-grid');
    const favoriteEmpty = node('p', 'favorite-empty', 'Oznacz kafelki gwiazdką, aby mieć je zawsze pod ręką.');
    favorites.append(favoriteHeader, favoriteGrid, favoriteEmpty);
    sections.prepend(favorites);
    allSectionIds.forEach(id => grids.set(id, get(id).querySelector(':scope > .grid')));
    grids.set('geo-games', geoPanel.querySelector('.grid'));
    const knownGroups = new Set(grids.keys());

    grids.forEach((grid, group) => {
        if (group === favoriteId) return;
        [...grid.children].filter(child => child.classList.contains('card')).forEach(card => {
            const id = card === geoToggle ? 'group:geogames' : `builtin:${card.getAttribute('href')}`;
            tiles.set(id, { id, group, card, custom: false });
        });
    });
    const builtinIds = new Set(tiles.keys());
    function text(value, limit, allowEmpty = false) {
        if (typeof value !== 'string' || value.length > limit || (!allowEmpty && !value.trim())) throw new Error('Nieprawidłowa treść ustawień.');
        return value;
    }
    function linkUrl(value) {
        const url = new URL(text(value, 4096));
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Podaj adres HTTP lub HTTPS bez danych logowania.');
        return url.href;
    }
    function duration(timer, phase = timer.phase) {
        return (phase === 'focus' ? timer.focusMinutes : timer.breakMinutes) * 60000;
    }
    function validate(data) {
        if (!data || data.version !== 1 || !Array.isArray(data.customTiles) || data.customTiles.length > 500) throw new Error('Nieprawidłowa kopia ustawień strony.');
        const ids = new Set(builtinIds);
        const customTiles = data.customTiles.map(tile => {
            const id = text(tile.id, 100);
            if (!id.startsWith('custom:') || ids.has(id) || !sectionIds.includes(tile.section)) throw new Error('Nieprawidłowy kafelek lub sekcja.');
            ids.add(id);
            return { id, section: tile.section, name: text(tile.name, 80).trim(), url: linkUrl(tile.url), icon: text(tile.icon, 8, true), description: text(tile.description, 120, true) };
        });
        function idList(list, allowed, max = 1000) {
            if (!Array.isArray(list) || list.length > max || new Set(list).size !== list.length || list.some(id => !allowed.has(id))) throw new Error('Nieprawidłowa lista w ustawieniach.');
            return [...list];
        }
        const favorites = idList(data.favorites, new Set([...ids].filter(id => id !== 'group:geogames')));
        if (!data.layout || !data.layout.order || typeof data.layout.order !== 'object' || Array.isArray(data.layout.order)) throw new Error('Nieprawidłowy układ.');
        const order = {};
        Object.entries(data.layout.order).forEach(([group, list]) => {
            if (!knownGroups.has(group)) throw new Error('Nieznana sekcja w układzie.');
            order[group] = idList(list, ids);
        });
        const collapsed = idList(data.layout.collapsed, new Set(allSectionIds), allSectionIds.length);
        const timer = data.timer;
        if (!timer || !['focus', 'break'].includes(timer.phase) || !Number.isInteger(timer.focusMinutes) || timer.focusMinutes < 1 || timer.focusMinutes > 180 || !Number.isInteger(timer.breakMinutes) || timer.breakMinutes < 1 || timer.breakMinutes > 60 || !Number.isFinite(timer.remainingMs) || timer.remainingMs < 0 || timer.remainingMs > duration(timer) || (timer.deadline !== null && (!Number.isFinite(timer.deadline) || timer.deadline < 0 || timer.deadline > Date.now() + duration(timer) + 60000))) throw new Error('Nieprawidłowe ustawienia timera.');
        return { version: 1, notes: text(data.notes, 100000, true), favorites, customTiles, layout: { order, collapsed }, timer: { phase: timer.phase, focusMinutes: timer.focusMinutes, breakMinutes: timer.breakMinutes, remainingMs: timer.remainingMs, deadline: timer.deadline } };
    }
    try {
        const saved = localStorage.getItem(storageKey);
        state = saved ? validate(JSON.parse(saved)) : defaults();
    } catch {
        state = defaults();
        notify('Nie udało się odczytać ustawień. Zachowano zapisane dane; możesz przywrócić kopię.');
    }
    function persist(message = 'Zapisano ustawienia w tej przeglądarce.') {
        try {
            localStorage.setItem(storageKey, JSON.stringify(state));
            if (message) notify(message);
            return true;
        } catch {
            notify('Nie udało się zapisać zmian w przeglądarce. Wyeksportuj kopię, aby ich nie utracić.');
            return false;
        }
    }
    function actionButton(action, label, symbol, extra = '') {
        const button = node('button', `tile-action ${extra}`, symbol);
        button.type = 'button';
        button.dataset.action = action;
        button.title = label;
        button.setAttribute('aria-label', label);
        return button;
    }
    function wrapCard(info, card = info.card, group = info.group) {
        const wrapper = node('div', 'tile-wrap');
        wrapper.dataset.tileId = info.id;
        wrapper.dataset.group = group;
        if (info.custom) wrapper.dataset.customTile = 'true';
        const tools = node('div', 'tile-tools');
        if (info.id !== 'group:geogames') {
            tools.append(actionButton('favorite', 'Dodaj do ulubionych', '☆'));
        }
        const handle = actionButton('drag', 'Przeciągnij kafelek', '⠿', 'layout-control tile-drag');
        handle.draggable = true;
        tools.append(handle, actionButton('earlier', 'Przesuń wcześniej', '←', 'layout-control'), actionButton('later', 'Przesuń później', '→', 'layout-control'));
        if (info.custom) tools.append(actionButton('edit', 'Edytuj kafelek', '✎', 'layout-control'), actionButton('delete', 'Usuń kafelek', '×', 'layout-control'));
        card.replaceWith(wrapper);
        wrapper.append(card, tools);
        return wrapper;
    }
    tiles.forEach(info => wrapCard(info));
    const bodyMap = new Map();
    allSectionIds.forEach(id => {
        const section = get(id);
        const header = section.querySelector('.category-header');
        const body = node('div', 'section-body');
        body.id = `${id}-content`;
        [...section.children].filter(child => child !== header).forEach(child => body.append(child));
        section.append(body);
        const toggle = node('button', 'section-toggle', 'Zwiń');
        toggle.type = 'button';
        toggle.setAttribute('aria-controls', body.id);
        toggle.setAttribute('aria-label', `Zwiń sekcję ${header.querySelector('h2').textContent}`);
        header.append(toggle);
        bodyMap.set(id, { body, toggle });
        toggle.addEventListener('click', () => {
            const collapsed = !body.hidden;
            state.layout.collapsed = state.layout.collapsed.filter(value => value !== id);
            if (collapsed) state.layout.collapsed.push(id);
            setSectionOpen(id, !collapsed);
            persist();
        });
    });
    function setSectionOpen(id, open) {
        const { body, toggle } = bodyMap.get(id);
        body.hidden = !open;
        toggle.textContent = open ? 'Zwiń' : 'Rozwiń';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', `${open ? 'Zwiń' : 'Rozwiń'} sekcję ${get(id).querySelector('h2').textContent}`);
    }
    function applyOrders() {
        grids.forEach((grid, group) => {
            const order = state.layout.order[group] || [];
            const wrappers = [...grid.children].filter(child => child.classList.contains('tile-wrap'));
            const rank = id => order.includes(id) ? order.indexOf(id) : order.length;
            wrappers.sort((a, b) => rank(a.dataset.tileId) - rank(b.dataset.tileId)).forEach(wrapper => grid.insertBefore(wrapper, grid.querySelector(':scope > .geo-panel')));
            updateMoveButtons(grid);
        });
    }
    function updateMoveButtons(grid) {
        const wrappers = [...grid.children].filter(child => child.classList.contains('tile-wrap'));
        wrappers.forEach((wrapper, index) => {
            wrapper.querySelector('[data-action="earlier"]').disabled = index === 0;
            wrapper.querySelector('[data-action="later"]').disabled = index === wrappers.length - 1;
        });
    }
    function saveOrder(grid, group) {
        state.layout.order[group] = [...grid.children].filter(child => child.classList.contains('tile-wrap')).map(child => child.dataset.tileId);
        updateMoveButtons(grid);
        persist('Pozycja kafelka została zapisana.');
    }
    function renderCustom() {
        sections.querySelectorAll('[data-custom-tile]').forEach(wrapper => wrapper.remove());
        [...tiles].filter(([, info]) => info.custom).forEach(([id]) => tiles.delete(id));
        state.customTiles.forEach(tile => {
            const card = node('a', `card custom-card${tile.section === 'shops-section' ? ' shop-card' : ''}`);
            card.href = tile.url;
            card.target = '_blank';
            card.rel = 'noopener';
            card.append(node('span', 'card-icon', tile.icon || '🔗'), node('span', 'card-name', tile.name));
            if (tile.description) card.append(node('span', 'card-desc', tile.description));
            grids.get(tile.section).append(card);
            const info = { id: tile.id, group: tile.section, card, custom: true };
            tiles.set(tile.id, info);
            wrapCard(info);
        });
    }
    function renderFavorites() {
        favoriteGrid.replaceChildren();
        state.favorites.forEach(id => {
            const info = tiles.get(id);
            if (!info) return;
            const card = info.card.cloneNode(true);
            card.removeAttribute('id');
            card.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
            card.classList.remove('shop-card');
            favoriteGrid.append(card);
            wrapCard(info, card, favoriteId);
        });
        favoriteEmpty.hidden = state.favorites.length > 0;
        sections.querySelectorAll('[data-action="favorite"]').forEach(button => {
            const wrapper = button.closest('.tile-wrap');
            const active = state.favorites.includes(wrapper.dataset.tileId);
            const info = tiles.get(wrapper.dataset.tileId);
            const name = info?.card.querySelector('.card-name')?.textContent || 'kafelek';
            button.textContent = active ? '★' : '☆';
            button.setAttribute('aria-pressed', String(active));
            button.setAttribute('aria-label', `${active ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}: ${name}`);
            button.title = button.getAttribute('aria-label');
        });
        applyOrders();
    }
    function setGeoOpen(open) {
        geoPanel.hidden = !open;
        geoToggle.setAttribute('aria-expanded', String(open));
        get('geo-toggle-label').textContent = open ? 'Gry rozwinięte · kliknij, aby zwinąć' : 'Wybierz grę · 3 gry';
    }
    function applyFilter() {
        const query = search.value.toLocaleLowerCase('pl').trim();
        const groupMatch = !!query && 'geogames'.includes(query);
        const geoCards = [...geoPanel.querySelectorAll('a.card')];
        const childMatch = !!query && geoCards.some(card => card.textContent.toLocaleLowerCase('pl').includes(query));
        setGeoOpen(query ? groupMatch || childMatch : geoManuallyOpen);
        let count = 0;
        allSectionIds.forEach(id => {
            const section = get(id);
            let sectionCount = 0;
            section.querySelectorAll('.tile-wrap').forEach(wrapper => {
                const card = wrapper.querySelector(':scope > .card');
                const match = !query || card.textContent.toLocaleLowerCase('pl').includes(query) || (groupMatch && geoPanel.contains(card)) || (card === geoToggle && childMatch);
                wrapper.hidden = !match;
                if (match) sectionCount++;
            });
            section.hidden = !!query && sectionCount === 0;
            setSectionOpen(id, query ? sectionCount > 0 : !state.layout.collapsed.includes(id));
            count += sectionCount;
        });
        get('no-results').style.display = query && count === 0 ? 'block' : 'none';
    }
    geoToggle.addEventListener('click', () => { geoManuallyOpen = geoPanel.hidden; setGeoOpen(geoManuallyOpen); });
    function closeGeo() { geoManuallyOpen = false; setGeoOpen(false); geoToggle.focus(); }
    get('geo-close').addEventListener('click', closeGeo);
    geoPanel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeGeo(); } });
    search.addEventListener('input', applyFilter);

    get('edit-layout').addEventListener('click', () => {
        editMode = !editMode;
        document.body.classList.toggle('layout-editing', editMode);
        get('edit-layout').setAttribute('aria-pressed', String(editMode));
        get('edit-layout').textContent = editMode ? '✓ Zakończ edycję układu' : '↔ Edytuj układ';
        get('layout-help').hidden = !editMode;
    });
    sections.addEventListener('click', event => {
        const button = event.target.closest('[data-action]');
        if (!button) return;
        event.preventDefault();
        const wrapper = button.closest('.tile-wrap');
        const id = wrapper.dataset.tileId;
        const action = button.dataset.action;
        if (action === 'favorite') {
            state.favorites = state.favorites.includes(id) ? state.favorites.filter(value => value !== id) : [...state.favorites, id];
            persist(); renderFavorites(); applyFilter();
        } else if (action === 'earlier' || action === 'later') {
            const grid = wrapper.parentElement;
            const list = [...grid.children].filter(child => child.classList.contains('tile-wrap'));
            const index = list.indexOf(wrapper);
            const target = list[index + (action === 'earlier' ? -1 : 1)];
            if (target) { grid.insertBefore(wrapper, action === 'earlier' ? target : target.nextSibling); saveOrder(grid, wrapper.dataset.group); }
        } else if (action === 'edit') {
            openTileDialog(id);
        } else if (action === 'delete') {
            if (!confirm('Usunąć ten własny kafelek?')) return;
            state.customTiles = state.customTiles.filter(tile => tile.id !== id);
            state.favorites = state.favorites.filter(value => value !== id);
            Object.keys(state.layout.order).forEach(group => { state.layout.order[group] = state.layout.order[group].filter(value => value !== id); });
            persist(); renderTiles();
        }
    });
    sections.addEventListener('dragstart', event => {
        const handle = event.target.closest('[data-action="drag"]');
        if (!handle || !editMode) { if (editMode) event.preventDefault(); return; }
        const wrapper = handle.closest('.tile-wrap');
        dragged = wrapper;
        wrapper.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', wrapper.dataset.tileId);
    });
    sections.addEventListener('dragover', event => {
        const target = event.target.closest('.tile-wrap');
        sections.querySelectorAll('.drag-target').forEach(element => element.classList.remove('drag-target'));
        if (!dragged || !target || dragged === target || dragged.parentElement !== target.parentElement) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        target.classList.add('drag-target');
    });
    sections.addEventListener('drop', event => {
        const target = event.target.closest('.tile-wrap');
        if (!dragged || !target || dragged === target || dragged.parentElement !== target.parentElement) return;
        event.preventDefault();
        const rect = target.getBoundingClientRect();
        const after = event.clientY > rect.bottom || (event.clientY >= rect.top && event.clientX > rect.left + rect.width / 2);
        const grid = target.parentElement;
        grid.insertBefore(dragged, after ? target.nextSibling : target);
        saveOrder(grid, dragged.dataset.group);
    });
    sections.addEventListener('dragend', () => {
        sections.querySelectorAll('.dragging, .drag-target').forEach(element => element.classList.remove('dragging', 'drag-target'));
        dragged = null;
    });

    function openTileDialog(id = null) {
        editingTile = id;
        const tile = state.customTiles.find(value => value.id === id);
        get('tile-form').reset();
        get('tile-dialog-title').textContent = tile ? 'Edytuj kafelek' : 'Dodaj kafelek';
        get('tile-form-status').textContent = '';
        if (tile) {
            get('tile-name').value = tile.name; get('tile-url').value = tile.url;
            get('tile-section').value = tile.section; get('tile-icon').value = tile.icon; get('tile-description').value = tile.description;
        }
        get('tile-dialog').showModal();
    }
    get('add-tile').addEventListener('click', () => openTileDialog());
    get('tile-cancel').addEventListener('click', () => get('tile-dialog').close());
    get('tile-form').addEventListener('submit', event => {
        event.preventDefault();
        try {
            const tile = {
                id: editingTile || `custom:${crypto.randomUUID()}`, name: get('tile-name').value.trim(),
                url: linkUrl(get('tile-url').value.trim()), section: get('tile-section').value,
                icon: get('tile-icon').value.trim(), description: get('tile-description').value.trim()
            };
            const next = { ...state, customTiles: [...state.customTiles.filter(value => value.id !== tile.id), tile] };
            state = validate(next);
            if (!persist()) {
                editingTile = tile.id;
                get('tile-form-status').textContent = 'Nie udało się zapisać w przeglądarce. Kafelek jest dostępny w tej sesji; wyeksportuj kopię.';
                renderTiles();
                return;
            }
            renderTiles();
            get('tile-dialog').close();
            const targetSection = get(tile.section);
            targetSection.hidden = false;
            if (search.value) { search.value = ''; applyFilter(); }
            state.layout.collapsed = state.layout.collapsed.filter(id => id !== tile.section);
            setSectionOpen(tile.section, true);
            persist('Zapisano własny kafelek.');
        } catch (error) { get('tile-form-status').textContent = error.message; }
    });
    function renderTiles() { renderCustom(); renderFavorites(); applyFilter(); }

    get('personal-notes').value = state.notes;
    get('personal-notes').addEventListener('input', event => {
        state.notes = event.target.value;
        get('notes-status').textContent = 'Zapisywanie…';
        clearTimeout(noteSaveTimer);
        noteSaveTimer = setTimeout(() => {
            get('notes-status').textContent = persist('') ? 'Zapisano automatycznie w tej przeglądarce.' : 'Nie zapisano — wyeksportuj kopię.';
        }, 300);
    });
    window.addEventListener('pagehide', () => { clearTimeout(noteSaveTimer); persist(''); });

    function remaining() { return state.timer.deadline === null ? state.timer.remainingMs : Math.min(duration(state.timer), Math.max(0, state.timer.deadline - Date.now())); }
    function renderTimer() {
        const timer = state.timer;
        if (timer.deadline !== null && timer.deadline <= Date.now()) {
            const finishedFocus = timer.phase === 'focus';
            timer.phase = finishedFocus ? 'break' : 'focus';
            timer.deadline = null;
            timer.remainingMs = duration(timer);
            persist('');
            get('focus-status').textContent = finishedFocus ? 'Sesja zakończona. Czas na przerwę — kliknij Start, gdy będziesz gotowy.' : 'Przerwa zakończona. Możesz rozpocząć kolejną sesję.';
        }
        const seconds = Math.ceil(remaining() / 1000);
        get('focus-countdown').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        get('focus-phase').textContent = timer.phase === 'focus' ? 'Skupienie' : 'Przerwa';
        get('focus-start').textContent = timer.deadline === null ? 'Start' : 'Pauza';
        get('focus-skip').textContent = timer.phase === 'focus' ? 'Przejdź do przerwy' : 'Przejdź do skupienia';
        get('focus-minutes').disabled = get('break-minutes').disabled = timer.deadline !== null;
    }
    function syncTimerInputs() { get('focus-minutes').value = state.timer.focusMinutes; get('break-minutes').value = state.timer.breakMinutes; }
    get('focus-start').addEventListener('click', () => {
        renderTimer();
        if (state.timer.deadline === null) {
            state.timer.deadline = Date.now() + (state.timer.remainingMs || duration(state.timer));
            get('focus-status').textContent = 'Timer działa. Możesz zamknąć panel i wrócić później.';
        } else {
            state.timer.remainingMs = remaining(); state.timer.deadline = null;
            get('focus-status').textContent = 'Timer wstrzymany.';
        }
        persist(''); renderTimer();
    });
    get('focus-reset').addEventListener('click', () => {
        state.timer.deadline = null; state.timer.remainingMs = duration(state.timer);
        get('focus-status').textContent = 'Timer ustawiony od nowa.';
        persist(''); renderTimer();
    });
    get('focus-skip').addEventListener('click', () => {
        state.timer.phase = state.timer.phase === 'focus' ? 'break' : 'focus';
        state.timer.deadline = null; state.timer.remainingMs = duration(state.timer);
        get('focus-status').textContent = 'Kliknij Start, aby rozpocząć.';
        persist(''); renderTimer();
    });
    ['focus-minutes', 'break-minutes'].forEach(id => get(id).addEventListener('change', () => {
        const input = get(id);
        if (!input.checkValidity() || !Number.isInteger(Number(input.value))) { input.reportValidity(); syncTimerInputs(); return; }
        state.timer[id === 'focus-minutes' ? 'focusMinutes' : 'breakMinutes'] = Number(input.value);
        state.timer.remainingMs = duration(state.timer); state.timer.deadline = null;
        persist(''); renderTimer();
    }));
    syncTimerInputs(); renderTimer();
    if (state.timer.deadline !== null) get('focus-status').textContent = 'Przywrócono działający timer.';
    else if (state.timer.remainingMs < duration(state.timer)) get('focus-status').textContent = 'Przywrócono wstrzymany timer. Kliknij Start, aby kontynuować.';
    setInterval(renderTimer, 250);
    document.addEventListener('visibilitychange', renderTimer);

    function download(data, filename) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = node('a'); link.href = url; link.download = filename;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    get('dashboard-export').addEventListener('click', () => {
        try {
            clearTimeout(noteSaveTimer); persist('');
            download({ app: 'szkudek-commandcenter', version: 1, dashboard: validate(state), radio: window.CommandCenterRadio.exportData() }, 'szkudek-commandcenter.json');
            notify('Wyeksportowano radio i wszystkie ustawienia strony.');
        } catch (error) { notify(`Nie udało się wyeksportować kopii: ${error.message}`); }
    });
    get('dashboard-import').addEventListener('click', () => get('dashboard-import-file').click());
    get('dashboard-import-file').addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (file.size > 2 * 1024 * 1024) throw new Error('Kopia może mieć maksymalnie 2 MB.');
            const data = JSON.parse(await file.text());
            if (data.app !== 'szkudek-commandcenter' || data.version !== 1) throw new Error('To nie jest wspólna kopia ustawień CommandCenter.');
            const next = validate(data.dashboard);
            const radio = window.CommandCenterRadio;
            const nextRadio = radio.validateData(data.radio);
            if (!confirm('Import zastąpi obecne notatki, radio, ulubione, własne kafelki, układ i timer. Kontynuować?')) return;
            if (next.timer.deadline !== null) {
                next.timer.remainingMs = Math.min(duration(next.timer), Math.max(0, next.timer.deadline - Date.now()));
                next.timer.deadline = null;
            }
            const previous = [localStorage.getItem(storageKey), localStorage.getItem(radio.storageKey)];
            try {
                localStorage.setItem(radio.storageKey, JSON.stringify(nextRadio));
                localStorage.setItem(storageKey, JSON.stringify(next));
            } catch (error) {
                [storageKey, radio.storageKey].forEach((key, index) => {
                    if (previous[index] === null) localStorage.removeItem(key); else localStorage.setItem(key, previous[index]);
                });
                throw error;
            }
            clearTimeout(noteSaveTimer);
            state = next;
            radio.reloadSettings();
            get('personal-notes').value = state.notes;
            get('notes-status').textContent = 'Przywrócono notatki z kopii.';
            search.value = ''; geoManuallyOpen = false;
            renderTiles(); syncTimerInputs(); renderTimer();
            get('focus-status').textContent = 'Przywrócono timer. Kliknij Start, aby go uruchomić.';
            notify('Przywrócono radio i wszystkie ustawienia strony.');
        } catch (error) { notify(`Nie udało się zaimportować kopii: ${error.message}`); }
        finally { event.target.value = ''; }
    });
    renderTiles();
})();
