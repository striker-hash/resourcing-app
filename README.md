# Resourcing - simple CV upload and reporting

This is a minimal Node.js + Express app to upload CVs, filter candidates, and view simple reports.

Quick start

1. Install dependencies:

```bash
cd /Users/shubhavsharma/workspace/Resourcing
npm install
```

2. Start server:

```bash
npm start
```

Open http://localhost:3000

What it includes
- File upload endpoint: `POST /api/upload` (form field `cv` + fields `name, role, skills, seniority`)
- List and filter: `GET /api/candidates`
- Report: `GET /api/report`
- CV download: `GET /cv/:filename`

Persisted files
- Uploaded files are stored under `data/uploads`
- Simple JSON DB at `data/db.json`

Free hosting options (low cost / free tiers):

- Vercel: great for static frontends; can host the `public` site. For the API you'd need a serverless function—works but requires slight refactor.
- Render (free web services): can host this Node app directly (free instance with sleeping). Easy deploy with a GitHub repo.
- Railway: free tier with $5 credits/month shared; simple deploy from GitHub.
- Fly.io: small free allowances; can run the Node process directly.
- Heroku (free dynos discontinued in 2023): not recommended unless you have a paid plan.

Recommendation
- For minimum friction, push this repo to GitHub and use Render's free web service to deploy the Node server. It supports persistent file storage for small apps and maps environment variables.

Notes & Caveats
- This app uses disk storage (not suitable for multi-instance horizontally scaled deployments). For more robust storage, use S3 or a DB.
- Max upload size is 5MB per file; change in `server.js` if needed.
