// =============================================================================
//  Cloudflare Pages Function: previzualizări și SEO pentru app.autoreel.ro
// =============================================================================
//
//  Problema: Cloudflare servește același index.html pentru orice rută a
//  aplicației Flutter. WhatsApp, Facebook și Google vedeau deci, pentru orice
//  link /car/<id>, doar „AutoReel — Descoperă mașini” cu imaginea generică.
//
//  Soluția: pentru /car/<id> și /dealer/<id> luăm index.html-ul normal și îi
//  rescriem doar etichetele din <head> (titlu, descriere, Open Graph, Twitter,
//  canonical, JSON-LD) cu datele reale ale anunțului. Corpul paginii rămâne
//  identic, deci aplicația se încarcă exact ca înainte, pentru oricine.
//  /sitemap.xml se generează din anunțurile active.
//
//  Rulează DOAR pe rutele din `_routes.json`; restul site-ului e static.
//
//  Reguli:
//  - Orice eroare (Supabase căzut, timeout) => index.html neatins, cu 200.
//    Previzualizarea generică e mai bună decât o pagină stricată.
//  - 404 doar când Supabase a răspuns corect și anunțul nu există / nu e activ
//    (vândut, expirat). Corpul e tot aplicația, care afișează mesajul ei.
//  - Header-ul `x-autoreel-client: 2` e obligatoriu: fără el, RLS-ul din
//    migrația 0055 ascunde anunțurile fără km (vezi HANDOFF.md).
//  - Cheia anon e publică prin design (e și în main.dart.js, protecția e RLS).
//    Poate fi suprascrisă din Cloudflare cu variabila SUPABASE_ANON_KEY.
// =============================================================================

const SITE = 'https://app.autoreel.ro';
const SUPABASE_URL = 'https://ngdbnlcrejiqyumdvdnw.supabase.co';
// Aceeași cheie publicabilă ca fallback-ul din lib/core/config/env.dart.
const SUPABASE_ANON_KEY = 'sb_publishable_puQ5QRSxcFipFQkD8MXTlg_bHzUJUCw';

// Datele din Supabase stau în cache-ul Cloudflare atâtea secunde. Un preț
// schimbat apare în previzualizare cu cel mult atâta întârziere.
const DATA_TTL = 300;

