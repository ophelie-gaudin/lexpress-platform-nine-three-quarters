-- BASE TEST SEULEMENT (`gsvvcrhagatwjwyyjkli`, branche Supabase `test-europe`). Jamais en PROD.
--
-- Revue adverse du 24/11, constat 5 (antérieur aux offres) : sur TEST, `anon` et `authenticated` gardaient
-- TRUNCATE, REFERENCES, TRIGGER et MAINTAIN (ACL `Dxtm`) sur quatre tables et deux vues. La PROD ne leur
-- donne aucun droit direct sur ces relations (relevé du 24/11 en lecture seule). On aligne TEST sur PROD.
-- Les lectures publiques passent par des fonctions SECURITY DEFINER : rien de ce qui est retiré ne sert.
--
-- Retour arrière (TEST) : GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON <les six relations> TO anon, authenticated;
BEGIN;
SET LOCAL lock_timeout = '3s';
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
  ON public.api_clients, public.articles, public.gift_link_opens, public.gift_links,
     public.gift_link_reads_by_campaign, public.gift_links_by_client
  FROM anon, authenticated;
DO $$
DECLARE v text;
BEGIN
  IF current_setting('server_version_num')::int < 170000 THEN RAISE EXCEPTION 'PostgreSQL 17 attendu (MAINTAIN)'; END IF;
  SELECT string_agg(c.relname || ':' || r || ':' || p, ', ') INTO v
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['anon','authenticated']) AS r
    CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p
   WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND has_table_privilege(r, c.oid, p);
  IF v IS NOT NULL THEN RAISE EXCEPTION 'droits publics restants : %', v; END IF;
END $$;
COMMIT;
