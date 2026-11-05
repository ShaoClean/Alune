#!/usr/bin/env bash
# Keep the original failing run: collect its native stack, never retry the test.
# Raw cores may contain a gateway invitation. Keep them on the disposable runner.
set -eu
if [[ "${RUNNER_ENVIRONMENT:-}" != github-hosted ]]; then
  exec npm run test:agent-dev -w web
fi
cores=$(mktemp -d "${RUNNER_TEMP:?}/gateway-cores.XXXXXX")
original_pattern=$(cat /proc/sys/kernel/core_pattern)
cleanup() {
  sudo sysctl -q -w "kernel.core_pattern=$original_pattern"
  rm -rf -- "$cores"
}
trap cleanup EXIT
sudo sysctl -q -w "kernel.core_pattern=$cores/core.%e.%p"
ulimit -c unlimited
if npm run test:agent-dev -w web; then
  exit 0
else
  result=$?
fi
for dump in "$cores"/core.*; do
  [[ -f "$dump" ]] || continue
  if command -v gdb >/dev/null; then
    gdb -nx -batch -iex 'set auto-load off' -ex 'set print frame-arguments none' \
      -ex 'thread apply all bt 12' "$(command -v node)" "$dump" || true
  fi
done
exit "$result"
