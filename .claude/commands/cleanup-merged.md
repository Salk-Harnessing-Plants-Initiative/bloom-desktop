# Cleanup Merged Branch

Clean up a feature branch after PR is merged and archive completed OpenSpec proposals.

## Commands

### Step 1: Confirm the PR is actually merged

Never delete a branch before GitHub confirms the PR merged.

```bash
gh pr view <pr-number> --json state,mergedAt,headRefName
```

Proceed **only if** `"state": "MERGED"`. If it is `OPEN` or `CLOSED` (not merged), stop — do not delete the branch.

### Step 2: Switch to Main and Pull Latest

```bash
# Switch to main branch
git checkout main

# Pull latest changes (including your merged PR)
git pull origin main
```

### Step 3: Delete Local Feature Branch

```bash
# Delete local feature branch (use -D if branch wasn't fully merged locally)
git branch -d <branch-name>

# Or force delete if needed — only after Step 1 confirmed state == MERGED
git branch -D <branch-name>
```

On a **squash merge**, git prints `warning: the branch '<branch>' is not yet merged to HEAD` because the squashed commit is not an ancestor of `main`. The same warning also fires for a wrong/stale branch name or a local branch with extra unpushed commits — Step 1 confirming `state == MERGED` is necessary but not sufficient on its own. Before trusting `-D`, confirm the warning is actually the squash case:

```bash
git checkout main && git pull origin main
git log <branch-name> --not main --oneline
```

If this prints nothing (or only commits that were part of the merged PR), it's the expected squash-merge case — `-D` is safe. If it prints commits you don't recognize from the PR, stop — the branch has content `main` doesn't have, and force-deleting would lose it.

### Step 4: Delete Remote Feature Branch and Prune

```bash
# Delete remote branch (skip if GitHub already auto-deleted it on merge)
git push origin --delete <branch-name>

# Or using GitHub CLI (bash/zsh — no xargs equivalent in native Windows PowerShell,
# use the plain `git push origin --delete <branch-name>` form above there instead)
gh pr view <pr-number> --json headRefName --jq '.headRefName' | xargs -I {} git push origin --delete {}

# Prune the stale remote-tracking ref either way
git fetch --prune origin
```

### Step 5: Archive Completed OpenSpec Proposals

**CRITICAL**: You must be on the `main` branch (after pulling the merged PR) before archiving. Archiving on a feature branch will not update the base specs on main.

**CRITICAL**: Before archiving, verify ALL tasks in `tasks.md` are marked `- [x]` (complete). If any are `- [ ]` (incomplete), you MUST either complete them or mark them as done before archiving. **Never archive with incomplete tasks** — the `--yes` flag bypasses the warning but does not fix the problem. Incomplete tasks in an archive are a record of work that was claimed done but wasn't verified.

**How to check**: Read the `tasks.md` file and grep for `- [ ]`. If any exist, update them to `- [x]` (if the work was actually done) or finish the work first.

**Never use `--skip-specs`** unless the change is purely tooling-only (no spec deltas). All changes with spec deltas must have their specs applied during archiving.

**Dependency order**: When archiving multiple changes that modify the same capability specs, archive them in dependency order — parent/base changes first, then changes that build on them. For example, if `add-feature` introduces a requirement and `fix-feature` modifies it, archive `add-feature` first so the base spec exists before `fix-feature` tries to modify it.

```bash
# List active proposals
npx openspec list

# BEFORE archiving: verify all tasks complete
grep -c '\- \[ \]' openspec/changes/<change-id>/tasks.md
# If count > 0, read tasks.md and mark completed tasks as [x]

# Archive each completed proposal (in dependency order)
npx openspec archive <change-id> --yes

# Example (dependency order matters):
npx openspec archive add-browse-scans --yes
npx openspec archive fix-code-review-findings --yes    # depends on specs from add-browse-scans
npx openspec archive fix-copilot-review-findings --yes
```

### Step 6: Verify Archives

```bash
# List archived proposals
ls -la openspec/changes/archive/

# Verify no validation errors
npx openspec validate --strict
```

## Complete Cleanup Script

**This is a convenience wrapper around Steps 1-6 above — it does not skip the safety gate.** Supply the PR number explicitly; do not auto-detect it with `gh pr list --state merged --limit 1`, which picks whichever PR _anywhere in the repo_ merged most recently and may not be the one you mean to clean up.

```bash
# 1. Set the PR number explicitly (caller-supplied, not auto-detected)
PR_NUMBER=<pr-number>

# 2. Gate: confirm this specific PR is actually merged before anything destructive
STATE=$(gh pr view "$PR_NUMBER" --json state --jq '.state')
if [ "$STATE" != "MERGED" ]; then
  echo "PR #$PR_NUMBER is not merged (state: $STATE) — aborting, no branch will be deleted"
  exit 1
fi
BRANCH_NAME=$(gh pr view "$PR_NUMBER" --json headRefName --jq '.headRefName')
echo "Cleaning up PR #$PR_NUMBER (branch: $BRANCH_NAME)"

# 3. Switch to main and update
git checkout main
git pull origin main

# 4. Disambiguate the squash-merge warning before force-deleting (see Step 3 above)
git log "$BRANCH_NAME" --not main --oneline

# 5. Delete local branch (only after step 4 confirms no unrecognized commits)
git branch -D "$BRANCH_NAME"

# 6. Delete remote branch
git push origin --delete "$BRANCH_NAME"
git fetch --prune origin

# 7. Archive OpenSpec proposals — reuse Step 5's task-completeness check per change,
#    do NOT blind-loop over every active change (skips the incomplete-tasks guard
#    and ignores dependency order between changes)
npx openspec list
# For each change_id above: verify tasks.md has no remaining `- [ ]`, then:
#   npx openspec archive <change-id> --yes

# 8. Verify
npx openspec validate --strict
git status
```

