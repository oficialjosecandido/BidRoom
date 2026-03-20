#!/bin/bash
# Auto-select Angular serve configuration based on current git branch
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

case "$BRANCH" in
  ericeira-e2e)
    echo "📌 Branch: ericeira-e2e → using ericeira-e2e environment"
    exec ng serve --configuration=ericeira-e2e "$@"
    ;;
  ericeira-prod)
    echo "📌 Branch: ericeira-prod → using ericeira-prod environment"
    exec ng serve --configuration=ericeira-prod "$@"
    ;;
  ericeira)
    echo "📌 Branch: ericeira → using ericeira environment"
    exec ng serve --configuration=ericeira "$@"
    ;;
  *)
    echo "📌 Branch: $BRANCH → using default environment"
    exec ng serve "$@"
    ;;
esac
