# Runbook: move a production deployment to Convex Auth v2

Written for an agent to follow, one section at a time. It takes a deployment from Convex Auth v1 to the v2 code
(commit `7b15f15` or later). The backend, the relay (`server/`) and the web client each change how they sign in or
check tokens, so all three must ship in the same sitting. Players see a few minutes of failed sign-ins in between.
Afterwards everyone is signed out once, new passwords need at least 10 characters, and every account keeps its user id
(and with it its save, records and islands).

## Rules for the agent

- **Each section is marked** `READ-ONLY` (run it freely), `LOCAL` (writes only on this machine) or `PROD WRITE`
  (changes production). Before every `PROD WRITE` section, show the person the exact command and wait for a clear yes.
  One yes covers one section.
- **Stop at the first failed check.** Report what you ran and its output, and do nothing else. Don't retry with other
  flags, don't skip ahead, and never roll back on your own.
- **The deploy key comes from the person.** They export `CONVEX_DEPLOY_KEY` in the shell themselves. Never ask for it
  in chat, print it, write it to a file or commit it. Every `bunx convex` command below then targets that deployment.
- **Never print secret values.** List env vars with `--names-only` only.
- **Run from the repo root.**

## 0. Preflight `READ-ONLY`

Each check must pass before you go on.

1. The working tree is clean, on `main`, and includes the v2 commit:
   ```bash
   git status --porcelain --untracked-files=no   # must print nothing
   git merge-base --is-ancestor 7b15f15 HEAD && echo ok
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
   bunx convex function-spec | grep -c legacySignIn   # 0: still on v1. 1 or more: backend already on v2
   bunx convex env list --names-only
   ```
   - On v1 with no `AUTH_PRIVATE_KEY`/`AUTH_JWKS`: start at section 1.
   - Backend already on v2: skip sections 2–3. Run section 4's check and continue from there.

## 1. Back up `LOCAL`

```bash
bunx convex export --path ./backup-before-auth-v2.zip
ls -lh ./backup-before-auth-v2.zip   # must exist and be larger than a few KB
```

This is the only way back once accounts have moved (see Rollback). Tell the person where it is, and that it holds
password hashes and emails, so it mustn't be committed or shared.

## 2. Set the signing keys `PROD WRITE`

The setup CLI has no `--prod` flag. It writes to whichever deployment `CONVEX_DEPLOY_KEY` points at. It leaves keys
that are already set alone, and skips `convex/` files that already exist.

```bash
bunx @convex-dev/auth
```

Check:
```bash
bunx convex env list --names-only | grep -cE '^(AUTH_PRIVATE_KEY|AUTH_JWKS)$'   # must print 2
git status --porcelain --untracked-files=no                                     # must print nothing
```

## 3. Deploy the backend `PROD WRITE`

Once this finishes, the old relay and the old client stop working. Tell the person that sections 4 and 5 should follow
within minutes.

```bash
bunx convex deploy
```

Check:
```bash
bunx convex function-spec | grep -c legacySignIn   # must be 1 or more
```

## 4. Reserve the old emails `PROD WRITE`

Until this finishes, every new sign-up is refused, because an old account's email would otherwise look free and its
owner could be locked out (`convex/users.ts`). It runs in batches of 100 and schedules the next batch itself, so it's
safe to run again.

```bash
bunx convex run legacyAccounts:reserveEmails
```

Check that no old password account is left unreserved. Wait a few seconds and run it again until it prints
`0 unreserved`:
```bash
bunx convex data authAccounts --limit 10000 --format jsonArray \
  | bun -e 'const a = await Bun.stdin.json(); console.log(a.length, "rows,", a.filter(r => r.provider === "password" && !r.reserved).length, "unreserved")'
```
10000 is the most `convex data` returns. If it prints `10000 rows`, the check can't see every account: stop and tell
the person.

Old accounts whose emails differ only by letter case can't all be reserved. The function logs a warning for each one
(`legacy account of user … not reserved`), and those players can't move. Ask the person to look for that line in the
dashboard logs.

## 5. Deploy the relay and the web client `PERSON`

They're hosted outside this repo (Railway, or `deploy/Dockerfile`), so the person deploys them. Neither needs new env
vars; the relay now fetches keys from `<CONVEX_SITE_URL>/auth/.well-known/jwks.json`. Wait until they say both are live.

## 6. Verify `READ-ONLY`

```bash
SITE=https://<deployment>.convex.site
curl -fsS "$SITE/auth/.well-known/jwks.json" | grep -c '"kty"'   # must be 1 or more
```

Then ask the person to check in the live game (an agent must not create accounts or type passwords into production):
- Playing as a guest works, and so does creating a new account.
- An old account signs in with its old password (it moves over at that point), then again with no extra step.
- Sailing with a second player works. If it doesn't, the relay is still on the old build.

## 7. Clean up later `LOCAL`, then a pull request

Only when the person says it's time, weeks after the switch. See how many accounts haven't moved:
```bash
bunx convex data authAccounts --limit 10000 --format jsonArray \
  | bun -e 'const a = await Bun.stdin.json(); console.log(a.filter(r => r.provider === "password").length, "not moved")'
```

Once the ones left are accounts nobody will come back for, on a new branch, delete `convex/legacyAccounts.ts`,
`convex/legacySignIn.ts`, `tests/legacySignIn.test.ts`, the `authAccounts` table in `convex/schema.ts`, the
`legacySignIn` rate limit (`convex/lib.ts`, `convex/limits.ts`), the check in `convex/users.ts` and the migrate call in
`src/net.ts`. Run typecheck and tests, then open a pull request. Deploying it is section 3 again.

Clearing v1's leftover tables (`authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`,
`authRateLimits`) and env vars (`JWT_PRIVATE_KEY`, `JWKS`) is for the person to do in the dashboard. It's what makes
rollback impossible.

## Rollback `PERSON ONLY`

An agent never does this. Rolling back means redeploying `ea68123` to all three parts, and it loses data: every
account that moved has had its v1 row deleted, so those players can't sign in on v1 again. Getting them back in
takes the backup from section 1. Roll back only if a problem shows up before many people have signed in.
