// Módulo de búsqueda y resolución de metadatos para videojuegos y consolas retro
const https = require('node:https');
const http = require('node:http');

// Helper para peticiones HTTP/HTTPS con timeout
function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const client = parsedUrl.protocol === 'https:' ? https : http;
      const headers = {
        'User-Agent': 'RetroCollectionManager/1.0 (Retro Gaming Collector Tool)',
        'Accept': 'application/json',
        ...(options.headers || {})
      };

      const req = client.get(url, { headers, timeout: 6000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchJson(res.headers.location, options).then(resolve).catch(reject);
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return resolve(null);
        }
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// Detección heurística de plataforma a partir de texto
function detectPlatform(text = '') {
  const lower = text.toLowerCase();
  if (lower.includes('super nintendo') || lower.includes('snes') || lower.includes('super famicom')) return 'snes';
  if (lower.includes('nintendo 64') || lower.includes('n64')) return 'n64';
  if (lower.includes('gamecube') || lower.includes('game cube') || lower.includes('ngc')) return 'gamecube';
  if (lower.includes('game boy advance') || lower.includes('gba')) return 'gba';
  if (lower.includes('game boy color') || lower.includes('gbc')) return 'gameboy';
  if (lower.includes('game boy') || lower.includes('gameboy')) return 'gameboy';
  if (lower.includes('nintendo ds') || lower.includes('nds')) return 'nds';
  if (lower.includes('nintendo entertainment system') || lower.includes(' nes ')) return 'nes';
  if (lower.includes('wii')) return 'wii';
  if (lower.includes('mega drive') || lower.includes('genesis')) return 'megadrive';
  if (lower.includes('master system')) return 'mastersystem';
  if (lower.includes('game gear')) return 'gamegear';
  if (lower.includes('dreamcast')) return 'dreamcast';
  if (lower.includes('saturn')) return 'saturn';
  if (lower.includes('playstation 2') || lower.includes('ps2')) return 'ps2';
  if (lower.includes('playstation') || lower.includes('ps1') || lower.includes('psx')) return 'ps1';
  if (lower.includes('psp') || lower.includes('playstation portable')) return 'psp';
  if (lower.includes('xbox')) return 'xbox';
  if (lower.includes('neo geo') || lower.includes('neogeo')) return 'neogeo';
  if (lower.includes('atari')) return 'atari2600';
  if (lower.includes('spectrum') || lower.includes('zx spectrum')) return 'spectrum';
  if (lower.includes('amstrad')) return 'amstrad';
  if (lower.includes('commodore 64') || lower.includes('c64')) return 'c64';
  if (lower.includes('amiga')) return 'amiga';
  if (lower.includes('msx')) return 'msx';
  return null;
}

// Búsqueda por código de barras (EAN-13, UPC-A, etc.)
async function lookupBarcode(barcode) {
  const cleanBarcode = barcode.trim().replace(/[^0-9]/g, '');
  if (!cleanBarcode) return null;

  // 1. Intentar con UPCitemdb API (Trial pública)
  try {
    const upcUrl = `https://api.upcitemdb.com/prod/trial/lookup?upc=${cleanBarcode}`;
    const upcData = await fetchJson(upcUrl);
    if (upcData && upcData.items && upcData.items.length > 0) {
      const item = upcData.items[0];
      const title = item.title || item.description || '';
      const platform = detectPlatform(`${title} ${item.brand || ''} ${item.category || ''}`);
      return {
        source: 'upcitemdb',
        barcode: cleanBarcode,
        title: title.replace(/\s+/g, ' ').trim(),
        platform_id: platform,
        description: item.description || '',
        cover_image: (item.images && item.images.length > 0) ? item.images[0] : null,
        brand: item.brand || null,
        type: (title.toLowerCase().includes('console') || title.toLowerCase().includes('consola') || title.toLowerCase().includes('sistema')) ? 'console' : 'game'
      };
    }
  } catch (err) {
    // Continuar al siguiente proveedor
  }

  // 2. Intentar con Open Library (por si es libro/guía/manual con ISBN-13 / EAN)
  try {
    const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanBarcode}&format=json&jscmd=data`;
    const olData = await fetchJson(olUrl);
    const key = `ISBN:${cleanBarcode}`;
    if (olData && olData[key]) {
      const book = olData[key];
      return {
        source: 'openlibrary',
        barcode: cleanBarcode,
        title: book.title || 'Guía / Libro Retro',
        platform_id: 'other',
        type: 'book_doc',
        description: book.notes || (book.authors ? `Autor: ${book.authors.map(a => a.name).join(', ')}` : ''),
        cover_image: book.cover ? (book.cover.large || book.cover.medium) : null
      };
    }
  } catch (err) {
    // Continuar
  }

  // 3. Fallback: Búsqueda a través de DuckDuckGo Lite API
  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${cleanBarcode}&format=json&no_html=1&skip_disambig=1`;
    const ddgData = await fetchJson(ddgUrl);
    if (ddgData && ddgData.Heading) {
      return {
        source: 'duckduckgo',
        barcode: cleanBarcode,
        title: ddgData.Heading,
        platform_id: detectPlatform(ddgData.AbstractText || ddgData.Heading),
        description: ddgData.AbstractText || '',
        cover_image: ddgData.Image || null,
        type: 'game'
      };
    }
  } catch (err) {
    // Ignorar
  }

  return {
    barcode: cleanBarcode,
    title: '',
    platform_id: null,
    source: 'not_found'
  };
}

