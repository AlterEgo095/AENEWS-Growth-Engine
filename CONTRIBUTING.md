# 🤝 Contributing to AENEWS Growth Engine

Merci de votre intérêt pour contribuer ! Voici comment vous pouvez aider.

## 📋 Code of Conduct

Ce projet adhère au [Code of Conduct](CODE_OF_CONDUCT.md). En participant, vous acceptez de respecter ces règles.

## 🚀 Quick Start

```bash
# 1. Fork le projet
# 2. Clone votre fork
git clone https://github.com/VOTRE-USERNAME/AENEWS-Growth-Engine.git
cd AENEWS-Growth-Engine

# 3. Créer une branche
git checkout -b feature/amazing-feature

# 4. Installer les dépendances
npm run install:all

# 5. Lancer en dev
make dev
```

## 📝 Conventions

### Commits

Nous utilisons [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new event tracking endpoint
fix: resolve memory leak in Redis client
docs: update API documentation
style: format code with prettier
refactor: simplify authentication logic
test: add unit tests for event service
chore: update dependencies
```

### Code Style

- **TypeScript**: Respecter le `tsconfig.json`
- **Prettier**: Formater avec `npm run format`
- **ESLint**: Vérifier avec `npm run lint`
- **Tests**: Minimum 80% coverage

### Branches

- `main` — Production
- `develop` — Développement
- `feature/*` — Nouvelles fonctionnalités
- `fix/*` — Corrections de bugs
- `hotfix/*` — Corrections urgentes

## 🧪 Tests

```bash
# Tests unitaires
npm run test

# Tests avec coverage
npm run test:coverage

# Tests d'intégration
npm run test:integration
```

## 📤 Pull Requests

1. Mettre à jour votre branche avec `main`
2. S'assurer que tous les tests passent
3. Mettre à jour la documentation si nécessaire
4. Créer une PR avec une description détaillée
5. Attendre la review

## 🐛 Reporting Bugs

Utilisez les [GitHub Issues](https://github.com/AlterEgo095/AENEWS-Growth-Engine/issues) avec le template bug report.

## 💬 Questions ?

Ouvrez une [Discussion](https://github.com/AlterEgo095/AENEWS-Growth-Engine/discussions).

## 📄 License

En contribuant, vous acceptez que vos contributions soient sous [MIT License](LICENSE).
