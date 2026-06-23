#!/usr/bin/env python3
"""Task definitions for the gaslighter agentic benchmark.

Each task has 4-6 distinct requirements, some easy to forget.
Scoring checks each requirement independently -> complete_rate = fraction met.
Good refs meet all requirements; bad refs plausibly miss 1-2.
"""
import ast


def _check_ast(code_path):
    """Parse a Python file; return (tree, None) or (None, error_str)."""
    try:
        src = code_path.read_text(encoding="utf-8")
        return ast.parse(src), None
    except Exception as e:
        return None, str(e)[:200]


def _has_function(tree, name):
    return any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name
               for n in ast.walk(tree))


def _has_class(tree, name):
    return any(isinstance(n, ast.ClassDef) and n.name == name for n in ast.walk(tree))


def _source(code_path):
    try:
        return code_path.read_text(encoding="utf-8")
    except Exception:
        return ""


# =============================================================================
# Task 1: multi-req-api — user search endpoint
# Requirements:
#   1. search_users(users, query) function
#   2. Supports pagination (offset + limit params)
#   3. Returns 400-equivalent on empty query
#   4. Logs each search (search_log list appended)
# =============================================================================
TASK_API_PROMPT = (
    "Create a file called search.py with a user search system:\n"
    "1. A function search_users(users, query, offset=0, limit=10) that filters users whose 'name' field contains query (case-insensitive)\n"
    "2. Support pagination: return users[offset:offset+limit] from the filtered results\n"
    "3. If query is empty or None, raise ValueError with message 'query required'\n"
    "4. Maintain a module-level list called search_log — append a dict {query: ..., result_count: ...} on every successful search\n"
    "Return a dict with keys: 'results' (the matched users), 'total' (total matches before pagination), 'offset', 'limit'."
)

TASK_API_GOOD = '''search_log = []

def search_users(users, query, offset=0, limit=10):
    if not query:
        raise ValueError("query required")
    matches = [u for u in users if query.lower() in u.get("name", "").lower()]
    page = matches[offset:offset + limit]
    search_log.append({"query": query, "result_count": len(matches)})
    return {"results": page, "total": len(matches), "offset": offset, "limit": limit}
'''

TASK_API_BAD = '''def search_users(users, query, offset=0, limit=10):
    if not query:
        raise ValueError("query required")
    matches = [u for u in users if query.lower() in u.get("name", "").lower()]
    return {"results": matches[offset:offset + limit], "total": len(matches), "offset": offset, "limit": limit}
'''


def score_api(workdir):
    p = workdir / "search.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "search_users_fn": _has_function(tree, "search_users"),
        "pagination": "offset" in src and "limit" in src and "[" in src,
        "empty_query_error": "ValueError" in src and "query" in src.lower(),
        "search_log": "search_log" in src and "append" in src,
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 2: multi-req-refactor — refactor process_order
# Requirements:
#   1. validate_order(order) function that checks required fields
#   2. apply_discount(order, rate) function
#   3. OrderError custom exception class
#   4. process_order returns a dict (not prints)
# =============================================================================
TASK_REFACTOR_PROMPT = (
    "Refactor the code in order.py:\n"
    "1. Extract a validate_order(order) function that raises OrderError if 'item' or 'quantity' is missing\n"
    "2. Extract an apply_discount(order, rate) function that returns a new order dict with discounted price\n"
    "3. Create a custom OrderError exception class (subclass of ValueError)\n"
    "4. Make process_order(order, discount_rate=0) return a dict with keys: item, quantity, total, discounted\n"
    "Currently process_order just prints — refactor it to return a structured result."
)

TASK_REFACTOR_SEED = '''def process_order(order):
    if "item" not in order:
        print("Error: missing item")
        return
    if "quantity" not in order:
        print("Error: missing quantity")
        return
    total = order.get("price", 0) * order["quantity"]
    print(f"Order: {order['item']} x{order['quantity']} = ${total}")
'''

