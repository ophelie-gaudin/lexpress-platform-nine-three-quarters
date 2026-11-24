// Sauvegarde et restauration des offres d'abonnement (018) : la table `subscription_offers` et le droit
// `api_clients.manage_offers`. Revue adverse du 24/11, constat 3 : le retour arrière de 018 supprime la
// table et la colonne ; sans copie, les offres et les droits accordés sont perdus.
//
// Quatre sous-commandes, qui n'écrivent que sur la sortie standard (aucun réseau, aucun secret) :
//   node gift-links/supabase/sauvegarde/offres.mjs sql-sauvegarde               > sauvegarde.sql
//   node gift-links/supabase/sauvegarde/offres.mjs sql-verification <fichier>   > verification.sql
//   node gift-links/supabase/sauvegarde/offres.mjs sql-retour-arriere <fichier> > retour-arriere.sql
//   node gift-links/supabase/sauvegarde/offres.mjs sql-restauration <fichier>   > restauration.sql
// `verification.sql` n'écrit RIEN (transaction annulée) : sauvegarde intacte et encore égale à la base.
// `retour-arriere.sql` est le retour arrière de 018 GARDÉ par la sauvegarde : il verrouille les tables, vérifie
// dans la même transaction que offres et droits sont encore exactement ceux de la sauvegarde, puis seulement
// supprime. Une offre créée, terminée ou modifiée après la sauvegarde l'arrête : rien n'est perdu en silence.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const texteOuNul = (v) => v === null || typeof v === 'string';

/** Le document de sauvegarde, depuis le fichier tel que l'API Management l'a rendu, ou seul. Vérifie sa forme
 * ligne à ligne ; l'empreinte et l'égalité avec la base sont vérifiées en SQL (retour arrière gardé, restauration). */
export function lireSauvegarde(texte) {
  let doc = JSON.parse(texte);
  if (Array.isArray(doc) && doc.length === 1 && doc[0] && typeof doc[0] === 'object' && 'sauvegarde' in doc[0]) doc = doc[0].sauvegarde;
  if (!doc || typeof doc !== 'object' || doc.format !== FORMAT || !Array.isArray(doc.offres) || !Array.isArray(doc.droits)
      || typeof doc.empreinte !== 'string' || !/^[0-9a-f]{32}$/.test(doc.empreinte) || typeof doc.pris_le !== 'string' || !DATE.test(doc.pris_le)) {
    throw new Error(`sauvegarde illisible : format ${FORMAT} attendu`);
  }
  doc.offres.forEach((o, i) => {
    const ok = o && typeof o === 'object' && Object.keys(o).sort().join(',') === COLONNES.join(',')
      && UUID.test(o.id) && Array.isArray(o.sites) && o.sites.length > 0 && o.sites.every((x) => typeof x === 'string')
      && DATE.test(o.starts_at) && DATE.test(o.ends_at) && DATE.test(o.created_at) && (o.ended_at === null || DATE.test(o.ended_at))
      && (o.created_by === null || UUID.test(o.created_by)) && (o.ended_by === null || UUID.test(o.ended_by))
      && texteOuNul(o.name) && texteOuNul(o.url) && texteOuNul(o.label) && texteOuNul(o.request_id);
    if (!ok) throw new Error(`sauvegarde incomplète : offre n° ${i + 1}`);
  });
  doc.droits.forEach((d, i) => {
    if (!d || typeof d !== 'object' || Object.keys(d).sort().join(',') !== 'id,name' || !UUID.test(d.id) || typeof d.name !== 'string') {
      throw new Error(`sauvegarde incomplète : droit n° ${i + 1}`);
    }
  });
  return doc;
}

const enBase64 = (doc) => Buffer.from(JSON.stringify(doc), 'utf8').toString('base64');
// Contrôles communs : document intact, puis égalité exacte de la base avec lui (offres et droits).
const verifierDocument = `  IF doc->>'format' IS DISTINCT FROM '${FORMAT}' THEN RAISE EXCEPTION '%: format de sauvegarde inattendu', etape; END IF;
  IF md5((doc->'offres')::text || (doc->'droits')::text) IS DISTINCT FROM doc->>'empreinte' THEN
    RAISE EXCEPTION '%: sauvegarde altérée (empreinte différente)', etape;
  END IF;`;
const verifierBase = (message) => `  IF ${OFFRES} IS DISTINCT FROM doc->'offres' THEN
    RAISE EXCEPTION '%: offres différentes de la sauvegarde (${message})', etape;
  END IF;
  IF (SELECT coalesce(jsonb_agg(c.id ORDER BY c.id), '[]'::jsonb) FROM public.api_clients c WHERE c.manage_offers)
     IS DISTINCT FROM (SELECT coalesce(jsonb_agg((e->>'id')::uuid ORDER BY (e->>'id')::uuid), '[]'::jsonb) FROM jsonb_array_elements(doc->'droits') e) THEN
    RAISE EXCEPTION '%: droits manage_offers différents de la sauvegarde (${message})', etape;
  END IF;`;

