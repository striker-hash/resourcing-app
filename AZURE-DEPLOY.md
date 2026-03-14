# Azure deployment (minimal cost)

This document lists the minimal steps to provision Azure resources and deploy the resourcing app.

Quick checklist
- Install Azure CLI and login: `az login`
- Run `scripts/provision-azure.sh` to create a resource group, Storage account (for CVs), PostgreSQL flexible server, and App Service
- Generate `ADMIN_PASS_HASH` with `node hash-password.js` and a `JWT_SECRET` (e.g. `openssl rand -hex 32`)
- Add repository secrets (or App Settings) used by the GitHub Actions workflow:
  - AZURE_WEBAPP_NAME
  - AZURE_WEBAPP_PUBLISH_PROFILE
  - AZURE_RESOURCE_GROUP
  - AZURE_CREDENTIALS (optional)
  - JWT_SECRET
  - ADMIN_USER
  - ADMIN_PASS_HASH
  - AZURE_STORAGE_CONNECTION_STRING
  - AZURE_STORAGE_CONTAINER
  - DATABASE_URL

Notes on costs and sizing
- Use the B1 App Service plan to keep compute costs low.
- Use Standard_LRS storage account (cheap, durable).
- PostgreSQL Flexible Server: the smallest SKU (Standard_B1ms) is modestly priced; scale up only if needed.

Security notes
- Don't commit secrets to git. Use GitHub repository secrets or App Service configuration.
- Consider locking down Postgres firewall to only allow the App Service outbound IPs or use VNet integration for production security.

If you'd like, I can add the GitHub Actions workflow to the repository (already added) and help you set up the GitHub secrets; I cannot set secrets on your GitHub account from here.
