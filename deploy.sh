#!/bin/bash
set -e

echo "🚀 Project Forge Production Deployment"
echo "======================================="

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found. Please create it first."
    exit 1
fi

# Generate SSL certs if not present
if [ ! -f nginx/ssl/cert.pem ] || [ ! -f nginx/ssl/key.pem ]; then
    echo "🔐 Generating self-signed SSL certificates..."
    mkdir -p nginx/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout nginx/ssl/key.pem \
        -out nginx/ssl/cert.pem \
        -subj "/CN=$(grep DOMAIN .env | cut -d= -f2 || echo 'localhost')"
    echo "✅ SSL certificates generated"
fi

# Build and start services
echo "🔨 Building and starting services..."
docker compose -f docker-compose.prod.yml build --no-cache
docker compose -f docker-compose.prod.yml up -d

# Wait for database to be healthy
echo "⏳ Waiting for database..."
sleep 10

# Run Strapi migrations
echo "🔄 Running database migrations..."
docker compose -f docker-compose.prod.yml exec -T backend npx strapi transfer --to-strapi || true

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Frontend: https://$(grep DOMAIN .env | cut -d= -f2 || echo 'localhost')"
echo "🔧 Strapi Admin: https://$(grep DOMAIN .env | cut -d= -f2 || echo 'localhost')/admin"
echo "📊 GraphQL: https://$(grep DOMAIN .env | cut -d= -f2 || echo 'localhost')/graphql"
echo ""
echo "📋 Useful commands:"
echo "  docker compose -f docker-compose.prod.yml logs -f"
echo "  docker compose -f docker-compose.prod.yml ps"
echo "  docker compose -f docker-compose.prod.yml down"