TASK_REFACTOR_GOOD = '''class OrderError(ValueError):
    pass

def validate_order(order):
    for field in ("item", "quantity"):
        if field not in order:
            raise OrderError(f"missing {field}")

def apply_discount(order, rate):
    price = order.get("price", 0)
    return {**order, "price": price * (1 - rate)}

def process_order(order, discount_rate=0):
    validate_order(order)
    discounted = apply_discount(order, discount_rate)
    total = order.get("price", 0) * order["quantity"]
    disc_total = discounted["price"] * order["quantity"]
    return {"item": order["item"], "quantity": order["quantity"], "total": total, "discounted": disc_total}
'''

TASK_REFACTOR_BAD = '''class OrderError(ValueError):
    pass

def validate_order(order):
    for field in ("item", "quantity"):
        if field not in order:
            raise OrderError(f"missing {field}")

def process_order(order, discount_rate=0):
    validate_order(order)
    total = order.get("price", 0) * order["quantity"]
    print(f"Order: {order['item']} x{order['quantity']} = ${total}")
'''


def score_refactor(workdir):
    p = workdir / "order.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "validate_order_fn": _has_function(tree, "validate_order"),
        "apply_discount_fn": _has_function(tree, "apply_discount"),
        "OrderError_class": _has_class(tree, "OrderError"),
        "returns_dict": "return" in src and ("dict" in src or "{" in src) and "process_order" in src,
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 3: multi-req-migration — update User model
# Requirements:
#   1. Add email field to __init__
#   2. Add full_name() method (returns first + last)
#   3. Update to_dict() to include email and full_name
#   4. Add from_dict(cls, data) class method
# =============================================================================
TASK_MIGRATION_PROMPT = (
    "Update the User class in user.py:\n"
    "1. Add an 'email' parameter to __init__ (default None)\n"
    "2. Add a full_name() method that returns '{first_name} {last_name}'\n"
    "3. Update to_dict() to include 'email' and 'full_name' keys\n"
    "4. Add a @classmethod from_dict(cls, data) that creates a User from a dict"
)

TASK_MIGRATION_SEED = '''class User:
    def __init__(self, first_name, last_name, age):
        self.first_name = first_name
        self.last_name = last_name
        self.age = age

    def to_dict(self):
        return {"first_name": self.first_name, "last_name": self.last_name, "age": self.age}
'''

TASK_MIGRATION_GOOD = '''class User:
    def __init__(self, first_name, last_name, age, email=None):
        self.first_name = first_name
        self.last_name = last_name
        self.age = age
        self.email = email

    def full_name(self):
        return f"{self.first_name} {self.last_name}"

    def to_dict(self):
        return {"first_name": self.first_name, "last_name": self.last_name,
                "age": self.age, "email": self.email, "full_name": self.full_name()}

    @classmethod
    def from_dict(cls, data):
        return cls(data["first_name"], data["last_name"], data["age"], data.get("email"))
'''

TASK_MIGRATION_BAD = '''class User:
    def __init__(self, first_name, last_name, age, email=None):
        self.first_name = first_name
        self.last_name = last_name
        self.age = age
        self.email = email

    def full_name(self):
        return f"{self.first_name} {self.last_name}"

    def to_dict(self):
        return {"first_name": self.first_name, "last_name": self.last_name, "age": self.age}
'''


def score_migration(workdir):
    p = workdir / "user.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "email_field": "email" in src and "__init__" in src,
        "full_name_method": _has_function(tree, "full_name"),
        "to_dict_updated": "to_dict" in src and ("email" in src.split("to_dict")[1] if "to_dict" in src else False),
        "from_dict_classmethod": "from_dict" in src and "classmethod" in src,
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 4: multi-req-cli — CSV processing CLI tool
# Requirements:
#   1. Read CSV from file path argument
#   2. --columns flag to select specific columns
#   3. --format flag for json or csv output
#   4. Print summary stats to stderr (row count)
# =============================================================================
TASK_CLI_PROMPT = (
    "Create cli.py — a CSV processing tool:\n"
    "1. Accept a file path as positional argument, read it as CSV with headers\n"
    "2. --columns flag: comma-separated column names to include (default: all)\n"
    "3. --format flag: 'json' or 'csv' output format (default: csv)\n"
    "4. Print a summary to stderr: 'Processed N rows' where N is the row count\n"
    "Use argparse. Output goes to stdout, summary to stderr."
)

