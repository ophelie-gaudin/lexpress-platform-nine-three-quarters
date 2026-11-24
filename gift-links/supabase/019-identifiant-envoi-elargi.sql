-- Gift links — 019 : un identifiant d'envoi au format élargi, PAR UNE NOUVELLE RPC (24 nov. 2026).
--
-- LE BESOIN. Le CRM branche un module « Article offert » dans les e-mails HubSpot (jeton de service
-- `hubspot-emails`). Il veut rattacher chaque lecture à l'e-mail qui l'a amenée, par le paramètre `s` du
-- lien diffusé — `at_campaign` sert déjà à autre chose. Or l'identifiant d'un e-mail HubSpot est un
-- nombre (`123456789012`), et la lecture ne gardait que 32 hexadécimaux, la forme tirée au hasard par
-- l'agent WhatsApp : tout le reste devenait NULL. Décision d'Ophélie du 24/11 (choix 1B).
--
-- POURQUOI UNE NOUVELLE RPC, ET NON L'ÉLARGISSEMENT DES ANCIENNES (revue adverse du 24/11, constats 1 et
-- bloquant de la seconde revue). La page publiée le 20/10 envoie `at_recipient_id` EN PRIORITÉ sur `s` ;
-- `at_recipient_id` peut porter l'identifiant d'un CONTACT. Tant que la base ne garde que 32 hexadécimaux,
-- un identifiant de contact devient NULL. Élargir le motif des fonctions existantes l'aurait fait
-- enregistrer pour tout appelant ancien : un onglet resté ouvert sur l'ancienne page, ou l'ancienne page
-- remise en ligne par un retour arrière. La base ne peut pas savoir de quel paramètre vient la valeur.
-- Donc :
--   - `get_gift_article_for_edition` (015), `get_gift_article` et `get_gift_article_for_edition_v2` (017)
--     NE CHANGENT PAS : toujours 32 hexadécimaux ou NULL ;
--   - `get_gift_article_for_edition_v3` est nouvelle : même contrat que v2 (mêmes paramètres, mêmes
--     colonnes, même journalisation), mais `s` accepte ^[A-Za-z0-9_-]{1,64}$. Seule la page de la
--     demande de fusion GitLab !1, qui ne prend l'identifiant d'envoi que dans `s` (`sendIdFrom`),
--     l'appelle.
-- Le motif exclut « @ », « + », « . » et l'espace, donc une adresse e-mail ou un numéro au format
-- international ; il ne peut pas exclure un identifiant de contact numérique : ne jamais en mettre dans
-- `s` (README, Partie I).
--
-- PAS DE CONTRAINTE CHECK, TOUJOURS (voir 005) : la page est publique, l'URL se modifie à la main, une
-- contrainte ferait échouer l'INSERT donc l'affichage. On assainit dans la fonction.
--
-- v3 est une copie de la définition de 015 (relevée en TEST et en PROD le 24/11, même empreinte
-- 254b463cfdba9db7bdc326f40d38d788) à trois écarts près, vérifiés par validate-send-id.mjs : la ligne
-- d'assainissement de `s`, et la colonne `language` de v2 (langue de l'article, aussi sur « retiré » et
-- « expiré »). Rejouable. Retour arrière : rollback/019-identifiant-envoi-elargi.sql.
--
-- ORDRE DE DÉPLOIEMENT : 019 AVANT la page de !1 (elle appelle v3 ; sans v3, elle afficherait l'écran
-- technique). 019 seule ne change rien pour personne : aucune page publiée ne l'appelle. Retour arrière
-- dans l'ordre inverse : la page d'abord, 019 ensuite.
BEGIN;
SET LOCAL lock_timeout = '3s';

-- Garde : la fonction de 015 doit être STRICTE. Une base où l'ancienne version de 019 (motif élargi dans
-- la fonction existante) a été appliquée doit d'abord passer rollback/019 (cas de TEST, le 24/11).
DO $garde$
BEGIN
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.get_gift_article_for_edition(text,text,text,text,text,text,text)'::regprocedure)
       NOT LIKE '%v_send  := CASE WHEN p_send_id ~ ''^[0-9a-f]{32}$'' THEN p_send_id ELSE NULL END;%' THEN
    RAISE EXCEPTION '019 : get_gift_article_for_edition n''est pas la version stricte de 015 — appliquer rollback/019 d''abord';
  END IF;
END $garde$;

