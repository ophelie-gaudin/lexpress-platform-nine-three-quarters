// Sauvegarde et restauration des offres d'abonnement (018) : la table `subscription_offers` et le droit
// `api_clients.manage_offers`. Revue adverse du 24/11, constat 3 : le retour arrière de 018 supprime la
// table et la colonne ; sans copie, les offres et les droits accordés sont perdus.
//
// Deux sous-commandes, qui n'écrivent que sur la sortie standard (aucun réseau, aucun secret) :
//   node gift-links/supabase/sauvegarde/offres.mjs sql-sauvegarde            > sauvegarde.sql
//   node gift-links/supabase/sauvegarde/offres.mjs sql-restauration <fichier> > restauration.sql
// `sauvegarde.sql` est une seule requête SELECT, en lecture seule : sa réponse (telle que la rend l'API
// Management, `[{"sauvegarde": {…}}]`, ou le document seul) est le fichier de sauvegarde.
// `restauration.sql` remet offres et droits après ré-application de 018, dans une transaction qui
// vérifie le résultat ligne à ligne avant de valider. Rejouable : un second passage ne change rien.
// Procédure complète : docs/implementation/offres-abonnement-20261123.md, § 5.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FORMAT = 'p934-offres-v1';

// Une offre en JSON, toujours sous la même forme : dates en UTC à la microseconde, quel que soit le fuseau
// de la session. La sauvegarde et la vérification de la restauration emploient CETTE expression.
const horodatage = (colonne) => `to_char(${colonne} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const LIGNE = `jsonb_build_object(
    'id', o.id, 'name', o.name, 'sites', to_jsonb(o.sites),
    'starts_at', ${horodatage('o.starts_at')}, 'ends_at', ${horodatage('o.ends_at')},
    'url', o.url, 'label', o.label,
    'created_by', o.created_by, 'created_at', ${horodatage('o.created_at')},
    'ended_by', o.ended_by, 'ended_at', ${horodatage('o.ended_at')},
    'request_id', o.request_id)`;
const OFFRES = `(SELECT coalesce(jsonb_agg(${LIGNE} ORDER BY o.id), '[]'::jsonb) FROM public.subscription_offers o)`;
const DROITS = `(SELECT coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.id), '[]'::jsonb)
     FROM public.api_clients c WHERE c.manage_offers)`;
// Colonnes attendues de la table : une table modifiée depuis 018 doit arrêter la restauration.
const COLONNES = ['created_at', 'created_by', 'ended_at', 'ended_by', 'ends_at', 'id', 'label', 'name', 'request_id', 'sites', 'starts_at', 'url'].sort();

export function sqlSauvegarde() {
  return `-- Sauvegarde des offres (018) et des droits manage_offers. Lecture seule. Généré par offres.mjs.
SELECT jsonb_build_object(
  'format', '${FORMAT}',
  'pris_le', ${horodatage('now()')},
  'offres', d.offres,
  'droits', d.droits,
  'empreinte', md5(d.offres::text || d.droits::text)) AS sauvegarde
FROM (SELECT ${OFFRES} AS offres,
             ${DROITS} AS droits) d;
`;
}

/** Le document de sauvegarde, depuis le fichier tel que l'API Management l'a rendu, ou seul. */
export function lireSauvegarde(texte) {
  let doc = JSON.parse(texte);
  if (Array.isArray(doc) && doc.length === 1 && doc[0] && typeof doc[0] === 'object' && 'sauvegarde' in doc[0]) doc = doc[0].sauvegarde;
  if (!doc || typeof doc !== 'object' || doc.format !== FORMAT || !Array.isArray(doc.offres) || !Array.isArray(doc.droits) || typeof doc.empreinte !== 'string') {
    throw new Error(`sauvegarde illisible : format ${FORMAT} attendu`);
  }
  return doc;
}

export function sqlRestauration(doc) {
  // Le document voyage en base64 : aucune apostrophe, aucun dollar ni retour à la ligne d'un libellé ou
  // d'un nom ne peut sortir de la chaîne SQL.
  const b64 = Buffer.from(JSON.stringify(doc), 'utf8').toString('base64');
  return `-- Restauration des offres (018) et des droits manage_offers depuis la sauvegarde du ${String(doc.pris_le).replace(/[^0-9TZ:.-]/g, '')}.
