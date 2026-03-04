#!/bin/bash
#
# Scaffold E2E test structure for a Deco site
#
# Usage:
#   ./scaffold.sh /path/to/site-repo site-name
#
# Example:
#   ./scaffold.sh ~/Projects/lojastorra-2 lojastorra-2
#

set -e

SITE_PATH="${1:-.}"
SITE_NAME="${2:-my-site}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

# Escape special sed characters in SITE_NAME to prevent breakage with / & \ etc.
SITE_NAME_ESCAPED=$(printf '%s\n' "$SITE_NAME" | sed 's/[&/\|]/\\&/g')

echo "🚀 Scaffolding E2E tests for: $SITE_NAME"
echo "   Site path: $SITE_PATH"
echo "   Templates: $TEMPLATES_DIR"
echo ""

# Create directory structure
E2E_DIR="$SITE_PATH/tests/e2e"
mkdir -p "$E2E_DIR/specs"
mkdir -p "$E2E_DIR/utils"
mkdir -p "$E2E_DIR/reports"

# Copy and customize templates
echo "📁 Creating files..."

# package.json
sed "s|{{SITE_NAME}}|$SITE_NAME_ESCAPED|g" "$TEMPLATES_DIR/package.json" > "$E2E_DIR/package.json"
echo "   ✓ package.json"

# playwright.config.ts
sed "s|{{SITE_NAME}}|$SITE_NAME_ESCAPED|g" "$TEMPLATES_DIR/playwright.config.ts" > "$E2E_DIR/playwright.config.ts"
echo "   ✓ playwright.config.ts"

# tsconfig.json
cp "$TEMPLATES_DIR/tsconfig.json" "$E2E_DIR/tsconfig.json"
echo "   ✓ tsconfig.json"

# Test spec (needs manual customization)
sed "s|{{SITE_NAME}}|$SITE_NAME_ESCAPED|g" "$TEMPLATES_DIR/specs/ecommerce-flow.spec.ts" > "$E2E_DIR/specs/ecommerce-flow.spec.ts"
echo "   ✓ specs/ecommerce-flow.spec.ts"

# Metrics collector
cp "$TEMPLATES_DIR/utils/metrics-collector.ts" "$E2E_DIR/utils/metrics-collector.ts"
echo "   ✓ utils/metrics-collector.ts"

# Add reports to .gitignore if not already there
GITIGNORE="$SITE_PATH/.gitignore"
if [ -f "$GITIGNORE" ]; then
    if ! grep -q "tests/e2e/reports" "$GITIGNORE"; then
        echo "" >> "$GITIGNORE"
        echo "# E2E test reports" >> "$GITIGNORE"
        echo "tests/e2e/reports/" >> "$GITIGNORE"
        echo "   ✓ Updated .gitignore"
    fi
fi

echo ""
echo "✅ Scaffold complete!"
echo ""
echo "📋 Next steps:"
echo "   1. cd $E2E_DIR"
echo "   2. Open specs/ecommerce-flow.spec.ts"
echo "   3. Replace {{PLACEHOLDERS}} with your site values:"
echo "      - {{PLP_PATH}}"
echo "      - {{FALLBACK_PDP_PATH}}"
echo "      - {{PRODUCT_CARD_SELECTOR}}"
echo "      - {{BUY_BUTTON_SELECTOR}}"
echo "      - {{MINICART_TEXT}}"
echo ""
echo "   4. npm install"
echo "   5. npx playwright install chromium"
echo "   6. npm test"
echo ""
echo "📖 See discovery.md for how to find each value."
