# Runbook: retire the realtime relay

Written for an agent to follow, one section at a time. It moves a production deployment off the Bun WebSocket relay
(`server/`, hosted on Railway): boat positions, chat, the roster and the online count all run on Convex after this.
No data moves and nobody is signed out.

If the deployment is still on Convex Auth v1, follow `MIGRATING_AUTH_V2.md` instead. It ships this change in the same
sitting, and this runbook is not needed.

What players notice afterwards:
- Other boats update twice a second (the relay sent ten a second) and are drawn about 0.4 s in the past.
- A sailor who closes the tab disappears at once. One whose browser crashes, or who leaves the tab in the background,
  disappears after 30 to 45 seconds.

## Rules for the agent

- **Each section is marked** `READ-ONLY` (run it freely), `PROD WRITE` (changes production) or `PERSON` (the person
  does it). Before every `PROD WRITE` section, show the person the exact command and wait for a clear yes. One yes
  covers one section.
- **Stop at the first failed check.** Report what you ran and its output, and do nothing else. Don't retry with other
  flags, don't skip ahead, and never roll back on your own.
- **The deploy key comes from the person.** They export `CONVEX_DEPLOY_KEY` in the shell themselves. Never ask for it
  in chat, print it, write it to a file or commit it. Every `bunx convex` command below then targets that deployment.
- **Never print secret values.** List env vars with `--names-only` only.
- **Never create accounts, sign in or send chat on production.** The person does the in-game checks.
- **Run from the repo root.**

## 0. Preflight `READ-ONLY`

Each check must pass before you go on.

1. The working tree is clean, on `main`, and the relay is gone from it:
   ```bash
   git status --porcelain --untracked-files=no   # must print nothing
   test ! -e server && test ! -e src/relay.ts && echo ok
   ```
2. The code builds and the tests pass:
   ```bash
   bun install --frozen-lockfile && bun run typecheck && bun run test
   ```
3. The key is set and points at the deployment the live game uses:
   ```bash
   test -n "$CONVEX_DEPLOY_KEY" && echo key-set
   grep VITE_CONVEX_URL deploy/Dockerfile
   ```
   Show the person the deployment name in the key prefix (`prod:<name>|…`, print only the part before `|`) next to
   the URL from the Dockerfile, and have them confirm it's the right one.
4. Find out where the deployment stands:
   ```bash
   bunx convex function-spec | grep -c legacySignIn        # must be 1 or more (0: use MIGRATING_AUTH_V2.md)
   bunx convex function-spec | grep -c '"chat.js:send"'    # 0: relay still in use. 1: backend already moved
   bunx convex env list --names-only
   ```
   - `AI_GATEWAY_API_KEY` should be in the list: chat is filtered on Convex now (it used to be on the relay). If it's
     missing, tell the person: chat still works, but only the local word filter runs until they set it.
   - Backend already moved: skip section 1 and continue from section 2.

## 1. Deploy the backend `PROD WRITE`

This adds the `aboard` table and the chat functions, removes the two `/relay/*` HTTP routes, and runs the stale-boat
sweep every 15 seconds. Until section 2 is done, players on the old client keep sailing through the relay, but their
chat lines are no longer recorded and the title screen's online count reads 0. Tell the person section 2 should
follow within minutes.

```bash
bunx convex deploy
```

Check:
```bash
bunx convex function-spec | grep -cE '"(chat.js:send|chat.js:recent|sea.js:everyone)"'   # must print 3
```

## 2. Deploy the web client, then stop the relay `PERSON`

The client is hosted outside this repo (Railway, or `deploy/Dockerfile`), so the person deploys it from `main`. It
needs no new env vars, and `VITE_RELAY_URL` is no longer read.

Once the client is live, they stop the relay service on Railway. Order matters: players with an old tab still open
are on the relay and can't see players on the new client. Stopping the relay moves those old tabs onto Convex for
boats (their chat stays off until they reload). Wait until the person says both are done.

## 3. Verify `READ-ONLY`

The live page no longer allows connections to the relay (ask the person for the game's address):
```bash
csp=$(curl -fsSI https://<the game's address>/ | grep -i '^content-security-policy:') && echo "$csp" | grep -c relay   # must print 0
```
If it prints nothing, the request failed or the page has no Content-Security-Policy header: that is a failed check,
not a pass.

Then ask the person to check in the live game with two browsers:
- Each sees the other's boat, and it follows when the other sails.
- Chat lines arrive both ways, and the chat header lists both names.
- Closing one tab makes that boat and name disappear from the other within a couple of seconds.

After they have sailed for a minute, the online count is being kept:
```bash
bunx convex run leaderboard:online   # must print a number of 1 or more while someone is sailing
```

## 4. Clean up `PROD WRITE`, and the rest for the `PERSON`

Only after section 3 passes and the person says the relay is staying off.

The backend no longer reads the relay's shared secret:
```bash
bunx convex env list --names-only | grep -c '^RELAY_SECRET$'   # 1: remove it. 0: nothing to do
bunx convex env remove RELAY_SECRET
```

The person then deletes the relay service on Railway (with its `CONVEX_URL`, `CONVEX_SITE_URL`, `RELAY_SECRET` and
`ALLOWED_ORIGINS` variables) and removes `VITE_RELAY_URL` from the web client's build variables.

## Rollback `PERSON ONLY`

An agent never does this. Rolling back means starting the relay again and redeploying the commit before this change
to the backend and the client. No data is lost: saves, accounts and recorded chat are untouched, and the leftover
`aboard` table is harmless. Do it before section 4; after it, the relay needs `RELAY_SECRET` set again on both sides.
