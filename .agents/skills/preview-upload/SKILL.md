---
name: preview-upload
description: Put a rig page on its public preview link (GitHub Pages) for a reviewer, then upload it again without the lane marker once the review is in, with gh and this repo's preview workflow. Use when a plan reaches its preview or clean-up step.
---

# preview-upload

Puts one rig page on `https://<owner>.github.io/<repo>/` and later takes its lane marker off
(ADR 0003). `.github/workflows/preview.yml` runs rig on GitHub's runner, saves the page with
`curl` and deploys it as a Pages artifact, so the preview never sits in git history. Easiest with
`gh`, authenticated, in a shell this agent can run.

## Steps

1. Ask the human before the page goes public, and again before it goes up without the marker:
   what, why, where, who can see it, how to undo it.
2. First time in a repo: turn Pages on (built by a workflow) and store the marker as a secret,
   piped in from `.env`, never echoed:

   ```sh
   gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow
   grep '^LANE_MARKER=' .env | cut -d= -f2 | tr -d '\r' | gh secret set LANE_MARKER
   ```

3. Put the page up with the marker:

   ```sh
   gh workflow run preview.yml -f marker=true
   gh run watch <run id> --exit-status
   ```

4. Open the link the way the reviewer will, without a sign-in: `curl -s <link>` returns 200 and
   the banner shows the marker. Compare it with the same page from a local `pnpm start`.
5. Send the reviewer the link. The preview issue stays open until the reviewer has looked.
6. Review in: `gh workflow run preview.yml -f marker=false`, then check that the same link's
   banner reads "no marker set" (Pages caches for up to 10 minutes).
7. Clean up: `gh secret delete LANE_MARKER`, and delete the marked run's `github-pages` artifact:

   ```sh
   gh api repos/<owner>/<repo>/actions/runs/<run id>/artifacts --jq '.artifacts[].id'
   gh api -X DELETE repos/<owner>/<repo>/actions/artifacts/<id>
   ```

## Another page

The workflow saves `/digest/2026-10-28`. For another page, change the `curl` path in its
"Save" step, in that plan's preview issue.

## Don'ts

- Don't commit the saved HTML or attach it to an issue or a chat, and don't serve it from a Pages
  branch: the history keeps the marked copy (ADR 0003).
- Don't take the marker off, or close the preview issue, before the reviewer has looked.
