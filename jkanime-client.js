/**
 * JKAnime Client-Side & Hybrid Scraper Engine
 * Support for GitHub Pages: https://zenitapp751-bot.github.io/jkani/scrapper.html
 * Location: /scrappers/jkanime/jkanime-client.js
 */

const JKAnimeScraper = (function () {
    const getApiBaseUrl = () => {
        if (typeof CONFIG !== 'undefined' && CONFIG.apiBaseUrl) {
            return CONFIG.apiBaseUrl.replace(/\/+$/, '') + '/';
        }
        return 'https://over.xzod.cloud/scrappers/jkanime/';
    };

    const getCorsProxies = () => {
        if (typeof CONFIG !== 'undefined' && Array.isArray(CONFIG.corsProxies) && CONFIG.corsProxies.length > 0) {
            return CONFIG.corsProxies.map(p => (url) => p.includes('{url}') ? p.replace('{url}', encodeURIComponent(url)) : `${p}${encodeURIComponent(url)}`);
        }
        return [
            (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
            (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
            (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
        ];
    };

    let customProxy = null;
    let activeProxyIndex = 0;

    function setCustomProxy(proxyUrl) {
        customProxy = proxyUrl ? (url) => proxyUrl.includes('{url}') ? proxyUrl.replace('{url}', encodeURIComponent(url)) : `${proxyUrl}${encodeURIComponent(url)}` : null;
    }

    /**
     * Petición HTTP robusta con auto-failover entre proxies CORS
     */
    async function proxyFetch(targetUrl, options = {}) {
        const defaultProxies = getCorsProxies();
        const proxiesToTry = [];
        if (customProxy) proxiesToTry.push(customProxy);
        
        for (let i = 0; i < defaultProxies.length; i++) {
            const idx = (activeProxyIndex + i) % defaultProxies.length;
            proxiesToTry.push(defaultProxies[idx]);
        }

        let lastError = null;

        for (let i = 0; i < proxiesToTry.length; i++) {
            const getProxyUrl = proxiesToTry[i];
            const proxiedUrl = getProxyUrl(targetUrl);

            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), options.timeout || 12000);

                const response = await fetch(proxiedUrl, {
                    ...options,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                if (response.ok) {
                    const text = await response.text();
                    if (text && text.trim().length > 0 && !text.includes('500 Internal Server Error') && !text.includes('error code: 522')) {
                        if (!customProxy && i < defaultProxies.length) {
                            activeProxyIndex = (activeProxyIndex + i) % defaultProxies.length;
                        }
                        return text;
                    }
                }
            } catch (err) {
                lastError = err;
            }
        }

        throw new Error(`Error en proxyFetch tras reintentar con todos los proxies: ${lastError ? lastError.message : 'Error de red'}`);
    }

    /**
     * Construir enlace de Proxy PHP HLS para reproducción en HLS.js
     */
    function buildProxyUrl(rawUrl, proxyPhpBase = '') {
        let base = proxyPhpBase;
        if (!base) {
            if (typeof CONFIG !== 'undefined' && CONFIG.proxyUrl) {
                base = CONFIG.proxyUrl;
            } else if (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.proxyUrl) {
                base = window.CONFIG.proxyUrl;
            } else {
                base = 'https://cris.crispdev.online/zenit_proxy_m3u8.php?url=';
            }
        }
        return `${base}${encodeURIComponent(rawUrl)}`;
    }

    function limpiarSEO(texto) {
        if (!texto) return '';
        let t = texto.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        if (t.includes(' - ')) {
            t = t.split(' - ')[0];
        }
        return t.trim();
    }

    /**
     * OBTENER LISTA DE GÉNEROS (API -> Fallback Client-Side)
     */
    async function getGeneros() {
        const apiBase = getApiBaseUrl();
        try {
            const res = await fetch(`${apiBase}generos.php`);
            if (res.ok) {
                const data = await res.json();
                if (data.success && Array.isArray(data.generos)) {
                    return data;
                }
            }
        } catch (apiErr) {
            console.warn('API generos.php no respondió, ejecutando fallback client-side...');
        }

        // Fallback Client-Side
        try {
            const html = await proxyFetch('https://jkanime.net/directorio/');
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const select = doc.querySelector('select[name="genero"]');
            const generos = [];

            if (select) {
                const options = select.querySelectorAll('option');
                options.forEach(opt => {
                    const slug = opt.value.trim();
                    const nombre = opt.textContent.trim();
                    if (slug) {
                        generos.push({
                            nombre: nombre,
                            slug: slug,
                            url_filtro: `https://jkanime.net/directorio/${slug}/1/`
                        });
                    }
                });
            }

            return { success: true, generos: generos };
        } catch (e) {
            return { success: false, generos: [], error: e.message };
        }
    }

    /**
     * OBTENER DIRECTORIO DE ANIMES (API -> Fallback Client-Side)
     */
    async function getDirectorio(pagina = 1, genero = '') {
        const pageNum = Math.max(1, parseInt(pagina) || 1);
        const apiBase = getApiBaseUrl();

        try {
            let url = `${apiBase}directorio.php?p=${pageNum}`;
            if (genero && genero.trim() !== '') url += `&genero=${encodeURIComponent(genero)}`;

            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                if (data && Array.isArray(data.animes)) {
                    return { success: true, ...data };
                }
            }
        } catch (apiErr) {
            console.warn('API directorio.php no respondió, ejecutando fallback client-side...');
        }

        // Fallback Client-Side
        try {
            let targetUrl = `https://jkanime.net/directorio/?p=${pageNum}`;
            if (genero && genero.trim() !== '') {
                targetUrl = `https://jkanime.net/directorio?genero=${encodeURIComponent(genero)}&p=${pageNum}`;
            }

            const html = await proxyFetch(targetUrl);
            const res = {
                pagina_actual: pageNum,
                total_paginas: 1,
                animes: []
            };

            const matchData = html.match(/var\s+animes\s*=\s*(\{.*?\});/s);
            if (matchData && matchData[1]) {
                try {
                    const parsed = JSON.parse(matchData[1]);
                    if (parsed && Array.isArray(parsed.data)) {
                        parsed.data.forEach(anime => {
                            let slug = '';
                            if (anime.slug) {
                                slug = anime.slug;
                            } else if (anime.url) {
                                slug = anime.url.replace(/^\/+|\/+$/g, '').split('/').pop();
                            } else if (anime.id) {
                                slug = `anime-${anime.id}`;
                            }

                            res.animes.push({
                                id: anime.id || null,
                                slug: slug,
                                titulo: anime.title || '',
                                poster: anime.image || '',
                                tipo: anime.tipo || 'N/A'
                            });
                        });
                    }
                } catch (jsonErr) {}
            }

            const pagesMatches = [...html.matchAll(/[?&]p=(\d+)/g)];
            if (pagesMatches.length > 0) {
                const maxPage = Math.max(...pagesMatches.map(m => parseInt(m[1])));
                if (maxPage > 0) res.total_paginas = maxPage;
            }

            return { success: true, ...res };
        } catch (e) {
            return {
                success: false,
                pagina_actual: pagina,
                total_paginas: 1,
                animes: [],
                error: e.message
            };
        }
    }

    /**
     * BUSCADOR DE ANIMES (API -> Fallback Client-Side)
     */
    async function buscarAnime(query) {
        if (!query || !query.trim()) {
            return { success: false, error: "Consulta de búsqueda vacía" };
        }
        const q = query.trim();
        const apiBase = getApiBaseUrl();

        try {
            const res = await fetch(`${apiBase}apibuscador.php?q=${encodeURIComponent(q)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.success && Array.isArray(data.results)) {
                    return data;
                }
            }
        } catch (apiErr) {
            console.warn('API apibuscador.php no respondió, ejecutando fallback client-side...');
        }

        // Fallback Client-Side
        try {
            const homeHtml = await proxyFetch('https://jkanime.net/');
            const tokenMatch = homeHtml.match(/<meta name="csrf-token" content="([^"]+)">/);
            const token = tokenMatch ? tokenMatch[1] : null;

            if (token) {
                try {
                    const searchResText = await proxyFetch('https://jkanime.net/ajax_search', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-CSRF-TOKEN': token,
                            'X-Requested-With': 'XMLHttpRequest'
                        },
                        body: `q=${encodeURIComponent(q)}&_token=${encodeURIComponent(token)}`
                    });

                    const data = JSON.parse(searchResText);
                    if (Array.isArray(data)) {
                        const results = data.map(item => {
                            const rawImg = item.image ? `https://cdn.jkdesa.com/assets/images/animes/image/${item.image}` : (item.thumbnail || '');
                            const fixedImg = rawImg.replace("jkdesu.com", "jkdesa.com");
                            return {
                                id: item.id || null,
                                slug: item.slug || null,
                                titulo: item.title ? item.title.replace(/&quot;/g, '"').replace(/&#039;/g, "'") : '',
                                tipo: item.type || null,
                                status: item.status || null,
                                thumbnail: item.thumbnail || null,
                                image: fixedImg
                            };
                        });

                        return { success: true, query: q, total: results.length, results: results };
                    }
                } catch (postErr) {}
            }

            const searchHtml = await proxyFetch(`https://jkanime.net/buscar/${encodeURIComponent(q)}/1/`);
            const parser = new DOMParser();
            const doc = parser.parseFromString(searchHtml, 'text/html');

            const results = [];
            const animeItems = doc.querySelectorAll('.anime__item, .bloque');

            animeItems.forEach(item => {
                const link = item.querySelector('a');
                const img = item.querySelector('img');
                const titleEl = item.querySelector('h5, h3, .title');

                if (link && link.href) {
                    const slug = link.href.replace(/^\/+|\/+$/g, '').split('/').pop();
                    results.push({
                        id: null,
                        slug: slug,
                        titulo: titleEl ? titleEl.textContent.trim() : slug,
                        tipo: 'Anime',
                        status: null,
                        image: img ? img.src : ''
                    });
                }
            });

            return { success: true, query: q, total: results.length, results: results };
        } catch (e) {
            return { success: false, query: q, total: 0, results: [], error: e.message };
        }
    }

    /**
     * OBTENER FICHA TÉCNICA Y METADATOS (API -> Fallback Client-Side)
     */
    async function getAnimeInfo(slug) {
        if (!slug) return { success: false, error: "Slug requerido" };
        const apiBase = getApiBaseUrl();

        try {
            const res = await fetch(`${apiBase}testcap_v2.php?slug=${encodeURIComponent(slug)}`);
            if (res.ok) {
                const data = await res.json();
                if (data && data.success && data.data) {
                    return data;
                }
            }
        } catch (apiErr) {
            console.warn('API testcap_v2.php no respondió, ejecutando fallback client-side...');
        }

        // Fallback Client-Side
        try {
            const html = await proxyFetch(`https://jkanime.net/${slug}/`);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const info = {
                id: null,
                slug: slug,
                titulo: null,
                subtitulo: null,
                poster: null,
                sinopsis: null,
                votos: null,
                ultimo_capitulo: null,
                estadisticas: { mirando: 0, visto: 0, por_ver: 0 },
                titulos_alternativos: [],
                trailer: { id_yt: null, url: null },
                relacionados: []
            };

            const animeIdMatch = html.match(/data-anime="(\d+)"/);
            if (animeIdMatch) info.id = animeIdMatch[1];

            const posterEl = doc.querySelector('.anime_pic.pc img, .movpic img');
            if (posterEl) info.poster = posterEl.src;

            const h3El = doc.querySelector('h3');
            const spanEl = doc.querySelector('h3 + span, .anime_info span');

            let rawH3 = h3El ? h3El.textContent.trim() : '';
            let rawSpan = spanEl ? spanEl.textContent.trim() : '';

            info.titulo = limpiarSEO(rawH3) || slug.replace(/-/g, ' ');
            info.subtitulo = (rawSpan && rawSpan !== rawH3 && !rawSpan.toLowerCase().includes('emision')) ? limpiarSEO(rawSpan) : '';

            const sinopsisEl = doc.querySelector('.scroll, .sinopsis');
            if (sinopsisEl) info.sinopsis = sinopsisEl.textContent.trim();

            const votosEl = doc.querySelector('.vot');
            if (votosEl) info.votos = votosEl.textContent.trim();

            const uepEl = doc.querySelector('#uep, a[href*="/' + slug + '/"]');
            if (uepEl) {
                const uepHref = uepEl.getAttribute('href') || uepEl.href || '';
                const epMatch = uepHref.match(/\/(\d+)\/?$/);
                if (epMatch) {
                    info.ultimo_capitulo = parseInt(epMatch[1]);
                }
            }

            const ytEl = doc.querySelector('[data-yt]');
            if (ytEl) {
                const ytId = ytEl.getAttribute('data-yt');
                info.trailer.id_yt = ytId;
                info.trailer.url = `https://www.youtube.com/watch?v=${ytId}`;
            }

            const relElements = doc.querySelectorAll('#aditional');
            relElements.forEach(el => {
                const typeText = el.textContent.trim();
                const parent = el.parentElement;
                const link = parent ? parent.querySelector('a') : null;
                if (link && link.href) {
                    const relSlug = link.href.replace(/^\/+|\/+$/g, '').split('/').pop();
                    info.relacionados.push({
                        tipo: typeText,
                        titulo: link.textContent.trim(),
                        slug: relSlug,
                        url: link.href,
                        poster: `https://cdn.jkdesa.com/assets/images/animes/image/${relSlug}.jpg`
                    });
                }
            });

            return { success: true, data: info };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    /**
     * OBTENER LISTA DE ENLACES RAW DE CAPÍTULOS (API -> Fallback Client-Side)
     */
    async function getCapitulosRaw(slug, animeId = null, totalCapsIn = null) {
        if (!slug) return { success: false, error: "Slug requerido" };
        const apiBase = getApiBaseUrl();

        if (animeId) {
            try {
                const res = await fetch(`${apiBase}testcap.php?id=${encodeURIComponent(animeId)}&slug=${encodeURIComponent(slug)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.success && Array.isArray(data.links)) {
                        return data;
                    }
                }
            } catch (apiErr) {
                console.warn('API testcap.php no respondió, ejecutando fallback client-side...');
            }
        }

        // Fallback Client-Side
        try {
            let totalCapitulos = totalCapsIn;

            if (!totalCapitulos) {
                const infoRes = await getAnimeInfo(slug);
                if (infoRes.success && infoRes.data.ultimo_capitulo) {
                    totalCapitulos = infoRes.data.ultimo_capitulo;
                }
            }

            if (totalCapitulos && totalCapitulos > 0) {
                const links = [];
                for (let i = 1; i <= totalCapitulos; i++) {
                    links.push({
                        cap: i,
                        url: `https://jkanime.net/${slug}/${i}/`
                    });
                }

                return {
                    success: true,
                    total_total: links.length,
                    paginas_recorridas: 1,
                    links: links
                };
            }

            return {
                success: true,
                total_total: 1,
                paginas_recorridas: 1,
                links: [{ cap: 1, url: `https://jkanime.net/${slug}/1/` }]
            };
        } catch (e) {
            return { success: false, error: e.message, links: [] };
        }
    }

    return {
        setCustomProxy,
        buildProxyUrl,
        getGeneros,
        getDirectorio,
        buscarAnime,
        getAnimeInfo,
        getCapitulosRaw
    };
})();