// Profilurile cu mai puține anunțuri active sunt, de regulă, persoane private.
// Le dăm previzualizare când linkul e trimis, dar nu le cerem lui Google să
// indexeze o pagină cu numele unui om. Parcurile (2+ anunțuri) intră în sitemap.
const MIN_CARS_TO_INDEX_DEALER = 2;
const FETCH_TIMEOUT_MS = 2500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FUEL = {
  petrol: 'Benzină',
  diesel: 'Diesel',
  hybrid: 'Hibrid',
  electric: 'Electric',
  lpg: 'GPL',
  cng: 'GNC',
};
const GEARBOX = {
  manual: 'Manuală',
  automatic: 'Automată',
  semi_automatic: 'Semiautomată',
};
// Valori schema.org pentru JSON-LD (Google le înțelege în engleză).
const FUEL_LD = {
  petrol: 'Gasoline',
  diesel: 'Diesel',
  hybrid: 'Hybrid',
  electric: 'Electric',
  lpg: 'LPG',
  cng: 'CNG',
};
const GEARBOX_LD = {
  manual: 'ManualTransmission',
  automatic: 'AutomaticTransmission',
  semi_automatic: 'AutomaticTransmission',
};

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return context.next();
  }
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');

  try {
    if (path === '/sitemap.xml') return await sitemap(context);

    const car = path.match(/^\/car\/([^/]+)$/);
    if (car && UUID_RE.test(car[1])) return await carPage(context, car[1]);

    const dealer = path.match(/^\/dealer\/([^/]+)$/);
    if (dealer && UUID_RE.test(dealer[1])) {
      return await dealerPage(context, dealer[1]);
    }
  } catch (e) {
    console.error('og middleware', path, e && e.stack ? e.stack : e);
    // Un sitemap gol sau HTML în locul lui l-ar încurca pe Google; 503 îi
    // spune să revină mai târziu.
    if (path === '/sitemap.xml') {
      return new Response('Sitemap indisponibil temporar.', {
        status: 503,
        headers: { 'retry-after': '3600', 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return appShell(context);
  }
  // /car/<id>/edit, /car/<id>/prezentare etc.: aplicația normală.
  return appShell(context);
}

// ------------------------------------------------------------------ pagini

async function carPage(context, id) {
  const rows = await db(
    context,
    'cars?select=id,owner_id,brand,model,variant,year,mileage_km,price_eur,' +
      'negotiable,fuel,transmission,city,cover_image_url,published_at,updated_at,' +
      'owner:profiles!cars_owner_id_fkey(display_name)' +
      `&id=eq.${id}&status=eq.active&limit=1`,
  );
  if (rows.length === 0) return notFound(context);
  const c = rows[0];

  const name = [c.brand, c.model, c.variant].filter(Boolean).join(' ').trim();
  const price = c.price_eur != null ? `${formatInt(c.price_eur)} €` : null;
  const seller = c.owner && c.owner.display_name ? c.owner.display_name : null;

  const title = [`${name}${c.year ? ` ${c.year}` : ''}`, price, c.city]
    .filter(Boolean)
    .join(' · ');
  const facts = [
    c.year,
    c.mileage_km != null ? `${formatInt(c.mileage_km)} km` : null,
    FUEL[c.fuel],
    GEARBOX[c.transmission],
    c.city,
  ].filter(Boolean);
  const description =
    `${facts.join(' · ')}.` +
    (c.negotiable ? ' Preț negociabil.' : '') +
    (seller ? ` Vânzător: ${seller}.` : '') +
    ' Vezi pozele și contactează direct vânzătorul în AutoReel.';

  const pageUrl = `${SITE}/car/${c.id}`;
  const image = ogImage(c.cover_image_url);

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: `${name}${c.year ? ` ${c.year}` : ''}`,
    url: pageUrl,
    brand: c.brand ? { '@type': 'Brand', name: c.brand } : undefined,
    model: c.model || undefined,
    vehicleModelDate: c.year ? String(c.year) : undefined,
    mileageFromOdometer:
      c.mileage_km != null
        ? { '@type': 'QuantitativeValue', value: c.mileage_km, unitCode: 'KMT' }
        : undefined,
    fuelType: FUEL_LD[c.fuel],
    vehicleTransmission: GEARBOX_LD[c.transmission],
    image: c.cover_image_url || undefined,
    offers:
      c.price_eur != null
        ? {
            '@type': 'Offer',
            price: Number(c.price_eur),
            priceCurrency: 'EUR',
            availability: 'https://schema.org/InStock',
            itemCondition: 'https://schema.org/UsedCondition',
            url: pageUrl,
            seller: seller ? { '@type': 'AutoDealer', name: seller } : undefined,
          }
        : undefined,
  };

  return rewrite(context, {
    title: `${title} | AutoReel`,
    ogTitle: title,
    description,
    url: pageUrl,
    image,
    type: 'product',
    ld,
  });
}

async function dealerPage(context, id) {
  const [profiles, cars] = await Promise.all([
    db(context, `profiles?select=id,display_name,bio,avatar_url&id=eq.${id}&limit=1`),
    db(
      context,
      'cars?select=city,cover_image_url,published_at' +
        `&owner_id=eq.${id}&status=eq.active&order=published_at.desc.nullslast`,
    ),
  ]);
  if (profiles.length === 0) return notFound(context);
  const p = profiles[0];
  const name = p.display_name || 'Vânzător AutoReel';

  const cities = [...new Set(cars.map((c) => c.city).filter(Boolean))];
  const count = cars.length;
  const countText = count === 0 ? null : carsText(count);

  const title = [name, countText, cities.length === 1 ? cities[0] : null]
    .filter(Boolean)
    .join(' · ');
  const bio = (p.bio || '').replace(/\s+/g, ' ').trim();
  const description =
    (countText
      ? `${countText} de vânzare${cities.length ? ` în ${cities.join(', ')}` : ''}.`
      : 'Profil de vânzător în AutoReel.') +
    (bio ? ` ${truncate(bio, 160)}` : '');

  const pageUrl = `${SITE}/dealer/${p.id}`;
  // O poză de mașină arată mult mai bine în previzualizare decât un logo
  // pătrat întins pe 1200×630. Fără mașini, logo-ul; fără logo, imaginea generică.
  const cover = cars.find((c) => c.cover_image_url);
  const image = cover
    ? ogImage(cover.cover_image_url)
    : p.avatar_url
      ? { url: p.avatar_url }
      : null;

  const ld = {
    '@context': 'https://schema.org',
    '@type': 'AutoDealer',
    name,
    url: pageUrl,
    description: bio || undefined,
    logo: p.avatar_url || undefined,
    address: cities.length
      ? { '@type': 'PostalAddress', addressLocality: cities[0], addressCountry: 'RO' }
      : undefined,
  };

  return rewrite(context, {
    title: `${title} | AutoReel`,
    ogTitle: title,
    description,
    url: pageUrl,
    image,
    type: 'profile',
    ld,
    noindex: count < MIN_CARS_TO_INDEX_DEALER,
  });
}

async function sitemap(context) {
  // PostgREST întoarce cel mult 1000 de rânduri pe cerere: paginăm.
  const cars = [];
  for (let from = 0; ; from += 1000) {
    const page = await db(
      context,
      'cars?select=id,owner_id,updated_at&status=eq.active&order=id',
      { from, to: from + 999 },
    );
    cars.push(...page);
    if (page.length < 1000) break;
  }
  const dealers = new Map();
  for (const c of cars) {
    const d = dealers.get(c.owner_id) || { count: 0, lastmod: '' };
    d.count += 1;
    if (c.updated_at > d.lastmod) d.lastmod = c.updated_at;
    dealers.set(c.owner_id, d);
  }

  const entry = (loc, lastmod) =>
    `  <url><loc>${escapeXml(loc)}</loc>` +
    (lastmod ? `<lastmod>${escapeXml(lastmod.slice(0, 10))}</lastmod>` : '') +
    '</url>';
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry(`${SITE}/`),
    entry(`${SITE}/parteneri`),
    ...[...dealers]
      .filter(([, d]) => d.count >= MIN_CARS_TO_INDEX_DEALER)
      .map(([id, d]) => entry(`${SITE}/dealer/${id}`, d.lastmod)),
    ...cars.map((c) => entry(`${SITE}/car/${c.id}`, c.updated_at)),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}

// ---------------------------------------------------------------- utilitare

async function db(context, query, range) {
  const key = (context.env && context.env.SUPABASE_ANON_KEY) || SUPABASE_ANON_KEY;
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    'x-autoreel-client': '2',
    accept: 'application/json',
  };
  if (range) headers.range = `${range.from}-${range.to}`;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cf: { cacheTtl: DATA_TTL, cacheEverything: true },
  });
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

