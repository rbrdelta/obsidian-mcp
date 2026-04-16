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

# Open deliverables by outcome
BACKLOG="$PROJECT_DIR/config/backlog_epics.json"
if [[ -f "$BACKLOG" ]]; then
  echo ""
  echo "--- Open Deliverables ---"
  node -e "
    const data = require('$BACKLOG');
    const open = data.deliverables.filter(d => d.status === 'open');
    for (const o of data.outcomes) {
      const items = open.filter(d => d.outcome === o.key);
      if (items.length === 0) continue;
      console.log('  ' + o.key + ': ' + o.name + ' (' + items.length + ' open)');
      items.slice(0, 3).forEach(d => console.log('    - ' + d.title));
      if (items.length > 3) console.log('    + ' + (items.length - 3) + ' more');
    }
  " 2>/dev/null || echo "(could not parse backlog)"
fi

echo ""
echo "=== End Context ==="
