-- Fonction déjà publiée : réintégrée au dépôt autonome avant évolution FR/EUR.
BEGIN;
CREATE OR REPLACE FUNCTION public.gift_link_status_v107(p_digest text, p_urls text[])
 RETURNS TABLE(url text, arc_id text, observed_at timestamp with time zone, available boolean, reason text, token text, link text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE observed timestamptz := statement_timestamp();
BEGIN
 IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' OR NOT EXISTS(SELECT 1 FROM api_clients c WHERE c.token_sha256=p_digest AND c.active AND c.revoked_at IS NULL) THEN
  RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='non autorisé';
 END IF;
 IF p_urls IS NULL OR cardinality(p_urls)>100 OR EXISTS(SELECT 1 FROM unnest(p_urls) u WHERE u IS NULL OR u !~ '^https://(www\.)?lexpress\.fr/[^?#[:space:]]+-[A-Z0-9]{26}/?([?#][^[:space:]]*)?$') THEN RAISE EXCEPTION 'URLs invalides'; END IF;
 RETURN QUERY WITH requested AS (
 SELECT DISTINCT u AS requested_url,substring(split_part(split_part(u,'?',1),'#',1) FROM '-([A-Z0-9]{26})/?$') AS requested_arc FROM unnest(p_urls) u
 ), states AS (
 SELECT r.*,g.token AS gift_token,g.expires_at AS gift_expiry,
 CASE WHEN g.token IS NULL THEN 'missing' WHEN g.withdrawn_at IS NOT NULL THEN 'withdrawn'
 WHEN g.expires_at<=observed THEN 'expired' WHEN NULLIF(btrim(a.body),'') IS NULL THEN 'preview'
 WHEN a.body ILIKE '%TEXTE DE DÉMONSTRATION%' OR a.body ILIKE '%data-demo%' THEN 'demo'
 ELSE 'available' END AS status_reason
 FROM requested r LEFT JOIN gift_links g ON g.arc_id=r.requested_arc LEFT JOIN articles a ON a.arc_id=r.requested_arc
 ) SELECT s.requested_url,s.requested_arc,observed,s.status_reason='available',s.status_reason,
 CASE WHEN s.status_reason='available' THEN s.gift_token END,
 CASE WHEN s.status_reason='available' THEN 'https://articles.lexpress.fr/a/'||s.gift_token END,
 CASE WHEN s.status_reason='available' THEN s.gift_expiry END FROM states s ORDER BY s.requested_url;
END $function$
;
REVOKE ALL ON FUNCTION public.gift_link_status_v107(text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.gift_link_status_v107(text,text[]) TO service_role;
COMMIT;
