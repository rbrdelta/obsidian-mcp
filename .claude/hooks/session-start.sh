#!/bin/bash

# Session-start hook: loads active context so each session starts with
# the "connective tissue" — current branch, recent work, active epics.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
cd "$PROJECT_DIR" 2>/dev/null || exit 0

echo "=== Session Context ==="

# Current branch
branch=$(git branch --show-current 2>/dev/null)
if [[ -n "$branch" ]]; then
  echo "Branch: $branch"
fi

# Uncommitted state
if ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null; then
  echo "WARNING: Uncommitted changes present"
fi

# Recent commits on this branch (last 5)
echo ""
echo "--- Recent commits ---"
git log --oneline -5 2>/dev/null || echo "(no commits)"

# Active tier-1 epics from backlog
BACKLOG="$PROJECT_DIR/config/backlog_epics.json"
if [[ -f "$BACKLOG" ]]; then
  echo ""
  echo "--- Active Tier 1 Epics ---"
  # Extract tier-1 epic names and their why
  node -e "
    const data = require('$BACKLOG');
    data.epics
      .filter(e => e.tier === '1')
      .slice(0, 8)
      .forEach(e => console.log('  ' + e.key + ': ' + e.why));
  " 2>/dev/null || echo "(could not parse backlog)"
fi

echo ""
echo "=== End Context ==="
