.PHONY: help install dev down logs clean

help:
	@echo "AENEWS Growth Engine - Make Commands"
	@echo "====================================="
	@echo "make install    - Install all dependencies"
	@echo "make dev        - Start development environment"
	@echo "make down       - Stop all services"
	@echo "make logs       - Show logs"
	@echo "make clean      - Clean all data"

install:
	npm run install:all

dev:
	docker-compose up --build

down:
	docker-compose down

logs:
	docker-compose logs -f

clean:
	docker-compose down -v
	rm -rf services/*/node_modules
	rm -rf services/*/dist