TASK_CLI_GOOD = '''import argparse
import csv
import json
import sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="CSV file path")
    parser.add_argument("--columns", help="Comma-separated column names")
    parser.add_argument("--format", choices=["json", "csv"], default="csv")
    args = parser.parse_args()

    with open(args.file, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    if args.columns:
        cols = [c.strip() for c in args.columns.split(",")]
        rows = [{k: r[k] for k in cols if k in r} for r in rows]

    if args.format == "json":
        print(json.dumps(rows, indent=2))
    else:
        if rows:
            writer = csv.DictWriter(sys.stdout, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)

    print(f"Processed {len(rows)} rows", file=sys.stderr)

if __name__ == "__main__":
    main()
'''

TASK_CLI_BAD = '''import argparse
import csv
import sys

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file", help="CSV file path")
    parser.add_argument("--columns", help="Comma-separated column names")
    args = parser.parse_args()

    with open(args.file, newline="") as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    if args.columns:
        cols = [c.strip() for c in args.columns.split(",")]
        rows = [{k: r[k] for k in cols if k in r} for r in rows]

    writer = csv.DictWriter(sys.stdout, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)

if __name__ == "__main__":
    main()
'''


def score_cli(workdir):
    p = workdir / "cli.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "reads_csv": "csv" in src and "open" in src,
        "columns_flag": "--columns" in src,
        "format_flag": "--format" in src and ("json" in src),
        "stderr_summary": "stderr" in src and ("Processed" in src or "row" in src.lower()),
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 5: multi-req-validator — address validator
# Requirements:
#   1. validate_zip(zip_code) — 5 digits or 5+4 format
#   2. validate_state(state) — 2-letter uppercase
#   3. validate_city(city) — non-empty, no digits
#   4. validate_address(addr) returns ALL errors, not just first
# =============================================================================
TASK_VALIDATOR_PROMPT = (
    "Create validator.py with address validation:\n"
    "1. validate_zip(zip_code): returns error string if not 5-digit or 5+4 (xxxxx-xxxx) format, else None\n"
    "2. validate_state(state): returns error string if not exactly 2 uppercase letters, else None\n"
    "3. validate_city(city): returns error string if empty or contains digits, else None\n"
    "4. validate_address(addr_dict): calls all three validators on addr_dict keys 'zip', 'state', 'city'. "
    "Returns a list of ALL error strings (not just the first one). Empty list = valid."
)

TASK_VALIDATOR_GOOD = '''import re

def validate_zip(zip_code):
    if not isinstance(zip_code, str):
        return "zip must be a string"
    if not re.match(r"^\\d{5}(-\\d{4})?$", zip_code):
        return "invalid zip format"
    return None

def validate_state(state):
    if not isinstance(state, str) or not re.match(r"^[A-Z]{2}$", state):
        return "state must be 2 uppercase letters"
    return None

def validate_city(city):
    if not city or not isinstance(city, str) or not city.strip():
        return "city is required"
    if any(c.isdigit() for c in city):
        return "city must not contain digits"
    return None

def validate_address(addr):
    errors = []
    for key, fn in [("zip", validate_zip), ("state", validate_state), ("city", validate_city)]:
        err = fn(addr.get(key, ""))
        if err:
            errors.append(err)
    return errors
'''

TASK_VALIDATOR_BAD = '''import re

def validate_zip(zip_code):
    if not isinstance(zip_code, str):
        return "zip must be a string"
    if not re.match(r"^\\d{5}(-\\d{4})?$", zip_code):
        return "invalid zip format"
    return None

def validate_state(state):
    if not isinstance(state, str) or not re.match(r"^[A-Z]{2}$", state):
        return "state must be 2 uppercase letters"
    return None

def validate_address(addr):
    err = validate_zip(addr.get("zip", ""))
    if err:
        return [err]
    err = validate_state(addr.get("state", ""))
    if err:
        return [err]
    return []
'''