// Búsqueda interactiva por título y plataforma usando Wikipedia / Wikidata API (abierta y sin límite de clave)
async function searchGames(query, platformFilter = null) {
  if (!query || query.trim().length < 2) return [];

  const sanitizedQuery = query.trim();
  const searchTerms = platformFilter ? `${sanitizedQuery} ${platformFilter} videogame` : `${sanitizedQuery} video game`;
  const url = `https://es.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(searchTerms)}&limit=8&namespace=0&format=json`;

  try {
    const data = await fetchJson(url);
    if (!data || !Array.isArray(data) || data.length < 4) return [];

    const titles = data[1] || [];
    const descriptions = data[2] || [];
    const links = data[3] || [];

    const results = [];
    for (let i = 0; i < titles.length; i++) {
      const rawTitle = titles[i].replace(/\s*\([^)]*\)/g, '').trim();
      const platDetected = detectPlatform(`${titles[i]} ${descriptions[i]}`) || platformFilter;
      results.push({
        title: rawTitle,
        full_title: titles[i],
        description: descriptions[i] || '',
        link: links[i] || '',
        platform_id: platDetected,
        type: titles[i].toLowerCase().includes('consola') ? 'console' : 'game'
      });
    }
    return results;
  } catch (err) {
    return [];
  }
}

// Parseador de precios numéricos desde strings tipo "$17.50" o "$1,200.00"
function parsePrice(str) {
  if (!str) return 0;
  const clean = str.replace(/[^0-9.]/g, '');
  return parseFloat(clean) || 0;
}

// Tasación de mercado automática mediante PriceCharting (con conversión a EUR)
const USD_TO_EUR = 0.92;