function appShell(context) {
  const url = new URL(context.request.url);
  return context.env.ASSETS.fetch(new Request(new URL('/', url), context.request));
}

async function notFound(context) {
  const shell = await appShell(context);
  const res = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append('<meta name="robots" content="noindex">', { html: true });
      },
    })
    .transform(shell);
  return new Response(res.body, { status: 404, headers: res.headers });
}

async function rewrite(context, m) {
  const shell = await appShell(context);
  const image = m.image || { url: `${SITE}/og-image.png`, width: 1200, height: 630 };

  const setContent = (value) => ({
    element(el) {
      el.setAttribute('content', value);
    },
  });

  // Etichetele pe care index.html le are deja sunt rescrise pe loc, ca să nu
  // existe dubluri. Cele noi se adaugă la finalul lui <head>.
  const extra = [
    `<link rel="canonical" href="${escapeAttr(m.url)}">`,
    `<meta property="og:url" content="${escapeAttr(m.url)}">`,
    `<script type="application/ld+json">${jsonLd(m.ld)}</script>`,
    m.noindex ? '<meta name="robots" content="noindex">' : '',
  ]
    .filter(Boolean)
    .join('\n');

  const res = new HTMLRewriter()
    .on('title', {
      element(el) {
        el.setInnerContent(m.title);
      },
    })
    .on('meta[name="description"]', setContent(m.description))
    .on('meta[property="og:title"]', setContent(m.ogTitle))
    .on('meta[property="og:description"]', setContent(m.description))
    .on('meta[property="og:type"]', setContent(m.type))
    .on('meta[property="og:image"]', setContent(image.url))
    .on('meta[property="og:image:width"]', {
      element(el) {
        if (image.width) el.setAttribute('content', String(image.width));
        else el.remove();
      },
    })
    .on('meta[property="og:image:height"]', {
      element(el) {
        if (image.height) el.setAttribute('content', String(image.height));
        else el.remove();
      },
    })
    .on('meta[name="twitter:title"]', setContent(m.ogTitle))
    .on('meta[name="twitter:description"]', setContent(m.description))
    .on('meta[name="twitter:image"]', setContent(image.url))
    .on('head', {
      element(el) {
        el.append(extra, { html: true });
      },
    })
    .transform(shell);

  const headers = new Headers(res.headers);
  // Pagina conține date care se schimbă (preț, vândut): nu o lăsăm în cache
  // mai mult decât datele din spate.
  headers.set('cache-control', `public, max-age=0, s-maxage=${DATA_TTL}`);
  return new Response(res.body, { status: 200, headers });
}

// Poza de copertă, tăiată 1200×630 (formatul cerut de WhatsApp/Facebook) prin
// transformarea de imagini Supabase. Originalele au ~250–600 KB, prea mult
// pentru unele previzualizări; varianta asta are ~150 KB.
function ogImage(src) {
  if (!src) return null;
  const marker = '/storage/v1/object/public/';
  if (!src.startsWith(SUPABASE_URL + marker)) return { url: src };
  const path = src.slice((SUPABASE_URL + marker).length);
  return {
    url:
      `${SUPABASE_URL}/storage/v1/render/image/public/${path}` +
      '?width=1200&height=630&resize=cover&quality=75',
    width: 1200,
    height: 630,
  };
}

// Româna: „1 mașină”, „5 mașini”, „20 de mașini”, „105 mașini”, „120 de mașini”.
function carsText(n) {
  if (n === 1) return '1 mașină';
  const r = n % 100;
  return r >= 1 && r <= 19 ? `${formatInt(n)} mașini` : `${formatInt(n)} de mașini`;
}

function formatInt(n) {
  return String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function truncate(s, max) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(s) {
  return escapeAttr(s).replace(/'/g, '&apos;');
}

// JSON în <script>: `<` devine secvența de escape unicode, ca un text din anunț
// să nu poată închide tag-ul; la fel separatorii de linie U+2028 / U+2029.
// Câmpurile undefined dispar la stringify.
const LINE_SEP = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP = new RegExp(String.fromCharCode(0x2029), 'g');
function jsonLd(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEP, '\\u2028')
    .replace(PARA_SEP, '\\u2029');
}
