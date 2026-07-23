Find and display all GitHub Copilot inline review comments on the current branch's pull request, then offer to address them.

## Step 1: Find the PR

```bash
BRANCH=$(git branch --show-current)
gh pr list --state open --head "$BRANCH"
```

If no PR exists, inform the user and exit — create one with `/pr-description` first.

## Step 2: Get PR Number

Extract the PR number from the list output.

## Step 3: Fetch Copilot Review via GraphQL

Resolve the repo dynamically — never hardcode the owner/name:

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

gh api graphql -f query='
query {
  repository(owner: "'"${REPO%%/*}"'", name: "'"${REPO##*/}"'") {
    pullRequest(number: <PR_NUMBER>) {
      reviews(first: 10) {
        nodes {
          author { login }
          body
          comments(first: 50) {
            nodes { path line body diffHunk }
          }
        }
      }
    }
  }
}' --jq '.data.repository.pullRequest.reviews.nodes[] | select(.author.login | contains("opilot")) | .comments.nodes[] | "File: \(.path):\(.line)\n\(.body)\n" + ("="*80)'
```

### Alternative: REST API

```bash
gh api repos/$REPO/pulls/<PR_NUMBER>/comments --jq '.[] | "File: \(.path):\(.line // .original_line)\n\(.body)\n" + ("="*80)'
```

- GitHub Copilot inline comments come from user **"Copilot"**.
- Review summaries come from **"copilot-pull-request-reviewer[bot]"**.
- GraphQL fetches both review body and inline comments in one call; REST requires separate calls for reviews vs. comments.

## Step 4: Parse Copilot Comments

From the response, extract:

- Reviews where `author.login` matches Copilot
- `body` — the overview, which may contain a "Comments suppressed due to low confidence" note
- Inline comments, each with `path`, `body`, and `diffHunk`

## Step 5: Categorize

Organize all Copilot feedback into priority tiers:

1. **High Priority** — bugs, type errors, security issues, process-boundary violations (renderer/main/Python)
2. **Medium Priority** — code quality, maintainability, best practices
3. **Low Priority / Informational** — style suggestions, optimizations, low-confidence notes

## Step 6: Display Formatted Summary

```markdown
# GitHub Copilot Review for PR #<N>

**Branch**: <branch-name>
**PR Title**: <title>
**Repo**: <owner>/<repo>

## Overview

[Copilot's general PR overview comment]

## High Priority Issues (<count>)

1. **File**: path/to/file:42
   - **Issue**: Description of the problem
   - **Suggestion**: What Copilot recommends
   - **Confidence**: High / Medium / Low
   - **Status**: Open / Fixed in <commit>

## Medium Priority Suggestions (<count>)

[Same format]

## Low Priority / Informational (<count>)

[Same format]

## Summary

- Total comments: <N>
- High priority: <N>
- Medium priority: <N>
- Low priority / informational: <N>

## Recommended Actions

- [Specific tasks to address the feedback]
```

## Step 7: Offer to Address

After displaying the summary, ask the user:

```
Would you like me to:
1. Address all high-priority issues now
2. Create a plan to address specific issues
3. Explain any of these suggestions in detail
4. Mark low-confidence suggestions as reviewed (document why they're being skipped)
```

## Edge Cases

- **No Copilot comments** — report "No GitHub Copilot comments found on this PR."
- **PR not found** — suggest creating a PR via `/pr-description` first.
- **Multiple open PRs for this branch** — list all and ask which to check.
- **Copilot not enabled** — inform the user that Copilot reviews aren't enabled for this repo.

## Best Practices

- Always run this before requesting human review.
- Address high-confidence suggestions promptly.
- Evaluate low-confidence suggestions carefully — they may be false positives.
- When ignoring a suggestion, document why in the PR or a code comment.

## Integration with Pre-Merge Checks

This command runs as part of `/pre-merge` (Phase 8: Review Feedback) to ensure all Copilot feedback is addressed before merging.

## Related Commands

- `/review-pr` - adversarial multi-lens PR review (includes a Copilot check pass)
- `/pre-merge` - full pre-merge gate (includes this command)
- `/ci-debug` - debug CI failures that Copilot may have flagged
