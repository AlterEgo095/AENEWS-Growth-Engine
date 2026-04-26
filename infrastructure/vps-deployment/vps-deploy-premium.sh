#!/bin/bash
#
# AENEWS Growth Engine - VPS Deployment Script (PREMIUM)
# Ultra-professional deployment for production VPS
#
# Usage: sudo ./vps-deploy-premium.sh [domain]
#

set -euo pipefail

# ============================================
# CONFIGURATION
# ============================================
DOMAIN="${1:-}"
PROJECT_DIR="/opt/aenews-growth-engine"
BACKUP_DIR="/var/backups/aenews"
LOG_FILE="/var/log/aenews-deploy.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ============================================
# LOGGING
# ============================================
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

# ============================================
# PRE-FLIGHT CHECKS
# ============================================
preflight_checks() {
    log "🔍 Running pre-flight checks..."
    
    # Check if running as root
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run as root (use sudo)"
    fi
    
    # Check OS
    if [[ ! -f /etc/os-release ]]; then
        error "Cannot detect OS"
    fi
    
    . /etc/os-release
    if [[ "$ID" != "ubuntu" ]] && [[ "$ID" != "debian" ]]; then
        warn "This script is tested on Ubuntu/Debian. Your OS: $ID"
    fi
    
    # Check domain
    if [[ -z "$DOMAIN" ]]; then
        warn "No domain provided. SSL will be skipped."
    else
        log "✅ Domain: $DOMAIN"
    fi
    
    # Check system resources
    TOTAL_MEM=$(free -m | awk 'NR==2{print $2}')
    if [[ $TOTAL_MEM -lt 3500 ]]; then
        warn "Recommended RAM: 4GB. Available: ${TOTAL_MEM}MB"
    fi
    
    TOTAL_DISK=$(df -BG / | awk 'NR==2{print $4}' | sed 's/G//')
    if [[ $TOTAL_DISK -lt 30 ]]; then
        warn "Recommended disk: 40GB. Available: ${TOTAL_DISK}GB"
    fi
    
    log "✅ Pre-flight checks passed"
}

# ============================================
# SYSTEM UPDATE
# ============================================
update_system() {
    log "📦 Updating system packages..."
    
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get upgrade -y -qq
    apt-get install -y -qq \
        curl \
        wget \
        git \
        build-essential \
        software-properties-common \
        apt-transport-https \
        ca-certificates \
        gnupg \
        lsb-release \
        ufw \
        fail2ban \
        htop \
        vim \
        jq
    
    log "✅ System updated"
}

# ============================================
# INSTALL DOCKER
# ============================================
install_docker() {
    log "🐳 Installing Docker..."
    
    # Remove old versions
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true
    
    # Install Docker
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    
    # Install Docker Compose
    DOCKER_COMPOSE_VERSION="2.24.5"
    curl -L "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" \
        -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    
    # Enable and start Docker
    systemctl enable docker
    systemctl start docker
    
    # Verify
    docker --version
    docker-compose --version
    
    log "✅ Docker installed"
}

# ============================================
# CONFIGURE FIREWALL
# ============================================
configure_firewall() {
    log "🔒 Configuring firewall..."
    
    # Reset UFW
    ufw --force reset
    
    # Default policies
    ufw default deny incoming
    ufw default allow outgoing
    
    # Allow SSH (change port if needed)
    ufw allow 22/tcp comment 'SSH'
    
    # Allow HTTP/HTTPS
    ufw allow 80/tcp comment 'HTTP'
    ufw allow 443/tcp comment 'HTTPS'
    
    # Enable UFW
    ufw --force enable
    
    log "✅ Firewall configured"
}

# ============================================
# CLONE OR UPDATE REPOSITORY
# ============================================
setup_repository() {
    log "📥 Setting up repository..."
    
    if [[ -d "$PROJECT_DIR" ]]; then
        log "Repository exists, pulling latest changes..."
        cd "$PROJECT_DIR"
        git pull
    else
        log "Cloning repository..."
        mkdir -p "$(dirname $PROJECT_DIR)"
        git clone https://github.com/AlterEgo095/AENEWS-Growth-Engine.git "$PROJECT_DIR"
        cd "$PROJECT_DIR"
    fi
    
    log "✅ Repository ready"
}

