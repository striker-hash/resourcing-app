# Azure Deployment Guide

No local Azure CLI needed. All commands run in **Azure Cloud Shell** (browser-based terminal inside the Azure Portal).

**Data persistence:** CVs are stored in Azure Blob Storage and candidate records in PostgreSQL — both are independent of the app. Redeployments never wipe your data.

---

## Part 1 — Open Azure Cloud Shell

1. Go to [https://portal.azure.com](https://portal.azure.com) and sign in
2. Click the **Cloud Shell icon** (`>_`) in the top toolbar
3. Choose **Bash** when prompted
4. If asked to create storage for Cloud Shell, click **Create** (it's free)

---

## Part 2 — Run Provisioning Commands

Copy and paste the block below into Cloud Shell. **Edit the variables at the top first** — especially `PG_PASS`, `ADMIN_PASS`, and optionally `LOCATION`.

```bash
# ─── EDIT THESE ──────────────────────────────────────────────────────────────
LOCATION="eastus"          # Azure region (eastus, westeurope, uksouth, etc.)
PG_PASS="Change_Me_123!"   # PostgreSQL admin password (min 8 chars, mixed case + special)
ADMIN_PASS="MyAppPass1!"   # Login password for the resourcing web app
# ─────────────────────────────────────────────────────────────────────────────

# Auto-generated unique names (safe to leave as-is)
SUFFIX=$(openssl rand -hex 3)
RG="resourcing-rg"
STORAGE_NAME="resourcingcvs${SUFFIX}"
PG_SERVER="resourcing-pg-${SUFFIX}"
PG_ADMIN="pgadmin"
PG_DB="postgres"
WEBAPP_NAME="resourcing-app-${SUFFIX}"
PLAN_NAME="resourcing-plan"

echo "Resources will be created with suffix: $SUFFIX"
echo "Web app URL will be: https://${WEBAPP_NAME}.azurewebsites.net"

# 1. Resource Group
az group create --name $RG --location $LOCATION

# 2. Storage Account + Blob Container
az storage account create \
  --name $STORAGE_NAME \
  --resource-group $RG \
  --location $LOCATION \
  --sku Standard_LRS \
  --kind StorageV2

STORAGE_CONN=$(az storage account show-connection-string \
  --name $STORAGE_NAME \
  --resource-group $RG \
  --query connectionString -o tsv)

az storage container create \
  --name cvs \
  --connection-string "$STORAGE_CONN"

echo "✓ Storage ready"

# 3. PostgreSQL Flexible Server (Burstable B1ms = cheapest)
az postgres flexible-server create \
  --resource-group $RG \
  --name $PG_SERVER \
  --location $LOCATION \
  --admin-user $PG_ADMIN \
  --admin-password "$PG_PASS" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 15 \
  --storage-size 32 \
  --public-access 0.0.0.0

DATABASE_URL="postgresql://${PG_ADMIN}:${PG_PASS}@${PG_SERVER}.postgres.database.azure.com:5432/${PG_DB}?sslmode=require"

echo "✓ PostgreSQL ready"

# 4. App Service Plan (B1 = cheapest always-on Linux plan)
az appservice plan create \
  --name $PLAN_NAME \
  --resource-group $RG \
  --location $LOCATION \
  --sku B1 \
  --is-linux

# 5. Web App (Node 18)
az webapp create \
  --name $WEBAPP_NAME \
  --resource-group $RG \
  --plan $PLAN_NAME \
  --runtime "NODE:18-lts"

echo "✓ Web App created"

# 6. Generate secrets
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_PASS_HASH=$(node -e "const b=require('bcryptjs'); console.log(b.hashSync('${ADMIN_PASS}', 10));")

# 7. Set App Settings (env vars — persist across all redeployments)
az webapp config appsettings set \
  --name $WEBAPP_NAME \
  --resource-group $RG \
  --settings \
    JWT_SECRET="$JWT_SECRET" \
    ADMIN_USER="admin" \
    ADMIN_PASS_HASH="$ADMIN_PASS_HASH" \
    AZURE_STORAGE_CONNECTION_STRING="$STORAGE_CONN" \
    AZURE_STORAGE_CONTAINER="cvs" \
    DATABASE_URL="$DATABASE_URL" \
    WEBSITE_NODE_DEFAULT_VERSION="~18"

echo "✓ App Settings configured"

# 8. Print the values you need for GitHub Secrets
echo ""
echo "════════════════════════════════════════════"
echo " SAVE THESE — needed for GitHub Secrets"
echo "════════════════════════════════════════════"
echo "AZURE_WEBAPP_NAME    = $WEBAPP_NAME"
echo "AZURE_RESOURCE_GROUP = $RG"
echo ""
echo "App URL: https://${WEBAPP_NAME}.azurewebsites.net"
echo "Login:   admin / ${ADMIN_PASS}"
echo "════════════════════════════════════════════"
```

---

## Part 3 — Get the Publish Profile (for GitHub)

Run this in Cloud Shell right after Part 2 (variables are still set):

```bash
az webapp deployment list-publishing-profiles \
  --name $WEBAPP_NAME \
  --resource-group $RG \
  --xml
```

**Copy the entire XML output** — you'll paste it into GitHub in the next step.

---

## Part 4 — Add GitHub Secrets

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add these two secrets:

   | Secret Name | Value |
   |-------------|-------|
   | `AZURE_WEBAPP_NAME` | the `WEBAPP_NAME` printed in Part 2 (e.g. `resourcing-app-a1b2c3`) |
   | `AZURE_WEBAPP_PUBLISH_PROFILE` | the full XML from Part 3 |

---

## Part 5 — Deploy

Push to `main` and GitHub Actions deploys automatically:

```bash
git add .
git commit -m "deploy to azure"
git push origin main
```

Watch the deploy under the **Actions** tab in GitHub. When green, your app is live at:
`https://<WEBAPP_NAME>.azurewebsites.net`

**Login credentials:** `admin` / the `ADMIN_PASS` you set in Part 2.

---

## How Data Persistence Works

| Data | Where stored | Survives redeployment? |
|------|-------------|------------------------|
| Uploaded CV files | Azure Blob Storage (`cvs` container) | ✅ Yes |
| Candidate records | Azure PostgreSQL | ✅ Yes |
| App Settings (env vars) | Azure App Service Configuration | ✅ Yes — set once, never overwritten by deploys |

---

## Estimated Monthly Cost (minimum)

| Resource | SKU | Est. cost |
|----------|-----|-----------|
| App Service Plan | B1 Linux | ~$13 |
| PostgreSQL Flexible Server | Burstable B1ms | ~$13 |
| Storage Account | Standard LRS | ~$0.02/GB |
| **Total** | | **~$26/month** |

To reduce cost further: stop the PostgreSQL server when not in use via the Portal (Pause/Stop button on the server page).

---

## Troubleshooting

**Deployment fails in GitHub Actions:**
- Check the Actions tab for error details
- Re-run Part 3 to get a fresh publish profile if it expired

**App starts but login fails:**
- Verify App Settings are saved: Portal → Web App → Configuration → Application settings

**Cannot connect to PostgreSQL:**
- In Portal, go to your PostgreSQL server → **Networking** → ensure "Allow public access from Azure services" is checked

**View live logs:**
- Portal → Web App → **Log stream** (left sidebar)