## Manual Cleanup (Step by Step)

If you prefer to do it manually:

### 1. Identify Branch and Confirm It's Merged

```bash
# View recently merged PRs
gh pr list --state merged --limit 5

# Get branch name AND state from the specific PR — do not skip the state check
gh pr view <pr-number> --json state,headRefName
```

Proceed only if `state` is `MERGED`. If it's anything else, stop.

### 2. Update Main

```bash
git checkout main
git pull origin main

# Verify your changes are in main
git log --oneline -10
```

### 3. Clean Up Branch

```bash
# Delete local branch
git branch -d <branch-name>

# If branch wasn't merged locally (force delete) — only after step 1 confirmed
# state == MERGED, and after disambiguating the warning (see Step 3 in "Commands" above):
#   git log <branch-name> --not main --oneline
git branch -D <branch-name>

# Delete remote branch
git push origin --delete <branch-name>
```

### 4. Archive OpenSpec

```bash
# See what needs archiving
npx openspec list

# Archive each proposal
npx openspec archive <change-id>

# Verify archives created
ls openspec/changes/archive/
```

### 5. Commit Archives

```bash
# Stage archive changes
git add openspec/

# Commit
git commit -m "chore: Archive completed OpenSpec proposals

Archived proposals:
- <change-id-1>
- <change-id-2>
- <change-id-3>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"

# Push to main
git push origin main
```

## What Gets Archived

When you run `openspec archive <change-id>`, OpenSpec:

1. **Moves proposal** from `openspec/changes/<change-id>/` to `openspec/changes/archive/<date>-<change-id>/`
2. **Copies specs** from `openspec/changes/<change-id>/specs/` to `openspec/specs/` (if not already there)
3. **Updates spec purpose** with archive date and change reference
4. **Preserves history** - all proposal documents, tasks, and design docs

## Troubleshooting

### "Branch not fully merged"

**Error**: `error: The branch '<branch>' is not fully merged.`

**Cause**: Usually a squash merge (different commit SHAs than `main`) — but can also mean the branch has content `main` doesn't have.

**Solution**: Do not force-delete on this warning alone. First confirm the PR is merged (Step 1) and disambiguate the warning (Step 3's `git log <branch-name> --not main --oneline` — empty or only-PR-commits output means it's safe):

```bash
git branch -D <branch-name>
```

### "Remote ref does not exist"

**Error**: `error: unable to delete '<branch>': remote ref does not exist`

**Cause**: Branch already deleted on remote (GitHub auto-deletes on merge)

**Solution**: Skip remote deletion, only delete local

```bash
git branch -D <branch-name>
```

### OpenSpec archive fails

**Error**: `Change '<change-id>' not found`

**Cause**: Change ID doesn't match directory name

**Solution**: List changes and use exact ID

```bash
# List exact change IDs
npx openspec list

# Use exact ID from list
npx openspec archive <exact-id>
```

### "Modified specs/ files"

**Issue**: After archiving, `openspec/specs/` has changes

**Explanation**: OpenSpec copied/updated specs from the change

**Solution**: Commit the changes

```bash
git add openspec/
git commit -m "chore: Archive OpenSpec proposals"
git push origin main
```

## GitHub CLI Shortcuts

```bash
# View recently merged PRs with details
gh pr list --state merged --limit 5 --json number,title,headRefName

# Get branch name from most recent merged PR
gh pr list --state merged --limit 1 --json headRefName --jq '.[0].headRefName'

# View PR that was just merged
gh pr view --web
```

## Related Commands

- `/pr-description` - Template used before merge
- `/review-pr` - Checklist used during review
- `/update-changelog` - Update changelog after merge

## Best Practices

1. **Always archive on main** — switch to main and pull before archiving (never archive on feature branches)
2. **All tasks must be complete before archiving** — read `tasks.md` and verify every checkbox is `[x]`. Mark done tasks that were missed, finish incomplete work, or explicitly note why a task was deferred (with a GitHub issue link)
3. **Never skip specs** — only use `--skip-specs` for tooling-only changes with zero spec deltas
4. **Archive in dependency order** — parent changes before children that modify the same specs
5. **Archive OpenSpec proposals promptly** (within a day of merge)
6. **Verify archives** with `openspec validate --specs`
7. **Commit archive changes** to main branch and push
8. **Keep main clean** - delete stale branches regularly

## Post-Cleanup Verification

After cleanup, verify:

- [ ] `gh pr view <n> --json state` showed `MERGED` before any branch deletion
- [ ] Local branch deleted: `git branch` doesn't show old branch
- [ ] Remote branch deleted and pruned: `git branch -r` doesn't show origin/branch
- [ ] Main is up to date: `git status` shows "up to date with origin/main"
- [ ] OpenSpec proposals archived: `openspec list` shows no active changes
- [ ] Specs updated: New specs in `openspec/specs/` (if applicable)
- [ ] Archive committed: No uncommitted changes in `openspec/`
