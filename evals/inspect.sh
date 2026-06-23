#!/bin/bash
# Quick workspace inspection helpers

# Check if nudge fired in a gaslighter workspace
check_nudge() {
    local ws=$1
    if [[ ! -d "$ws" ]]; then
        echo "Workspace not found: $ws"
        return 1
    fi

    if [[ -f "$ws/_claude.stderr.txt" ]]; then
        grep -i "GASLIGHTER CHECK" "$ws/_claude.stderr.txt" || echo "No nudge found"
    else
        echo "No stderr file"
    fi
}

# Compare workspace file lists between baseline and gaslighter
compare_files() {
    local run_dir=$1
    local task=$2
    local model=$3
    local run_num=${4:-0}

    local baseline="$run_dir/${task}__baseline__${model}__${run_num}"
    local gaslighter="$run_dir/${task}__gaslighter__${model}__${run_num}"

    echo "=== Baseline files ==="
    find "$baseline" -type f -name "*.py" -o -name "*.js" -o -name "*.ts" 2>/dev/null | sort

    echo -e "\n=== Gaslighter files ==="
    find "$gaslighter" -type f -name "*.py" -o -name "*.js" -o -name "*.ts" 2>/dev/null | sort
}

# Show implementation from a workspace
show_impl() {
    local ws=$1
    for f in $(find "$ws" -type f \( -name "*.py" -o -name "*.js" -o -name "*.ts" \) ! -name "test_*" ! -path "*/test/*" 2>/dev/null); do
        echo "=== $f ==="
        cat "$f"
        echo
    done
}

# Usage examples printed if no args
if [[ $# -eq 0 ]]; then
    echo "Usage:"
    echo "  $0 check_nudge <workspace_path>"
    echo "  $0 compare_files <run_dir> <task_id> <model> [run_num]"
    echo "  $0 show_impl <workspace_path>"
    exit 1
fi

"$@"
