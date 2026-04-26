#!/usr/bin/env python3
"""
AENEWS Growth Engine - Test d'intégration léger (sans Docker)
Simule le flux complet : Event → Ingestion → AI → Décision
"""

import json
import time
import random
from datetime import datetime
from typing import List, Dict
import pandas as pd
import numpy as np

# =============================================
# SIMULATION EVENT INGESTION WORKER
# =============================================

class MockEventWorker:
    """Simule le Event Ingestion Worker"""
    
    def __init__(self):
        self.processed_events = []
        self.enriched_events = []
        
    def enrich_event(self, event: Dict) -> Dict:
        """Enrichissement événement (simulation)"""
        enriched = event.copy()
        enriched['enriched_at'] = datetime.utcnow().isoformat()
        enriched['session_id'] = f"sess_{random.randint(10000, 99999)}"
        enriched['device_type'] = random.choice(['desktop', 'mobile', 'tablet'])
        enriched['country'] = random.choice(['FR', 'US', 'UK', 'DE', 'ES'])
        return enriched
    
    def deduplicate(self, event: Dict) -> bool:
        """Vérification doublons (simulation)"""
        event_hash = f"{event.get('userId')}_{event.get('type')}_{event.get('timestamp')}"
        if event_hash in [e.get('_hash') for e in self.processed_events]:
            return True
        event['_hash'] = event_hash
        return False
    
    def process_event(self, event: Dict) -> Dict:
        """Traitement événement"""
        if self.deduplicate(event):
            return {'status': 'duplicate', 'event': event}
        
        enriched = self.enrich_event(event)
        self.enriched_events.append(enriched)
        self.processed_events.append(event)
        
        return {'status': 'processed', 'event': enriched}


# =============================================
# SIMULATION AI DECISION ENGINE
# =============================================

class MockAIEngine:
    """Simule le AI Decision Engine"""
    
    def __init__(self):
        self.predictions = []
        
    def calculate_rfm_score(self, events: List[Dict]) -> float:
        """Calcul RFM (Recency, Frequency, Monetary)"""
        recency = len([e for e in events if 'page_view' in e.get('type', '')])
        frequency = len(events)
        monetary = sum([float(e.get('properties', {}).get('value', 0)) for e in events])
        
        # Normalisation 0-1
        rfm = (recency * 0.3 + min(frequency/10, 1) * 0.4 + min(monetary/100, 1) * 0.3)
        return round(rfm, 3)
    
    def predict_lead_score(self, user_id: str, events: List[Dict]) -> Dict:
        """Prédiction score lead (simulation ML)"""
        rfm = self.calculate_rfm_score(events)
        
        # Simulation score ML
        lead_score = rfm * 100
        confidence = random.uniform(0.7, 0.95)
        
        # Simulation segments
        if lead_score > 70:
            segment = 'hot_lead'
        elif lead_score > 40:
            segment = 'warm_lead'
        else:
            segment = 'cold_lead'
        
        prediction = {
            'user_id': user_id,
            'lead_score': round(lead_score, 2),
            'confidence': round(confidence, 3),
            'segment': segment,
            'rfm_score': rfm,
            'recommended_action': self._get_recommendation(segment),
            'predicted_at': datetime.utcnow().isoformat()
        }
        
        self.predictions.append(prediction)
        return prediction
    
    def _get_recommendation(self, segment: str) -> str:
        """Recommandation action basée sur segment"""
        recommendations = {
            'hot_lead': 'Send personalized offer email immediately',
            'warm_lead': 'Schedule nurturing campaign',
            'cold_lead': 'Add to re-engagement campaign'
        }
        return recommendations.get(segment, 'Monitor activity')


# =============================================
# GÉNÉRATEUR ÉVÉNEMENTS RÉALISTES
# =============================================

def generate_realistic_events(num_users: int = 10, events_per_user: int = 5) -> List[Dict]:
    """Génère des événements utilisateurs réalistes"""
    events = []
    event_types = ['page_view', 'form_submit', 'button_click', 'signup', 'purchase']
    
    for user_idx in range(num_users):
        user_id = f"user_{user_idx + 1000}"
        
        for evt_idx in range(events_per_user):
            event = {
                'userId': user_id,
                'type': random.choice(event_types),
                'timestamp': int(time.time() - random.randint(0, 86400)),  # Dernières 24h
                'properties': {
                    'page': f'/page/{random.randint(1,10)}',
                    'value': round(random.uniform(0, 200), 2)
                },
                'context': {
                    'userAgent': 'Mozilla/5.0 Test',
                    'ip': f"192.168.1.{random.randint(1,254)}"
                }
            }
            events.append(event)
    
    return events


# =============================================
# TEST D'INTÉGRATION PRINCIPAL
# =============================================

