#!/usr/bin/env python3
"""
AENEWS Growth Engine - AI Decision Engine
Production-ready ML-powered decision engine with real training pipeline
"""

import os
import json
import asyncio
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict

import redis.asyncio as aioredis
from pymongo import MongoClient
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestClassifier, GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, mean_squared_error
import joblib

# ============================================
# CONFIGURATION
# ============================================
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', '6379'))
REDIS_PASSWORD = os.getenv('REDIS_PASSWORD', None)

MONGODB_URI = os.getenv('MONGODB_URI', 'mongodb://admin:MongoPass2024!@localhost:27017')
MONGODB_DATABASE = os.getenv('MONGODB_DATABASE', 'aenews')

REDIS_STREAM_AI = os.getenv('REDIS_STREAM_AI_DECISIONS', 'ai.decisions')
REDIS_STREAM_MAUTIC = os.getenv('REDIS_STREAM_MAUTIC', 'mautic.events')
CONSUMER_GROUP = os.getenv('CONSUMER_GROUP', 'ai-engine-group')
CONSUMER_NAME = os.getenv('CONSUMER_NAME', f'ai-engine-{os.getpid()}')

BATCH_SIZE = int(os.getenv('BATCH_SIZE', '10'))
BLOCK_TIME = int(os.getenv('BLOCK_TIME_MS', '5000'))

MODEL_PATH = '/tmp/models'
RETRAIN_INTERVAL = 24 * 3600  # Retrain every 24h

# ============================================
# LOGGING
# ============================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('ai-decision-engine')

# ============================================
# DATA CLASSES
# ============================================
@dataclass
class UserFeatures:
    """Features extracted from user behavior"""
    user_id: str
    total_events: int
    page_views: int
    form_submits: int
    email_opens: int
    email_clicks: int
    purchases: int
    avg_session_duration: float
    days_since_first_event: int
    days_since_last_event: int
    recency_score: float
    frequency_score: float
    monetary_score: float

@dataclass
class AIDecision:
    """AI decision output"""
    user_id: str
    decision_id: str
    decision_type: str  # 'lead_score', 'segment', 'next_best_action'
    score: float
    confidence: float
    tags: List[str]
    recommendations: Dict[str, Any]
    timestamp: datetime

# ============================================
# MONGODB CLIENT
# ============================================
mongo_client = None
db = None

def init_mongodb():
    global mongo_client, db
    mongo_client = MongoClient(MONGODB_URI)
    db = mongo_client[MONGODB_DATABASE]
    logger.info('MongoDB connected')

# ============================================
# FEATURE ENGINEERING
# ============================================
async def extract_user_features(user_id: str) -> Optional[UserFeatures]:
    """Extract features from MongoDB event data lake"""
    try:
        events = list(db.events.find({'userId': user_id}).sort('timestamp', -1).limit(1000))
        
        if not events:
            return None
        
        df = pd.DataFrame(events)
        
        # Event counts by type
        event_counts = df['eventType'].value_counts().to_dict()
        
        # Time-based features
        timestamps = pd.to_datetime(df['timestamp'], unit='ms')
        first_event = timestamps.min()
        last_event = timestamps.max()
        now = datetime.now()
        
        days_since_first = (now - first_event).days
        days_since_last = (now - last_event).days
        
        # RFM scores (Recency, Frequency, Monetary)
        recency_score = 1.0 / (days_since_last + 1)  # Higher = more recent
        frequency_score = len(events) / max(days_since_first, 1)  # Events per day
        monetary_score = event_counts.get('purchase', 0) * 10.0  # Simplified
        
        # Session duration (simplified: time between first and last event)
        total_duration = (last_event - first_event).total_seconds()
        avg_session = total_duration / max(len(events), 1)
        
        return UserFeatures(
            user_id=user_id,
            total_events=len(events),
            page_views=event_counts.get('page_view', 0),
            form_submits=event_counts.get('form_submit', 0),
            email_opens=event_counts.get('email_open', 0),
            email_clicks=event_counts.get('email_click', 0),
            purchases=event_counts.get('purchase', 0),
            avg_session_duration=avg_session,
            days_since_first_event=days_since_first,
            days_since_last_event=days_since_last,
            recency_score=recency_score,
            frequency_score=frequency_score,
            monetary_score=monetary_score
        )
    except Exception as e:
        logger.error(f'Error extracting features for {user_id}: {e}')
        return None

# ============================================
# ML MODELS
# ============================================
lead_score_model = None
engagement_model = None
scaler = None