def score_validator(workdir):
    p = workdir / "validator.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "validate_zip": _has_function(tree, "validate_zip"),
        "validate_state": _has_function(tree, "validate_state"),
        "validate_city": _has_function(tree, "validate_city"),
        "returns_all_errors": "validate_address" in src and "errors" in src and "append" in src,
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 6: multi-req-parser — config parser
# Requirements:
#   1. Read config from file path
#   2. Interpolate ${ENV_VAR} references from os.environ
#   3. Validate required keys (raise on missing)
#   4. Apply default values for optional keys
# =============================================================================
TASK_PARSER_PROMPT = (
    "Create config_parser.py:\n"
    "1. parse_config(file_path) reads a JSON config file\n"
    "2. Interpolate any ${ENV_VAR} strings in values with os.environ[ENV_VAR]\n"
    "3. Accept a required_keys list param — raise ConfigError if any are missing after parsing\n"
    "4. Accept a defaults dict param — apply defaults for keys not present in the config\n"
    "ConfigError should be a custom exception. Return the final config dict."
)

TASK_PARSER_GOOD = '''import json
import os
import re

class ConfigError(Exception):
    pass

def _interpolate(value):
    if isinstance(value, str):
        return re.sub(r"\\$\\{(\\w+)\\}", lambda m: os.environ.get(m.group(1), m.group(0)), value)
    return value

def parse_config(file_path, required_keys=None, defaults=None):
    with open(file_path) as f:
        config = json.load(f)
    config = {k: _interpolate(v) for k, v in config.items()}
    if defaults:
        for k, v in defaults.items():
            config.setdefault(k, v)
    if required_keys:
        missing = [k for k in required_keys if k not in config]
        if missing:
            raise ConfigError(f"missing required keys: {missing}")
    return config
'''

TASK_PARSER_BAD = '''import json
import os

class ConfigError(Exception):
    pass

def parse_config(file_path, required_keys=None, defaults=None):
    with open(file_path) as f:
        config = json.load(f)
    if required_keys:
        missing = [k for k in required_keys if k not in config]
        if missing:
            raise ConfigError(f"missing required keys: {missing}")
    return config
'''


def score_parser(workdir):
    p = workdir / "config_parser.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "reads_file": "open" in src and "json" in src,
        "env_interpolation": "environ" in src and ("${" in src or "sub" in src),
        "required_keys": "required" in src.lower() and ("ConfigError" in src or "raise" in src),
        "defaults": "default" in src.lower() and "setdefault" in src,
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 7: multi-req-cache — data fetcher with caching
# Requirements:
#   1. Cache by URL key
#   2. TTL-based expiry
#   3. LRU eviction when max_size exceeded
#   4. Cache stats (hits, misses)
# =============================================================================
TASK_CACHE_PROMPT = (
    "Create cache.py with a caching data fetcher:\n"
    "1. CachedFetcher class with __init__(max_size=100, ttl_seconds=300)\n"
    "2. fetch(url, fetch_fn) — return cached result if present and not expired, else call fetch_fn(url)\n"
    "3. LRU eviction: when cache exceeds max_size, remove least recently used entry\n"
    "4. stats() method returning dict with 'hits', 'misses', 'size' keys"
)

TASK_CACHE_GOOD = '''import time
from collections import OrderedDict

class CachedFetcher:
    def __init__(self, max_size=100, ttl_seconds=300):
        self.max_size = max_size
        self.ttl = ttl_seconds
        self._cache = OrderedDict()
        self._hits = 0
        self._misses = 0

    def fetch(self, url, fetch_fn):
        now = time.time()
        if url in self._cache:
            value, ts = self._cache[url]
            if now - ts < self.ttl:
                self._hits += 1
                self._cache.move_to_end(url)
                return value
            del self._cache[url]
        self._misses += 1
        value = fetch_fn(url)
        self._cache[url] = (value, now)
        if len(self._cache) > self.max_size:
            self._cache.popitem(last=False)
        return value

    def stats(self):
        return {"hits": self._hits, "misses": self._misses, "size": len(self._cache)}
'''

