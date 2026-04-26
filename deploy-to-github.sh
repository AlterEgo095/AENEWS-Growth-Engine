#!/bin/bash

# AENEWS Growth Engine - GitHub Deployment Script
# Usage: ./deploy-to-github.sh <github-username> <repo-name>

set -e

GITHUB_USER=${1:-"votre-username"}
REPO_NAME=${2:-"aenews-growth-engine"}

echo "🚀 Deploying AENEWS Growth Engine to GitHub"
echo "================================================"
echo "User: $GITHUB_USER"
echo "Repo: $REPO_NAME"
echo ""

# Check if git is configured
if ! git config user.name > /dev/null; then
    echo "⚠️  Git user not configured. Please configure:"
    echo "git config --global user.name 'Your Name'"
    echo "git config --global user.email 'your@email.com'"
    exit 1
fi

# Check if remote already exists
if git remote | grep -q origin; then
    echo "📍 Remote 'origin' already exists. Removing..."
    git remote remove origin
fi

# Add new remote
echo "🔗 Adding GitHub remote..."
git remote add origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"

# Rename branch to main if needed
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "master" ]; then
    echo "🔄 Renaming branch from master to main..."
    git branch -m main
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Create the repository on GitHub: https://github.com/new"
echo "   - Name: $REPO_NAME"
echo "   - Visibility: Public or Private"
echo "   - DO NOT initialize with README"
echo ""
echo "2. Push the code:"
echo "   git push -u origin main"
echo ""
echo "3. Configure GitHub Secrets (Settings > Secrets and variables > Actions):"
echo "   - DOCKER_USERNAME: Your Docker Hub username"
echo "   - DOCKER_PASSWORD: Your Docker Hub access token"
echo ""
echo "4. Enable GitHub Actions (Actions tab)"
echo ""
echo "🎉 Your repo will be live at: https://github.com/$GITHUB_USER/$REPO_NAME"
