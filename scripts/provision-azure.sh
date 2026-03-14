#!/usr/bin/env bash
set -euo pipefail

# Minimal-cost Azure provisioning script (interactive values below)
# WARNING: This script uses az CLI and will create billable resources.

if ! command -v az >/dev/null 2>&1; then
  echo "az CLI is required. Install from https://learn.microsoft.com/cli/azure/install-azure-cli"
  exit 1
fi

echo "This script will create: resource group, storage account + container, postgres flexible server, and App Service plan + Web App."
read -p "Azure subscription id: " SUBSCRIPTION_ID
read -p "Azure region (e.g. eastus): " LOCATION
read -p "Resource group name (e.g. resourcing-rg): " RG
read -p "Storage account name (globally unique, lowercase) e.g. resourcingst$RANDOM: " STORAGE
read -p "Postgres server name (globally unique) e.g. resourcingpg$RANDOM: " PG
read -p "Admin username for Postgres: " PG_ADMIN
read -s -p "Admin password for Postgres (will be shown once): " PG_PASS
echo
read -p "App Service name (web app) e.g. resourcing-app: " APP_NAME

az account set --subscription "$SUBSCRIPTION_ID"

echo "Creating resource group $RG in $LOCATION"
az group create -n "$RG" -l "$LOCATION"

echo "Creating Storage account $STORAGE"
az storage account create -n "$STORAGE" -g "$RG" -l "$LOCATION" --sku Standard_LRS --kind StorageV2

echo "Creating storage container 'cvs'"
AZ_CONN=$(az storage account show-connection-string -n "$STORAGE" -g "$RG" --query connectionString -o tsv)
az storage container create --name cvs --account-name "$STORAGE" --connection-string "$AZ_CONN" || true

echo "Creating Azure Database for PostgreSQL Flexible Server $PG"
az postgres flexible-server create -g "$RG" -n "$PG" -l "$LOCATION" --admin-user "$PG_ADMIN" --admin-password "$PG_PASS" --sku-name Standard_B1ms --version 13 --storage-size 32

echo "Create a firewall rule to allow public access from Azure services (you may want to restrict)"
az postgres flexible-server firewall-rule create -g "$RG" -s "$PG" -n allow_az --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

PG_HOST=$(az postgres flexible-server show -g "$RG" -n "$PG" --query fullyQualifiedDomainName -o tsv)
DATABASE_URL="postgresql://$PG_ADMIN:$PG_PASS@$PG_HOST:5432/postgres"

echo "Creating App Service plan and Web App"
az appservice plan create -g "$RG" -n "${APP_NAME}-plan" --is-linux --sku B1
az webapp create -g "$RG" -p "${APP_NAME}-plan" -n "$APP_NAME" --runtime "NODE|18-lts"

echo
echo "Provisioning complete. Outputs you need to set as GitHub secrets or App Settings:" 
echo "AZURE_STORAGE_CONNECTION_STRING='$AZ_CONN'"
echo "AZURE_STORAGE_CONTAINER='cvs'"
echo "DATABASE_URL='$DATABASE_URL'"
echo "AZURE_WEBAPP_NAME='$APP_NAME'"
echo "AZURE_RESOURCE_GROUP='$RG'"

echo
echo "You should create an Admin password hash for the web app and a JWT secret. Run locally:"
echo "  node hash-password.js" 
echo "and generate a random JWT_SECRET (e.g. openssl rand -hex 32)"

echo
echo "If you want to setup GitHub Actions deployment, create the following repository secrets:"
echo "  AZURE_WEBAPP_NAME, AZURE_WEBAPP_PUBLISH_PROFILE (download from az webapp deployment list-publishing-profiles),"
echo "  AZURE_RESOURCE_GROUP, AZURE_CREDENTIALS (optional for az CLI actions), JWT_SECRET, ADMIN_USER, ADMIN_PASS_HASH, AZURE_STORAGE_CONNECTION_STRING, AZURE_STORAGE_CONTAINER, DATABASE_URL"
