/**
 * JKAnime Client-Side Scraper Engine
 * Pure HTML5 & JavaScript (ES6+) implementation without PHP dependencies.
 * Location: /scrappers/jkanime/jkanime-client.js
 */

const JKAnimeScraper = (function () {
    // Lista de CORS Proxies públicos con fallback automático
    const DEFAULT_PROXIES = [
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
    ];

    let customProxy = null;
    let activeProxyIndex = 0;

    /**
     * Configurar un proxy personalizado opcional (ej: https://mi-proxy.com/?url=)
     */
    function setCustomProxy(proxyUrl) {
        customProxy = proxyUrl ? (url) => proxyUrl.includes('{url}') ? proxyUrl.replace('{url}', encodeURIComponent(url)) : `${proxyUrl}${encodeURIComponent(url)}` : null;
    }

    /**
     * Petición HTTP robusta con auto-failover entre proxies CORS
     */
    async function proxyFetch(targetUrl, options = {}) {
        const proxiesToTry = [];
        if (customProxy) proxiesToTry.push(customProxy);
        
        // Agregar proxies por defecto ordenados empezando por el activo actualmente
        for (let i = 0; i < DEFAULT_PROXIES.length; i++) {
            const idx = (activeProxyIndex + i) % DEFAULT_PROXIES.length;
            proxiesToTry.push(DEFAULT_PROXIES[idx]);
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
                    if (text && text.trim().length > 0) {
                        // Guardar índice de proxy funcional para futuras peticiones
                        if (!customProxy && i < DEFAULT_PROXIES.length) {
                            activeProxyIndex = (activeProxyIndex + i) % DEFAULT_PROXIES.length;
                        }
                        return text;
                    }
                }
            } catch (err) {
                lastError = err;
                console.warn(`Proxy ${i + 1}/${proxiesToTry.length} falló para: ${targetUrl}. Reintentando con siguiente proxy...`);
            }
        }

        throw new Error(`Error en proxyFetch tras reintentar con todos los proxies: ${lastError ? lastError.message : 'Respuesta vacía o error de red'}`);
    }

    /**
     * Limpiar texto de SEO de JKAnime
     */
    function limpiarSEO(texto) {
        if (!texto) return '';
        let t = texto.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
        if (t.includes(' - ')) {
            t = t.split(' - ')[0];
        }
        return t.trim();
    }

    /**
     * OBTENER LISTA DE GÉNEROS
     */
    async function getGeneros() {
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
            console.error('Error cargando géneros:', e);
            return { success: false, generos: [], error: e.message };
        }
    }

    /**
     * OBTENER DIRECTORIO DE ANIMES (Paginado / Filtrado por género)
     */
    async function getDirectorio(pagina = 1, genero = '') {
        try {
            const pageNum = Math.max(1, parseInt(pagina) || 1);
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

            // Extraer JSON var animes = {...};
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
                } catch (jsonErr) {
                    console.error('Error parseando JSON animes:', jsonErr);
                }
            }

            // Determinar total de páginas
            const pagesMatches = [...html.matchAll(/[?&]p=(\d+)/g)];
            if (pagesMatches.length > 0) {
                const maxPage = Math.max(...pagesMatches.map(m => parseInt(m[1])));
                if (maxPage > 0) res.total_paginas = maxPage;
            }

            return { success: true, ...res };
        } catch (e) {
            console.error('Error cargando directorio:', e);
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
     * BUSCADOR DE ANIMES
     */
    async function buscarAnime(query) {
        if (!query || !query.trim()) {
            return { success: false, error: "Consulta de búsqueda vacía" };
        }
        const q = query.trim();

        try {
            // Método A: Búsqueda vía POST /ajax_search
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
                } catch (postErr) {
                    console.warn('POST ajax_search falló, probando fallback HTML search...');
                }
            }

            // Método B Fallback: Petición GET a https://jkanime.net/buscar?q=...
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
            console.error('Error buscando anime:', e);
            return { success: false, query: q, total: 0, results: [], error: e.message };
        }
    }

    /**
     * OBTENER DETALLE E INFORMACIÓN COMPLETA DE UN ANIME
     */
    async function getAnimeInfo(slug) {
        if (!slug) return { success: false, error: "Slug requerido" };

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
                trailer: { id_yt: null, url: null },
                relacionados: []
            };

            // ID del Anime
            const animeIdMatch = html.match(/data-anime="(\d+)"/);
            if (animeIdMatch) info.id = animeIdMatch[1];

            // Poster
            const posterEl = doc.querySelector('.anime_pic.pc img, .movpic img');
            if (posterEl) info.poster = posterEl.src;

            // Título y Subtítulo
            const h3El = doc.querySelector('h3');
            const spanEl = doc.querySelector('h3 + span, .anime_info span');

            let rawH3 = h3El ? h3El.textContent.trim() : '';
            let rawSpan = spanEl ? spanEl.textContent.trim() : '';

            info.titulo = limpiarSEO(rawH3) || slug.replace(/-/g, ' ');
            info.subtitulo = (rawSpan && rawSpan !== rawH3 && !rawSpan.toLowerCase().includes('emision')) ? limpiarSEO(rawSpan) : '';

            // Sinopsis
            const sinopsisEl = doc.querySelector('.scroll, .sinopsis');
            if (sinopsisEl) info.sinopsis = sinopsisEl.textContent.trim();

            // Votos
            const votosEl = doc.querySelector('.vot');
            if (votosEl) info.votos = votosEl.textContent.trim();

            // Último episodio (#uep)
            const uepEl = doc.querySelector('#uep, a[href*="/' + slug + '/"]');
            if (uepEl) {
                const uepHref = uepEl.getAttribute('href') || uepEl.href || '';
                const epMatch = uepHref.match(/\/(\d+)\/?$/);
                if (epMatch) {
                    info.ultimo_capitulo = parseInt(epMatch[1]);
                }
            }

            // Trailer YouTube
            const ytEl = doc.querySelector('[data-yt]');
            if (ytEl) {
                const ytId = ytEl.getAttribute('data-yt');
                info.trailer.id_yt = ytId;
                info.trailer.url = `https://www.youtube.com/watch?v=${ytId}`;
            }

            // Animes Relacionados
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
                        url: `https://jkanime.net/${relSlug}/`,
                        poster: `https://cdn.jkdesa.com/assets/images/animes/image/${relSlug}.jpg`
                    });
                }
            });

            return { success: true, data: info };
        } catch (e) {
            console.error('Error extrayendo info del anime:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * OBTENER LISTA DE CAPÍTULOS
     */
    async function getCapitulos(slug, animeId = null, totalCapsIn = null) {
        if (!slug) return { success: false, error: "Slug requerido" };

        try {
            let totalCapitulos = totalCapsIn;

            // Si no tenemos el número total de capítulos, obtenemos el HTML del anime
            if (!totalCapitulos) {
                const infoRes = await getAnimeInfo(slug);
                if (infoRes.success && infoRes.data.ultimo_capitulo) {
                    totalCapitulos = infoRes.data.ultimo_capitulo;
                }
            }

            // Si se conoce el último número de capítulo, generamos la lista al instante sin sobrecargar de peticiones HTTP
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
                    links: links
                };
            }

            // Fallback: Consultar API de episodios AJAX si no se pudo determinar el último episodio en HTML
            if (animeId) {
                const html = await proxyFetch(`https://jkanime.net/${slug}/`);
                const tokenMatch = html.match(/<meta name="csrf-token" content="([^"]+)">/);
                const token = tokenMatch ? tokenMatch[1] : null;

                if (token) {
                    const allLinks = [];
                    let page = 1;
                    let lastPage = 1;

                    do {
                        try {
                            const epResText = await proxyFetch(`https://jkanime.net/ajax/episodes/${animeId}/${page}`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                    'X-CSRF-TOKEN': token,
                                    'X-Requested-With': 'XMLHttpRequest'
                                },
                                body: `_token=${encodeURIComponent(token)}`
                            });

                            const data = JSON.parse(epResText);
                            if (data && Array.isArray(data.data)) {
                                data.data.forEach(ep => {
                                    allLinks.push({
                                        cap: ep.number,
                                        url: `https://jkanime.net/${slug}/${ep.number}/`
                                    });
                                });
                                lastPage = data.last_page || 1;
                            } else {
                                break;
                            }
                        } catch (err) {
                            break;
                        }
                        page++;
                    } while (page <= lastPage);

                    if (allLinks.length > 0) {
                        allLinks.sort((a, b) => a.cap - b.cap);
                        return {
                            success: true,
                            total_total: allLinks.length,
                            links: allLinks
                        };
                    }
                }
            }

            // Fallback predeterminado mínimo si no hay capítulos reportados
            return {
                success: true,
                total_total: 1,
                links: [{ cap: 1, url: `https://jkanime.net/${slug}/1/` }]
            };
        } catch (e) {
            console.error('Error extrayendo capítulos:', e);
            return { success: false, error: e.message, links: [] };
        }
    }

    return {
        setCustomProxy,
        getGeneros,
        getDirectorio,
        buscarAnime,
        getAnimeInfo,
        getCapitulos
    };
})();