-- ${doc.offres.length} offre(s), ${doc.droits.length} jeton(s) avec le droit. Généré par offres.mjs. Rejouable.
-- Prérequis : 018 ré-appliquée. Tout écart arrête la transaction : rien n'est écrit.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $restauration$
DECLARE
  doc jsonb := convert_from(decode('${b64}', 'base64'), 'UTF8')::jsonb;
  v text;
BEGIN
  IF doc->>'format' IS DISTINCT FROM '${FORMAT}' THEN RAISE EXCEPTION 'restauration : format de sauvegarde inattendu'; END IF;
  IF md5((doc->'offres')::text || (doc->'droits')::text) IS DISTINCT FROM doc->>'empreinte' THEN
    RAISE EXCEPTION 'restauration : sauvegarde altérée (empreinte différente)';
  END IF;
  IF to_regclass('public.subscription_offers') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_clients' AND column_name = 'manage_offers') THEN
    RAISE EXCEPTION 'restauration : appliquer 018 avant de restaurer';
  END IF;
  SELECT string_agg(column_name::text, ',' ORDER BY column_name::text COLLATE "C") INTO v FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'subscription_offers';
  IF v IS DISTINCT FROM '${COLONNES.join(',')}' THEN
    RAISE EXCEPTION 'restauration : colonnes de subscription_offers différentes de 018 (%)', v;
  END IF;
  SELECT string_agg(DISTINCT i, ', ') INTO v FROM (
    SELECT e->>'created_by' AS i FROM jsonb_array_elements(doc->'offres') e
    UNION SELECT e->>'ended_by' FROM jsonb_array_elements(doc->'offres') e
    UNION SELECT e->>'id' FROM jsonb_array_elements(doc->'droits') e) r
   WHERE i IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.api_clients c WHERE c.id = i::uuid);
  IF v IS NOT NULL THEN RAISE EXCEPTION 'restauration : jetons absents de api_clients : %', v; END IF;

  INSERT INTO public.subscription_offers (id, name, sites, starts_at, ends_at, url, label, created_by, created_at, ended_by, ended_at, request_id)
  SELECT x.id, x.name, x.sites, x.starts_at::timestamptz, x.ends_at::timestamptz, x.url, x.label,
         x.created_by, x.created_at::timestamptz, x.ended_by, x.ended_at::timestamptz, x.request_id
    FROM jsonb_to_recordset(doc->'offres') AS x(id uuid, name text, sites text[], starts_at text, ends_at text, url text,
         label text, created_by uuid, created_at text, ended_by uuid, ended_at text, request_id text)
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.api_clients SET manage_offers = true
   WHERE id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(doc->'droits') e) AND NOT manage_offers;

  -- Vérification : la table et les droits sont exactement ceux de la sauvegarde, ni plus ni moins.
  IF ${OFFRES} IS DISTINCT FROM doc->'offres' THEN
    RAISE EXCEPTION 'restauration : offres différentes de la sauvegarde après restauration (offre déjà présente et modifiée, ou offre en plus)';
  END IF;
  IF (SELECT coalesce(jsonb_agg(c.id ORDER BY c.id), '[]'::jsonb) FROM public.api_clients c WHERE c.manage_offers)
     IS DISTINCT FROM (SELECT coalesce(jsonb_agg((e->>'id')::uuid ORDER BY (e->>'id')::uuid), '[]'::jsonb) FROM jsonb_array_elements(doc->'droits') e) THEN
    RAISE EXCEPTION 'restauration : droits manage_offers différents de la sauvegarde (un jeton en a reçu un autre entre-temps)';
  END IF;
END $restauration$;
COMMIT;
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [commande, fichier] = process.argv.slice(2);
  if (commande === 'sql-sauvegarde') process.stdout.write(sqlSauvegarde());
  else if (commande === 'sql-restauration' && fichier) process.stdout.write(sqlRestauration(lireSauvegarde(readFileSync(fichier, 'utf8'))));
  else {
    process.stderr.write('usage : offres.mjs sql-sauvegarde | offres.mjs sql-restauration <fichier de sauvegarde>\n');
    process.exit(2);
  }
}