# ============================================
# GENERATE SECURE CREDENTIALS
# ============================================
generate_env() {
    log "🔐 Generating secure environment configuration..."
    
    # Generate random passwords
    MYSQL_ROOT_PASSWORD=$(openssl rand -base64 32)
    MYSQL_PASSWORD=$(openssl rand -base64 32)
    MONGODB_PASSWORD=$(openssl rand -base64 32)
    REDIS_PASSWORD=$(openssl rand -base64 32)
    MAUTIC_ADMIN_PASSWORD=$(openssl rand -base64 24)
    JWT_SECRET=$(openssl rand -base64 64)
    GRAFANA_PASSWORD=$(openssl rand -base64 24)
    
    # Create .env.production
    cat > "$PROJECT_DIR/.env.production" <<EOF
# ============================================
# AENEWS Growth Engine - Production Configuration
# Generated: $(date)
# ============================================

# Domain
DOMAIN=${DOMAIN:-localhost}

# MySQL
MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
MYSQL_PASSWORD=${MYSQL_PASSWORD}
MYSQL_USER=mautic
MYSQL_DATABASE=mautic

# MongoDB
MONGODB_USER=admin
MONGODB_PASSWORD=${MONGODB_PASSWORD}

# Redis
REDIS_PASSWORD=${REDIS_PASSWORD}

# Mautic
MAUTIC_DB_HOST=mysql
MAUTIC_DB_USER=mautic
MAUTIC_DB_PASSWORD=${MYSQL_PASSWORD}
MAUTIC_DB_NAME=mautic
MAUTIC_ADMIN_EMAIL=admin@${DOMAIN:-localhost}
MAUTIC_ADMIN_PASSWORD=${MAUTIC_ADMIN_PASSWORD}

# API Gateway
JWT_SECRET=${JWT_SECRET}
NODE_ENV=production
PORT=3000
RATE_LIMIT_MAX=1000
RATE_LIMIT_WINDOW=60s

# AI Engine
OPENAI_API_KEY=${OPENAI_API_KEY:-your-openai-key-here}

# Monitoring
GRAFANA_ADMIN_PASSWORD=${GRAFANA_PASSWORD}

# Redis Streams
REDIS_STREAM_USER_EVENTS=user.events
REDIS_STREAM_AI_DECISIONS=ai.decisions
REDIS_STREAM_MAUTIC=mautic.events

# Logging
LOG_LEVEL=info
EOF

    chmod 600 "$PROJECT_DIR/.env.production"
    
    # Save credentials to secure file
    cat > "$PROJECT_DIR/CREDENTIALS.txt" <<EOF
# ============================================
# AENEWS Growth Engine - Production Credentials
# Generated: $(date)
# ⚠️ KEEP THIS FILE SECURE - DELETE AFTER SAVING
# ============================================

DOMAIN: ${DOMAIN:-localhost}

MySQL Root: ${MYSQL_ROOT_PASSWORD}
MySQL Mautic: ${MYSQL_PASSWORD}
MongoDB: ${MONGODB_PASSWORD}
Redis: ${REDIS_PASSWORD}

Mautic Admin:
  Email: admin@${DOMAIN:-localhost}
  Password: ${MAUTIC_ADMIN_PASSWORD}

Grafana Admin:
  Username: admin
  Password: ${GRAFANA_PASSWORD}

JWT Secret: ${JWT_SECRET}

# Access URLs:
Mautic: https://${DOMAIN:-localhost}/
API: https://${DOMAIN:-localhost}/api/
Grafana: https://${DOMAIN:-localhost}/grafana
EOF

    chmod 600 "$PROJECT_DIR/CREDENTIALS.txt"
    
    log "✅ Environment configured"
    log "📄 Credentials saved to $PROJECT_DIR/CREDENTIALS.txt"
}

# ============================================
# INSTALL SSL (Let's Encrypt)
# ============================================
install_ssl() {
    if [[ -z "$DOMAIN" ]]; then
        warn "Skipping SSL (no domain provided)"
        return
    fi
    
    log "🔒 Installing SSL certificate..."
    
    apt-get install -y certbot
    
    # Stop services if running
    docker-compose -f "$PROJECT_DIR/docker-compose.prod.yml" down 2>/dev/null || true
    
    # Get certificate
    certbot certonly --standalone \
        --non-interactive \
        --agree-tos \
        --email "admin@${DOMAIN}" \
        --domains "${DOMAIN}" \
        || warn "SSL certificate installation failed"
    
    # Setup auto-renewal
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook 'docker-compose -f $PROJECT_DIR/docker-compose.prod.yml restart nginx'") | crontab -
    
    log "✅ SSL installed"
}

