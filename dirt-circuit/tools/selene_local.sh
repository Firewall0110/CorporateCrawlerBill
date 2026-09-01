#!/usr/bin/env bash
# selene_local.sh — run selene where `selene generate-roblox-std` cannot reach the network.
#
# WHY THIS EXISTS
#
# selene's `std = "roblox"` needs a generated API dump. In a sandboxed or offline
# environment that generation fails, and the obvious workaround — falling back to the
# built-in `luau` std — makes every Roblox global (`game`, `Instance`, `CFrame`, …) report
# as an undefined variable. A couple of hundred of those drown the handful that are real.
#
# The trap is what you do next. Filtering the output down to the rule names you happen to
# care about (`unused_variable`, `multiple_statements`) makes `undefined_variable` invisible
# — and that is exactly how a genuine `model is not defined` reached CI: the local run
# "passed" because the check had been narrowed until it could not fail.
#
# So this filters the other way round: keep every undefined_variable, subtract the names
# that are legitimately Roblox globals, and report whatever is left. Falsified against the
# real bug before being committed. (LESSONS.md J-01, J-04.)
#
# CI still runs the authoritative `selene src` with a real roblox std. This is the local
# stand-in, not a replacement.

set -euo pipefail
cd "$(dirname "$0")/.."

SELENE="${SELENE:-selene}"
command -v "$SELENE" >/dev/null || { echo "selene not found (set SELENE=/path/to/selene)"; exit 1; }

# Globals the roblox std would define. Anything reported that is NOT in here is a real
# undefined variable in our own code.
ROBLOX_GLOBALS='game|workspace|script|shared|plugin|settings|require|typeof|warn|task|
Instance|CFrame|Vector2|Vector3|Vector2int16|Vector3int16|Color3|ColorSequence|ColorSequenceKeypoint|
NumberRange|NumberSequence|NumberSequenceKeypoint|UDim|UDim2|Enum|BrickColor|Ray|Region3|Rect|
TweenInfo|PhysicalProperties|DateTime|Random|Faces|Axes|Font|OverlapParams|RaycastParams|
DockWidgetPluginGuiInfo|PathWaypoint|CatalogSearchParams|FloatCurveKey|RotationCurveKey|bit32|buffer'
PATTERN=$(echo "$ROBLOX_GLOBALS" | tr -d '\n')

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

sed 's/^std = "roblox"/std = "luau"/' selene.toml > "$TMP/selene.toml"
cp selene.toml "$TMP/selene.toml.orig"
cp "$TMP/selene.toml" selene.toml
# Restore the real config whatever happens, including on a lint failure.
trap 'cp "$TMP/selene.toml.orig" selene.toml 2>/dev/null || true; rm -rf "$TMP"' EXIT

set +e
"$SELENE" src > "$TMP/out.txt" 2>&1
set -e

cp "$TMP/selene.toml.orig" selene.toml

# Rules other than undefined_variable are trustworthy under the luau std, so surface them
# verbatim.
OTHER=$(grep -E '^(warning|error)\[' "$TMP/out.txt" | grep -v 'undefined_variable' || true)

REAL=$(grep -oP '(?<=undefined_variable\]: `)[^`]+' "$TMP/out.txt" | sort -u \
  | grep -vxE "$PATTERN" || true)

status=0
if [ -n "$OTHER" ]; then
  echo "$OTHER"
  status=1
fi
if [ -n "$REAL" ]; then
  echo "undefined variables that are NOT Roblox globals:"
  echo "$REAL" | sed 's/^/  /'
  status=1
fi

if [ "$status" -eq 0 ]; then
  echo "selene (local, luau std + roblox-global filter): clean"
fi
exit "$status"
