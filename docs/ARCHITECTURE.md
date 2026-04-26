# Architecture Détaillée - AENEWS Growth Engine

## Table des Matières
- [Vue d'Ensemble](#vue-densemble)
- [Flux de Données](#flux-de-données)
- [Services](#services)
- [Patterns de Résilience](#patterns-de-résilience)
- [Scalabilité](#scalabilité)

## Vue d'Ensemble

L'architecture AENEWS Growth Engine repose sur 7 principes fondamentaux :

1. **Asynchrone partout** — Aucune opération Mautic ne bloque le frontend
2. **Idempotence** — Chaque événement peut être rejoué sans effet de bord
3. **Identité unique** — Service centralisé de mapping email ↔ ID Mautic
4. **Découplage total** — Communication via Event Bus (Redis Streams)
5. **Observabilité** — OpenTelemetry + Prometheus + Grafana + Loki
6. **Data-first** — Archivage intégral dans MongoDB (Data Lake)
7. **IA progressive** — Décisions intelligentes sans bloquer le pipeline

## Flux de Données

### 1. Ingestion d'Événement

```
Frontend → API Gateway → Redis Stream → Event Worker → Mautic Service + Data Lake
                ↓                            ↓              ↓
            Validation                 Enrichment    Circuit Breaker
            Rate Limit                 Transform      Retry Logic
            JWT Auth                   Dedupe         ID Caching
```

### 2. Pipeline AI

```
Data Lake → AI Engine → Predictions → Redis Stream → Mautic Service
             ↓              ↓
        Lead Scoring   Auto-Tagging
        Content Gen    Timing Optimization
```

## Services

### API Gateway (Node.js)

**Responsabilités :**
- Point d'entrée unique pour tous les événements
- Authentification JWT
- Rate limiting par IP/user
- Validation des schémas (Zod)
- Publication vers Redis Streams
- Métriques OpenTelemetry

**Endpoints :**
- `POST /events/track` — Track single event
- `POST /events/batch` — Track multiple events
- `GET /events/pixel.gif` — Tracking pixel
- `POST /auth/login` — User authentication
- `GET /health/*` — Health checks

### Event Ingestion Worker (Node.js)

**Responsabilités :**
- Consommation Redis Streams (consumer groups)
- Transformation & enrichissement des événements
- Déduplication (hash des events)
- Routage intelligent vers Mautic/AI/Archive
- Gestion de backpressure

**Patterns :**
- Consumer Groups pour scalabilité horizontale
- Dead Letter Queue pour événements invalides
- Batch processing pour optimisation

### Mautic Integration Service (Node.js)

**Responsabilités :**
- Interface unique avec Mautic API
- Cache Redis pour ID mapping (email → Mautic ID)
- Circuit Breaker (Opossum) pour résilience
- Retry exponentiel avec jitter
- Batch operations pour performance

**Logique :**
```typescript
1. Receive event
2. Lookup Mautic ID (cache → API)
3. If not exists → Create contact
4. Update contact properties
5. Trigger Mautic campaign point
6. Update cache
```

### AI Decision Engine (Python)

**Responsabilités :**
- Lead scoring ML (scikit-learn)
- Sentiment analysis (transformers)
- Content generation (OpenAI)
- Predictive timing (best send time)

**Models :**
- Lead Scoring: Random Forest Classifier
- Sentiment: BERT fine-tuned
- Timing: XGBoost Regressor

## Patterns de Résilience

### 1. Circuit Breaker

```
CLOSED → requests pass through
  ↓ (failures > threshold)
OPEN → requests fail fast (30s)
  ↓ (timeout)
HALF_OPEN → test request
  ↓ (success)
CLOSED
```

### 2. Retry Strategy

```
Attempt 1: immediate
Attempt 2: 100ms + jitter
Attempt 3: 400ms + jitter
Attempt 4: 1600ms + jitter
Fail → DLQ
```

### 3. Idempotency

```
Event ID = hash(userId + type + timestamp + properties)
Check existence in Redis → Skip if exists
Process → Store ID → Acknowledge
```

## Scalabilité

### Horizontal Scaling

| Service | Strategy | Max Instances |
|---------|----------|---------------|
| API Gateway | Stateless | Unlimited |
| Event Worker | Consumer Groups | 10 per group |
| Mautic Service | Connection Pool | 5 |
| AI Engine | Async workers | 3 |

### Capacity Planning

- **100 events/sec** → 1 instance each
- **1000 events/sec** → 3-5 API Gateway, 5-10 Workers
- **10000 events/sec** → Redis Cluster, Kafka consideration

## Monitoring

### KPIs

- **Latency**: p50, p95, p99 per endpoint
- **Throughput**: events/sec, requests/sec
- **Error Rate**: 4xx, 5xx percentages
- **Queue Depth**: Redis Streams lag
- **Circuit Breaker**: Open/Closed states
- **Mautic API**: Success rate, latency

### Alerts

- Latency > 500ms p95 → Warning
- Error rate > 1% → Critical
- Queue lag > 10k → Warning
- Circuit breaker OPEN → Critical

---

**Version**: 1.0.0  
**Last Updated**: 2026-04-26