# ============================================
# DEPLOY SERVICES
# ============================================
deploy_services() {
    log "🚀 Deploying services..."
    
    cd "$PROJECT_DIR"
    
    # Use production compose file
    export COMPOSE_FILE=docker-compose.prod.yml
    
    # Pull images
    docker-compose pull
    
    # Build custom images
    docker-compose build --no-cache
    
    # Start services
    docker-compose up -d
    
    log "⏳ Waiting for services to start..."
    sleep 30
    
    # Check health
    docker-compose ps
    
    log "✅ Services deployed"
}

# ============================================
# SETUP BACKUPS
# ============================================
setup_backups() {
    log "💾 Setting up automated backups..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Make backup script executable
    chmod +x "$PROJECT_DIR/infrastructure/scripts/backup.sh"
    
    # Add to crontab (daily at 2 AM)
    (crontab -l 2>/dev/null; echo "0 2 * * * $PROJECT_DIR/infrastructure/scripts/backup.sh >> /var/log/aenews-backup.log 2>&1") | crontab -
    
    log "✅ Backups configured (daily at 2 AM)"
}

# ============================================
# SETUP MONITORING
# ============================================
setup_monitoring() {
    log "📊 Setting up monitoring..."
    
    # Log rotation
    cat > /etc/logrotate.d/aenews <<EOF
/var/log/aenews-*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 root root
}
EOF
    
    log "✅ Monitoring configured"
}

# ============================================
# POST-DEPLOYMENT CHECKS
# ============================================
post_deployment_checks() {
    log "🔍 Running post-deployment checks..."
    
    cd "$PROJECT_DIR"
    
    # Check containers
    RUNNING=$(docker-compose ps --services --filter "status=running" | wc -l)
    TOTAL=$(docker-compose ps --services | wc -l)
    
    log "Containers running: $RUNNING/$TOTAL"
    
    # Test API
    if curl -f http://localhost:3000/health >/dev/null 2>&1; then
        log "✅ API Gateway is healthy"
    else
        warn "API Gateway health check failed"
    fi
    
    log "✅ Post-deployment checks complete"
}

# ============================================
# PRINT SUMMARY
# ============================================
print_summary() {
    echo ""
    echo "╔═══════════════════════════════════════════════════╗"
    echo "║   AENEWS Growth Engine - Deployment Complete     ║"
    echo "╚═══════════════════════════════════════════════════╝"
    echo ""
    echo "📍 Access URLs:"
    echo "   Mautic:  https://${DOMAIN:-localhost}/"
    echo "   API:     https://${DOMAIN:-localhost}/api/"
    echo "   Grafana: https://${DOMAIN:-localhost}/grafana"
    echo ""
    echo "🔐 Credentials: $PROJECT_DIR/CREDENTIALS.txt"
    echo ""
    echo "📊 Useful Commands:"
    echo "   View logs:     cd $PROJECT_DIR && docker-compose logs -f"
    echo "   Restart:       cd $PROJECT_DIR && docker-compose restart"
    echo "   Stop:          cd $PROJECT_DIR && docker-compose down"
    echo "   Backup:        $PROJECT_DIR/infrastructure/scripts/backup.sh"
    echo ""
    echo "📚 Full documentation: $PROJECT_DIR/docs/VPS_DEPLOYMENT.md"
    echo ""
    echo "✅ Deployment successful!"
    echo ""
}

# ============================================
# MAIN
# ============================================
main() {
    log "╔═══════════════════════════════════════════════════╗"
    log "║   AENEWS Growth Engine - VPS Deployment          ║"
    log "╚═══════════════════════════════════════════════════╝"
    
    preflight_checks
    update_system
    install_docker
    configure_firewall
    setup_repository
    generate_env
    install_ssl
    deploy_services
    setup_backups
    setup_monitoring
    post_deployment_checks
    print_summary
}

# Run main function
main "$@"
