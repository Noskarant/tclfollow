# TCL Follow · Lyon en mouvement

**Un jumeau numérique 3D du réseau TCL, pour les voyageurs.** Projet indépendant, non affilié à TCL / SYTRAL Mobilités.

Carte 3D sombre de Lyon, bâtiments extrudés, bus / tramways / métros / funiculaires, fiches véhicules, lignes, recherche, filtres, favoris, géolocalisation, replay visuel, orientation, suivi caméra, contrôle de fraîcheur et information voyageurs. Mobile et ordinateur.

> **Transparence essentielle :** Sans accès configuré à l'API de position, l'application passe en mode **DÉMONSTRATION** avec mouvements simulés explicitement signalés. Aucun véhicule de démonstration n'est présenté comme réellement géolocalisé. Avec les identifiants officiels Grand Lyon et le Worker déployé, les positions proviennent de SIRI Vehicle Monitoring. L'animation interpolée entre deux relevés n'est pas un nouveau relevé GPS.

## Voir le site

Déploiement statique possible sur **GitHub Pages** (Settings → Pages → Deploy from a branch → main / root). Adresse attendue après activation : `https://noskarant.github.io/tclfollow/`.

Pas de compilation obligatoire pour le site, pas de GitHub Actions, pas de runner payant.

## Déployer le suivi réel

1. Créer un compte **data.grandlyon.com** et s'assurer que l'accès au flux `https://data.grandlyon.com/siri-lite/2.0/vehicle-monitoring.json` est autorisé.
2. Installer Node.js 20+ et, depuis `worker/`, lancer `npm install` puis `npx wrangler login`.
3. `npx wrangler secret put GRANDLYON_API_USERNAME` et `npx wrangler secret put GRANDLYON_API_PASSWORD`. Ne jamais placer ces identifiants dans GitHub ou dans le code frontend.
4. `npx wrangler deploy`. Le nom du Worker est défini dans `worker/wrangler.toml`.
5. Dans **Paramètres** de l'interface TCL Follow, renseigner l'URL de ce Worker, sans clé / secret, puis choisir **Direct**. Pour définir une URL par défaut pour tous les visiteurs, modifier la variable `API_BASE_URL` dans `src/config.js` et publier la modification.

Le Worker expose `GET /api/vehicles`, `GET /api/lines/{bus|tram|metro|rhonexpress|stops}` et `GET /healthz`. Les tracés sont mis en cache 24 h et les positions quelques secondes. Il interdit les méthodes d'écriture, vérifie les données et renvoie un état explicite lors des erreurs. Ajuster `ALLOWED_ORIGIN` pour restreindre CORS en production.

## Développement local

Pour le site : `python3 -m http.server 8080` puis `http://localhost:8080`. Les imports ES Modules et assets ne fonctionnent pas correctement avec `file://`.

Pour le Worker : `cd worker && npm install && npx wrangler dev`, puis définir localement `.dev.vars` d'après `.dev.vars.example`.

Tests unitaires sans dépendance : `node --test tests/*.test.mjs` depuis la racine (Node.js 20+).

## Sources et limites

- [SYTRAL — positions en temps réel SIRI VM](https://www.data.gouv.fr/datasets/positions-en-temps-reel-des-vehicules-du-reseau-des-transports-en-commun-lyonnais)
- [Grand Lyon — portail des jeux de données](https://data.grandlyon.com/)
- [TCL GTFS / NeTEx](https://transport.data.gouv.fr/datasets/horaires-theoriques-du-reseau-transports-en-commun-lyonnais)
- [Fond de carte OpenFreeMap](https://openfreemap.org/) et [MapLibre](https://maplibre.org/), [OpenStreetMap](https://www.openstreetmap.org/copyright).

**Positions réelles ≠ trajectoire GPS continue.** Les données SIRI peuvent être absentes, en retard, ou dédoublonnées. La position affichée comme « extrapolée » est indicative et n'est jamais utilisée pour promettre une heure d'arrivée précise. Les métros en souterrain et certaines lignes ne sont pas forcément visibles.

**Commercialisation :** avant une licence, intégration TCL ou affichage institutionnel, examiner les conditions de réutilisation des données, les licences des fonds, les quotas du flux, l'accessibilité RGAA, la conformité RGPD et les droits de marque. Aucun logo officiel TCL n'est inclus. Projet indépendant.

## Stack

Site HTML/CSS/JavaScript natif + MapLibre GL JS + Three.js (chargés depuis des CDN documentés), Worker Cloudflare JavaScript / SIRI-Lite. Aucune base de données utilisateur : préférences stockées dans le navigateur.

© 2026 TCL Follow. Projet indépendant. Licence du code : MIT.
