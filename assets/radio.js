(() => {
    const genre = document.getElementById('radio-genre');
    const stations = document.getElementById('radio-station');
    const audio = document.getElementById('radio-audio');
    const status = document.getElementById('radio-status');
    const reload = document.getElementById('radio-reload');
    const mirrors = [
        'https://de1.api.radio-browser.info',
        'https://de2.api.radio-browser.info',
        'https://fi1.api.radio-browser.info'
    ];
    let currentRequest;

    async function searchStations(tag, polish, signal) {
        const params = new URLSearchParams({
            tag, hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '100'
        });
        if (polish) params.set('countrycode', 'PL');
        for (const mirror of mirrors) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const timeout = new AbortController();
            const abort = () => timeout.abort();
            signal.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(abort, 7000);
            try {
                const response = await fetch(`${mirror}/json/stations/search?${params}`, {
                    signal: timeout.signal,
                    referrerPolicy: 'no-referrer'
                });
                if (!response.ok) throw new Error('Catalog unavailable');
                const data = await response.json();
                if (!Array.isArray(data)) throw new Error('Invalid catalog response');
                return data;
            } catch (error) {
                if (signal.aborted) throw error;
            } finally {
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
            }
        }
        throw new Error('Catalog unavailable');
    }

    function selectStation() {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        if (!stations.value) return;
        audio.src = stations.value;
        status.textContent = 'Kliknij ▶, aby włączyć wybraną stację.';
    }

    async function loadStations() {
        currentRequest?.abort();
        const request = new AbortController();
        currentRequest = request;
        const polish = genre.value.endsWith('-pl');
        const tags = genre.value.startsWith('rap') ? ['rap', 'hip hop', 'hip-hop'] : ['reggae'];
        stations.replaceChildren(new Option('Wczytywanie stacji…', ''));
        stations.disabled = true;
        reload.disabled = true;
        selectStation();
        status.textContent = 'Szukam stacji w katalogu…';
        try {
            const results = await Promise.allSettled(tags.map(tag =>
                searchStations(tag, polish, request.signal)));
            if (request.signal.aborted) return;
            const successful = results.filter(result => result.status === 'fulfilled');
            if (!successful.length) throw new Error('Catalog unavailable');
            const streams = new Map();
            successful.flatMap(result => result.value).forEach(station => {
                try {
                    const url = new URL(station.url_resolved || station.url);
                    if (url.protocol !== 'https:' || url.username || url.password) return;
                    if (polish !== (station.countrycode === 'PL')) return;
                    if (station.lastcheckok !== 1 || !station.name) return;
                    if (!streams.has(url.href)) streams.set(url.href, station);
                } catch { /* Ignore malformed catalog entries. */ }
            });
            const sorted = [...streams.entries()].sort((a, b) =>
                (Number(b[1].votes) || 0) - (Number(a[1].votes) || 0));
            if (!sorted.length) {
                stations.replaceChildren(new Option('Brak dostępnych stacji', ''));
                status.textContent = 'Brak aktywnych stacji HTTPS w tej kategorii. Wybierz inny klimat lub spróbuj później.';
                return;
            }
            stations.replaceChildren(...sorted.map(([url, station]) =>
                new Option(`${station.name}${!polish && station.country ? ` · ${station.country}` : ''}`, url)));
            stations.disabled = false;
            selectStation();
        } catch {
            if (request.signal.aborted) return;
            stations.replaceChildren(new Option('Nie udało się pobrać stacji', ''));
            status.textContent = 'Katalog jest chwilowo niedostępny. Kliknij „Odśwież stacje”, aby spróbować ponownie.';
        } finally {
            if (currentRequest === request) reload.disabled = false;
        }
    }

    genre.addEventListener('change', loadStations);
    reload.addEventListener('click', loadStations);
    stations.addEventListener('change', selectStation);
    audio.addEventListener('playing', () => {
        status.textContent = `Gramy: ${stations.selectedOptions[0]?.textContent || 'radio'}`;
    });
    audio.addEventListener('waiting', () => {
        if (audio.getAttribute('src')) status.textContent = 'Łączenie ze stacją…';
    });
    audio.addEventListener('pause', () => {
        if (audio.getAttribute('src') && !audio.error) status.textContent = 'Odtwarzanie wstrzymane.';
    });
    audio.addEventListener('error', () => {
        if (audio.getAttribute('src')) {
            status.textContent = 'Nie można odtworzyć tej stacji. Wybierz inną lub spróbuj ponownie.';
        }
    });
    loadStations();
})();
