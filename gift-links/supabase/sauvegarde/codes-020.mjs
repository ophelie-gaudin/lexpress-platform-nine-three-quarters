// Sauvegarde et restauration des codes d'offre (020). Le retour arrière de 020 supprime la colonne `code` ;
// une ré-application en tire de nouveaux. Sans copie, un code déjà envoyé dans des liens pourrait être
// repris par une autre offre, et ces liens afficheraient alors cette autre offre. On garde donc, offre par
// offre, son code, et on le remet après ré-application de 020.
//
// Trois sous-commandes, qui n'écrivent que sur la sortie standard (aucun réseau, aucun secret) :
//   node gift-links/supabase/sauvegarde/codes-020.mjs sql-sauvegarde              > sauvegarde-codes.sql
//   node gift-links/supabase/sauvegarde/codes-020.mjs sql-verification <fichier>  > verification-codes.sql
//   node gift-links/supabase/sauvegarde/codes-020.mjs sql-restauration <fichier>  > restauration-codes.sql
// `sauvegarde-codes.sql` est une seule lecture ; sa réponse (telle que la rend l'API Management,
// `[{"sauvegarde": {…}}]`, ou le document seul) est le fichier de sauvegarde. `verification-codes.sql`
// n'écrit rien (ROLLBACK) : sauvegarde intacte et égale à la base. `restauration-codes.sql`, après
// ré-application de 020, remet à chaque offre son code ; elle refuse (et n'écrit rien) si une offre de la
// sauvegarde manque, ou si un code sauvegardé est déjà pris par une offre créée depuis. Rejouable.
// Procédure : docs/implementation/offres-abonnement-20261123.md, § « 020 ».
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FORMAT_CODES = 'p934-codes-020-v1';
const CODES = `(SELECT coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code) ORDER BY o.id), '[]'::jsonb) FROM public.subscription_offers o)`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[a-z0-9-]{3,40}$/;

export function sqlSauvegardeCodes() {
  return `-- Sauvegarde des codes d'offre (020). Lecture seule. Généré par codes-020.mjs.
SELECT jsonb_build_object(
  'format', '${FORMAT_CODES}',
  'pris_le', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'codes', d.codes,
  'empreinte', md5(d.codes::text)) AS sauvegarde
FROM (SELECT ${CODES} AS codes) d;
`;
}

/** Le document de sauvegarde, contrôlé ligne à ligne. */
export function lireSauvegardeCodes(texte) {
  let doc = JSON.parse(texte);
  if (Array.isArray(doc) && doc.length === 1 && doc[0] && typeof doc[0] === 'object' && 'sauvegarde' in doc[0]) doc = doc[0].sauvegarde;
  if (!doc || typeof doc !== 'object' || doc.format !== FORMAT_CODES || !Array.isArray(doc.codes)
      || typeof doc.empreinte !== 'string' || !/^[0-9a-f]{32}$/.test(doc.empreinte) || typeof doc.pris_le !== 'string') {
    throw new Error(`sauvegarde des codes illisible : format ${FORMAT_CODES} attendu`);
  }
  const vus = new Set();
  doc.codes.forEach((c, i) => {
    if (!c || typeof c !== 'object' || Object.keys(c).sort().join(',') !== 'code,id' || !UUID.test(c.id) || !CODE.test(c.code) || vus.has(c.code)) {
      throw new Error(`sauvegarde des codes incomplète ou incohérente : ligne n° ${i + 1}`);
    }
    vus.add(c.code);
  });
  return doc;
}

const enBase64 = (doc) => Buffer.from(JSON.stringify(doc), 'utf8').toString('base64');
const date = (doc) => String(doc.pris_le).replace(/[^0-9TZ:.-]/g, '');
const entete = (doc, etape) => `DECLARE
  doc jsonb := convert_from(decode('${enBase64(doc)}', 'base64'), 'UTF8')::jsonb;
  etape text := '${etape}';
  v text;
BEGIN
  IF doc->>'format' IS DISTINCT FROM '${FORMAT_CODES}' OR md5((doc->'codes')::text) IS DISTINCT FROM doc->>'empreinte' THEN
    RAISE EXCEPTION '%: sauvegarde des codes altérée', etape;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'subscription_offers' AND column_name = 'code') THEN
    RAISE EXCEPTION '%: appliquer 020 d''abord', etape;
  END IF;`;
