# Journal DevOps — FormConsult
> Ce fichier documente chaque étape du déploiement de FormConsult.
> Il explique **pourquoi** on fait chaque chose, pas seulement comment.
> Il sera mis à jour à chaque nouvelle étape.

---

## C'est quoi le but global ?

On part d'une application qui tourne sur un seul ordinateur (le mien, en développement)
et on veut la rendre accessible à n'importe qui sur internet, de manière fiable et automatique.

C'est ça le travail d'un **Administrateur Système DevOps** :
- Automatiser la création des serveurs
- Conteneuriser l'application pour qu'elle tourne partout pareil
- Mettre en place des pipelines qui déploient automatiquement
- Surveiller que tout fonctionne

---

## ÉTAPE 0 — L'état de départ

### L'application FormConsult
FormConsult est une plateforme LMS (Learning Management System) développée pour RH Optimum.
Elle permet de gérer des formations, des consultants, des employés.

**Stack technique :**
- **Next.js 15** — le framework qui gère à la fois le frontend (ce qu'on voit) et le backend (les APIs)
- **PostgreSQL** — la base de données qui stocke tout (utilisateurs, formations, etc.)
- **Prisma** — l'outil qui fait le lien entre le code et la base de données
- **NextAuth.js** — gère les connexions et les droits des utilisateurs

**Problème de départ :** l'application ne tournait qu'en local sur ma machine.
Objectif : la déployer sur AWS pour qu'elle soit accessible en production.

---

## ÉTAPE 1 — Faire tourner l'app localement avec Docker

### Pourquoi on a besoin d'une base de données ?

FormConsult stocke toutes ses données dans PostgreSQL :
- Les utilisateurs et leurs mots de passe
- Les formations et les modules
- Les paiements, les inscriptions...

Sans base de données → l'app démarre mais plante dès qu'elle essaie de lire ou écrire des données.

### Pourquoi on avait Neon DB avant ?

Neon DB est un service PostgreSQL hébergé dans le cloud (comme louer une base de données
au lieu d'en installer une). C'était pratique pour développer rapidement.

**Problème :** le plan gratuit supprime les projets après 14 jours d'inactivité.
→ Notre projet a été supprimé automatiquement.

### Pourquoi on a choisi Docker pour la base de données ?

**Option 1 — Réinstaller Neon DB** : gratuit mais le même problème reviendra.

**Option 2 — Utiliser le PostgreSQL installé sur Windows** : possible, mais ça crée
une dépendance à la machine Windows. Si quelqu'un d'autre clone le projet, il doit
installer PostgreSQL sur sa machine, le configurer exactement pareil. C'est fragile.

**Option 3 — Docker (notre choix)** : on lance PostgreSQL dans un conteneur Docker.

> **Un conteneur Docker, c'est quoi ?**
> Imagine une boîte hermétique qui contient tout ce dont un programme a besoin pour tourner :
> le logiciel, ses dépendances, sa configuration. Cette boîte fonctionne pareil
> sur Windows, Mac, Linux, ou sur un serveur AWS. C'est ça la magie de Docker.

Avantages :
- Pas besoin d'installer PostgreSQL sur la machine
- Facile à reproduire sur n'importe quel serveur
- On peut tout arrêter et relancer proprement avec une commande
- C'est exactement ce qu'on fera en production sur AWS

### La commande qu'on a lancée

```bash
docker run -d \
  --name formconsult-db \
  -e POSTGRES_USER=formconsult \
  -e POSTGRES_PASSWORD=formconsult123 \
  -e POSTGRES_DB=formconsult \
  -p 5433:5432 \
  postgres:16-alpine
```

**Explication mot par mot :**

| Morceau | Signification |
|---|---|
| `docker run` | Crée et lance un nouveau conteneur |
| `-d` | "detached" — tourne en arrière-plan, ne bloque pas le terminal |
| `--name formconsult-db` | On donne un nom au conteneur pour le retrouver facilement |
| `-e POSTGRES_USER=formconsult` | `-e` = variable d'environnement. On dit à PostgreSQL quel utilisateur créer |
| `-e POSTGRES_PASSWORD=formconsult123` | Le mot de passe de cet utilisateur |
| `-e POSTGRES_DB=formconsult` | Le nom de la base de données à créer automatiquement |
| `-p 5433:5432` | Redirection de port (voir explication ci-dessous) |
| `postgres:16-alpine` | L'image Docker à utiliser (voir explication ci-dessous) |

### Pourquoi `-p 5433:5432` et pas `-p 5432:5432` ?

PostgreSQL écoute toujours sur le port **5432** à l'intérieur du conteneur.
Mais sur ma machine Windows, il y avait déjà un PostgreSQL installé qui utilisait le port 5432.

`-p 5433:5432` signifie : "relie le port **5433** de ma machine au port **5432** du conteneur".

```
Ma machine Windows          Conteneur Docker
     port 5433        →→→      port 5432 (PostgreSQL)
```

Ainsi, quand Prisma se connecte à `localhost:5433`, il atteint bien le PostgreSQL
dans Docker, sans conflit avec le PostgreSQL local.

> **Analogie :** C'est comme avoir deux restaurants dans la même rue.
> L'un est au numéro 5432, l'autre au 5433. Les deux existent, pas de conflit.

### Pourquoi `postgres:16-alpine` ?

C'est le nom de l'**image Docker** officielle de PostgreSQL.

Une image Docker = un modèle de départ (comme un ISO pour installer un OS).
Quand on fait `docker run postgres:16-alpine`, Docker télécharge ce modèle
(s'il n'est pas déjà là) et crée un conteneur à partir de lui.

- `16` = la version de PostgreSQL (la 16, stable et récente)
- `alpine` = basé sur Alpine Linux, une distribution Linux ultra-légère (~5 Mo)
  au lieu de ~300 Mo pour une image standard. Même fonctionnalités, juste plus léger.

> **Pourquoi alpine ?** En DevOps, on optimise la taille des images. Moins lourd =
> téléchargement plus rapide, moins d'espace disque, moins de surface d'attaque.

---

## ÉTAPE 2 — Connecter l'app à la base de données

### Le fichier `.env`

Pour que l'app sache où est la base de données, on crée un fichier `.env` à la racine du projet.

```
DATABASE_URL="postgresql://formconsult:formconsult123@localhost:5433/formconsult"
NEXTAUTH_SECRET="dev-secret-temporaire-changer-en-prod"
NEXTAUTH_URL="http://localhost:3000"
```

**Pourquoi `.env` et pas `.env.local` ?**

Next.js utilise `.env.local` pour ses variables. Mais Prisma (l'outil de base de données)
lit uniquement `.env`. Il fallait donc créer les deux, ou mettre la `DATABASE_URL` dans `.env`.

**Pourquoi ces fichiers ne sont pas dans Git ?**

Regarde le fichier `.gitignore` : `.env` et `.env*.local` sont dedans.
Ces fichiers contiennent des mots de passe et des secrets. On ne les met JAMAIS
dans un dépôt GitHub public. En production, ces valeurs seront des variables
d'environnement gérées par le serveur (ou des secrets dans GitHub Actions).

**Décomposition de la DATABASE_URL :**
```
postgresql://formconsult:formconsult123@localhost:5433/formconsult
             ^^^^^^^^^^^  ^^^^^^^^^^^^^^  ^^^^^^^^^  ^^^^  ^^^^^^^^^^
             utilisateur  mot de passe    hôte      port  nom de la BDD
```

---

## ÉTAPE 3 — Initialiser la base de données avec Prisma

### Qu'est-ce que Prisma ?

Prisma est un **ORM** (Object-Relational Mapping). C'est un outil qui permet
d'écrire du code TypeScript/JavaScript pour parler à la base de données,
au lieu d'écrire du SQL brut.

Le fichier `prisma/schema.prisma` décrit toutes les tables de la base de données
(utilisateurs, formations, cours, etc.). C'est la source de vérité.

### `npx prisma generate`

Cette commande lit le fichier `schema.prisma` et génère du code TypeScript automatiquement
dans `node_modules/@prisma/client`. Ce code généré est ce qu'on utilise dans l'application
pour faire des requêtes (`prisma.user.findMany()`, `prisma.course.create()`, etc.).

> À faire à chaque fois qu'on modifie le schema.prisma.

### `npx prisma db push`

Cette commande compare le `schema.prisma` avec la vraie base de données et crée
ou modifie les tables pour qu'elles correspondent au schéma.

```
schema.prisma  →  db push  →  Tables créées dans PostgreSQL
(le plan)                      (la réalité)
```

> En développement on utilise `db push` (rapide, sans migrations).
> En production on utilisera `prisma migrate deploy` (traçable, réversible).

---

## ÉTAPE 4 — L'app tourne ! ✓

Après ces étapes, `npm run dev` lance l'application sur `http://localhost:3000`.

**Ce qui se passe quand on ouvre le navigateur :**
1. Next.js sert les pages React (interface)
2. L'interface appelle les API Routes (ex: `/api/auth/signin`)
3. Les API Routes utilisent Prisma pour lire/écrire dans PostgreSQL (dans Docker)
4. PostgreSQL répond → les données s'affichent

---

### ❓ Questions posées — bonnes questions !

**"Notre conteneur héberge ou stocke notre BDD ?"**

Les deux. Le conteneur Docker **fait tourner** PostgreSQL ET **stocke les données**
à l'intérieur de lui-même. Mais attention : par défaut, si on supprime le conteneur
(`docker rm formconsult-db`), toutes les données disparaissent avec lui.

C'est pourquoi en production on ajoute un **volume Docker** :
```bash
-v formconsult-data:/var/lib/postgresql/data
```
Ce volume stocke les données sur la machine hôte, pas dans le conteneur.
Même si on supprime/recrée le conteneur, les données survivent.
→ On l'ajoutera dans le `docker-compose.yml`.

**"Est-ce que je peux avoir une interface pour voir mes tables avec Adminer ?"**

Oui ! Adminer est une interface web pour visualiser et gérer une base de données.
C'est comme phpMyAdmin mais pour PostgreSQL aussi. On l'a lancé (voir étape ci-dessous).

---

## ÉTAPE 5 — Adminer : interface graphique pour la base de données

### Pourquoi Adminer ?

En ligne de commande, voir ses tables PostgreSQL c'est possible mais peu lisible.
Adminer permet de :
- Voir toutes les tables et leur contenu
- Exécuter des requêtes SQL facilement
- Vérifier que `db push` a bien créé les bonnes tables
- Utile pour déboguer pendant le développement

### Lancer Adminer

```bash
docker run -d --name formconsult-adminer -p 8080:8080 adminer
```

| Morceau | Signification |
|---|---|
| `--name formconsult-adminer` | Nom du conteneur |
| `-p 8080:8080` | Adminer écoute sur le port 8080, on l'expose sur le port 8080 de la machine |
| `adminer` | L'image Docker officielle d'Adminer |

### Se connecter à la base via Adminer

Ouvre : **http://localhost:8080**

Remplis le formulaire comme ça :

| Champ | Valeur |
|---|---|
| Système | PostgreSQL |
| Serveur | `host.docker.internal:5433` |
| Utilisateur | `formconsult` |
| Mot de passe | `formconsult123` |
| Base de données | `formconsult` |

> **Pourquoi `host.docker.internal` ?**
> Adminer tourne dans un conteneur Docker. De son point de vue, `localhost`
> c'est lui-même — pas ta machine Windows. Pour atteindre ta machine depuis
> l'intérieur d'un conteneur, Docker Desktop fournit l'adresse spéciale
> `host.docker.internal`. C'est l'équivalent de "sortir du conteneur pour
> rejoindre la machine hôte".

---

## ÉTAPE 6 — Le Dockerfile : conteneuriser Next.js

### C'est quoi un Dockerfile ?

Un Dockerfile est une recette de cuisine. Il décrit étape par étape comment
construire une image Docker de ton application.

Une **image Docker** = un snapshot figé de l'application avec tout ce qu'il faut
pour la faire tourner. À partir de cette image, on peut créer autant de
**conteneurs** (instances) qu'on veut, partout.

```
Dockerfile  →  docker build  →  Image  →  docker run  →  Conteneur
 (recette)       (cuisine)      (plat)      (servir)      (mangé)
```

### Pourquoi 3 stages (multi-stage build) ?

On aurait pu tout faire en un seul stage. Mais l'image finale aurait pesé ~1 Go
(avec tout le code source, les outils de dev, etc.).

Avec le multi-stage build :
- **Stage 1 (deps)** : installe les dépendances
- **Stage 2 (builder)** : compile l'application
- **Stage 3 (runner)** : contient UNIQUEMENT ce qui est nécessaire pour faire tourner l'app

Résultat : l'image finale pèse ~150 Mo au lieu de ~1 Go.
En production, ça veut dire des déploiements plus rapides et moins de coûts AWS.

### Pourquoi `output: "standalone"` dans next.config.ts ?

Par défaut, Next.js a besoin de tout `node_modules` (600+ packages, ~300 Mo) pour tourner.

Avec `output: "standalone"`, Next.js analyse l'application et ne garde que
les fichiers strictement nécessaires. Il crée un `server.js` autonome.
C'est ce `server.js` qu'on lance dans le stage runner avec `CMD ["node", "server.js"]`.

### Pourquoi `binaryTargets` dans schema.prisma ?

Prisma utilise un moteur natif (un binaire compilé) pour parler à PostgreSQL.
Sur ta machine Windows, il utilise le binaire Windows.
Mais le conteneur Docker tourne sur **Alpine Linux** — il faut donc le binaire Linux.

```
binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
                  ^^^^^^     ^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 Windows/Mac      Alpine Linux (Docker)
```

Sans ça, Prisma planterait dans le conteneur avec une erreur "binary not found".

### Pourquoi un utilisateur `nextjs` non-root ?

Par défaut dans Docker, tout tourne en tant que `root` (administrateur).
C'est une mauvaise pratique de sécurité : si l'application est compromise,
l'attaquant a les droits root dans le conteneur.

On crée un utilisateur `nextjs` avec des droits limités :
```dockerfile
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs
```

C'est une recommandation de l'ANSSI (Agence Nationale de la Sécurité des Systèmes d'Information).

### Le `.dockerignore`

Comme `.gitignore` pour Git, `.dockerignore` dit à Docker quoi ne PAS copier
dans l'image lors du `COPY . .`.

On exclut notamment :
- `node_modules` : serait écrasé par `npm ci` de toute façon, inutile de le copier
- `.env` et `.env.local` : ne jamais mettre des secrets dans une image Docker
- `.next` : sera regénéré par `npm run build`

---

## ÉTAPE 7 — Pourquoi on a abandonné le multi-stage build (pour l'instant)

### Le problème rencontré

On a essayé de construire l'image avec le Dockerfile multi-stage (stage builder qui fait `npm run build`).
Le build échouait à cause des services tiers : **Stripe** et **Mux**.

Ces librairies s'initialisent **au moment où Next.js compile les pages** (pas seulement à l'exécution).
Elles essaient de contacter leurs serveurs avec de vraies clés API dès le build.

Sans les vraies clés API dans l'image → le build plante.

### Options envisagées

| Option | Avantages | Inconvénients |
|---|---|---|
| Mettre les vraies clés dans l'image | Build fonctionne | ❌ Secrets dans l'image = faille de sécurité |
| Passer les clés en `--build-arg` | Plus propre | ❌ Complexe, les clés restent dans les layers de l'image |
| Dockerfile en mode dev (notre choix) | Simple, fonctionne | Image plus lourde (~800 Mo vs ~150 Mo) |

### Décision : Dockerfile dev pour l'instant

On utilise un Dockerfile **simplifié** qui lance l'app en mode développement (`npm run dev`)
au lieu de compiler (`npm run build`). Pas de multi-stage.

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "dev"]
```

> **Ce que ça veut dire pour la production réelle :**
> En vraie production, on injecterait les clés via des **secrets GitHub Actions** ou **AWS Secrets Manager**,
> jamais en dur dans l'image. Le multi-stage sera refait proprement à cette étape.
> Pour l'instant, on valide que tout le pipeline Docker fonctionne avec ce Dockerfile simple.

C'est une **décision technique argumentée**, pas un raccourci. Le jury peut demander pourquoi → la réponse est là.

---

## ÉTAPE 8 — docker-compose.yml : orchestrer app + base de données

### Pourquoi docker-compose ?

Jusqu'ici on lançait les conteneurs un par un avec `docker run`. C'est fastidieux et fragile.

**docker-compose** permet de décrire tous les services dans un seul fichier
et de tout lancer avec une seule commande :

```bash
docker compose up
```

C'est l'équivalent d'une partition de musique : chaque instrument (service) est décrit,
et le chef d'orchestre (Docker Compose) les lance ensemble au bon moment.

### Structure du docker-compose.yml créé

```yaml
services:
  db:       # PostgreSQL
  adminer:  # Interface web pour voir la base
  app:      # FormConsult (Next.js)

volumes:
  db_data:  # Stockage persistant de la base
```

### Points importants à retenir (le jury peut demander)

**Pourquoi `DATABASE_URL` change entre le dev local et Docker Compose ?**

| Contexte | DATABASE_URL |
|---|---|
| Dev local (`npm run dev`) | `postgresql://...@localhost:5433/formconsult` |
| Dans Docker Compose | `postgresql://...@db:5432/formconsult` |

Dans Docker Compose, chaque service est dans le même réseau virtuel.
`localhost` dans le conteneur `app` = le conteneur lui-même, pas la machine.
Pour atteindre la base, on utilise le **nom du service** : `db`.

**Pourquoi `depends_on: db` ?**

`app` et `adminer` démarrent seulement après que `db` soit lancé.
Sans ça, l'app essaierait de se connecter à une base pas encore prête → crash.

**Pourquoi un `volume` nommé `db_data` ?**

Sans volume, les données PostgreSQL vivent dans le conteneur.
Si on supprime le conteneur → toutes les données disparaissent.

Avec un volume nommé, Docker stocke les données sur la machine hôte :
```
Conteneur db (supprimable)  ←→  Volume db_data (persistant)
```

**Pourquoi `restart: unless-stopped` ?**

Si un conteneur plante (bug, manque de mémoire), Docker le relance automatiquement.
`unless-stopped` = relance toujours, sauf si on l'a arrêté manuellement.
C'est essentiel pour une app en production.

### Commandes importantes

```bash
# Lancer tous les services (en arrière-plan)
docker compose up -d

# Reconstruire l'image de l'app et relancer
docker compose up --build -d

# Voir les logs en temps réel
docker compose logs -f app

# Tout arrêter
docker compose down

# Tout arrêter ET supprimer les volumes (⚠️ perd les données)
docker compose down -v
```

---

## ÉTAPE 9 — Premier lancement avec Docker Compose

### Commandes exécutées

```bash
# Stopper et supprimer les anciens conteneurs manuels
docker compose down

# Reconstruire l'image et relancer tous les services
docker compose up --build -d
```

### Erreur rencontrée et cause

Au premier `docker compose up`, l'app crashait avec :
```
Error: Cannot find module '/app/node_modules/next/package.json'
```

**Cause** : le conteneur `formconsult-app` tournait encore avec une **ancienne image** (construite avant le `docker-compose.yml`). L'image avait été buildée différemment.

**Diagnostic** : on a vérifié que `next` était bien présent dans la nouvelle image :
```bash
docker run --rm --entrypoint sh form-consult-app -c "ls /app/node_modules/next/package.json"
# → /app/node_modules/next/package.json  ✓
```

**Solution** : `docker compose down` force la suppression des conteneurs et la recréation depuis la nouvelle image. Après relancement → app démarre normalement.

### Résultat final ✓

```
formconsult-app  |  ▲ Next.js 15.3.3 (Turbopack)
formconsult-app  |  ✓ Ready in 1879ms
```

| Service | URL | Statut |
|---|---|---|
| Application FormConsult | http://localhost:3000 | ✅ En ligne |
| Adminer (interface DB) | http://localhost:8080 | ✅ En ligne |
| PostgreSQL | localhost:5433 | ✅ En ligne |

### Leçon retenue

Quand on modifie un `docker-compose.yml` ou un `Dockerfile`, toujours faire :
```bash
docker compose down       # supprimer les anciens conteneurs
docker compose up --build # reconstruire ET relancer
```
Sans `--build`, Docker peut réutiliser une ancienne image en cache.

---

---

## ÉTAPE 10 — Préparation AWS : compte, IAM, credentials

### Pourquoi AWS ?

Notre application tourne dans Docker sur notre machine locale. Pour qu'elle soit accessible
sur internet (en production), il faut la déployer sur un serveur distant.

On choisit **AWS (Amazon Web Services)** pour plusieurs raisons :
- **Free Tier** : AWS offre 12 mois gratuits sur certaines ressources (EC2 t2.micro, etc.)
- **Standard du marché** : c'est le cloud le plus utilisé en entreprise
- **Référentiel ASD** : les compétences cloud sont explicitement attendues

### Qu'est-ce qu'AWS ?

AWS est une plateforme qui loue des ressources informatiques à la demande :
- Des **serveurs virtuels** (EC2) → comme louer un ordinateur dans un datacenter
- Du **stockage** (S3) → comme un disque dur dans le cloud
- Des **bases de données** (RDS) → base PostgreSQL managée
- Et des dizaines d'autres services

On ne paie que ce qu'on utilise, à la seconde.

### Compte AWS créé

- Plan choisi : **Free Tier** (gratuit 12 mois sur les ressources de base)
- Région choisie : **eu-west-3 (Paris)** — la plus proche pour minimiser la latence

> **Pourquoi la région Paris ?** AWS a des datacenters partout dans le monde (régions).
> Chaque région est indépendante. On choisit Paris car c'est la plus proche de la France
> et du Maroc (client RH Optimum à Tanger). Moins de distance = moins de latence.

### IAM : gestion des accès AWS

**IAM (Identity and Access Management)** est le système de droits d'AWS.
Il contrôle qui peut faire quoi sur le compte AWS.

On a créé un utilisateur `terraform-user` avec les droits `AdministratorAccess`.

> **Pourquoi ne pas utiliser le compte root AWS directement ?**
> Le compte root (celui créé à l'inscription) a tous les droits sans restriction.
> C'est une très mauvaise pratique de sécurité de l'utiliser au quotidien.
> Si les credentials root sont volés → accès total au compte, factures illimitées.
>
> Bonne pratique : créer un utilisateur IAM dédié avec uniquement les droits nécessaires.
> C'est une recommandation de l'ANSSI et d'AWS eux-mêmes.

### Clés d'accès (Access Keys)

Pour que Terraform puisse créer des ressources AWS depuis notre machine,
il a besoin de s'authentifier. On utilise des **clés d'accès** :

```
Access Key ID     : AKIA...  (identifiant public)
Secret Access Key : xxxxxxx  (mot de passe secret — ne jamais partager)
```

Ces clés sont stockées localement dans `~/.aws/credentials` (géré par AWS CLI).
**Elles ne sont jamais dans le code source ni dans Git.**

### Installation des outils

```powershell
# Terraform — outil d'infrastructure as code
winget install HashiCorp.Terraform

# AWS CLI — interface ligne de commande pour AWS
winget install Amazon.AWSCLI

# Configuration des credentials
aws configure
# → Access Key ID     : [valeur du CSV]
# → Secret Access Key : [valeur du CSV]
# → Default region    : eu-west-3
# → Output format     : json
```

### Vérification

```bash
aws sts get-caller-identity
```

Cette commande demande à AWS "qui suis-je ?" et retourne l'identité associée
aux credentials configurés. Si ça répond avec l'Account ID et `terraform-user` → tout est en ordre.

---

---

## ÉTAPE 11 — Terraform : créer l'infrastructure AWS

### C'est quoi Terraform ?

Terraform est un outil d'**Infrastructure as Code (IaC)**.
Au lieu de créer des serveurs manuellement dans la console AWS (cliquer sur des boutons),
on les décrit dans des fichiers texte `.tf`. Terraform lit ces fichiers et crée
l'infrastructure automatiquement.

**Avantages :**
- Reproductible : relancer les fichiers = même infra à l'identique
- Versionnable : les fichiers `.tf` vont dans Git → historique des changements
- Documenté : le code EST la documentation de l'infrastructure
- Détruire/recréer facilement : `terraform destroy` puis `terraform apply`

### Les 3 commandes fondamentales

```bash
terraform init    # Télécharge les plugins (provider AWS)
terraform plan    # Simule ce qui va être créé/modifié/détruit
terraform apply   # Applique réellement les changements sur AWS
```

> **Toujours faire `terraform plan` avant `terraform apply`.**
> C'est comme relire une commande avant d'appuyer sur Entrée.

### Structure des fichiers Terraform créés

```
terraform/
├── main.tf       # Configuration du provider AWS (région, version)
├── variables.tf  # Paramètres configurables (région, type d'instance...)
└── ec2.tf        # Ressources créées : Security Group + Instance EC2
```

### Ce que Terraform a créé sur AWS

**1. Security Group `formconsult-sg`** (pare-feu virtuel)

Un Security Group contrôle le trafic réseau entrant et sortant du serveur.
Sans lui, le serveur est soit totalement fermé, soit totalement ouvert.

| Port | Protocole | Usage |
|------|-----------|-------|
| 22   | TCP | SSH — pour se connecter au serveur en ligne de commande |
| 80   | TCP | HTTP — accès web standard |
| 3000 | TCP | Application FormConsult (Next.js) |
| Tout | Sortant | Autoriser le serveur à télécharger des paquets |

**2. Instance EC2 `formconsult-server`**

EC2 (Elastic Compute Cloud) = un serveur virtuel dans le datacenter AWS de Paris.

| Paramètre | Valeur | Explication |
|-----------|--------|-------------|
| Type | t3.micro | 1 vCPU, 1 Go RAM — Free Tier eligible |
| OS | Amazon Linux 2023 | Distribution Linux optimisée pour AWS |
| IP publique | 35.181.50.81 | Adresse pour accéder au serveur depuis internet |
| Clé SSH | formconsult-key | Pour se connecter en ligne de commande |

> **Pourquoi t3.micro et pas t2.micro ?**
> AWS a mis à jour son Free Tier. Dans les régions récentes, t2.micro n'est plus
> éligible — il faut utiliser t3.micro. Même prix (gratuit), légèrement meilleures
> performances (architecture Nitro vs Xen).

**3. Script user_data**

Au premier démarrage, EC2 exécute automatiquement un script bash qui installe Docker :
```bash
yum update -y
yum install -y docker
systemctl start docker
systemctl enable docker
usermod -aG docker ec2-user
```
C'est le principe du **cloud-init** : provisionner automatiquement un serveur dès sa création.

### Erreurs rencontrées et solutions

| Erreur | Cause | Solution |
|--------|-------|---------|
| `ec2:DescribeImages` non autorisé | `AdministratorAccess` pas encore attachée à `terraform-user` | Attacher la policy dans IAM |
| `t2.micro` not Free Tier eligible | AWS a changé les types Free Tier dans les nouvelles régions | Utiliser `t3.micro` à la place |

### Résultat final

```
Apply complete! Resources: 2 added, 0 changed, 0 destroyed.
Outputs:
  server_public_ip = "35.181.50.81"
```

Infrastructure créée en **13 secondes** depuis un fichier texte. C'est la puissance de l'IaC.

---

## ÉTAPE 12 — Ansible : automatiser le déploiement

### C'est quoi Ansible ?

Ansible est un outil d'**automatisation de configuration** (Configuration Management).
Là où Terraform crée l'infrastructure (les serveurs), Ansible configure ce qui tourne dessus :
installe des logiciels, copie des fichiers, démarre des services.

**Analogie :**
- Terraform = construire la maison (murs, électricité, plomberie)
- Ansible = meubler et décorer (installer l'app, configurer les services)

**Avantages d'Ansible vs scripts bash manuels :**
- **Idempotent** : relancer le playbook deux fois = même résultat, sans effets de bord
- **Déclaratif** : on décrit l'état voulu, pas les commandes à exécuter
- **Sans agent** : fonctionne via SSH standard, pas besoin d'installer quoi que ce soit sur le serveur
- **Lisible** : les tâches YAML se lisent comme de la documentation

### Structure des fichiers créés

```
ansible/
├── inventory.ini              # Liste des serveurs cibles avec paramètres SSH
├── playbook.yml               # Script de déploiement (liste de tâches ordonnées)
├── templates/
│   └── env.j2                 # Template du fichier .env (variables remplacées au déploiement)
└── group_vars/
    └── formconsult.yml        # Variables par défaut pour le groupe de serveurs
```

### Pourquoi cette structure ?

**inventory.ini** : Ansible doit savoir QUELS serveurs configurer.
Ce fichier liste notre EC2 avec les paramètres de connexion SSH.
En production réelle, on aurait plusieurs groupes : `[staging]`, `[production]`.

**playbook.yml** : Le "script" Ansible. Chaque `task` est une action atomique.
L'ordre est garanti — si une tâche échoue, les suivantes ne s'exécutent pas.

**templates/env.j2** : Le fichier `.env` contient des secrets (clés API).
On ne peut pas le commiter tel quel. Le template utilise des variables `{{ }}` que
Ansible remplace au moment du déploiement depuis `group_vars/formconsult.yml`.

### Ce que fait le playbook (dans l'ordre)

| Tâche | Ce que ça fait | Pourquoi |
|-------|----------------|----------|
| 1. Docker started | Vérifie que Docker tourne | user_data l'installe au boot, on vérifie |
| 2. Install git | Installe git avec yum | Pour cloner le repo depuis GitHub |
| 3. Clone repo | `git clone` ou `git pull` si déjà là | Source de vérité = GitHub |
| 4. Deploy .env | Copie le template env.j2 transformé | Les secrets ne sont pas dans git |
| 5. docker compose up | Construit et lance les conteneurs | Déploiement de l'app |
| 6. docker compose ps | Affiche l'état des conteneurs | Vérification immédiate |

### Lancer le déploiement

```bash
# Pré-requis : clé SSH dans ~/.ssh/
cp formconsult-key.pem ~/.ssh/
chmod 400 ~/.ssh/formconsult-key.pem

# Tester la connexion
ansible -i ansible/inventory.ini formconsult -m ping

# Déployer
ansible-playbook -i ansible/inventory.ini ansible/playbook.yml
```

### Problème rencontré : gros fichier dans git

Lors du premier push, GitHub a rejeté le commit avec cette erreur :
```
remote: error: File terraform/.terraform/providers/.../terraform-provider-aws_v5.100.0_x5.exe
is 685.52 MB; this exceeds GitHub's file size limit of 100.00 MB
```

**Cause :** Le dossier `.terraform/` (providers téléchargés par `terraform init`) avait été
commité par erreur. Le provider AWS pèse 685 MB.

**Pourquoi `.terraform/` ne doit PAS être dans git :**
- C'est l'équivalent de `node_modules/` pour Terraform
- Chaque développeur regénère ce dossier avec `terraform init`
- Le fichier `.terraform.lock.hcl` (équivalent de `package-lock.json`) suffit pour
  garantir les mêmes versions de providers

**Solution appliquée :**
```bash
# 1. Défaire les 2 commits problématiques (sans perdre les modifications)
git reset HEAD~2

# 2. Ajouter les règles dans .gitignore
echo "terraform/.terraform/" >> .gitignore
echo "terraform/terraform.tfstate" >> .gitignore

# 3. Recommiter proprement sans le binaire
git add .gitignore terraform/ec2.tf terraform/main.tf ... ansible/
git commit -m "Étapes 1-3 DevOps : Docker, Terraform AWS, Ansible"
git push origin master  # ✓ Succès
```

**Leçon retenue :** Toujours configurer `.gitignore` AVANT le premier `terraform init`.
Le fichier `.terraform.lock.hcl` doit être commité (lock des versions) mais pas `.terraform/`.

### terraform.tfstate : également exclu de git

Le fichier `terraform.tfstate` contient l'état de l'infrastructure :
- Les IDs des ressources AWS
- Les IPs des serveurs
- Les configurations sensibles

En équipe, ce fichier doit être stocké dans un **backend distant** (ex: S3 + DynamoDB pour
le locking). Pour notre projet solo, on l'exclut simplement de git.

---

*Dernière mise à jour : Ansible configuré + problème gros fichier git résolu → push réussi*