CREATE OR REPLACE FUNCTION public.get_gift_article_for_edition_v3(p_edition text, p_token text, p_utm_source text DEFAULT NULL::text, p_utm_campaign text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text, p_send_id text DEFAULT NULL::text, p_campaign_group text DEFAULT NULL::text)
 RETURNS TABLE(status text, canonical_url text, title text, standfirst text, image_url text, body text, section text, author text, published_at timestamp with time zone, language text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $v3$
DECLARE
  v_link  public.gift_links%ROWTYPE;
  v_send  text;
  v_group text;
  v_lang  text;
BEGIN
  IF p_edition IS NULL OR p_edition NOT IN ('FR','EUR') OR p_token IS NULL OR p_token !~ '^[0-9a-f]{32}$' THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  SELECT * INTO v_link FROM public.gift_links WHERE gift_links.token = p_token AND gift_links.edition = p_edition;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'unknown'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  -- Comme v2 (017) : la langue de l'article, pour traduire aussi les écrans « retiré » et « expiré ».
  SELECT a.language INTO v_lang FROM public.articles a WHERE a.edition = v_link.edition AND a.arc_id = v_link.arc_id;

  -- Retiré d'abord : une coupure manuelle prime sur une date encore valide.
  IF v_link.withdrawn_at IS NOT NULL THEN
    RETURN QUERY SELECT 'withdrawn'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, v_lang;
    RETURN;
  END IF;

  IF v_link.expires_at <= now() THEN
    RETURN QUERY SELECT 'expired'::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::timestamptz, v_lang;
    RETURN;
  END IF;

  -- ASSAINISSEMENT. Une query string bricolée ne doit jamais faire tomber la page : ce qui ne convient
  -- pas devient NULL, et l'article s'affiche quand même.
  -- 019 : l'écart d'assainissement avec get_gift_article_for_edition (015) — 1 à 64 caractères [A-Za-z0-9_-]
  -- (32 hexadécimaux WhatsApp comme identifiant numérique d'un e-mail HubSpot). Intervalles en points de
  -- code : aucun caractère accentué ni non latin ne passe.
  v_send  := CASE WHEN p_send_id ~ '^[A-Za-z0-9_-]{1,64}$' THEN p_send_id ELSE NULL END;
  v_group := CASE WHEN p_campaign_group ~ '^[a-z0-9_]{1,40}$' THEN p_campaign_group ELSE NULL END;

  -- LA JOURNALISATION NE CHANGE PAS. C'est elle qui porte l'attribution juste : un segment PAR LECTURE,
  -- celui que ce visiteur-là portait dans son URL.
  INSERT INTO public.gift_link_opens (token, utm_source, utm_campaign, referrer, send_id, campaign_group)
  VALUES (p_token, p_utm_source, p_utm_campaign, p_referrer, v_send, v_group);
  UPDATE public.gift_links
     SET opens = gift_links.opens + 1, last_opened_at = now()
   WHERE gift_links.token = p_token AND gift_links.edition = p_edition;

  RETURN QUERY
  SELECT CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN 'preview' ELSE 'ok' END,
         a.canonical_url, a.title, a.standfirst, a.image_url,
         CASE WHEN a.body IS NULL OR btrim(a.body) = '' THEN NULL ELSE a.body END,
         a.section, a.author, a.published_at, a.language
  FROM public.articles a WHERE a.edition = v_link.edition AND a.arc_id = v_link.arc_id;
END $v3$
;

REVOKE ALL ON FUNCTION public.get_gift_article_for_edition_v3(text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gift_article_for_edition_v3(text,text,text,text,text,text,text) TO anon,authenticated,service_role;

COMMENT ON FUNCTION public.get_gift_article_for_edition_v3(text,text,text,text,text,text,text) IS
  'Lecture d''un article offert (page de !1). Comme v2, mais p_send_id accepte 1 à 64 caractères [A-Za-z0-9_-] (019). La page ne la remplit qu''avec ?s=, jamais at_recipient_id.';
COMMENT ON COLUMN public.gift_link_opens.send_id IS
  'Identifiant de l''ENVOI (?s=…) : 32 hexadécimaux par get_gift_article, _for_edition et _v2 ; 1 à 64 caractères [A-Za-z0-9_-] par _v3 depuis le 24 nov. 2026 (019). Une valeur par envoi ou par e-mail (WhatsApp : tirage au hasard ; HubSpot : identifiant de l''e-mail), jamais une adresse, un téléphone ni un identifiant de contact. NULL pour une visite directe, une valeur hors forme ou une ouverture antérieure au 5 oct. 2026. Effacé à 90 jours (012).';

COMMIT;
