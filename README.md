# Sydex

Sydex is an independent real-time messaging app. It does not use WhatsApp servers, APIs, or code.

## Current features

Sydex provides email-only OTP sign-in, profiles and privacy settings, linked-device management, an email-based registered-user directory, one-to-one and group text conversations, persistent message history, and real-time message delivery over Socket.IO.

### Prerequisites

- Node.js 20.19+ or 22.13+ and npm
- Docker Desktop (for local MongoDB and Redis), or reachable MongoDB/Redis instances
- A Resend API key and verified sender domain for production email OTP

### Run locally

In PowerShell:

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run dev
```

The server loads the root `.env` file even when npm starts it from the `server` workspace.
The client is served at `http://localhost:5173` (or the next available Vite port); the versioned API is at `http://localhost:4000/api/v1`. Localhost dev origins are allowed if Vite picks another port. In development, the mock email provider writes the OTP to the server log. For real email, set `EMAIL_OTP_PROVIDER=resend`, `RESEND_API_KEY`, and `EMAIL_FROM` in `.env`. The sender address must be verified in Resend for production delivery. Production refuses to start with the mock provider.

### Local service troubleshooting

- Redis must be running at `REDIS_URL` for OTP caching and rate limits. Start it with `docker compose up -d redis` if Docker is installed, or point `REDIS_URL` at a reachable Redis server.
- MongoDB must be reachable at `MONGODB_URI`. For local development, use `mongodb://127.0.0.1:27017/sydex` and start it with `docker compose up -d mongo`; for Atlas SRV lookup errors, verify the cluster hostname and check DNS, VPN, and network access.
- If Vite reports that port 5173 is occupied, use the alternate URL printed in its output (for example `http://localhost:5174/`) or stop the existing Vite process.

Set `COOKIE_SECURE=true` when serving the API over HTTPS. Keep both JWT secrets private and use unique, randomly generated values of at least 32 characters.

### Deploy to Vercel and Render

The repository includes a Vercel SPA/build config and a Render Blueprint for the API and Redis-compatible Key Value service.

1. Push the repository to GitHub, then create a Render Blueprint from the repository using `render.yaml`.
2. When prompted, set `MONGODB_URI` to a production MongoDB Atlas URI, `CLIENT_ORIGIN` to the exact Vercel production origin (for example `https://sydex.vercel.app`), `RESEND_API_KEY` to your Resend key, and `EMAIL_FROM` to a sender address verified in Resend. Render generates the JWT secrets and connects its Key Value service as `REDIS_URL`.
3. Deploy the Vercel project from the repository root. Set `VITE_API_URL` to `https://<render-service>.onrender.com/api/v1`, then redeploy so Vite includes the API URL in the client build.
4. If the Vercel production domain was not known when Render was first configured, update Render's `CLIENT_ORIGIN` to the final exact origin and redeploy the API.
5. Open the Vercel site, request an email code, sign in, then check chat and calling from two browsers.

The default Render/Vercel domains are cross-site, so the Blueprint sets the refresh cookie to `SameSite=None; Secure`. Some browsers restrict third-party cookies. For more reliable sessions, attach custom domains under the same site (for example `app.example.com` and `api.example.com`) and set `COOKIE_SAME_SITE=lax` on Render. The Render free web service sleeps when idle, and its free Key Value service is in-memory only; use paid plans for always-on service and persistent Redis data.

### Verify

```powershell
npm test
npm run build
```

Manual smoke test:

1. Open the client and enter an email address.
2. Read the development email OTP from the server log (or check the inbox when Resend is configured) and enter it. The API creates the account after successful email verification. Existing legacy accounts without an email must be migrated before they can sign in with this flow.
3. Open **Start a conversation** to message a registered user, or use **＋** to create a group with at least two other users.
4. Send messages from separate signed-in browsers and confirm they arrive without refreshing.
5. Open Settings to update the profile and privacy options, manage linked devices, or sign out.
6. Try an invalid email address and verify the API rejects it without issuing an OTP.

### Phase 1 API

- `POST /api/v1/auth/request-otp` — request an email verification code
- `POST /api/v1/auth/verify-otp` — verify the email code and establish a session
- `POST /api/v1/auth/refresh` — rotate the refresh token and issue an access token
- `POST /api/v1/auth/logout` and `POST /api/v1/auth/logout-all` — revoke sessions
- `GET /api/v1/auth/sessions` and `DELETE /api/v1/auth/sessions/:id` — manage linked sessions
- `GET /api/v1/profile` and `PATCH /api/v1/profile` — retrieve/update profile and privacy
- `GET /api/v1/users` — list registered users (optional `search` query)
- `GET /api/v1/users/lookup?email=person@example.com` — find a registered user by email address
- `GET /api/v1/conversations`, `POST /api/v1/conversations/direct`, and `POST /api/v1/conversations/groups` — list or create conversations
- `GET /api/v1/conversations/:id/messages` and `POST /api/v1/conversations/:id/messages` — read/send text messages

The authenticated Socket.IO endpoint delivers `chat:message` and `chat:conversation` updates to conversation members.

The refresh token is stored only in a `HttpOnly`, `SameSite=Lax` cookie; access tokens remain in client memory. MongoDB stores passwordless user profiles, their unique email addresses, and bcrypt-hashed refresh tokens. OTPs are stored in Redis with a short TTL and consumed after successful verification. Profile photo URLs are accepted now; uploads are part of the media phase.

## Repository layout

```text
client/    React 18, Vite, TypeScript, Tailwind, Zustand, React Query
server/    Express, TypeScript, Mongoose, Redis, auth/profile API
shared/    Shared client/server contracts
docker-compose.yml
```