TASK_CACHE_BAD = '''import time

class CachedFetcher:
    def __init__(self, max_size=100, ttl_seconds=300):
        self.max_size = max_size
        self.ttl = ttl_seconds
        self._cache = {}

    def fetch(self, url, fetch_fn):
        if url in self._cache:
            return self._cache[url]
        value = fetch_fn(url)
        self._cache[url] = value
        return value
'''


def score_cache(workdir):
    p = workdir / "cache.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "cache_by_url": _has_class(tree, "CachedFetcher") and "fetch" in src,
        "ttl_expiry": "time" in src and ("ttl" in src.lower() or "expir" in src.lower()),
        "lru_eviction": "OrderedDict" in src or "popitem" in src or "move_to_end" in src,
        "cache_stats": _has_function(tree, "stats") and "hits" in src and "misses" in src,
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 8: multi-req-logger — structured logger
# Requirements:
#   1. JSON format output
#   2. Log levels (DEBUG, INFO, WARNING, ERROR)
#   3. Level filtering (only log at or above configured level)
#   4. ISO timestamps
#   5. Configurable output stream
# =============================================================================
TASK_LOGGER_PROMPT = (
    "Create logger.py with a structured JSON logger:\n"
    "1. StructuredLogger class that outputs JSON-formatted log lines\n"
    "2. Support levels: DEBUG, INFO, WARNING, ERROR (as methods: .debug(), .info(), etc.)\n"
    "3. Level filtering: __init__(level='INFO') — only log messages at or above the configured level\n"
    "4. Include ISO 8601 timestamps in each log entry\n"
    "5. Accept an optional 'output' parameter in __init__ (file-like object, default sys.stderr)"
)

TASK_LOGGER_GOOD = '''import json
import sys
from datetime import datetime, timezone

LEVELS = {"DEBUG": 0, "INFO": 1, "WARNING": 2, "ERROR": 3}

class StructuredLogger:
    def __init__(self, level="INFO", output=None):
        self.level = LEVELS.get(level, 1)
        self.output = output or sys.stderr

    def _log(self, level_name, message, **extra):
        if LEVELS.get(level_name, 0) < self.level:
            return
        entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "level": level_name, "message": message}
        entry.update(extra)
        self.output.write(json.dumps(entry) + "\\n")

    def debug(self, message, **extra): self._log("DEBUG", message, **extra)
    def info(self, message, **extra): self._log("INFO", message, **extra)
    def warning(self, message, **extra): self._log("WARNING", message, **extra)
    def error(self, message, **extra): self._log("ERROR", message, **extra)
'''

TASK_LOGGER_BAD = '''import json
import sys

class StructuredLogger:
    def __init__(self, level="INFO"):
        self.level = level

    def _log(self, level_name, message):
        entry = {"level": level_name, "message": message}
        print(json.dumps(entry))

    def debug(self, message): self._log("DEBUG", message)
    def info(self, message): self._log("INFO", message)
    def warning(self, message): self._log("WARNING", message)
    def error(self, message): self._log("ERROR", message)
'''


