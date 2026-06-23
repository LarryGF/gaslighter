#!/usr/bin/env python3
"""
Enrichment script for session metadata.

Reads metadata.json from a session directory, processes tags, and outputs enriched results.

Usage:
    python3 scripts/enrich.py <session_path>
"""

import sys
import json
from pathlib import Path


def enrich_tags(tags):
    """
    Enriches tags by normalizing and expanding them.

    Args:
        tags: List or string of tags from metadata

    Returns:
        List of enriched tag strings
    """
    if isinstance(tags, str):
        tags = [tags]

    enriched = []
    for tag in tags:
        tag = str(tag).strip()
        # Normalize: lowercase, replace spaces with hyphens
        normalized = tag.lower().replace(' ', '-')
        enriched.append(normalized)

    return enriched


def main():
    if len(sys.argv) < 2:
        print("Error: session_path argument required", file=sys.stderr)
        sys.exit(1)

    session_path = Path(sys.argv[1])
    metadata_file = session_path / "metadata.json"

    # Verify session directory exists
    if not session_path.exists():
        print(f"Error: session directory does not exist: {session_path}", file=sys.stderr)
        sys.exit(1)

    # Handle missing metadata.json
    if not metadata_file.exists():
        print(f"Error: metadata.json not found: {metadata_file}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(metadata_file, 'r') as f:
            metadata = json.load(f)
    except json.JSONDecodeError as e:
        print(f"Error: failed to parse JSON from {metadata_file}: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: failed to read {metadata_file}: {e}", file=sys.stderr)
        sys.exit(1)

    # Extract and enrich tags
    tags = metadata.get('tags', [])
    enriched = enrich_tags(tags)

    # Output enriched tags
    output = {
        'session_path': str(session_path),
        'original_tags': tags if isinstance(tags, list) else [tags],
        'enriched_tags': enriched
    }

    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    main()