async function getPriceChartingValuation(query, platformId = null, condition = 'CIB') {
  if (!query || query.trim().length < 2) return null;

  // Mapa de plataformas a slugs de PriceCharting
  const platformSlugs = {
    snes: 'super-nintendo',
    nes: 'nes',
    n64: 'nintendo-64',
    gamecube: 'gamecube',
    wii: 'wii',
    gameboy: 'gameboy',
    gba: 'gameboy-advance',
    nds: 'nintendo-ds',
    megadrive: 'sega-genesis',
    mastersystem: 'sega-master-system',
    gamegear: 'sega-game-gear',
    saturn: 'sega-saturn',
    dreamcast: 'sega-dreamcast',
    ps1: 'playstation',
    ps2: 'playstation-2',
    psp: 'psp',
    xbox: 'xbox',
    neogeo: 'neo-geo',
    atari2600: 'atari-2600'
  };

  const platSlug = platformSlugs[platformId] || '';
  const searchTerms = platSlug ? `${query.trim()} ${platSlug}` : query.trim();
  const searchUrl = `https://www.pricecharting.com/search-products?type=videogames&q=${encodeURIComponent(searchTerms)}`;

  try {
    return new Promise((resolve) => {
      function fetchRecursive(url) {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const nextUrl = res.headers.location.startsWith('http') ? res.headers.location : `https://www.pricecharting.com${res.headers.location}`;
            return fetchRecursive(nextUrl);
          }
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            if (!data || res.statusCode !== 200) return resolve(null);

            // 1. Si redirigió directamente a la ficha del juego
            let looseMatch = data.match(/id="used_price"[^>]*>[\s\S]*?<span class="price">([^<]+)<\/span>/i);
            let cibMatch = data.match(/id="complete_price"[^>]*>[\s\S]*?<span class="price">([^<]+)<\/span>/i);
            let newMatch = data.match(/id="new_price"[^>]*>[\s\S]*?<span class="price">([^<]+)<\/span>/i);
            let gameTitleMatch = data.match(/<h1 id="product_name"[^>]*>([\s\S]*?)<\/h1>/i);

            // 2. Si es una lista de resultados de búsqueda
            if (!looseMatch) {
              const rowMatch = data.match(/<tr id="product-[0-9]+"[\s\S]*?<\/tr>/);
              if (rowMatch) {
                const row = rowMatch[0];
                looseMatch = row.match(/class="[^"]*used_price"[^>]*>[\s\S]*?<span class="js-price">([^<]+)<\/span>/i);
                cibMatch = row.match(/class="[^"]*cib_price"[^>]*>[\s\S]*?<span class="js-price">([^<]+)<\/span>/i);
                newMatch = row.match(/class="[^"]*new_price"[^>]*>[\s\S]*?<span class="js-price">([^<]+)<\/span>/i);
                gameTitleMatch = row.match(/<td class="title">\s*<a[^>]*>([^<]+)<\/a>/i);
              }
            }

            if (!looseMatch && !cibMatch && !newMatch) {
              return resolve(null);
            }

            const looseUsd = looseMatch ? parsePrice(looseMatch[1]) : 0;
            const cibUsd = cibMatch ? parsePrice(cibMatch[1]) : 0;
            const newUsd = newMatch ? parsePrice(newMatch[1]) : 0;

            const looseEur = Math.round(looseUsd * USD_TO_EUR * 10) / 10;
            const cibEur = Math.round(cibUsd * USD_TO_EUR * 10) / 10;
            const newEur = Math.round(newUsd * USD_TO_EUR * 10) / 10;

            let recommendedEur = cibEur;
            if (condition === 'Loose') recommendedEur = looseEur;
            else if (condition === 'Boxed') recommendedEur = Math.round(((looseEur + cibEur) / 2) * 10) / 10;
            else if (condition === 'Sealed') recommendedEur = newEur;

            // Si CIB es 0 pero loose tiene precio
            if (recommendedEur === 0 && looseEur > 0) recommendedEur = looseEur;

            resolve({
              source: 'PriceCharting',
              title: gameTitleMatch ? gameTitleMatch[1].trim() : query,
              condition,
              recommendedEur,
              prices: {
                loose: { usd: looseUsd, eur: looseEur },
                cib: { usd: cibUsd, eur: cibEur },
                boxed: { eur: Math.round(((looseEur + cibEur) / 2) * 10) / 10 },
                sealed: { usd: newUsd, eur: newEur }
              }
            });
          });
        }).on('error', () => resolve(null));
      }

      fetchRecursive(searchUrl);
    });
  } catch (e) {
    return null;
  }
}

module.exports = {
  lookupBarcode,
  searchGames,
  detectPlatform,
  getPriceChartingValuation
};
