-- Gift links — 010 : les vues s'exécutent avec les droits de qui les lit (8 oct. 2026).
--
-- LE PIÈGE QU'ON FERME. Une vue PostgreSQL s'exécute par défaut avec les droits de son PROPRIÉTAIRE,
-- pas de son lecteur. Elle traverse donc la RLS des tables qu'elle joint. Aujourd'hui sans danger :
-- `gift_links_by_client` et `gift_link_reads_by_campaign` sont fermées à `anon` et `authenticated`.
-- Mais le jour où quelqu'un accorde un SELECT à `anon` « pour voir », la vue rendrait le contenu de
-- `gift_links` et `gift_link_opens` en contournant la RLS — et le token ne protégerait plus rien.
--
-- `security_invoker = true` renverse la règle : la vue applique les droits de celui qui l'interroge.
-- Un GRANT distrait ne suffirait plus à ouvrir la porte.
--
-- ON RECRÉE LES VUES AU LIEU DE POSER L'OPTION À CÔTÉ. `ALTER VIEW ... SET` aurait suffi aujourd'hui,
-- mais `CREATE OR REPLACE VIEW` efface les options : rejouer le 009 aurait silencieusement rendu les
-- vues permissives de nouveau. Le test l'a trouvé. En portant l'option DANS la définition, le fichier
-- le plus récent fait foi à lui seul, et c'est déjà la règle de ce service : les migrations vont en
-- avant, on rejoue la dernière.
--
-- SANS EFFET AUJOURD'HUI : seul `service_role`, qui contourne la RLS de toute façon, lit ces vues.
-- C'est une protection pour plus tard, pas une correction d'une fuite présente. Relevé à la main
-- pendant le scan de sécurité Lovable du 8 octobre, qui ne voit que le frontend.

BEGIN;

CREATE OR REPLACE VIEW public.gift_links_by_client
WITH (security_invoker = true) AS
  SELECT g.token, g.arc_id, a.title,
         cre.name AS created_by, g.created_at,
         upd.name AS updated_by, g.updated_at, g.extended_at,
         g.expires_at, g.withdrawn_at, g.opens
    FROM public.gift_links g
    LEFT JOIN public.articles a      ON a.arc_id = g.arc_id
    LEFT JOIN public.api_clients cre ON cre.id = g.created_by
    LEFT JOIN public.api_clients upd ON upd.id = g.updated_by;

CREATE OR REPLACE VIEW public.gift_link_reads_by_campaign
WITH (security_invoker = true) AS
  SELECT o.campaign_group, o.utm_source, o.utm_campaign,
         count(*)::int                       AS reads,
         count(DISTINCT o.send_id)::int      AS sends,
         count(DISTINCT o.token)::int        AS articles,
         min(o.opened_at)                    AS first_read,
         max(o.opened_at)                    AS last_read
    FROM public.gift_link_opens o
   GROUP BY o.campaign_group, o.utm_source, o.utm_campaign;

REVOKE ALL ON public.gift_links_by_client        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.gift_link_reads_by_campaign FROM PUBLIC, anon, authenticated;

COMMIT;
