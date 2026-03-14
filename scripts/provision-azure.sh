#!/usr/bin/env bash
set -euo pipefail

# ─── EDIT THESE THREE LINES ───────────────────────────────────────────────────
LOCATION="eastus"          # Azure region: eastus, westeurope, uksouth, etc.
PG_PASS="Change_Me_123!"   # PostgreSQL password (min 8 chars, uppercase + lowercase + special)
ADMIN_PASS="MyAppPass1!"   # Login password for the resourcing web app
# ──────────────────────────────────────────────────────────────────────────────

SUFFIX=$(openssl rand -hex 3)
RG="resourcing-rg"
STORAGE_NAME="resourcingcvs${SUFFIX}"
PG_SERVER="resourcing-pg-${SUFFIX}"
PG_ADMIN="pgadmin"
WEBAPP_NAME="resourcing-app-${SUFFIX}"
PLAN_NAME="resourcing-plan"

echo ""
echo "=== Starting Azure provisioning ==="
echo "Suffix: $SUFFIX | Region: $LOCATION"
echo ""

# 1. Resource Group
echo "[1/7] Creating resource group..."
az group create --name "$RG" --location "$LOCATION" --output none

# 2. Storage Account
echo "[2/7] Creating storage account..."
az storage account create \
  --name "$STORAGE_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --output none

STORAGE_CONN=$(az storage account show-connection-string \
  --name "$STORAGE_NAME" \
  --resource-group "$RG" \
  --query connectionString -o tsv)

az storage container create \
  --name cvs \
  --connection-string "$STORAGE_CONN" \
  --output none

echo "    Storage account: $STORAGE_NAME"

# 3. PostgreSQL Flexible Server
echo "[3/7] Creating PostgreSQL server (this takes ~3 minutes)..."
az postgres flexible-server create \
  --resource-group "$RG" \
  --name "$PG_SERVER" \
  --location "$LOCATION" \
  --admin-user "$PG_ADMIN" \
  --admin-password "$PG_PASS" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 15 \
  --storage-size 32 \
  --public-access 0.0.0.0 \
  --output none

DATABASE_URL="postgresql://${PG_ADMIN}:${PG_PASS}@${PG_SERVER}.postgres.database.azure.com:5432/postgres?sslmode=require"
echo "    PostgreSQL server: $PG_SERVER"

# 4. App Service Plan
echo "[4/7] Creating App Service plan..."
az appservice plan create \
  --name "$PLAN_NAME" \
  --resource-group "$RG" \
  --location "$LOCATION" \
  --sku B1 \
  --is-linux \
  --output none

# 5. Web App
echo "[5/7] Creating Web App..."
az webapp create \
  --name "$WEBAPP_NAME" \
  --resource-group "$RG" \
  --plan "$PLAN_NAME" \
  --runtime "NODE:18-lts" \
  --output none

echo "    Web App: $WEBAPP_NAME"

# 6. Generate secrets
echo "[6/7] Generating secrets..."
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASS_HASH=$(node -e "const b=require('bcryptjs'); console.log(b.hashSync('${ADMIN_PASS}', 10));" 2>/dev/null || \
  node -e "const b=require('/usr/lib/node_modules/bcryptjs/index.js'); console.log(b.hashSync('${ADMIN_PASS}', 10));" 2>/dev/null || \
  echo "HASH_FAILED")

if [ "$ADMIN_PASS_HASH" = "HASH_FAILED" ]; then
  # Install bcryptjs in Cloud Shell temp and retry
  npm install bcryptjs --prefix /tmp/bcrypt --silent 2>/dev/null
  ADMIN_PASS_HASH=$(node -e "const b=require('/tmp/bcrypt/node_modules/bcryptjs'); console.log(b.hashSync('${ADMIN_PASS}', 10));")
fi

# 7. Configure App Settings
echo "[7/7] Configuring App Settings..."
az webapp config appsettings set \
  --name "$WEBAPP_NAME" \
  --resource-group "$RG" \
  --settings \
    JWT_SECRET="$JWT_SECRET" \
    ADMIN_USER="admin" \
    ADMIN_PASS_HASH="$ADMIN_PASS_HASH" \
    AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONN" \
    AZURE_STORAGE_CONTAINER="cvs" \
    DATABASE_URL="$DATABASE_URL" \
    WEBSITE_NODE_DEFAULT_VERSION="~18" \
  --output none

# Get Publish Profile
PUBLISH_PROFILE=$(az webapp deployment list-publishing-profiles \
  --name "$WEBAPP_NAME" \
  --resource-group "$RG" \
  --xml)

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║                  PROVISIONING COMPLETE                          ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  App URL:  https://${WEBAPP_NAME}.azurewebsites.net"
echo "║  Login:    admin / ${ADMIN_PASS}"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "║  Add these 2 secrets to GitHub (repo → Settings → Secrets):    ║"
echo "╠══════════════════════════════════════════════════════════════════╣"
echo "  AZURE_WEBAPP_NAME = $WEBAPP_NAME"
echo ""
echo "  AZURE_WEBAPP_PUBLISH_PROFILE ="
echo "$PUBLISH_PROFILE"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "Once secrets are added, push to main branch to deploy:"
echo "  git push origin main"
