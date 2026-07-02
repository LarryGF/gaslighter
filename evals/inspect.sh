#!/bin/bash
# Quick workspace inspection helpers

# Compare workspace file lists between two arms (default baseline vs gaslighter-lite)
compare_files() {
    local run_dir=$1
    local task=$2
    local model=$3
    local run_num=${4:-0}
    local arm_a=${5:-baseline}
    local arm_b=${6:-gaslighter-lite}

    local ws_a="$run_dir/${task}__${arm_a}__${model}__${run_num}"
    local ws_b="$run_dir/${task}__${arm_b}__${model}__${run_num}"

    echo "=== $arm_a files ==="
    find "$ws_a" -type f -name "*.py" -o -name "*.js" -o -name "*.ts" 2>/dev/null | sort

    echo -e "\n=== $arm_b files ==="
    find "$ws_b" -type f -name "*.py" -o -name "*.js" -o -name "*.ts" 2>/dev/null | sort
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
    echo "  $0 compare_files <run_dir> <task_id> <model> [run_num] [arm_a] [arm_b]"
    echo "  $0 show_impl <workspace_path>"
    exit 1
fi

"$@"
