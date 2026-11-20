# NeonWave

PWA de musique pour iPhone, organisée comme Apple Music, thème bleu néon.
Vanilla JS (modules ES), aucune dépendance à l'exécution, aucune étape de build.

**Sources légales uniquement :** l'API Jamendo (musique sous licence Creative Commons) et vos propres fichiers audio.

## Fonctionnalités
- Onglets Écouter / Parcourir / Bibliothèque / Rechercher, mini-lecteur, lecteur plein écran (couleur dominante, glisser vers le bas pour fermer).
- File d'attente façon Apple Music : *À suivre* (Lire ensuite / Ajouter à la file), *Suite de la lecture*, glisser-déposer, balayer pour supprimer, aléatoire, répétition off/tout/1. Elle est restaurée après fermeture de l'app.
- Écran verrouillé / Centre de contrôle : Media Session (métadonnées, pochette, position, précédent/suivant/seek).
- Import local MP3/M4A/AAC/FLAC/WAV, avec lecture des tags (ID3, MP4, FLAC, WAV) par un parseur maison : titre, artiste, album, pochette, paroles USLT/SYLT. Un `.lrc` de même nom est rattaché automatiquement.
- Téléchargements hors-ligne (2 en parallèle, progression, reprise par Range), stockés dans IndexedDB. Lecture via une Blob URL, avec bascule automatique sur le service worker (réponses 206) si besoin.
- Playlists : création, renommage, image recadrée, mosaïque, tri, réordonnancement, téléchargement auto, export/import JSON.
- Historique (écoutes de plus de 30 s), paroles synchronisées (fichier → .lrc → Jamendo → LRCLIB), recherche instantanée.

## Utilisation locale
```bash
npm start            # http://localhost:8080
```

## Configuration Jamendo
1. Créez une app gratuite sur https://devportal.jamendo.com → « Create an app ».
2. Dans NeonWave : Réglages → *Client ID* → « Enregistrer et tester ».

Le client_id reste uniquement sur l'appareil (IndexedDB) ; il n'est jamais écrit dans le code.

## Tests
```bash
npm install
npx playwright install webkit
npm test             # tests unitaires (node:test) + E2E Playwright (WebKit iPhone 15 et Chrome iPhone 15)
```
Les captures sont écrites dans `tests/screens/`.
Limite connue : le WebKit de Playwright sous Windows ne sait lire ni les médias en `blob:` ni ceux servis par un service worker. Ces vérifications passent donc par le projet Chrome ; le vrai test reste l'iPhone.

## Déploiement (GitHub Pages)
1. Créez un dépôt vide sur github.com (par ex. `neonwave`).
2. Poussez :
   ```bash
   git remote add origin https://github.com/<vous>/neonwave.git
   git push -u origin main
   ```
3. Sur GitHub : *Settings → Pages → Build and deployment → Source : **GitHub Actions***.
4. Chaque push sur `main` lance `.github/workflows/deploy.yml` : tests unitaires, mise à jour de la version du cache du service worker, puis publication sur `https://<vous>.github.io/neonwave/`.

## Limites iOS
- **Installez l'app sur l'écran d'accueil** (Partager → « Sur l'écran d'accueil ») : sinon Safari peut effacer les téléchargements après 7 jours sans visite.
- Le volume se règle uniquement avec les boutons de l'iPhone (iOS ignore `audio.volume`), c'est pourquoi le curseur est masqué sur iOS.
- Sur iOS, l'écran verrouillé affiche ⏮/⏭ (titre précédent/suivant) et non ±10 s : c'est voulu.
- L'enchaînement automatique écran verrouillé fonctionne en général, mais il peut être moins fiable que dans une app native selon la version d'iOS.
- Après un appel, iOS ne relance pas toujours l'audio d'une PWA : appuyez sur Lecture (écouteurs ou Centre de contrôle).
- Jamendo et LRCLIB ne couvrent pas tous les titres.
