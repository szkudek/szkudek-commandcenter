(() => {
    const get = id => document.getElementById(id);
    const genre = get('radio-genre');
    const stations = get('radio-station');
    const audio = get('radio-audio');
    const status = get('radio-status');
    const feedback = get('radio-feedback');
    const storageKey = 'szkudek-personal-radio-v1';
    const empty = () => ({ version: 1, categories: [], stations: [], volume: 0.5, muted: false });
    let state = empty();
    let selectedCategory = '';
    let selectedStation = '';

    function streamUrl(value) {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Użyj bezpośredniego adresu streamu HTTPS bez danych logowania.');
        if (/\.(m3u8?|pls)$/i.test(url.pathname)) throw new Error('Wklej adres audio ze środka playlisty, zamiast pliku M3U/PLS.');
        return url.href;
    }

    function validate(data) {
        if (!data || data.version !== 1 || !Array.isArray(data.categories) || !Array.isArray(data.stations) || data.categories.length > 100 || data.stations.length > 1000) throw new Error('Nieprawidłowa kopia ustawień radia.');
        const ids = new Set();
        const names = new Set();
        const categories = data.categories.map(category => {
            if (typeof category.id !== 'string' || !category.id || category.id.length > 100 || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 60 || ids.has(category.id) || names.has(category.name.trim().toLocaleLowerCase('pl'))) throw new Error('Nieprawidłowa lub powtórzona kategoria.');
            ids.add(category.id);
            names.add(category.name.trim().toLocaleLowerCase('pl'));
            return { id: category.id, name: category.name.trim() };
        });
        const stationIds = new Set();
        const streams = new Set();
        const checkedStations = data.stations.map(station => {
            if (typeof station.id !== 'string' || !station.id || station.id.length > 100 || stationIds.has(station.id) || !ids.has(station.categoryId) || typeof station.name !== 'string' || !station.name.trim() || station.name.length > 100 || typeof station.url !== 'string' || station.url.length > 4096) throw new Error('Nieprawidłowa stacja w kopii ustawień.');
            const url = streamUrl(station.url);
            const key = JSON.stringify([station.categoryId, url]);
            if (streams.has(key)) throw new Error('Powtórzona stacja w kategorii.');
            streams.add(key);
            stationIds.add(station.id);
            return { id: station.id, categoryId: station.categoryId, name: station.name.trim(), url };
        });
        const volume = data.volume === undefined ? 0.5 : data.volume;
        const muted = data.muted === undefined ? false : data.muted;
        if (!Number.isFinite(volume) || volume < 0 || volume > 1 || typeof muted !== 'boolean') throw new Error('Nieprawidłowa głośność w kopii ustawień.');
        return { version: 1, categories, stations: checkedStations, volume, muted };
    }

    try {
        const saved = localStorage.getItem(storageKey);
        if (saved) state = validate(JSON.parse(saved));
    } catch {
        feedback.textContent = 'Nie udało się odczytać ustawień. Zapisane dane nie zostały nadpisane. Możesz zaimportować kopię.';
    }

    function save(next) {
        try {
            next = validate(next);
            const serialized = JSON.stringify(next);
            const changed = localStorage.getItem(storageKey) !== serialized;
            localStorage.setItem(storageKey, serialized);
            if (changed) window.dispatchEvent(new Event('commandcenter:radio-changed'));
            state = next;
            return true;
        } catch (error) {
            feedback.textContent = error.name === 'QuotaExceededError' || error.name === 'SecurityError'
                ? 'Przeglądarka nie pozwala zapisać ustawień. Sprawdź dostęp do danych witryny.'
                : error.message;
            return false;
        }
    }

    function setAudio() {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        const station = state.stations.find(item => item.id === selectedStation && item.categoryId === selectedCategory);
        if (station) audio.src = station.url;
        get('radio-delete-station').disabled = !station;
        status.textContent = station ? 'Kliknij ▶, aby włączyć wybraną stację.' : state.categories.length ? 'Dodaj stację do wybranej kategorii.' : 'Zacznij od dodania swojej kategorii.';
    }

    function render() {
        audio.volume = state.volume;
        audio.muted = state.muted;
        syncVolumeUI();
        if (!state.categories.some(item => item.id === selectedCategory)) selectedCategory = state.categories[0]?.id || '';
        genre.replaceChildren(...(state.categories.length
            ? state.categories.map(item => new Option(item.name, item.id))
            : [new Option('Dodaj kategorię', '')]));
        genre.value = selectedCategory;
        genre.disabled = !state.categories.length;
        const list = state.stations.filter(item => item.categoryId === selectedCategory);
        if (!list.some(item => item.id === selectedStation)) selectedStation = list[0]?.id || '';
        stations.replaceChildren(...(list.length ? list.map(item => new Option(item.name, item.id)) : [new Option('Dodaj stację', '')]));
        stations.value = selectedStation;
        stations.disabled = !list.length;
        get('radio-add-station').disabled = !selectedCategory;
        get('radio-delete-category').disabled = !selectedCategory;
        setAudio();
    }

    genre.addEventListener('change', () => { selectedCategory = genre.value; render(); });
    stations.addEventListener('change', () => { selectedStation = stations.value; setAudio(); });

    get('radio-category-form').addEventListener('submit', event => {
        event.preventDefault();
        const name = get('radio-category-name').value.trim();
        if (!name) return;
        const category = { id: crypto.randomUUID(), name };
        if (!save({ ...state, categories: [...state.categories, category] })) return;
        selectedCategory = category.id;
        event.target.reset();
        render();
        feedback.textContent = `Dodano kategorię: ${name}.`;
    });

    get('radio-station-form').addEventListener('submit', event => {
        event.preventDefault();
        if (!selectedCategory) return;
        const name = get('radio-name').value.trim();
        if (!name) return;
        const station = { id: crypto.randomUUID(), categoryId: selectedCategory, name, url: get('radio-url').value.trim() };
        if (!save({ ...state, stations: [...state.stations, station] })) return;
        selectedStation = station.id;
        event.target.reset();
        render();
        feedback.textContent = `Dodano stację: ${name}.`;
    });

    get('radio-delete-station').addEventListener('click', () => {
        if (!selectedStation || !save({ ...state, stations: state.stations.filter(item => item.id !== selectedStation) })) return;
        render();
        feedback.textContent = 'Usunięto stację.';
    });
    get('radio-delete-category').addEventListener('click', () => {
        if (!selectedCategory) return;
        if (state.stations.some(item => item.categoryId === selectedCategory) && !confirm('Usunąć wybraną kategorię razem ze wszystkimi jej stacjami?')) return;
        if (!save({ ...state, categories: state.categories.filter(item => item.id !== selectedCategory), stations: state.stations.filter(item => item.categoryId !== selectedCategory) })) return;
        render();
        feedback.textContent = 'Usunięto kategorię.';
    });

    get('radio-export').addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'szkudek-radio.json';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    get('radio-import').addEventListener('click', () => get('radio-import-file').click());
    get('radio-import-file').addEventListener('change', async event => {
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (file.size > 1024 * 1024) throw new Error('Kopia może mieć maksymalnie 1 MB.');
            const next = validate(JSON.parse(await file.text()));
            if (state.categories.length && !confirm('Import zastąpi wszystkie obecne kategorie i stacje. Kontynuować?')) return;
            if (!save(next)) return;
            selectedCategory = '';
            selectedStation = '';
            render();
            feedback.textContent = 'Zaimportowano ustawienia radia.';
        } catch (error) {
            feedback.textContent = `Nie udało się zaimportować kopii: ${error.message}`;
        } finally {
            event.target.value = '';
        }
    });

    function syncVolumeUI() {
        const percent = audio.muted ? 0 : Math.round(audio.volume * 100);
        get('radio-volume').value = percent;
        get('radio-volume-value').textContent = `${percent}%`;
    }
    get('radio-volume').addEventListener('input', event => {
        const level = Number(event.target.value) / 100;
        audio.volume = level;
        audio.muted = level === 0;
        syncVolumeUI();
    });
    audio.addEventListener('volumechange', () => {
        syncVolumeUI();
        if (state.volume === audio.volume && state.muted === audio.muted) return;
        state.volume = audio.volume;
        state.muted = audio.muted;
        save(state);
    });

    audio.addEventListener('playing', () => {
        status.textContent = `Gramy: ${state.stations.find(item => item.id === selectedStation)?.name || 'radio'}`;
    });
    audio.addEventListener('waiting', () => { if (audio.getAttribute('src')) status.textContent = 'Łączenie ze stacją…'; });
    audio.addEventListener('pause', () => { if (audio.getAttribute('src') && !audio.error) status.textContent = 'Odtwarzanie wstrzymane.'; });
    audio.addEventListener('error', () => {
        if (audio.getAttribute('src')) status.textContent = 'Nie można odtworzyć stacji. Sprawdź bezpośredni adres audio HTTPS lub wybierz inną stację.';
    });
    window.CommandCenterRadio = {
        storageKey,
        exportData: () => validate(state),
        validateData: validate,
        reloadSettings() {
            const saved = localStorage.getItem(storageKey);
            state = saved ? validate(JSON.parse(saved)) : empty();
            selectedCategory = '';
            selectedStation = '';
            render();
        }
    };
    render();
})();
