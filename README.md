# EspaceCloud — version connectable

Cette version ajoute les écrans de création de compte et de connexion, ainsi que les fonctions d’envoi, d’affichage, de téléchargement et de suppression. Elle ne fonctionnera qu’après la configuration de Supabase et Cloudflare et le remplissage des trois valeurs de `config.js`.

## Contenu du projet

- `index.html` et `app.js` : site web en français.
- `config.js` : emplacement pour l’URL Supabase, sa clé publique et l’adresse du Worker. Les valeurs sont volontairement vides.
- `schema.sql` : table des fichiers et règles d’accès par utilisateur.
- `index.js` : service Cloudflare Worker entre les comptes et le stockage R2.
- `wrangler.toml.example` : exemple de configuration du Worker.

La limite actuelle est de 50 Mo par fichier. Les extensions courantes des images, fichiers audio, vidéos et documents sont acceptées. Commence uniquement avec des fichiers d’essai sans importance.

## 1. Créer les comptes et la base de données

1. Crée un projet Supabase.
2. Dans **SQL Editor**, ouvre `schema.sql`, copie son contenu, colle-le dans un nouvel éditeur et exécute-le.
3. Dans **Authentication → URL Configuration**, ajoute `https://paulcloud-ps.github.io/EspaceCloud/` comme URL du site et comme URL de redirection autorisée.
4. Dans **Authentication → Providers → Email**, garde la confirmation par e-mail activée.
5. Copie l’URL du projet et la clé **publishable** ou **anon**. Ne copie jamais la clé `service_role` dans le site.

## 2. Créer le stockage privé

1. Crée un compte Cloudflare et un bucket R2 privé, par exemple `espacecloud-files`.
2. Crée un Worker nommé `espacecloud-api` à partir du code `index.js` à la racine du dépôt GitHub.
3. Dans les paramètres du Worker, ajoute une liaison R2 appelée `FILES` et associe-la à ton bucket.
4. Ajoute ces variables au Worker :
   - `SUPABASE_URL` : URL du projet Supabase.
   - `SUPABASE_ANON_KEY` : clé publishable ou anon de Supabase.
   - `ALLOWED_ORIGIN` : `https://paulcloud-ps.github.io`
5. Publie le Worker et copie son adresse `https://...workers.dev`.

Le Worker vérifie la session auprès de Supabase avant chaque action. Le bucket R2 reste privé. Aucun identifiant R2 ne doit être ajouté à la page du site.

## 3. Relier le site aux services

Dans `config.js`, remplis ces champs avec les valeurs publiques de tes projets :

```js
window.ESPACE_CLOUD_CONFIG = {
  SUPABASE_URL: "URL_DE_TON_PROJET",
  SUPABASE_ANON_KEY: "CLE_PUBLISHABLE_OU_ANON",
  WORKER_URL: "ADRESSE_DE_TON_WORKER"
};
```

La clé publishable ou anon peut apparaître dans le navigateur uniquement si les règles RLS sont en place. Ne mets jamais un mot de passe, une clé privée, un jeton R2 ou la clé `service_role` dans `config.js`.

## 4. Mettre à jour GitHub Pages

Les fichiers nécessaires sont à la racine du dépôt `EspaceCloud` : `index.html`, `app.js`, `config.js`, `schema.sql`, `README.md`, `index.js` et `wrangler.toml.example`. Dans **Settings → Pages**, conserve la publication depuis la branche `main` et le dossier `/ (root)`.

L’adresse actuelle du site est `https://paulcloud-ps.github.io/EspaceCloud/`. N’envoie pas de fichiers personnels au dépôt GitHub : seuls les fichiers choisis dans l’application doivent être envoyés au bucket privé.

## 5. Vérifier avec des fichiers d’essai

1. Crée un compte de test, confirme ton adresse e-mail et connecte-toi.
2. Envoie une petite image sans importance.
3. Vérifie que le fichier apparaît, peut être téléchargé, puis supprimé.
4. Connecte-toi depuis un autre appareil avec le même compte et vérifie que le fichier est retrouvé.
5. Crée un deuxième compte de test et vérifie qu’il ne voit pas les fichiers du premier.

Avant d’y conserver des fichiers importants, ajoute et vérifie une sauvegarde indépendante ainsi qu’une procédure de récupération de compte.
