# Cleanup Branch After Merge

Clean up a feature branch after PR is merged and archive completed OpenSpec proposals.

## Commands

### Step 1: Switch to Main and Pull Latest

```bash
# Switch to main branch
git checkout main

# Pull latest changes (including your merged PR)
git pull origin main
```

### Step 2: Delete Local Feature Branch

```bash
# Delete local feature branch (use -D if branch wasn't fully merged locally)
git branch -d <branch-name>

# Or force delete if needed
git branch -D <branch-name>
```

### Step 3: Delete Remote Feature Branch

```bash
# Delete remote branch
git push origin --delete <branch-name>

# Or using GitHub CLI
gh pr view <pr-number> --json headRefName --jq '.headRefName' | xargs -I {} git push origin --delete {}
```

### Step 4: Archive Completed OpenSpec Proposals

```bash
# List active proposals
npx openspec list

# Archive each completed proposal
npx openspec archive <change-id>

# Example:
npx openspec archive fix-integration-test-ci-failures
npx openspec archive optimize-ci-build-pipeline
npx openspec archive add-claude-commands
```

### Step 5: Verify Archives

```bash
# List archived proposals
ls -la openspec/changes/archive/

# Verify no validation errors
npx openspec validate --strict
```

## Complete Cleanup Script

For a recently merged PR, run this complete sequence:

```bash
# 1. Get PR number and branch name
PR_NUMBER=$(gh pr list --state merged --limit 1 --json number --jq '.[0].number')
BRANCH_NAME=$(gh pr view $PR_NUMBER --json headRefName --jq '.headRefName')

echo "Cleaning up PR #$PR_NUMBER (branch: $BRANCH_NAME)"

# 2. Switch to main and update
git checkout main
git pull origin main

# 3. Delete local branch
git branch -D "$BRANCH_NAME"

# 4. Delete remote branch
git push origin --delete "$BRANCH_NAME"

# 5. Archive OpenSpec proposals (if any exist)
# List and archive each proposal manually or with script:
for change_id in $(npx openspec list --json | jq -r '.[].id'); do
  echo "Archiving $change_id..."
  npx openspec archive "$change_id"
done

# 6. Verify
npx openspec validate --strict
git status
```

## Manual Cleanup (Step by Step)

If you prefer to do it manually:

### 1. Identify Branch

```bash
# View recently merged PRs
gh pr list --state merged --limit 5

# Get branch name from specific PR
gh pr view <pr-number> --json headRefName
```

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

# If branch wasn't merged locally (force delete)
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

**Cause**: Git doesn't recognize the branch as merged (different commit SHAs due to squash merge)

**Solution**: Use force delete

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
- `/changelog` - Update changelog after merge

## Best Practices

1. **Always pull main first** before deleting branches (ensure you have merged changes)
2. **Archive OpenSpec proposals promptly** (within a day of merge)
3. **Verify archives** with `openspec validate --strict`
4. **Commit archive changes** to main branch
5. **Keep main clean** - delete stale branches regularly

## Post-Cleanup Verification

After cleanup, verify:

- [ ] Local branch deleted: `git branch` doesn't show old branch
- [ ] Remote branch deleted: `git branch -r` doesn't show origin/branch
- [ ] Main is up to date: `git status` shows "up to date with origin/main"
- [ ] OpenSpec proposals archived: `openspec list` shows no active changes
- [ ] Specs updated: New specs in `openspec/specs/` (if applicable)
- [ ] Archive committed: No uncommitted changes in `openspec/`