// Chaque offre de la sauvegarde existe et porte son code : c'est l'égalité qui compte (des offres créées
// depuis peuvent exister, avec leur propre code).
const egalite = (message) => `  SELECT string_agg(e->>'id', ', ') INTO v FROM jsonb_array_elements(doc->'codes') e
   WHERE NOT EXISTS (SELECT 1 FROM public.subscription_offers o WHERE o.id = (e->>'id')::uuid AND o.code = e->>'code');
  IF v IS NOT NULL THEN RAISE EXCEPTION '%: offres sans leur code sauvegardé (${message}) : %', etape, v; END IF;`;

/** Vérification sans écriture : sauvegarde intacte et égale à la base. */
export function sqlVerificationCodes(doc) {
  return `-- Vérification de la sauvegarde des codes du ${date(doc)} (${doc.codes.length} offre(s)). N'écrit rien : ROLLBACK.
BEGIN;
DO $verification$
${entete(doc, 'vérification des codes')}
${egalite('base modifiée depuis la sauvegarde : la reprendre')}
END $verification$;
ROLLBACK;
`;
}

/** Après ré-application de 020 : remet à chaque offre son code sauvegardé. */
export function sqlRestaurationCodes(doc) {
  return `-- Restauration des codes d'offre depuis la sauvegarde du ${date(doc)} (${doc.codes.length} offre(s)). Généré par codes-020.mjs. Rejouable.
BEGIN;
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.subscription_offers IN EXCLUSIVE MODE;
DO $restauration$
${entete(doc, 'restauration des codes')}
  SELECT string_agg(e->>'id', ', ') INTO v FROM jsonb_array_elements(doc->'codes') e
   WHERE NOT EXISTS (SELECT 1 FROM public.subscription_offers o WHERE o.id = (e->>'id')::uuid);
  IF v IS NOT NULL THEN RAISE EXCEPTION '%: offres absentes de la table : %', etape, v; END IF;
  -- Un code sauvegardé déjà porté par une AUTRE offre (créée depuis) : refus, rien n'est écrit.
  SELECT string_agg(o.code, ', ') INTO v FROM jsonb_array_elements(doc->'codes') e
    JOIN public.subscription_offers o ON o.code = e->>'code' AND o.id <> (e->>'id')::uuid
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(doc->'codes') f WHERE (f->>'id')::uuid = o.id);
  IF v IS NOT NULL THEN RAISE EXCEPTION '%: codes déjà pris par une offre créée depuis : %', etape, v; END IF;
  -- Deux temps : codes provisoires uniques, puis codes sauvegardés (aucun conflit d'unicité entre eux).
  UPDATE public.subscription_offers o SET code = 'tmp-' || substr(md5(o.id::text), 1, 32)
   WHERE o.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(doc->'codes') e);
  UPDATE public.subscription_offers o SET code = e->>'code'
    FROM jsonb_array_elements(doc->'codes') e WHERE o.id = (e->>'id')::uuid;
${egalite('après restauration')}
END $restauration$;
COMMIT;
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [commande, fichier] = process.argv.slice(2);
  if (commande === 'sql-sauvegarde') process.stdout.write(sqlSauvegardeCodes());
  else if (commande === 'sql-verification' && fichier) process.stdout.write(sqlVerificationCodes(lireSauvegardeCodes(readFileSync(fichier, 'utf8'))));
  else if (commande === 'sql-restauration' && fichier) process.stdout.write(sqlRestaurationCodes(lireSauvegardeCodes(readFileSync(fichier, 'utf8'))));
  else {
    process.stderr.write('usage : codes-020.mjs sql-sauvegarde | sql-verification <fichier> | sql-restauration <fichier>\n');
    process.exit(2);
  }
}
