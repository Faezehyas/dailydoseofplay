# Deploying

The owner's one-time setup on Wasmer Edge, and the addresses the site
answers on. Contributors don't need any of this: merging a PR into `main`
deploys it.

## Deploy on Wasmer Edge (one-time setup)

Deploys run through Wasmer's GitHub integration: every push to `main`
deploys. The repo holds no tokens or secrets, and nothing needs to be
configured besides the steps below. Wasmer's dashboard labels may change
slightly over time; the flow is the same.

1. **Merge the PR into `main`.**
2. **Sign in** at https://wasmer.io with the account that owns the `faezeh_yass` namespace.
3. **Create the app from the repository.**
   - In the dashboard choose **Deploy / Import from GitHub** (https://wasmer.io/new).
   - When asked, install or authorize the **Wasmer GitHub app** for the `Faezehyas` account. Granting access to just `dailydoseofplay` is enough.
   - Pick `Faezehyas/dailydoseofplay` and set the production branch to **`main`**.
   - Leave build settings empty. Wasmer reads `app.yaml` (name `dailydoseofplay`, owner `faezeh_yass`, region `fr-roub1`, a `/healthz` health check) and detects Node from `package.json` (`npm start`).
   - Click **Deploy**.

   If the dashboard only offers to connect Git to an **existing** app: deploy once from a checkout of `main`: install the CLI (`curl https://get.wasmer.io -sSfL | sh`, see https://docs.wasmer.io/install), run `wasmer login`, then `wasmer deploy --build-remote --non-interactive`. Then open the app in the dashboard → **Settings → Git** → choose **GitHub** → select `Faezehyas/dailydoseofplay` and branch `main` → **Save**. If the CLI writes `app_id` and `annotations:` into `app.yaml`, commit that change.
4. **Check the first build.** The log should show `Packaging project directory (N files…)` with N in the dozens (if N is 1 or 2 the upload was empty) and `Detected Node.js provider`. Then open https://dailydoseofplay.wasmer.app/healthz, which should return `{"ok":true,…}`.
5. **Alias `dailydoseofplay.wasmer.app`.** Every Wasmer app gets `<app-name>.wasmer.app`, and the app name is `dailydoseofplay`, so this URL is assigned automatically if no one else holds it. Check the URL shown on the app's dashboard page.
   - If it shows a suffixed URL (e.g. `dailydoseofplay-faezeh_yass.wasmer.app`), open the app → **Settings → Domains**, type `dailydoseofplay.wasmer.app`, click **Add** and follow the prompt.
   - If Wasmer refuses it, another account owns that alias. Keep the suffixed URL; the custom domain (next step) works either way.
6. **Add the custom domain.** Open the app → **Settings → Domains**, type `dailydoseofplay.com`, choose the option that adds `www.dailydoseofplay.com` and redirects the root domain to it, tick **Make this domain the default once verified**, and click **Add**.
   - Wasmer lists the DNS records to create. Add them at GoDaddy, which holds the domain: **Domain Portfolio** → `dailydoseofplay.com` → **DNS** → **DNS Records** → **Add New Record**. Today that is an `A` record for `@` and a `CNAME` for `www`, both pointing at Wasmer; copy the exact values from Wasmer's dialog.
   - Delete any `AAAA` record for `@` or `www`: Wasmer's docs say a stale one breaks verification.
   - Wait until Wasmer shows the domain as verified. It issues and renews the HTTPS certificate itself.
7. **Make the root redirect permanent (optional).** Wasmer only serves a root domain by redirecting it to `www`, and it answers with a temporary `307`. For a permanent `301`, let GoDaddy answer for the root instead:
   1. At GoDaddy: **Domain Portfolio** → `dailydoseofplay.com` → **DNS** → **Forwarding** → **Add Forwarding** → **Domain**.
   2. Choose `https://`, enter `www.dailydoseofplay.com`, choose **Permanent (301)**, and click **Save**. GoDaddy replaces and locks the `@` A record; leave the `www` CNAME pointing at Wasmer.
   3. Once DNS has updated (up to an hour, sometimes 48), run `curl -sI 'https://dailydoseofplay.com/ludo/?robot=1'`. Expect `301` and `location: https://www.dailydoseofplay.com/ludo/?robot=1`.
   4. If the check shows a certificate error, or the location drops `/ludo/?robot=1`, undo it: delete the forwarding, then put back the `@` A record from Wasmer's **Settings → Domains**.
   5. Wasmer may now mark `dailydoseofplay.com` as unverified. That is expected; keep the `www.dailydoseofplay.com` entry as it is.
8. **Smoke-test production.** Open the site in two browsers, play a friend match via the invite link, and play a robot game.

From then on, merging a PR into `main` deploys it. To roll back, pick an
earlier version on the app's **Versions** page.

## Domains

| Address | What it does |
|---|---|
| https://www.dailydoseofplay.com | The site. |
| https://dailydoseofplay.com | Redirects to `www`, keeping the path and query (step 7 above says who answers and with which code). |
| https://dailydoseofplay.wasmer.app | Wasmer's own address for the app. It serves the same site and keeps working, which helps when the custom domain has trouble. |
| `http://` on any of them | `308` to `https://` (Wasmer's default `force_https`). |

Domains are set in Wasmer's dashboard, not in `app.yaml`, and the `/healthz`
check doesn't depend on the domain. The lobby socket accepts pages from all
three addresses (`SITE_ORIGINS` in `server/app.js`).