def features_to_array(features: UserFeatures) -> np.ndarray:
    """Convert features to numpy array for ML"""
    return np.array([
        features.total_events,
        features.page_views,
        features.form_submits,
        features.email_opens,
        features.email_clicks,
        features.purchases,
        features.avg_session_duration,
        features.days_since_first_event,
        features.days_since_last_event,
        features.recency_score,
        features.frequency_score,
        features.monetary_score
    ]).reshape(1, -1)

async def train_models():
    """Train ML models from historical data"""
    global lead_score_model, engagement_model, scaler
    
    logger.info('Starting model training...')
    
    try:
        # Get all unique users from last 30 days
        cutoff = datetime.now() - timedelta(days=30)
        cutoff_ts = int(cutoff.timestamp() * 1000)
        
        users = db.events.distinct('userId', {'timestamp': {'$gte': cutoff_ts}})
        logger.info(f'Found {len(users)} users for training')
        
        if len(users) < 10:
            logger.warning('Not enough data for training, using dummy models')
            return
        
        # Extract features
        features_list = []
        for user_id in users[:1000]:  # Limit to 1000 for training speed
            feat = await extract_user_features(user_id)
            if feat:
                features_list.append(feat)
        
        if len(features_list) < 10:
            logger.warning('Not enough valid features, skipping training')
            return
        
        # Prepare training data
        X = np.array([
            [f.total_events, f.page_views, f.form_submits, f.email_opens, 
             f.email_clicks, f.purchases, f.avg_session_duration, 
             f.days_since_first_event, f.days_since_last_event,
             f.recency_score, f.frequency_score, f.monetary_score]
            for f in features_list
        ])
        
        # Labels (simplified: high-value if purchases > 0 or high engagement)
        y_classification = np.array([
            1 if f.purchases > 0 or (f.email_opens > 5 and f.form_submits > 2) else 0
            for f in features_list
        ])
        
        # Engagement score (regression target)
        y_regression = np.array([
            f.recency_score * f.frequency_score * (1 + f.monetary_score)
            for f in features_list
        ])
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        # Train lead scoring model (classification)
        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y_classification, test_size=0.2, random_state=42
        )
        
        lead_score_model = RandomForestClassifier(n_estimators=100, random_state=42)
        lead_score_model.fit(X_train, y_train)
        
        accuracy = accuracy_score(y_test, lead_score_model.predict(X_test))
        logger.info(f'Lead score model accuracy: {accuracy:.2%}')
        
        # Train engagement model (regression)
        X_train, X_test, y_train, y_test = train_test_split(
            X_scaled, y_regression, test_size=0.2, random_state=42
        )
        
        engagement_model = GradientBoostingRegressor(n_estimators=100, random_state=42)
        engagement_model.fit(X_train, y_train)
        
        mse = mean_squared_error(y_test, engagement_model.predict(X_test))
        logger.info(f'Engagement model MSE: {mse:.4f}')
        
        # Save models
        os.makedirs(MODEL_PATH, exist_ok=True)
        joblib.dump(lead_score_model, f'{MODEL_PATH}/lead_score.pkl')
        joblib.dump(engagement_model, f'{MODEL_PATH}/engagement.pkl')
        joblib.dump(scaler, f'{MODEL_PATH}/scaler.pkl')
        
        logger.info('Models trained and saved successfully')
        
    except Exception as e:
        logger.error(f'Error during training: {e}')

def load_models():
    """Load pre-trained models"""
    global lead_score_model, engagement_model, scaler
    
    try:
        if os.path.exists(f'{MODEL_PATH}/lead_score.pkl'):
            lead_score_model = joblib.load(f'{MODEL_PATH}/lead_score.pkl')
            engagement_model = joblib.load(f'{MODEL_PATH}/engagement.pkl')
            scaler = joblib.load(f'{MODEL_PATH}/scaler.pkl')
            logger.info('Models loaded from disk')
        else:
            logger.info('No saved models found')
    except Exception as e:
        logger.error(f'Error loading models: {e}')

