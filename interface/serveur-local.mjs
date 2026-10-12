// Regarder l'interface sans Vercel, et sans toucher à la production.
//
//   node interface/serveur-local.mjs        → mode DÉMONSTRATION : aucun appel réseau, rien n'est créé
//   GIFT_API_REEL=1 node interface/…        → appelle le VRAI service, et crée de VRAIS liens
//
// LE MODE DÉMONSTRATION EST LE DÉFAUT, et c'est délibéré. Lancer un serveur pour « juste voir la page »
// ne doit pas pouvoir fabriquer des accès à des articles payants par distraction. Le service est alors
// remplacé par une réponse fabriquée sur place : aucune requête ne sort de la machine, et n'importe
// quel jeton de 64 caractères hexadécimaux ouvre la session.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handlerCreer, handlerSession } from './handlers.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const RACINE = new URL('../public/', import.meta.url).pathname;
const DEMO = !process.env.GIFT_API_REEL;
const JETON_DEMO = 'd'.repeat(64);

const env = {
  INTERFACE_SECRET_SESSION: process.env.INTERFACE_SECRET_SESSION ?? 'secret-local-de-demonstration-sans-valeur',
  GIFT_API_URL: process.env.GIFT_API_URL,
};

/** Le service feint. Un article complet, un aperçu, un retiré : les trois issues, sans réseau. */
const serviceDemo = async (_url, options) => {
  const { urls, expires_in_days } = JSON.parse(options.body);
  // La sonde d'ouverture de session : demande vide, donc « aucune URL exploitable », donc 400 — ce que
  // le vrai service répond à un jeton RECONNU. Un jeton mal formé n'arrive même pas jusqu'ici.
  if (urls.length === 0) return new Response(JSON.stringify({ error: 'aucune URL exploitable', rejected: [] }), { status: 400 });
  const links = [], rejected = [];
  urls.forEach((url, i) => {
    if (/retire|withdrawn/i.test(url)) { rejected.push({ url, erreur: 'lien retiré : rouvrir withdrawn_at à la main, délibérément' }); return; }
    const token = `demo${String(i).padStart(28, '0')}`;
    links.push({
      url, arc_id: url.slice(-26), token, link: `https://articles.lexpress.fr/a/${token}`,
      expires_at: new Date(Date.now() + expires_in_days * 86400000).toISOString(),
      // Un aperçu sur deux : c'est l'avertissement rouge qu'on veut pouvoir regarder.
      content: i % 2 === 1 ? 'preview' : 'full',
      source: 'demonstration', state: ['created', 'extended', 'unchanged'][i % 3],
    });
  });
  if (links.length === 0) return new Response(JSON.stringify({ error: 'aucun article exploitable', rejected }), { status: 502 });
  return new Response(JSON.stringify({ links, rejected, client: 'demonstration-locale' }), { status: 200 });
};

const reseau = DEMO ? serviceDemo : globalThis.fetch;
const session = handlerSession({ env, fetch: reseau });
const creer = handlerCreer({ env, fetch: reseau });

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    const corps = req.method === 'GET' || req.method === 'DELETE' ? undefined
      : await new Promise((ok) => { const m = []; req.on('data', (c) => m.push(c)); req.on('end', () => ok(Buffer.concat(m))); });
    const requete = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body: corps });
    const reponse = await (url.pathname === '/api/session' ? session : creer)(requete);
    res.writeHead(reponse.status, Object.fromEntries(reponse.headers));
    res.end(await reponse.text());
    return;
  }
  // Un chemin normalisé puis vérifié : sans ça, `/../../etc/passwd` servirait ce qu'il demande.
  const demande = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const chemin = normalize(join(RACINE, demande));
  if (!chemin.startsWith(RACINE)) { res.writeHead(403).end('non'); return; }
  try {
    res.writeHead(200, { 'content-type': TYPES[extname(chemin)] ?? 'application/octet-stream' });
    res.end(await readFile(chemin));
  } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('page inconnue'); }
}).listen(PORT, () => {
  console.log(`Interface sur http://localhost:${PORT}`);
  console.log(DEMO
    ? `MODE DÉMONSTRATION : aucun appel réseau, aucun lien réel créé.\nJeton à coller : ${JETON_DEMO}`
    : 'ATTENTION : mode réel — le jeton saisi sera envoyé au service, et les liens créés seront de VRAIS accès à des articles payants.');
});
