---
name: data-enricher
description: "Enriches session metadata by reading tags from metadata.json and delegating processing to enrich.py"
model: haiku
disallowed-tools: []
---

# Data Enricher Skill

Enriches session data by reading metadata and delegating to an enrichment script.

## Usage

```
/gaslighter:data-enricher <session_path>
```

Where `<session_path>` is the path to a session directory (e.g., `runs/20260623-142956/session-1`).

## What it does

1. Verifies that the specified `<session_path>` directory exists
2. Checks for `{session_path}/metadata.json` and handles missing file gracefully
3. Reads session metadata JSON file
4. Delegates enrichment processing to `scripts/enrich.py` with session_path as argument
5. Displays enriched tags output

## Assumptions

- `metadata.json` contains a `tags` field (array or string)
- `scripts/enrich.py` is available relative to project root
- Session metadata is valid JSON

## Error handling

- If session directory does not exist: report error and exit
- If `metadata.json` is missing: catch FileNotFoundError and report gracefully
- If JSON parsing fails: report parse error with file path
- If enrichment script fails: report script error and exit code

## Implementation Instructions

When invoked with a session_path argument:

1. **Validate session directory**: Check that `<session_path>` exists, report error if not
2. **Check for metadata file**: Verify `<session_path>/metadata.json` exists; if not, handle FileNotFoundError
3. **Read metadata**: Parse JSON from metadata.json
4. **Delegate to script**: Call `scripts/enrich.py` with session_path as command-line argument
5. **Display output**: Print enriched tags from the script

## Frontmatter Arguments

- `session_path` (required): Path to the session directory containing metadata.json
