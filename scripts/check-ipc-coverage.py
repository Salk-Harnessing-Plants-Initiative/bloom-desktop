#!/usr/bin/env python3
"""
Analyze test coverage for renderer database IPC handlers.

This script:
1. Extracts all IPC handler registrations from database-handlers.ts
2. Checks which handlers are called in the E2E test file
3. Reports coverage statistics by model

Usage:
    python3 scripts/check-ipc-coverage.py
    npm run test:e2e:coverage
"""

import re
from pathlib import Path
import sys


def main():
    # Read database handlers - handle multiline
    handlers_file = Path('src/main/database-handlers.ts')
    if not handlers_file.exists():
        print(f"Error: {handlers_file} not found", file=sys.stderr)
        return 1

    handlers_content = handlers_file.read_text()

    # Remove comments and normalize whitespace
    handlers_normalized = re.sub(r'//.*?\n', '\n', handlers_content)
    handlers_normalized = re.sub(r'/\*.*?\*/', '', handlers_normalized, flags=re.DOTALL)
    handlers_normalized = re.sub(r'\s+', ' ', handlers_normalized)

    # Extract handler names
    handler_pattern = r"ipcMain\.handle\s*\(\s*['\"]([^'\"]+)['\"]"
    handlers = sorted(set(re.findall(handler_pattern, handlers_normalized)))

    # Read test file
    test_file = Path('tests/e2e/renderer-database-ipc.e2e.ts')
    if not test_file.exists():
        print(f"Error: {test_file} not found", file=sys.stderr)
        return 1

    test_content = test_file.read_text()

    # Count test calls for each handler
    test_calls = {}
    for handler in handlers:
        parts = handler.split(':')
        if len(parts) == 3:
            model = parts[1]
            action = parts[2]
            # Count direct handler references and method calls
            count = test_content.count(f"'{handler}'") + test_content.count(f'"{handler}"')
            # Also count method calls like .experiments.list(
            count += test_content.count(f'.{model}.{action}(')
            test_calls[handler] = count

    print("=== Renderer Database IPC Test Coverage Analysis ===\n")
    print(f"📊 Total IPC Handlers Found: {len(handlers)}\n")

    # Organize by model
    models = {}
    for handler in handlers:
        parts = handler.split(':')
        if len(parts) >= 3:
            model = parts[1]
            action = parts[2]
            if model not in models:
                models[model] = []
            models[model].append((handler, action, test_calls.get(handler, 0)))

    tested_count = 0
    untested_handlers = []
    total_calls = 0

    # Print coverage by model
    for model in sorted(models.keys()):
        print(f"\n🗂️  {model.upper()}")
        print("-" * 60)
        for handler, action, calls in sorted(models[model], key=lambda x: x[1]):
            is_tested = calls > 0
            status = "✅" if is_tested else "❌"
            tested_count += 1 if is_tested else 0
            total_calls += calls

            if not is_tested:
                untested_handlers.append(handler)

            call_info = f"({calls} test calls)" if is_tested else ""
            print(f"  {status} {action:12s} {handler:30s} {call_info}")

    # Calculate and print summary
    coverage_pct = (tested_count / len(handlers) * 100) if handlers else 0

    print(f"\n\n📈 Coverage Summary:")
    print(f"  Tested handlers: {tested_count}/{len(handlers)}")
    print(f"  Coverage: {coverage_pct:.1f}%")
    print(f"  Total test method calls: {total_calls}")

    if untested_handlers:
        print(f"\n⚠️  Untested handlers ({len(untested_handlers)}):")
        for handler in sorted(untested_handlers):
            print(f"    - {handler}")
    else:
        print(f"\n🎉 100% coverage! All handlers are tested.")

    # Exit with error code if coverage is below threshold
    threshold = 90.0
    if coverage_pct < threshold:
        print(f"\n❌ Coverage {coverage_pct:.1f}% is below threshold {threshold}%")
        return 1

    return 0


if __name__ == '__main__':
    sys.exit(main())