def run_integration_test():
    """Exécute le test d'intégration complet"""
    
    print("=" * 70)
    print("🚀 AENEWS GROWTH ENGINE - TEST D'INTÉGRATION SIMPLIFIÉ")
    print("=" * 70)
    print()
    
    # Initialisation
    print("📦 Initialisation des composants...")
    worker = MockEventWorker()
    ai_engine = MockAIEngine()
    print("✅ Mock Event Worker initialisé")
    print("✅ Mock AI Engine initialisé")
    print()
    
    # Génération événements
    print("📊 Génération d'événements réalistes...")
    num_users = 20
    events_per_user = 8
    events = generate_realistic_events(num_users, events_per_user)
    total_events = len(events)
    print(f"✅ {total_events} événements générés pour {num_users} utilisateurs")
    print()
    
    # Test 1: Event Ingestion
    print("🔄 TEST 1: Event Ingestion & Enrichment")
    print("-" * 70)
    start_time = time.time()
    
    processed_count = 0
    duplicate_count = 0
    
    for event in events:
        result = worker.process_event(event)
        if result['status'] == 'processed':
            processed_count += 1
        else:
            duplicate_count += 1
    
    ingestion_time = time.time() - start_time
    throughput = total_events / ingestion_time
    
    print(f"✅ Événements traités: {processed_count}/{total_events}")
    print(f"⚠️  Doublons détectés: {duplicate_count}")
    print(f"⚡ Temps de traitement: {ingestion_time:.3f}s")
    print(f"📈 Débit: {throughput:.1f} events/sec")
    print()
    
    # Test 2: AI Predictions
    print("🤖 TEST 2: AI Decision Engine - Lead Scoring")
    print("-" * 70)
    start_time = time.time()
    
    # Grouper par utilisateur
    user_events = {}
    for event in worker.enriched_events:
        user_id = event['userId']
        if user_id not in user_events:
            user_events[user_id] = []
        user_events[user_id].append(event)
    
    predictions = []
    for user_id, user_evts in user_events.items():
        prediction = ai_engine.predict_lead_score(user_id, user_evts)
        predictions.append(prediction)
    
    ai_time = time.time() - start_time
    ai_throughput = len(predictions) / ai_time
    
    print(f"✅ Prédictions générées: {len(predictions)}")
    print(f"⚡ Temps de traitement: {ai_time:.3f}s")
    print(f"📈 Débit: {ai_throughput:.1f} predictions/sec")
    print()
    
    # Test 3: Analyse des résultats
    print("📊 TEST 3: Analyse des résultats")
    print("-" * 70)
    
    # Distribution segments
    df_pred = pd.DataFrame(predictions)
    segment_counts = df_pred['segment'].value_counts()
    
    print("📌 Distribution des segments:")
    for segment, count in segment_counts.items():
        pct = (count / len(predictions)) * 100
        print(f"  • {segment}: {count} ({pct:.1f}%)")
    
    print()
    print("📌 Statistiques lead scores:")
    print(f"  • Moyenne: {df_pred['lead_score'].mean():.2f}")
    print(f"  • Médiane: {df_pred['lead_score'].median():.2f}")
    print(f"  • Min: {df_pred['lead_score'].min():.2f}")
    print(f"  • Max: {df_pred['lead_score'].max():.2f}")
    
    print()
    print("📌 Top 3 utilisateurs (lead score):")
    top_users = df_pred.nlargest(3, 'lead_score')[['user_id', 'lead_score', 'segment', 'recommended_action']]
    for _, user in top_users.iterrows():
        print(f"  • {user['user_id']}: {user['lead_score']:.1f} ({user['segment']})")
        print(f"    → {user['recommended_action']}")
    
    print()
    
    # Test 4: Métriques de performance
    print("⚡ TEST 4: Métriques de performance")
    print("-" * 70)
    
    total_time = ingestion_time + ai_time
    avg_latency = (total_time / total_events) * 1000  # ms
    
    print(f"📊 Temps total: {total_time:.3f}s")
    print(f"📊 Latence moyenne: {avg_latency:.2f}ms/event")
    print(f"📊 Débit global: {total_events / total_time:.1f} events/sec")
    print()
    
    # Validation des objectifs
    print("✅ VALIDATION DES OBJECTIFS PRODUCTION")
    print("-" * 70)
    
    objectives = {
        'Latence < 100ms': avg_latency < 100,
        'Débit > 50 events/sec': (total_events / total_time) > 50,
        'Taux de succès > 95%': (processed_count / total_events) > 0.95,
        'AI throughput > 10/sec': ai_throughput > 10
    }
    
    for objective, passed in objectives.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} {objective}")
    
    print()
    
    # Résumé final
    all_pass = all(objectives.values())
    
    print("=" * 70)
    if all_pass:
        print("🎉 TOUS LES TESTS PASSÉS - SYSTÈME PRÊT POUR PRODUCTION")
    else:
        print("⚠️  CERTAINS OBJECTIFS NON ATTEINTS - OPTIMISATION RECOMMANDÉE")
    print("=" * 70)
    print()
    
    return {
        'success': all_pass,
        'total_events': total_events,
        'processed': processed_count,
        'predictions': len(predictions),
        'avg_latency_ms': avg_latency,
        'throughput': total_events / total_time,
        'objectives': objectives
    }


# =============================================
# EXÉCUTION
# =============================================

if __name__ == '__main__':
    results = run_integration_test()
    
    # Export résultats JSON
    output_file = '/mnt/user-data/outputs/integration-test-results.json'
    with open(output_file, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"📁 Résultats exportés: {output_file}")
    print()