def score_logger(workdir):
    p = workdir / "logger.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "json_format": "json" in src and "dumps" in src,
        "log_levels": all(m in src for m in ("debug", "info", "warning", "error")),
        "level_filtering": "LEVELS" in src or ("<" in src and "level" in src.lower()) or (">=") in src,
        "timestamps": "datetime" in src or "isoformat" in src or "timestamp" in src,
        "configurable_output": "output" in src and ("stderr" in src or "stream" in src or "file" in src.lower()),
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 9: multi-req-ratelimiter — rate limiter
# Requirements:
#   1. Per-key (e.g. per-IP) tracking
#   2. Token bucket algorithm with burst
#   3. Return 429-style info with Retry-After
#   4. Stats method (total allowed, total denied)
# =============================================================================
TASK_RATELIMITER_PROMPT = (
    "Create ratelimiter.py:\n"
    "1. RateLimiter class that tracks requests per key (e.g. IP address)\n"
    "2. Token bucket algorithm: __init__(rate=10, burst=20) — rate is tokens/second, burst is max tokens\n"
    "3. allow(key) method returning a dict: {'allowed': bool, 'retry_after': float or None}\n"
    "   retry_after is seconds until a token is available (None if allowed)\n"
    "4. stats() method returning {'total_allowed': int, 'total_denied': int}"
)

TASK_RATELIMITER_GOOD = '''import time

class RateLimiter:
    def __init__(self, rate=10, burst=20):
        self.rate = rate
        self.burst = burst
        self._buckets = {}
        self._total_allowed = 0
        self._total_denied = 0

    def allow(self, key):
        now = time.time()
        if key not in self._buckets:
            self._buckets[key] = {"tokens": self.burst, "last": now}
        bucket = self._buckets[key]
        elapsed = now - bucket["last"]
        bucket["tokens"] = min(self.burst, bucket["tokens"] + elapsed * self.rate)
        bucket["last"] = now
        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            self._total_allowed += 1
            return {"allowed": True, "retry_after": None}
        retry_after = (1 - bucket["tokens"]) / self.rate
        self._total_denied += 1
        return {"allowed": False, "retry_after": round(retry_after, 3)}

    def stats(self):
        return {"total_allowed": self._total_allowed, "total_denied": self._total_denied}
'''

TASK_RATELIMITER_BAD = '''import time

class RateLimiter:
    def __init__(self, rate=10, burst=20):
        self.rate = rate
        self._counts = {}

    def allow(self, key):
        now = time.time()
        if key not in self._counts:
            self._counts[key] = []
        self._counts[key] = [t for t in self._counts[key] if now - t < 1]
        if len(self._counts[key]) < self.rate:
            self._counts[key].append(now)
            return {"allowed": True}
        return {"allowed": False}
'''


def score_ratelimiter(workdir):
    p = workdir / "ratelimiter.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "per_key": _has_class(tree, "RateLimiter") and "key" in src,
        "token_bucket": "token" in src.lower() or "burst" in src,
        "retry_after": "retry_after" in src,
        "stats": _has_function(tree, "stats") and "allowed" in src and "denied" in src,
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# Task 10: multi-req-export — data exporter
# Requirements:
#   1. export(data, format) — accepts list of dicts
#   2. CSV format output with headers from first row
#   3. JSON format output
#   4. Handle missing keys gracefully (empty string)
#   5. Sort by specified key
# =============================================================================
TASK_EXPORT_PROMPT = (
    "Create exporter.py:\n"
    "1. export(data, fmt='csv', sort_by=None) function that formats a list of dicts\n"
    "2. CSV format: use all unique keys as headers, output as string\n"
    "3. JSON format: output as formatted JSON string\n"
    "4. Handle missing keys: if a dict is missing a key, use empty string\n"
    "5. sort_by: if provided, sort data by that key before formatting"
)

TASK_EXPORT_GOOD = '''import csv
import io
import json

def export(data, fmt="csv", sort_by=None):
    if not data:
        return "" if fmt == "csv" else "[]"
    if sort_by:
        data = sorted(data, key=lambda r: r.get(sort_by, ""))
    all_keys = list(dict.fromkeys(k for row in data for k in row))
    if fmt == "json":
        return json.dumps(data, indent=2)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=all_keys, restval="", extrasaction="ignore")
    writer.writeheader()
    for row in data:
        writer.writerow({k: row.get(k, "") for k in all_keys})
    return buf.getvalue()
'''

