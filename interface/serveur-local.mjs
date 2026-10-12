// Regarder l'interface sans Vercel, et sans toucher à la production.
//
//   node interface/serveur-local.mjs        → mode DÉMONSTRATION : aucun appel réseau, rien n'est créé
//   GIFT_SERVICE_TOKEN=… node interface/…   → appelle le VRAI service, et crée de VRAIS liens
//
// LE MODE DÉMONSTRATION EST LE DÉFAUT, et c'est délibéré. Lancer un serveur pour « juste voir la page »
// ne doit pas pouvoir fabriquer des accès à des articles payants par distraction. Sans jeton, le service
// est remplacé par une réponse fabriquée sur place : aucune requête ne sort de la machine.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handlerCreer, handlerSession } from './handlers.mjs';

const PORT = Number(process.env.PORT ?? 3000);
const RACINE = new URL('../public/', import.meta.url).pathname;
const DEMO = !process.env.GIFT_SERVICE_TOKEN;

const env = {
  INTERFACE_MOT_DE_PASSE: process.env.INTERFACE_MOT_DE_PASSE ?? 'demonstration-locale',
  INTERFACE_SECRET_SESSION: process.env.INTERFACE_SECRET_SESSION ?? 'secret-local-de-demonstration-sans-valeur',
  GIFT_SERVICE_TOKEN: process.env.GIFT_SERVICE_TOKEN ?? 'jeton-de-demonstration',
  GIFT_API_URL: process.env.GIFT_API_URL,
};

/** Le service feint. Un article complet, un aperçu, un retiré : les trois issues, sans réseau. */
const serviceDemo = async (_url, options) => {
  const { urls, expires_in_days } = JSON.parse(options.body);
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

const session = handlerSession({ env });
const creer = handlerCreer({ env, fetch: DEMO ? serviceDemo : globalThis.fetch });

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
    ? `MODE DÉMONSTRATION : aucun appel réseau, aucun lien réel créé. Mot de passe : ${env.INTERFACE_MOT_DE_PASSE}`
    : 'ATTENTION : jeton de service présent — les liens créés ici seront de VRAIS accès à des articles payants.');
});
