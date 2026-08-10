/**
 * Configuración Global para JKAnime Scraper (GitHub Pages & Web)
 * GitHub Pages URL: https://zenitapp751-bot.github.io/jkani/scrapper.html
 */
const CONFIG = {
    // URL Base del Servidor API (Backend PHP para raspado de datos)
    apiBaseUrl: "https://over.xzod.cloud/scrappers/jkanime/",

    // URL Principal del Proxy M3U8/HLS para resolución y reproducción de episodios
    proxyUrl: "https://cris.crispdev.online/zenit_proxy_m3u8.php?url=",

    // Proxy M3U8 de respaldo
    fallbackProxyUrl: "https://over.xzod.cloud/scrappers/jkanime/proxy.php?url=",

    // Proxies CORS para Fallback Client-Side
    corsProxies: [
        "https://api.codetabs.com/v1/proxy?quest=",
        "https://thingproxy.freeboard.io/fetch/",
        "https://api.allorigins.win/raw?url="
    ]
};
