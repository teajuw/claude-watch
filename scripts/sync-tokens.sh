#!/bin/bash
# Sync Claude credentials to Cloudflare Worker KV
# Run this manually or via cron when tokens expire

set -e

CREDS_FILE="$HOME/.claude/.credentials.json"
WORKER_DIR="$(dirname "$0")/.."

if [ ! -f "$CREDS_FILE" ]; then
    echo "Error: Claude credentials not found at $CREDS_FILE"
    exit 1
fi

# Extract tokens
ACCESS_TOKEN=$(jq -r '.claudeAiOauth.accessToken' "$CREDS_FILE")
REFRESH_TOKEN=$(jq -r '.claudeAiOauth.refreshToken' "$CREDS_FILE")
EXPIRES_AT=$(jq -r '.claudeAiOauth.expiresAt' "$CREDS_FILE")

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" = "null" ]; then
    echo "Error: No access token found in credentials"
    exit 1
fi

# Format expiry for display
EXPIRY_DATE=$(date -d "@$((EXPIRES_AT / 1000))" 2>/dev/null || python3 -c "import datetime; print(datetime.datetime.fromtimestamp($EXPIRES_AT/1000).strftime('%Y-%m-%d %H:%M:%S'))")

echo "Syncing tokens to Cloudflare Worker..."
echo "  Access token: ${ACCESS_TOKEN:0:20}..."
echo "  Expires: $EXPIRY_DATE"

# Build JSON payload
PAYLOAD=$(cat <<EOF
{"accessToken":"$ACCESS_TOKEN","refreshToken":"$REFRESH_TOKEN","expiresAt":$EXPIRES_AT}
EOF
)

# Use wrangler to update KV directly
cd "$WORKER_DIR/worker"

# Check if wrangler is available
if command -v npx &> /dev/null; then
    npx wrangler kv key put oauth_tokens "$PAYLOAD" --binding=KV --remote
    echo "Tokens synced successfully!"
elif command -v wrangler &> /dev/null; then
    wrangler kv key put oauth_tokens "$PAYLOAD" --binding=KV --remote
    echo "Tokens synced successfully!"
else
    echo "Error: wrangler not found. Install with: npm install -g wrangler"
    exit 1
fi
