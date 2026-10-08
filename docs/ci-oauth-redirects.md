# Interception OAuth dans les tests navigateur

Le passage à un formulaire POST natif a révélé une limite de l’ancien simulateur : le handler Playwright `route()` ne traite que la première URL d’une requête redirigée. Cette première URL est maintenant `/api/connexion/discord`, pas `discord.com`. Le navigateur de CI atteignait donc la vraie page Discord avec un identifiant d’application factice.

Le simulateur navigateur utilise désormais `BrowserContext.newCDPSession(page)` et `Fetch.requestPaused` pour intercepter le saut externe, y compris après le HTTP 303 natif. Les trois projets actuels utilisent Chromium ; une future extension Firefox/WebKit nécessitera un simulateur compatible et ne doit pas ignorer ces scénarios.

Le POST applicatif, ses contrôles Origin/CSRF, la réponse 303, les cookies émis par le serveur, la navigation inter-origines et le callback Auth.js ne sont pas réécrits. Seule la réponse d’autorisation externe est simulée. Le serveur de test continue à vérifier le challenge PKCE et la signature du code factice avant de retourner ses réponses Discord locales. Une URL Discord inattendue est bloquée et fait échouer le test ; il n’existe pas de repli vers le véritable service. Les erreurs asynchrones du simulateur sont remontées aux assertions de fin de test.

Les assertions d’absence d’erreur navigateur/CSP, de non-divulgation du Referer, de navigation native sans `_rsc`, de session réellement créée, d’attribution du rôle, d’audit unique et d’usage unique restent actives. Le test principal vérifie aussi le 303 réel et le nombre d’autorisations interceptées. Le scénario de lien périmé vérifie qu’aucune autorisation n’est lancée, même depuis un formulaire devenu obsolète.

Aucun code ni réglage d’authentification de production n’est modifié par cette correction du simulateur. Aucun cookie de session n’est injecté pour les nouveaux parcours d’invitation.

Références :
- https://playwright.dev/docs/api/class-page#page-route
- https://playwright.dev/docs/api/class-browsercontext#browser-context-new-cdp-session
- https://chromedevtools.github.io/devtools-protocol/tot/Fetch/
