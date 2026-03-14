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

## Part 2 — Run the Provisioning Script

The repo already contains the script. In Cloud Shell:

```bash
# Pull latest code
cd resourcing-app && git pull origin main

# Edit the 3 variables at the top (LOCATION, PG_PASS, ADMIN_PASS)
nano scripts/provision-azure.sh
```

Save and exit nano: `Ctrl+O` → `Enter` → `Ctrl+X`

Then run it:
```bash
bash scripts/provision-azure.sh
```

The script takes ~5 minutes. At the end it prints:
- Your **app URL** and **login credentials**
- The **`AZURE_WEBAPP_NAME`** value
- The **Publish Profile XML** — copy everything between the `=` line and the closing border

---

## Part 3 — Add GitHub Secrets

1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add these two secrets using the values printed by the script:

   | Secret Name | Value |
   |-------------|-------|
   | `AZURE_WEBAPP_NAME` | printed as `AZURE_WEBAPP_NAME = resourcing-app-xxxxxx` |
   | `AZURE_WEBAPP_PUBLISH_PROFILE` | the full XML block printed at the end of the script |

---

## Part 4 — Deploy

Push to `main` — GitHub Actions deploys automatically:

```bash
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