/** Vérification sans écriture : la sauvegarde est intacte et égale à la base (sinon erreur). Annulée par ROLLBACK. */
export function sqlVerification(doc) {
  return `-- Vérification de la sauvegarde du ${String(doc.pris_le).replace(/[^0-9TZ:.-]/g, '')} contre la base. N'écrit rien : ROLLBACK.
-- Généré par offres.mjs. Une erreur = sauvegarde altérée ou base modifiée depuis : reprendre la sauvegarde.
BEGIN;
DO $verification$
DECLARE
  doc jsonb := convert_from(decode('${enBase64(doc)}', 'base64'), 'UTF8')::jsonb;
  etape text := 'vérification';
BEGIN
${verifierDocument}
${verifierBase('modifiés après la sauvegarde : la reprendre')}
END $verification$;
ROLLBACK;
`;
}

/** Retour arrière de 018 gardé par la sauvegarde : refuse si la base a changé depuis. */
export function sqlRetourArriere(doc, rollback = readFileSync(new URL('../rollback/018-offres-abonnement.sql', import.meta.url), 'utf8')) {
  const corps = rollback.split('\n').filter((l) => !/^\s*(--|BEGIN;|COMMIT;|SET LOCAL lock_timeout)/.test(l) && l.trim() !== '').join('\n');
  return `-- Retour arrière de 018 GARDÉ par la sauvegarde du ${String(doc.pris_le).replace(/[^0-9TZ:.-]/g, '')} (${doc.offres.length} offre(s), ${doc.droits.length} droit(s)).
-- Généré par offres.mjs. Refuse, sans rien supprimer, si offres ou droits ont changé depuis la sauvegarde :
-- reprendre alors une sauvegarde. Corps : rollback/018-offres-abonnement.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
-- Plus aucune écriture possible sur ces tables jusqu'à la fin : rien ne change entre le contrôle et le DROP.
LOCK TABLE public.subscription_offers, public.api_clients IN EXCLUSIVE MODE;
DO $garde$
DECLARE
  doc jsonb := convert_from(decode('${enBase64(doc)}', 'base64'), 'UTF8')::jsonb;
  etape text := 'retour arrière refusé';
BEGIN
${verifierDocument}
${verifierBase('modifiés après la sauvegarde : la reprendre')}
END $garde$;
${corps}
COMMIT;
`;
}

export function sqlRestauration(doc) {
  // Le document voyage en base64 : aucune apostrophe, aucun dollar ni retour à la ligne d'un libellé ou
  // d'un nom ne peut sortir de la chaîne SQL.
  return `-- Restauration des offres (018) et des droits manage_offers depuis la sauvegarde du ${String(doc.pris_le).replace(/[^0-9TZ:.-]/g, '')}.
-- ${doc.offres.length} offre(s), ${doc.droits.length} jeton(s) avec le droit. Généré par offres.mjs. Rejouable.
-- Prérequis : 018 ré-appliquée. N'écrit que dans une table VIDE où aucun jeton n'a le droit (l'état juste
-- après ré-application) ; sinon elle compare seulement, et refuse le moindre écart sans rien écrire : elle ne
-- peut pas remettre une offre ni un droit retirés depuis la sauvegarde. Tout écart annule la transaction.
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $restauration$
DECLARE
  doc jsonb := convert_from(decode('${enBase64(doc)}', 'base64'), 'UTF8')::jsonb;
  etape text := 'restauration';
  v text;
BEGIN
${verifierDocument}
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

  -- Base déjà peuplée (pas encore supprimée, ou déjà restaurée) : comparaison seule, aucune écriture.
  IF EXISTS (SELECT 1 FROM public.subscription_offers) OR EXISTS (SELECT 1 FROM public.api_clients WHERE manage_offers) THEN
${verifierBase('la restauration n’écrit que dans une table vide sans droit accordé')}
    RETURN;
  END IF;

  INSERT INTO public.subscription_offers (id, name, sites, starts_at, ends_at, url, label, created_by, created_at, ended_by, ended_at, request_id)
  SELECT x.id, x.name, x.sites, x.starts_at::timestamptz, x.ends_at::timestamptz, x.url, x.label,
         x.created_by, x.created_at::timestamptz, x.ended_by, x.ended_at::timestamptz, x.request_id
    FROM jsonb_to_recordset(doc->'offres') AS x(id uuid, name text, sites text[], starts_at text, ends_at text, url text,
         label text, created_by uuid, created_at text, ended_by uuid, ended_at text, request_id text)
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.api_clients SET manage_offers = true
   WHERE id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(doc->'droits') e) AND NOT manage_offers;

  -- Vérification : la table et les droits sont exactement ceux de la sauvegarde, ni plus ni moins.
${verifierBase('offre déjà présente et modifiée, offre en plus, ou droit accordé entre-temps')}
END $restauration$;
COMMIT;
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [commande, fichier] = process.argv.slice(2);
  if (commande === 'sql-sauvegarde') process.stdout.write(sqlSauvegarde());
  else if (commande === 'sql-restauration' && fichier) process.stdout.write(sqlRestauration(lireSauvegarde(readFileSync(fichier, 'utf8'))));
  else if (commande === 'sql-verification' && fichier) process.stdout.write(sqlVerification(lireSauvegarde(readFileSync(fichier, 'utf8'))));
  else if (commande === 'sql-retour-arriere' && fichier) process.stdout.write(sqlRetourArriere(lireSauvegarde(readFileSync(fichier, 'utf8'))));
  else {
    process.stderr.write('usage : offres.mjs sql-sauvegarde | sql-verification <fichier de sauvegarde> | sql-retour-arriere <fichier de sauvegarde> | sql-restauration <fichier de sauvegarde>\n');
    process.exit(2);
  }
}
