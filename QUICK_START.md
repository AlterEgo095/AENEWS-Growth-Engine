# 🚀 QUICK START GUIDE

## Prérequis
- Docker 24+ & Docker Compose 2.20+
- Git
- 4GB RAM minimum
- 10GB espace disque

## Démarrage en 5 Minutes

### 1️⃣ Cloner le Projet

```bash
git clone <YOUR_REPO_URL> aenews-growth-engine
cd aenews-growth-engine
```

### 2️⃣ Configuration

```bash
# Copier le fichier d'environnement
cp .env.example .env

# Éditer si nécessaire (optionnel pour dev)
nano .env
```

### 3️⃣ Lancer l'Infrastructure

```bash
# Option 1: Avec Make
make dev

# Option 2: Avec npm
npm run dev

# Option 3: Docker Compose direct
docker-compose up --build
```

⏳ **Attendre 2-3 minutes** que tous les services démarrent

### 4️⃣ Vérifier le Déploiement

```bash
# Health check API Gateway
curl http://localhost:3000/health

# Health check Mautic
curl http://localhost:8080

# Grafana (monitoring)
open http://localhost:3001
# Login: admin / GrafanaAdmin2024!
```

### 5️⃣ Tester l'API

```bash
# Créer un compte
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "name": "Test User"
  }'

# Récupérer le token dans la réponse
TOKEN="<your_token_here>"

# Envoyer un événement
curl -X POST http://localhost:3000/events/track \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "type": "page_view",
    "email": "test@example.com",
    "properties": {
      "page": "/home"
    },
    "context": {
      "page": {
        "url": "https://example.com/home",
        "title": "Home Page"
      }
    }
  }'
```

## 🎯 Services Disponibles

| Service | URL | Description |
|---------|-----|-------------|
| API Gateway | http://localhost:3000 | Point d'entrée API |
| Mautic | http://localhost:8080 | Interface Mautic |
| Grafana | http://localhost:3001 | Monitoring dashboards |
| Prometheus | http://localhost:9090 | Métriques |
| AI Engine | http://localhost:8000 | API IA |

## 📊 Monitoring

Accéder à Grafana: http://localhost:3001
- **Login**: admin
- **Password**: GrafanaAdmin2024!

Dashboards disponibles:
- API Gateway Performance
- Event Processing Pipeline
- Mautic Integration Health
- System Resources

## 🐛 Troubleshooting

### Les services ne démarrent pas

```bash
# Vérifier les logs
docker-compose logs -f

# Redémarrer proprement
docker-compose down -v
docker-compose up --build
```

### Port déjà utilisé

```bash
# Modifier les ports dans .env
API_PORT=3001
# etc.
```

### Mautic ne répond pas

```bash
# Attendre l'initialisation complète (3-5 min première fois)
docker-compose logs mautic -f

# Vérifier MySQL
docker-compose exec mysql mysql -u root -pRootPass2024! -e "SHOW DATABASES;"
```

## 🚀 Déploiement Production

Voir [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) pour:
- Déploiement Kubernetes
- Configuration SSL/TLS
- Scaling horizontal
- Backup & Recovery
- Monitoring avancé

## 📚 Documentation Complète

- [Architecture](docs/ARCHITECTURE.md) — Détails techniques
- [API Reference](docs/API.md) — Documentation API
- [Contributing](docs/CONTRIBUTING.md) — Guide de contribution

## 🆘 Support

- GitHub Issues: [Create an issue]
- Documentation: [Read the docs]
- Community: [Join our Discord]

---

**Next Steps:**
1. ✅ Services running
2. Configure Mautic campaigns
3. Integrate your frontend
4. Set up production deployment
5. Configure monitoring alerts
