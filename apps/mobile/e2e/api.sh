#!/usr/bin/env bash
# `bash apps/mobile/e2e/api.sh <stop|start>`: takes the run's API away and brings it back, for
# the one check that needs a server that is gone while the device is online (e2e/run.ts,
# `--kept`). CI's Android job alone: the API is the binary the job built into `RUNNER_TEMP`
# and started itself (.github/workflows/ci.yml, "Start the API where the emulator reaches
# it"), and `start` starts it again exactly so, for the suite's flows that sign in and the
# steps after them, which ask it what the device left. The four settings are that step's:
# change them there and here.
set -euo pipefail

binary="${RUNNER_TEMP:?is not set: it is the folder the job built the API into}/household-api"
ready="http://127.0.0.1:8080/api/v1/readyz"

case "${1:-}" in
  stop)
    pkill -x household-api
    for _ in $(seq 20); do
      curl --silent --output /dev/null "$ready" || exit 0
      sleep 1
    done
    echo "api.sh: the API still answers" >&2
    exit 1
    ;;
  start)
    cd "$(dirname "$0")/../../../server"
    HOUSEHOLD_ENV=development \
      HOUSEHOLD_HTTP_ADDR=0.0.0.0:8080 \
      HOUSEHOLD_POWERSYNC_URL=http://10.0.2.2:8081 \
      HOUSEHOLD_LOG_LEVEL=warn \
      nohup "$binary" serve >>"$RUNNER_TEMP/api.log" 2>&1 &
    for _ in $(seq 60); do
      curl --fail --silent --output /dev/null "$ready" && exit 0
      sleep 1
    done
    echo "api.sh: the API did not come back" >&2
    exit 1
    ;;
  *)
    echo "api.sh: which? stop or start." >&2
    exit 2
    ;;
esac