# ============================================
# AI PREDICTIONS
# ============================================
async def predict_lead_score(features: UserFeatures) -> AIDecision:
    """Predict lead score for a user"""
    try:
        X = features_to_array(features)
        
        if scaler and lead_score_model:
            X_scaled = scaler.transform(X)
            score_proba = lead_score_model.predict_proba(X_scaled)[0]
            score = score_proba[1] if len(score_proba) > 1 else 0.5
            confidence = max(score_proba)
        else:
            # Fallback heuristic
            score = min(
                (features.recency_score * 0.3 + 
                 features.frequency_score * 0.3 + 
                 features.monetary_score * 0.4), 
                1.0
            )
            confidence = 0.7
        
        # Assign tags
        tags = []
        if score > 0.8:
            tags.append('hot_lead')
        elif score > 0.6:
            tags.append('warm_lead')
        else:
            tags.append('cold_lead')
        
        if features.purchases > 0:
            tags.append('customer')
        
        # Recommendations
        recommendations = {
            'next_action': 'send_nurture_email' if score > 0.5 else 'continue_monitoring',
            'segment': 'high_value' if score > 0.7 else 'standard',
            'priority': 'high' if score > 0.8 else 'medium' if score > 0.5 else 'low'
        }
        
        decision_id = hashlib.sha256(
            f'{features.user_id}-{datetime.now().isoformat()}'.encode()
        ).hexdigest()[:16]
        
        return AIDecision(
            user_id=features.user_id,
            decision_id=decision_id,
            decision_type='lead_score',
            score=float(score),
            confidence=float(confidence),
            tags=tags,
            recommendations=recommendations,
            timestamp=datetime.now()
        )
        
    except Exception as e:
        logger.error(f'Error predicting lead score: {e}')
        raise

# ============================================
# EVENT PROCESSING
# ============================================
async def process_ai_event(redis_client: aioredis.Redis, stream_id: str, fields: dict):
    """Process a single AI event"""
    try:
        event_data = json.loads(fields[b'eventData'])
        user_id = event_data['userId']
        
        logger.info(f'Processing AI event for user {user_id}')
        
        # Extract features
        features = await extract_user_features(user_id)
        
        if not features:
            logger.warning(f'No features found for user {user_id}')
            await redis_client.xack(REDIS_STREAM_AI, CONSUMER_GROUP, stream_id)
            return
        
        # Generate prediction
        decision = await predict_lead_score(features)
        
        # Store decision in MongoDB
        db.ai_decisions.insert_one({
            **asdict(decision),
            'timestamp': decision.timestamp.isoformat(),
            'createdAt': datetime.now()
        })
        
        # Send decision to Mautic stream
        decision_payload = {
            'userId': decision.user_id,
            'decisionId': decision.decision_id,
            'leadScore': decision.score,
            'tags': decision.tags,
            'segment': decision.recommendations.get('segment'),
            'priority': decision.recommendations.get('priority')
        }
        
        await redis_client.xadd(
            REDIS_STREAM_MAUTIC,
            {b'aiDecision': json.dumps(decision_payload).encode()}
        )
        
        # ACK
        await redis_client.xack(REDIS_STREAM_AI, CONSUMER_GROUP, stream_id)
        
        logger.info(f'AI decision created: {decision.decision_id}, score: {decision.score:.2f}')
        
    except Exception as e:
        logger.error(f'Error processing AI event: {e}')
        raise

# ============================================
# CONSUMER LOOP
# ============================================
async def consume_events():
    """Main consumer loop"""
    redis_client = await aioredis.from_url(
        f'redis://{REDIS_HOST}:{REDIS_PORT}',
        password=REDIS_PASSWORD,
        decode_responses=False
    )
    
    # Ensure consumer group
    try:
        await redis_client.xgroup_create(REDIS_STREAM_AI, CONSUMER_GROUP, id='0', mkstream=True)
        logger.info(f'Consumer group {CONSUMER_GROUP} created')
    except Exception as e:
        if 'BUSYGROUP' in str(e):
            logger.info(f'Consumer group {CONSUMER_GROUP} already exists')
        else:
            raise
    
    logger.info('Starting AI event consumer')
    
    while True:
        try:
            results = await redis_client.xreadgroup(
                CONSUMER_GROUP,
                CONSUMER_NAME,
                {REDIS_STREAM_AI: '>'},
                count=BATCH_SIZE,
                block=BLOCK_TIME
            )
            
            if not results:
                continue
            
            for stream_key, messages in results:
                logger.info(f'Received {len(messages)} AI events')
                
                for stream_id, fields in messages:
                    await process_ai_event(redis_client, stream_id, fields)
                    
        except Exception as e:
            logger.error(f'Error in consumer loop: {e}')
            await asyncio.sleep(5)

# ============================================
# PERIODIC RETRAINING
# ============================================
async def periodic_retrain():
    """Retrain models periodically"""
    while True:
        await asyncio.sleep(RETRAIN_INTERVAL)
        logger.info('Starting periodic model retraining')
        await train_models()

# ============================================
# MAIN
# ============================================
async def main():
    logger.info('Initializing AI Decision Engine')
    
    # Init MongoDB
    init_mongodb()
    
    # Load or train models
    load_models()
    if not lead_score_model:
        await train_models()
    
    # Start periodic retraining
    asyncio.create_task(periodic_retrain())
    
    # Start consumer
    await consume_events()

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info('Shutting down gracefully')
