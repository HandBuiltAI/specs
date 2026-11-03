# Account setup for the live app

These are the steps only Scott can do, because they need his accounts. Do them in this order. Each one takes a few minutes. Menu names move around now and then; if a label below doesn't match exactly, look for the nearest match.

Nothing here goes in the repo. The API key and the Turnstile secret key live only in Netlify's settings, never in a file, a commit, or a chat.

## 1. Claude Console: a separate workspace and key for the app

This keeps the live app's spending separate from your own testing, with its own hard limit.

1. Go to [platform.claude.com](https://platform.claude.com) and sign in.
2. Open **Settings**, then **Workspaces**, then **Create workspace**. Name it `specs-prod`.
3. Open the new `specs-prod` workspace and find **Limits** (sometimes under the workspace's settings). Set the **monthly spend limit** to `$20`. This is the guard that holds even if every guard in the app fails.
4. Still in Settings, open **API keys**, then **Create key**. Pick the `specs-prod` workspace, name the key `specs-netlify`, and create it.
5. Copy the key (it starts with `sk-ant-`). Keep the tab open; you'll paste it into Netlify in step 3, and the Console only shows it once. Don't paste it anywhere else.
6. Open **Settings**, then **Billing**. Check that **auto-reload is off** and that the prepaid credit balance is about `$20`. With auto-reload off, the worst case is losing that balance, never a surprise bill.

## 2. Cloudflare Turnstile: the bot check

Turnstile is the small "verify you're human" check that runs before a live session starts. It's free.

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up or sign in. You don't need to move any domain to Cloudflare.
2. In the left menu, open **Turnstile** (it may sit under **Application security** or **Protect & Connect**), then **Add widget**.
3. Name it `Specs`. Under **Hostnames**, add `specs.humanbuiltai.work`. Add the Netlify address too once you have it from step 3 (it looks like `something.netlify.app`); you can come back and add it later.
4. Leave the widget mode on **Managed**, and create it.
5. Cloudflare shows a **Site key** and a **Secret key**. Keep this tab open for step 3.

## 3. Netlify: host the app

1. Go to [app.netlify.com](https://app.netlify.com) and sign up with **GitHub**, so Netlify can see the repo.
2. Click **Add new project** (or **Add new site**), then **Import an existing project**, then **GitHub**.
3. When GitHub asks which repositories Netlify can see, choose **Only select repositories**, pick `HandBuiltAI/specs`, and save.
4. Back in Netlify, pick `specs`. Leave the branch as `main`. The build settings fill in from the repo's `netlify.toml` (build command `npm run build`, publish directory `.next`), so you don't need to change anything.
5. Before deploying, open **Add environment variables** on the same page if it's offered. If it isn't, deploy first and add them afterwards in **Project configuration**, then **Environment variables** (it may be called **Site configuration**).

Add each of these. For the two marked secret, tick **Contains secret values**, and set the scope to **Functions** only, so the build and the browser never see them.

| Key | Value | Secret? |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | The `sk-ant-` key from step 1 | Yes, Functions only |
| `TURNSTILE_SECRET_KEY` | The Turnstile **Secret key** from step 2 | Yes, Functions only |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | The Turnstile **Site key** from step 2. This one is meant to be public. | No |
| `GENERATION_ENABLED` | `true`. Set it to `false` any time to switch off every paid call (the kill switch). | No |
| `DAILY_SPEND_CAP_USD` | `1.50`. Generation closes for the day once this much has been spent. | No |
| `IP_HASH_SALT` | Any long random string; mash the keyboard for 30 or so characters. It scrambles visitors' IP addresses before they're stored for the rate limit. | Yes, Functions only |

6. Click **Deploy**. The first build takes a few minutes. When it's done, Netlify shows the address (`something.netlify.app`). Add that address to the Turnstile widget's hostnames (step 2.3).
7. **Any time you change an environment variable, redeploy** so the change takes effect: **Deploys**, then **Trigger deploy**, then **Deploy project**.

You can do this before the guard code is merged. Until it is, the deployed site is just the placeholder page.

## 4. Custom domain (can wait until launch)

1. In Netlify, open **Domain management**, then **Add a domain**, and enter `specs.humanbuiltai.work`.
2. Netlify shows a DNS record to add. Go to wherever `humanbuiltai.work`'s DNS is managed and add a **CNAME** record: name `specs`, value your `something.netlify.app` address.
3. Netlify issues the HTTPS certificate on its own once the record is live, usually within the hour.

## What to send back

Once it's deployed, paste the `something.netlify.app` address into the project thread. Don't paste any keys.
