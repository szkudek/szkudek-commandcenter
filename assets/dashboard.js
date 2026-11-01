(() => {
    'use strict';
    const get = id => document.getElementById(id);
    const storageKey = 'szkudek-dashboard-v1';
    const baseSectionIds = ['socials-section', 'chess-section', 'learn-section', 'gaming-section', 'shops-section'];
    const originalNames = new Map(baseSectionIds.map(id => [id, get(id).querySelector('h2').textContent]));
    const sectionIds = ['socials-section', 'chess-section', 'learn-section', 'gaming-section', 'shops-section'];
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
        version: 1, notes: [], activeNoteId: null, favorites: [], customTiles: [], customSections: [], sectionNames: {}, tileSections: {}, tasks: [], compact: false,
        layout: { order: {}, collapsed: [] }
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
    function validateNotes(value) {
        if (typeof value === 'string') {
            const body = text(value, 100000, true);
            return body.length ? [{ id: 'note:legacy', title: 'Dotychczasowa notatka', category: 'Ogólne', body, updatedAt: 0 }] : [];
        }
        if (!Array.isArray(value) || value.length > 200) throw new Error('Nieprawidłowa lista notatek (maksymalnie 200).');
        const ids = new Set();
        let totalLength = 0;
        return value.map(note => {
            const id = text(note.id, 100);
            if (!id.startsWith('note:') || ids.has(id)) throw new Error('Nieprawidłowy lub powtórzony identyfikator notatki.');
            ids.add(id);
            const body = text(note.body, 100000, true);
            totalLength += body.length;
            if (totalLength > 1000000) throw new Error('Notatki mogą zawierać łącznie maksymalnie milion znaków.');
            if (!Number.isFinite(note.updatedAt) || note.updatedAt < 0 || note.updatedAt > 8640000000000000) throw new Error('Nieprawidłowa data notatki.');
            return { id, title: text(note.title, 100, true).trim() || 'Bez tytułu', category: text(note.category, 60, true).trim() || 'Ogólne', body, updatedAt: note.updatedAt, pinned: note.pinned === true };
        });
    }
    function validate(data) {
        if (!data || data.version !== 1 || !Array.isArray(data.customTiles) || data.customTiles.length > 500) throw new Error('Nieprawidłowa kopia ustawień strony.');
        const customSections = data.customSections ?? [];
        if (!Array.isArray(customSections) || customSections.length > 30) throw new Error('Możesz utworzyć maksymalnie 30 własnych sekcji.');
        const allowedSections = new Set(baseSectionIds);
        const checkedSections = customSections.map(section => {
            const id = text(section.id, 100);
            if (!/^section:[a-zA-Z0-9-]+$/.test(id) || allowedSections.has(id)) throw new Error('Nieprawidłowa lub powtórzona sekcja.');
            allowedSections.add(id);
            return { id, name: text(section.name, 60).trim() };
        });
        const sectionNames = {};
        if (data.sectionNames != null && (typeof data.sectionNames !== 'object' || Array.isArray(data.sectionNames))) throw new Error('Nieprawidłowe nazwy sekcji.');
        Object.entries(data.sectionNames ?? {}).forEach(([id, name]) => {
            if (!baseSectionIds.includes(id)) throw new Error('Nieznana sekcja.');
            sectionNames[id] = text(name, 60).trim();
        });
        const tileSections = {};
        if (data.tileSections != null && (typeof data.tileSections !== 'object' || Array.isArray(data.tileSections))) throw new Error('Nieprawidłowe przeniesienia kafelków.');
        Object.entries(data.tileSections ?? {}).forEach(([id, group]) => {
            if (!builtinIds.has(id) || id === 'group:geogames' || !allowedSections.has(group)) throw new Error('Nieprawidłowe przeniesienie kafelka.');
            tileSections[id] = group;
        });
        if (data.compact !== undefined && typeof data.compact !== 'boolean') throw new Error('Nieprawidłowy tryb widoku.');
        const tasks = data.tasks ?? [];
        if (!Array.isArray(tasks) || tasks.length > 1000) throw new Error('Możesz zapisać maksymalnie 1000 zadań.');
        const taskIds = new Set();
        const checkedTasks = tasks.map(task => {
            const id = text(task.id, 100);
            if (!id.startsWith('task:') || taskIds.has(id) || typeof task.done !== 'boolean' || typeof task.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.date) || !Number.isFinite(Date.parse(task.date)) || new Date(task.date).toISOString().slice(0, 10) !== task.date) throw new Error('Nieprawidłowe zadanie.');
            taskIds.add(id);
            return { id, title: text(task.title, 160).trim(), date: task.date, done: task.done };
        });
        const ids = new Set(builtinIds);
        const customTiles = data.customTiles.map(tile => {
            const id = text(tile.id, 100);
            if (!id.startsWith('custom:') || ids.has(id) || !allowedSections.has(tile.section)) throw new Error('Nieprawidłowy kafelek lub sekcja.');
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
            if (![favoriteId, 'geo-games', ...allowedSections].includes(group)) throw new Error('Nieznana sekcja w układzie.');
            order[group] = idList(list, ids);
        });
        const collapsed = idList(data.layout.collapsed, new Set([favoriteId, ...allowedSections]), allowedSections.size + 1);
        const notes = validateNotes(data.notes);
        const activeNoteId = notes.some(note => note.id === data.activeNoteId) ? data.activeNoteId : notes[0]?.id || null;
        return { version: 1, notes, activeNoteId, favorites, customTiles, customSections: checkedSections, sectionNames, tileSections, tasks: checkedTasks, compact: data.compact ?? false, layout: { order, collapsed } };
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
            const serialized = JSON.stringify(state);
            const changed = localStorage.getItem(storageKey) !== serialized;
            localStorage.setItem(storageKey, serialized);
            if (changed) trackBackupChange();
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
        if (info.id !== 'group:geogames') tools.append(actionButton('move', 'Przenieś do innej sekcji', '↗', 'layout-control'));
        if (info.custom) tools.append(actionButton('edit', 'Edytuj kafelek', '✎', 'layout-control'), actionButton('delete', 'Usuń kafelek', '×', 'layout-control'));
        card.replaceWith(wrapper);
        wrapper.append(card, tools);
        return wrapper;
    }
    tiles.forEach(info => wrapCard(info));
    const bodyMap = new Map();
    function initializeSection(id) {
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
    }
    allSectionIds.forEach(initializeSection);
    syncSections();
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
    get('scroll-to-socials').addEventListener('click', () => {
        search.value = '';
        state.layout.collapsed = state.layout.collapsed.filter(id => id !== 'socials-section');
        applyFilter();
        updateWebSearch();
        persist('');
        const target = get('socials-section');
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });

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
        } else if (action === 'move') {
            openMoveDialog(id);
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
        fillSectionOptions(get('tile-section'));
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
    function renderTiles() {
        syncSections();
        tiles.forEach(info => {
            if (info.custom || info.id === 'group:geogames') return;
            info.originalGroup ??= info.group;
            info.group = state.tileSections[info.id] || info.originalGroup;
            const wrapper = info.card.parentElement;
            wrapper.dataset.group = info.group;
            const grid = grids.get(info.group);
            if (wrapper.parentElement !== grid) grid.insertBefore(wrapper, grid.querySelector(':scope > .geo-panel'));
        });
        renderCustom(); renderFavorites(); applyFilter();
    }

    function activeNote() { return state.notes.find(note => note.id === state.activeNoteId); }
    function renderNotebook(editor = true) {
        const filter = get('notes-filter');
        const categories = [...new Set(state.notes.map(note => note.category))].sort((a, b) => a.localeCompare(b, 'pl'));
        const selectedCategory = categories.includes(filter.value) ? filter.value : '';
        filter.replaceChildren(new Option('Wszystkie kategorie', ''), ...categories.map(category => new Option(category, category)));
        filter.value = selectedCategory;
        const query = get('notes-search').value.trim().toLocaleLowerCase('pl');
        const matching = state.notes.filter(note => (!selectedCategory || note.category === selectedCategory) && (!query || [note.title, note.category, note.body].some(value => value.toLocaleLowerCase('pl').includes(query)))).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
        if (!matching.some(note => note.id === state.activeNoteId)) state.activeNoteId = matching[0]?.id || null;
        get('notes-list').replaceChildren(...(matching.length ? matching.map(note => new Option(`${note.pinned ? '★ ' : ''}${note.title}`, note.id)) : [new Option('Brak notatek', '')]));
        get('notes-list').value = state.activeNoteId || '';
        get('notes-list').disabled = matching.length === 0;
        get('notes-categories').replaceChildren(...categories.map(category => new Option(category, category)));
        const note = activeNote();
        ['note-title', 'note-category', 'personal-notes', 'notes-delete', 'notes-save', 'notes-pin', 'notes-export'].forEach(id => { get(id).disabled = !note; });
        get('notes-pin').setAttribute('aria-pressed', String(!!note?.pinned));
        get('notes-pin').textContent = note?.pinned ? '★ Odepnij' : '☆ Przypnij';
        if (editor) {
            get('note-title').value = note?.title || '';
            get('note-category').value = note?.category || '';
            get('personal-notes').value = note?.body || '';
        }
    }
    function flushNotes() {
        clearTimeout(noteSaveTimer);
        const saved = persist('');
        get('notes-status').textContent = saved ? 'Zapisano notatki automatycznie w tej przeglądarce.' : 'Nie zapisano — wyeksportuj kopię.';
        return saved;
    }
    get('notes-shortcut').addEventListener('click', () => {
        renderNotebook();
        get('notes-dialog').showModal();
        get(activeNote() ? 'personal-notes' : 'notes-new').focus();
    });
    get('notes-close').addEventListener('click', () => get('notes-dialog').close());
    get('notes-dialog').addEventListener('close', flushNotes);
    get('notes-new').addEventListener('click', () => {
        if (state.notes.length >= 200) { get('notes-status').textContent = 'Możesz zapisać maksymalnie 200 notatek.'; return; }
        flushNotes();
        get('notes-search').value = '';
        const note = { id: `note:${crypto.randomUUID()}`, title: 'Bez tytułu', category: get('notes-filter').value || 'Ogólne', body: '', updatedAt: Date.now(), pinned: false };
        state.notes.push(note); state.activeNoteId = note.id;
        renderNotebook(); flushNotes();
        get('note-title').focus(); get('note-title').select();
    });
    get('notes-list').addEventListener('change', () => {
        flushNotes(); state.activeNoteId = get('notes-list').value;
        renderNotebook(); flushNotes();
    });
    get('notes-search').addEventListener('input', () => { flushNotes(); renderNotebook(); });
    get('notes-pin').addEventListener('click', () => { const note = activeNote(); if (!note) return; note.pinned = !note.pinned; flushNotes(); renderNotebook(false); });
    get('notes-export').addEventListener('click', () => {
        const note = activeNote(); if (!note) return;
        flushNotes();
        const url = URL.createObjectURL(new Blob([`${note.title}\nKategoria: ${note.category}\n\n${note.body}`], { type: 'text/plain;charset=utf-8' }));
        const link = node('a'); link.href = url; link.download = 'notatka.txt';
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    get('notes-filter').addEventListener('change', () => { flushNotes(); renderNotebook(); flushNotes(); });
    ['note-title', 'note-category', 'personal-notes'].forEach(id => get(id).addEventListener('input', event => {
        const note = activeNote();
        if (!note) return;
        const value = event.target.value;
        if (id === 'personal-notes') {
            const total = state.notes.reduce((sum, other) => sum + (other === note ? value.length : other.body.length), 0);
            if (total > 1000000) { event.target.value = note.body; get('notes-status').textContent = 'Osiągnięto limit miliona znaków we wszystkich notatkach.'; return; }
            note.body = value;
        } else if (id === 'note-title') note.title = value.trim() || 'Bez tytułu';
        else { note.category = value.trim() || 'Ogólne'; get('notes-filter').value = ''; }
        note.updatedAt = Date.now();
        if (id !== 'personal-notes') renderNotebook(false);
        get('notes-status').textContent = 'Zapisywanie…';
        clearTimeout(noteSaveTimer);
        noteSaveTimer = setTimeout(flushNotes, 300);
    }));
    get('notes-save').addEventListener('click', () => { flushNotes(); renderNotebook(); });
    get('notes-delete').addEventListener('click', () => {
        const note = activeNote();
        if (!note || !confirm(`Usunąć notatkę „${note.title}”?`)) return;
        clearTimeout(noteSaveTimer);
        state.notes = state.notes.filter(other => other.id !== note.id);
        state.activeNoteId = null;
        renderNotebook(); flushNotes();
    });
    renderNotebook();
    window.addEventListener('pagehide', () => { clearTimeout(noteSaveTimer); persist(''); });

    function download(data, filename) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = node('a'); link.href = url; link.download = filename;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function fillSectionOptions(select) {
        select.replaceChildren(...sectionIds.map(id => new Option(get(id).querySelector('h2').textContent, id)));
    }
    function syncSections() {
        // Preserve built-in nodes and their listeners while adding/removing custom sections.
        const current = new Set(state.customSections.map(section => section.id));
        [...bodyMap.keys()].filter(id => id.startsWith('section:') && !current.has(id)).forEach(id => {
            const grid = grids.get(id);
            [...grid.children].filter(child => child.classList.contains('tile-wrap') && !child.dataset.customTile).forEach(child => grids.get('socials-section').append(child));
            get(id).remove(); bodyMap.delete(id); grids.delete(id);
        });
        sectionIds.splice(0, sectionIds.length, ...baseSectionIds, ...state.customSections.map(section => section.id));
        allSectionIds.splice(0, allSectionIds.length, favoriteId, ...sectionIds);
        state.customSections.forEach(section => {
            if (!get(section.id)) {
                const element = node('section', 'category'); element.id = section.id;
                const header = node('div', 'category-header');
                header.append(node('span', 'category-icon', '✦'), node('h2', '', section.name), node('span', 'category-count', 'MOJA SEKCJA'));
                const grid = node('div', 'grid'); element.append(header, grid); sections.append(element);
                grids.set(section.id, grid); initializeSection(section.id);
            }
            get(section.id).querySelector('h2').textContent = section.name;
        });
        baseSectionIds.forEach(id => { get(id).querySelector('h2').textContent = state.sectionNames[id] || originalNames.get(id); });
        document.body.classList.toggle('compact', state.compact);
        get('compact-toggle').setAttribute('aria-pressed', String(state.compact));
    }
    let movingTile = null;
    function openMoveDialog(id) {
        const info = tiles.get(id); if (!info || id === 'group:geogames') return;
        movingTile = id;
        get('move-name').textContent = info.card.querySelector('.card-name').textContent;
        fillSectionOptions(get('move-section')); get('move-section').value = info.group;
        get('move-dialog').showModal();
    }
    function removeFromOrders(id) {
        Object.keys(state.layout.order).forEach(group => { state.layout.order[group] = state.layout.order[group].filter(value => value !== id); });
    }
    get('move-form').addEventListener('submit', event => {
        event.preventDefault();
        const target = get('move-section').value;
        if (!sectionIds.includes(target) || !tiles.has(movingTile)) return;
        const info = tiles.get(movingTile);
        if (info.custom) state.customTiles.find(tile => tile.id === movingTile).section = target;
        else state.tileSections[movingTile] = target;
        removeFromOrders(movingTile);
        state.layout.collapsed = state.layout.collapsed.filter(id => id !== target);
        search.value = ''; persist('Przeniesiono kafelek.'); renderTiles(); get('move-dialog').close();
    });
    get('move-cancel').addEventListener('click', () => get('move-dialog').close());
    get('compact-toggle').addEventListener('click', () => { state.compact = !state.compact; syncSections(); persist(); });

    function renderSectionManager() {
        get('sections-list').replaceChildren();
        sectionIds.forEach(id => {
            const form = node('form', 'section-row');
            const label = node('label', '', 'Nazwa sekcji');
            const input = node('input'); input.value = get(id).querySelector('h2').textContent; input.maxLength = 60; input.required = true;
            label.append(input);
            const save = node('button', '', 'Zapisz nazwę'); save.type = 'submit';
            save.setAttribute('aria-label', `Zapisz nazwę sekcji ${input.value}`);
            form.append(label, save);
            form.addEventListener('submit', event => {
                event.preventDefault();
                const name = input.value.trim();
                if (!name) { get('sections-status').textContent = 'Nazwa nie może być pusta.'; return; }
                if (baseSectionIds.includes(id)) state.sectionNames[id] = name;
                else state.customSections.find(section => section.id === id).name = name;
                persist('Zmieniono nazwę sekcji.'); renderTiles(); renderSectionManager();
                get('sections-status').textContent = 'Zapisano nazwę sekcji.';
            });
            if (!baseSectionIds.includes(id)) {
                const remove = node('button', '', 'Usuń sekcję'); remove.type = 'button';
                remove.setAttribute('aria-label', `Usuń sekcję ${input.value}`);
                remove.addEventListener('click', () => {
                    if (!confirm('Usunąć sekcję? Jej kafelki zostaną przeniesione do pierwszej sekcji.')) return;
                    state.customTiles.forEach(tile => { if (tile.section === id) { tile.section = baseSectionIds[0]; removeFromOrders(tile.id); } });
                    Object.entries(state.tileSections).forEach(([tileId, group]) => { if (group === id) { state.tileSections[tileId] = baseSectionIds[0]; removeFromOrders(tileId); } });
                    state.customSections = state.customSections.filter(section => section.id !== id);
                    delete state.layout.order[id]; state.layout.collapsed = state.layout.collapsed.filter(group => group !== id);
                    persist(); renderTiles(); renderSectionManager(); get('sections-status').textContent = 'Usunięto sekcję; zachowano kafelki.';
                });
                form.append(remove);
            }
            get('sections-list').append(form);
        });
    }
    get('manage-sections').addEventListener('click', () => { renderSectionManager(); get('sections-status').textContent = ''; get('sections-dialog').showModal(); });
    get('sections-close').addEventListener('click', () => get('sections-dialog').close());
    get('section-form').addEventListener('submit', event => {
        event.preventDefault();
        const name = get('section-name').value.trim();
        if (!name) return;
        if (state.customSections.length >= 30) { get('sections-status').textContent = 'Możesz dodać maksymalnie 30 własnych sekcji.'; return; }
        state.customSections.push({ id: `section:${crypto.randomUUID()}`, name });
        persist(); renderTiles(); renderSectionManager(); event.target.reset();
        get('sections-status').textContent = 'Dodano sekcję. Dodaj kafelek lub przenieś istniejący w trybie edycji układu.';
    });

    const today = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
    let lastToday = today();
    get('tasks-date').value = lastToday;
    function renderTasks() {
        const date = get('tasks-date').value || today();
        const tasks = state.tasks.filter(task => task.date === date);
        get('task-list').replaceChildren();
        tasks.forEach(task => {
            const row = node('li', 'task-row');
            const label = node('label', task.done ? 'task-done' : '');
            const check = node('input'); check.type = 'checkbox'; check.checked = task.done;
            label.append(check, node('span', '', task.title));
            check.addEventListener('change', () => { task.done = check.checked; persist('Zapisano postęp zadań.'); renderTasks(); });
            const remove = node('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Usuń zadanie: ${task.title}`);
            remove.addEventListener('click', () => { if (!confirm(`Usunąć zadanie „${task.title}”?`)) return; state.tasks = state.tasks.filter(item => item.id !== task.id); persist(); renderTasks(); });
            row.append(label, remove); get('task-list').append(row);
        });
        const done = tasks.filter(task => task.done).length;
        get('tasks-progress').max = tasks.length || 1; get('tasks-progress').value = done;
        get('tasks-count').textContent = `${done} / ${tasks.length} ukończonych`;
        const dailyTasks = state.tasks.filter(task => task.date === today());
        get('tasks-shortcut-count').textContent = dailyTasks.length ? `${dailyTasks.filter(task => task.done).length} / ${dailyTasks.length} ukończonych · Otwórz ↗` : 'Zaplanuj dzień ↗';
        get('tasks-empty').hidden = tasks.length > 0;
        get('tasks-title').textContent = date === today() ? '✓ Zadania na dziś' : `✓ Zadania — ${date}`;
    }
    get('tasks-shortcut').addEventListener('click', () => {
        rolloverDay();
        get('tasks-date').value = today();
        renderTasks();
        get('tasks-dialog').showModal();
        get('task-title').focus();
    });
    get('tasks-close').addEventListener('click', () => get('tasks-dialog').close());
    get('tasks-date').addEventListener('change', renderTasks);
    get('tasks-today').addEventListener('click', () => { get('tasks-date').value = today(); renderTasks(); });
    get('task-form').addEventListener('submit', event => {
        event.preventDefault();
        const title = get('task-title').value.trim();
        const date = get('tasks-date').value;
        if (!title || !date) { get('tasks-status').textContent = 'Wpisz zadanie i wybierz dzień.'; return; }
        if (state.tasks.length >= 1000) { get('tasks-status').textContent = 'Osiągnięto limit 1000 zadań. Usuń niepotrzebne zadania z wcześniejszych dni.'; return; }
        state.tasks.push({ id: `task:${crypto.randomUUID()}`, title, date, done: false });
        persist('Dodano zadanie.'); event.target.reset(); renderTasks(); get('tasks-status').textContent = ''; get('task-title').focus();
    });
    function rolloverDay() {
        const current = today();
        if (current !== lastToday) { if (get('tasks-date').value === lastToday) get('tasks-date').value = current; lastToday = current; renderTasks(); }
    }
    document.addEventListener('visibilitychange', rolloverDay);
    setInterval(rolloverDay, 30000);
    document.addEventListener('keydown', event => {
        const editing = event.target.closest('input, textarea, select, [contenteditable]');
        if (event.key === '/' && !editing && !document.querySelector('dialog[open]') && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); search.focus(); }
    });
    function updateWebSearch() {
        const query = search.value.trim();
        get('search-google').hidden = get('search-youtube').hidden = !query;
        get('search-google').href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        get('search-youtube').href = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    }
    search.addEventListener('input', updateWebSearch);
    search.addEventListener('keydown', event => {
        if (event.key === 'Escape') { search.value = ''; applyFilter(); updateWebSearch(); search.blur(); }
        if (event.key !== 'Enter' || event.isComposing || !search.value.trim()) return;
        const matches = new Map();
        sections.querySelectorAll('.tile-wrap:not([hidden]) > a.card').forEach(card => { if (!card.closest('section[hidden]')) matches.set(card.href, card); });
        if (matches.size === 1) { event.preventDefault(); [...matches.values()][0].click(); }
    });

    const backupMetaKey = 'szkudek-backup-meta-v1';
    let backupMeta;
    try {
        backupMeta = JSON.parse(localStorage.getItem(backupMetaKey));
        if (!backupMeta || !Number.isSafeInteger(backupMeta.changes) || backupMeta.changes < 0 || !Number.isSafeInteger(backupMeta.snoozeAt) || backupMeta.snoozeAt < 0) throw new Error();
    } catch { backupMeta = { changes: 0, snoozeAt: 0 }; }
    function updateBackupReminder() { get('backup-reminder').hidden = backupMeta.changes - backupMeta.snoozeAt < 50; }
    function saveBackupMeta() { try { localStorage.setItem(backupMetaKey, JSON.stringify(backupMeta)); } catch { /* The reminder must not block saving user data. */ } updateBackupReminder(); }
    function trackBackupChange() { backupMeta.changes++; saveBackupMeta(); }
    get('backup-later').addEventListener('click', () => { backupMeta.snoozeAt = backupMeta.changes; saveBackupMeta(); });
    window.addEventListener('commandcenter:radio-changed', trackBackupChange);
    let backupMode = 'export', pendingBackup = null, validatedBackup = null, backupBusy = false;
    function clearPasswords() { get('backup-password').value = ''; get('backup-password-confirm').value = ''; }
    function openBackupExport() {
        backupMode = 'export'; pendingBackup = validatedBackup = null; clearPasswords();
        get('backup-title').textContent = 'Eksport kopii danych'; get('backup-status').textContent = '';
        get('backup-preview').textContent = ''; get('backup-domains').replaceChildren();
        get('backup-export-options').hidden = false; get('backup-encrypt').checked = true; get('backup-notes').checked = true;
        get('backup-password-fields').hidden = false; get('backup-confirm-field').hidden = false;
        get('backup-password').autocomplete = 'new-password';
        get('backup-submit').textContent = 'Zapisz kopię'; get('backup-dialog').showModal();
    }
    get('dashboard-export').addEventListener('click', openBackupExport);
    get('backup-now').addEventListener('click', openBackupExport);
    get('backup-encrypt').addEventListener('change', () => { get('backup-password-fields').hidden = !get('backup-encrypt').checked; clearPasswords(); });
    get('backup-close').addEventListener('click', () => { if (!backupBusy) get('backup-dialog').close(); });
    get('backup-dialog').addEventListener('cancel', event => { if (backupBusy) event.preventDefault(); });
    get('backup-dialog').addEventListener('close', () => { clearPasswords(); pendingBackup = validatedBackup = null; });
    function prepareImport(data) {
        if (!data || data.app !== 'szkudek-commandcenter' || data.version !== 1 || (data.notesIncluded !== undefined && typeof data.notesIncluded !== 'boolean')) throw new Error('To nie jest kopia ustawień CommandCenter.');
        const dashboard = validate(data.dashboard);
        const radio = window.CommandCenterRadio.validateData(data.radio);
        const notesIncluded = data.notesIncluded !== false;
        validatedBackup = { dashboard, radio, notesIncluded };
        get('backup-password-fields').hidden = true; clearPasswords();
        get('backup-preview').textContent = `Kopia zawiera ${dashboard.customSections.length} własnych sekcji, ${dashboard.customTiles.length} własnych kafelków, ${dashboard.tasks.length} zadań i ${radio.stations.length} stacji. ${notesIncluded ? `${dashboard.notes.length} notatek zastąpi obecny notatnik.` : 'Kopia nie zawiera notatek — obecny notatnik zostanie zachowany.'} Pozostałe ustawienia zostaną zastąpione. Sprawdź adresy przed przywróceniem.`;
        const domains = [...new Set([...dashboard.customTiles.map(tile => tile.url), ...radio.stations.map(station => station.url)].map(url => new URL(url).host))];
        get('backup-domains').replaceChildren(...domains.map(domain => node('li', '', domain)));
        get('backup-submit').textContent = 'Przywróć wyświetloną kopię';
    }
    get('dashboard-import').addEventListener('click', () => get('dashboard-import-file').click());
    get('dashboard-import-file').addEventListener('change', async event => {
        const file = event.target.files[0]; if (!file) return;
        try {
            if (file.size > 16 * 1024 * 1024) throw new Error('Kopia może mieć maksymalnie 16 MB.');
            const data = JSON.parse(await file.text());
            backupMode = 'import'; pendingBackup = data; validatedBackup = null; clearPasswords();
            get('backup-title').textContent = 'Import kopii danych'; get('backup-status').textContent = '';
            get('backup-export-options').hidden = true; get('backup-confirm-field').hidden = true;
            get('backup-preview').textContent = ''; get('backup-domains').replaceChildren();
            get('backup-password').autocomplete = 'current-password';
            if (data?.app === 'szkudek-commandcenter-encrypted') {
                get('backup-password-fields').hidden = false;
                get('backup-preview').textContent = 'Wpisz hasło, aby zobaczyć zawartość kopii. Odszyfrowanie nie zmienia obecnych danych.';
                get('backup-submit').textContent = 'Odszyfruj i pokaż podsumowanie';
            } else prepareImport(data);
            get('backup-dialog').showModal();
        } catch (error) { pendingBackup = validatedBackup = null; notify(`Nie udało się odczytać kopii: ${error.message}`); }
        finally { event.target.value = ''; }
    });
    get('backup-submit').addEventListener('click', async () => {
        if (backupBusy) return;
        backupBusy = true; get('backup-submit').disabled = get('backup-close').disabled = true;
        get('backup-status').textContent = 'Przetwarzanie…';
        try {
            if (backupMode === 'export') {
                clearTimeout(noteSaveTimer); persist('');
                const dashboard = validate(state);
                const notesIncluded = get('backup-notes').checked;
                if (!notesIncluded) { dashboard.notes = []; dashboard.activeNoteId = null; }
                let data = { app: 'szkudek-commandcenter', version: 1, notesIncluded, dashboard, radio: window.CommandCenterRadio.exportData() };
                const encrypted = get('backup-encrypt').checked;
                if (encrypted) {
                    if (get('backup-password').value !== get('backup-password-confirm').value) throw new Error('Hasła muszą być identyczne.');
                    data = await window.CommandCenterBackup.encrypt(data, get('backup-password').value);
                }
                download(data, encrypted ? 'szkudek-commandcenter.encrypted.json' : 'szkudek-commandcenter.json');
                if (notesIncluded) { backupMeta = { changes: 0, snoozeAt: 0 }; saveBackupMeta(); }
                get('backup-dialog').close(); notify(`Przygotowano ${encrypted ? 'szyfrowaną' : 'zwykłą'} kopię ${notesIncluded ? 'z notatkami' : 'bez notatek'}. Zapisz pobrany plik.`);
            } else if (!validatedBackup) {
                const data = await window.CommandCenterBackup.decrypt(pendingBackup, get('backup-password').value);
                prepareImport(data); pendingBackup = null; get('backup-status').textContent = 'Sprawdź podsumowanie i potwierdź przywrócenie.';
            } else {
                const radio = window.CommandCenterRadio;
                const { dashboard, radio: nextRadio, notesIncluded } = validatedBackup;
                if (!confirm('Przywrócić tę kopię i zastąpić obecne dane zgodnie z podsumowaniem?')) { get('backup-status').textContent = 'Nie zmieniono danych.'; return; }
                const next = notesIncluded ? dashboard : validate({ ...dashboard, notes: state.notes, activeNoteId: state.activeNoteId });
                const previous = [localStorage.getItem(storageKey), localStorage.getItem(radio.storageKey)];
                try {
                    localStorage.setItem(radio.storageKey, JSON.stringify(nextRadio));
                    localStorage.setItem(storageKey, JSON.stringify(next));
                } catch (error) {
                    try { [storageKey, radio.storageKey].forEach((key, index) => { if (previous[index] === null) localStorage.removeItem(key); else localStorage.setItem(key, previous[index]); }); }
                    catch { throw new Error('Brak miejsca na przywrócenie i wycofanie kopii. Wyeksportuj aktualne dane przed ponowną próbą.'); }
                    throw error;
                }
                clearTimeout(noteSaveTimer); state = next; radio.reloadSettings();
                get('notes-filter').value = ''; get('notes-search').value = ''; renderNotebook();
                search.value = ''; geoManuallyOpen = false; renderTiles(); renderTasks(); updateWebSearch();
                backupMeta = { changes: 0, snoozeAt: 0 }; saveBackupMeta();
                get('backup-dialog').close(); notify('Przywrócono kopię danych.');
            }
        } catch (error) { get('backup-status').textContent = error.message; }
        finally { backupBusy = false; get('backup-submit').disabled = get('backup-close').disabled = false; }
    });
    renderTiles(); renderTasks(); updateBackupReminder(); updateWebSearch();

})();
