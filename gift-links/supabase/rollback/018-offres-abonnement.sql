-- Retour arrière de 018. Ordre : d'abord le lecteur précédent (il n'appelle plus get_subscription_offer),
-- ensuite seulement ce script. Un lecteur qui appelle encore la RPC supprimée retombe sur son bouton par
-- défaut — il ne casse pas —, mais chaque page ferait un appel en échec pour rien.
-- Les offres sont supprimées avec la table : en garder une copie avant (voir le runbook).
-- Liens, articles, lectures et jetons ne sont pas touchés.
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP FUNCTION IF EXISTS public.get_subscription_offer(text);
DROP FUNCTION IF EXISTS public.current_subscription_offer_id(text);
DROP FUNCTION IF EXISTS public.create_subscription_offer(uuid, text[], timestamptz, timestamptz, text, text, text, text);
DROP FUNCTION IF EXISTS public.displayed_subscription_offers(uuid);
DROP FUNCTION IF EXISTS public.list_subscription_offers(uuid);
DROP FUNCTION IF EXISTS public.end_subscription_offer(uuid, uuid);
DROP FUNCTION IF EXISTS public.assert_offer_manager(uuid);
DROP TABLE IF EXISTS public.subscription_offers;
DROP FUNCTION IF EXISTS public.offer_sites_valid(text[]);
DROP FUNCTION IF EXISTS public.offer_url_family(text);
DROP FUNCTION IF EXISTS public.offer_site_language(text);
DROP FUNCTION IF EXISTS public.offer_site_family(text);
ALTER TABLE public.api_clients DROP COLUMN IF EXISTS manage_offers;
COMMIT;