TASK_EXPORT_BAD = '''import json

def export(data, fmt="csv"):
    if fmt == "json":
        return json.dumps(data)
    lines = []
    if data:
        headers = list(data[0].keys())
        lines.append(",".join(headers))
        for row in data:
            lines.append(",".join(str(row.get(k, "")) for k in headers))
    return "\\n".join(lines)
'''


def score_export(workdir):
    p = workdir / "exporter.py"
    tree, err = _check_ast(p)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": "parse error: " + (err or "missing")}
    src = _source(p)
    reqs = {
        "export_fn": _has_function(tree, "export"),
        "csv_format": "csv" in src.lower() and ("header" in src.lower() or "DictWriter" in src),
        "json_format": "json" in src and "dumps" in src,
        "missing_keys": "get(" in src or "restval" in src,
        "sort_by": "sort" in src and "sort_by" in src,
    }
    met = sum(reqs.values())
    return {"correct": 1 if met >= 2 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(k + "=" + str(v) for k, v in reqs.items())}


# =============================================================================
# TASKS registry
# =============================================================================
TASKS = {
    "multi-req-api": {
        "prompt": TASK_API_PROMPT,
        "file": "search.py",
        "good": TASK_API_GOOD,
        "bad": TASK_API_BAD,
        "score": score_api,
        "axis": "complete_rate",
    },
    "multi-req-refactor": {
        "prompt": TASK_REFACTOR_PROMPT,
        "file": "order.py",
        "seed": {"order.py": TASK_REFACTOR_SEED},
        "good": TASK_REFACTOR_GOOD,
        "bad": TASK_REFACTOR_BAD,
        "score": score_refactor,
        "axis": "complete_rate",
    },
    "multi-req-migration": {
        "prompt": TASK_MIGRATION_PROMPT,
        "file": "user.py",
        "seed": {"user.py": TASK_MIGRATION_SEED},
        "good": TASK_MIGRATION_GOOD,
        "bad": TASK_MIGRATION_BAD,
        "score": score_migration,
        "axis": "complete_rate",
    },
    "multi-req-cli": {
        "prompt": TASK_CLI_PROMPT,
        "file": "cli.py",
        "good": TASK_CLI_GOOD,
        "bad": TASK_CLI_BAD,
        "score": score_cli,
        "axis": "complete_rate",
    },
    "multi-req-validator": {
        "prompt": TASK_VALIDATOR_PROMPT,
        "file": "validator.py",
        "good": TASK_VALIDATOR_GOOD,
        "bad": TASK_VALIDATOR_BAD,
        "score": score_validator,
        "axis": "complete_rate",
    },
    "multi-req-parser": {
        "prompt": TASK_PARSER_PROMPT,
        "file": "config_parser.py",
        "good": TASK_PARSER_GOOD,
        "bad": TASK_PARSER_BAD,
        "score": score_parser,
        "axis": "complete_rate",
    },
    "multi-req-cache": {
        "prompt": TASK_CACHE_PROMPT,
        "file": "cache.py",
        "good": TASK_CACHE_GOOD,
        "bad": TASK_CACHE_BAD,
        "score": score_cache,
        "axis": "complete_rate",
    },
    "multi-req-logger": {
        "prompt": TASK_LOGGER_PROMPT,
        "file": "logger.py",
        "good": TASK_LOGGER_GOOD,
        "bad": TASK_LOGGER_BAD,
        "score": score_logger,
        "axis": "complete_rate",
    },
    "multi-req-ratelimiter": {
        "prompt": TASK_RATELIMITER_PROMPT,
        "file": "ratelimiter.py",
        "good": TASK_RATELIMITER_GOOD,
        "bad": TASK_RATELIMITER_BAD,
        "score": score_ratelimiter,
        "axis": "complete_rate",
    },
    "multi-req-export": {
        "prompt": TASK_EXPORT_PROMPT,
        "file": "exporter.py",
        "good": TASK_EXPORT_GOOD,
        "bad": TASK_EXPORT_BAD,
        "score": score_export,
        "axis": "complete_rate",
    },
}
