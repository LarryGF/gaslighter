#!/usr/bin/env python3
"""Hard task definitions for gaslighter eval.

Tasks target specific failure modes where requirements are easy to miss:
- Buried constraints in prose
- Implicit patterns from seed code
- Cross-file cascade updates
- Preservation of intentional design
- Trailing requirements after main ask
"""
import ast
import re


def _check_ast(code_path):
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


def _score(reqs):
    met = sum(reqs.values())
    rate = round(met / len(reqs), 2)
    return {
        "correct": 1 if rate >= 0.75 else 0,
        "complete_rate": rate,
        "reason": ", ".join(f"{k}={v}" for k, v in reqs.items()),
    }


# =============================================================================
# Task 1: hard-buried-constraints
# Add webhook handler to notification system.
# Prompt is prose paragraphs, NOT a numbered list.
# 3 requirements buried mid-sentence in the prose.
# =============================================================================
TASK_BURIED_SEED = {
    "notifications/utils.py": '''import time


def format_message(template, **kwargs):
    return template.format(**kwargs)


def timestamp():
    return time.time()
''',
    "notifications/email_handler.py": '''from notifications.utils import format_message, timestamp


def handle_email(recipient, template, **kwargs):
    body = format_message(template, **kwargs)
    return {"status": "sent", "channel": "email", "timestamp": timestamp()}


def handle_email_error(error):
    return {"status": "error", "error": str(error), "timestamp": timestamp()}
''',
    "notifications/sms_handler.py": '''from notifications.utils import format_message, timestamp


def handle_sms(phone, template, **kwargs):
    body = format_message(template, **kwargs)
    return {"status": "sent", "channel": "sms", "timestamp": timestamp()}


def handle_sms_error(error):
    return {"status": "error", "error": str(error), "timestamp": timestamp()}
''',
    "notifications/__init__.py": '''from notifications.email_handler import handle_email, handle_email_error
from notifications.sms_handler import handle_sms, handle_sms_error

HANDLERS = {
    "email": {"send": handle_email, "error": handle_email_error},
    "sms": {"send": handle_sms, "error": handle_sms_error},
}
''',
}

TASK_BURIED_PROMPT = (
    "Add a webhook notification handler to the notifications package. The handler "
    "should accept a URL and payload, then POST the payload to the URL using urllib. "
    "It should support template-based message formatting for the payload body, just "
    "like the other handlers format their messages before sending. Create it at "
    "notifications/webhook_handler.py. Webhook delivery failures should be handled "
    "the same way other handlers deal with errors — returning a structured result "
    "rather than propagating exceptions up the call stack. Make sure the webhook "
    "handler is available alongside the existing handlers when the package is imported."
)

TASK_BURIED_GOOD = {
    "notifications/webhook_handler.py": '''import json
import urllib.request
from notifications.utils import format_message, timestamp


def handle_webhook(url, payload, template=None, **kwargs):
    body = payload
    if template:
        body = format_message(template, **kwargs)
    data = json.dumps({"body": body}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    urllib.request.urlopen(req)
    return {"status": "sent", "channel": "webhook", "timestamp": timestamp()}


def handle_webhook_error(error):
    return {"status": "error", "error": str(error), "timestamp": timestamp()}
''',
    "notifications/__init__.py": '''from notifications.email_handler import handle_email, handle_email_error
from notifications.sms_handler import handle_sms, handle_sms_error
from notifications.webhook_handler import handle_webhook, handle_webhook_error

HANDLERS = {
    "email": {"send": handle_email, "error": handle_email_error},
    "sms": {"send": handle_sms, "error": handle_sms_error},
    "webhook": {"send": handle_webhook, "error": handle_webhook_error},
}
''',
}

TASK_BURIED_BAD = {
    "notifications/webhook_handler.py": '''import json
import urllib.request


def handle_webhook(url, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req)
    if resp.status != 200:
        raise ConnectionError(f"Webhook failed: {resp.status}")
    return {"status": "sent", "channel": "webhook"}
''',
    # Missing: format_message, error handler (raises instead), not registered in __init__.py
}


def score_buried_constraints(workdir):
    handler = workdir / "notifications" / "webhook_handler.py"
    init = workdir / "notifications" / "__init__.py"

    handler_src = _source(handler)
    init_src = _source(init)

    reqs = {
        "file_exists": handler.exists(),
        "has_send_fn": bool(re.search(r"def (handle_webhook|send_webhook)\(", handler_src)),
        "accepts_url": "url" in handler_src,
        "accepts_payload": "payload" in handler_src,
        "uses_urllib": "urllib" in handler_src,
        # Buried: "just like the other handlers format their messages"
        "uses_format_message": "format_message" in handler_src,
        # Buried: "returning a structured result rather than propagating exceptions"
        "error_returns_dict": (
            bool(re.search(r"def \w*error\w*\(", handler_src))
            or ("except" in handler_src and "return" in handler_src)
        ) if handler.exists() else False,
        # Buried: "available alongside the existing handlers when the package is imported"
        "registered_in_init": "webhook" in init_src.lower() and "HANDLERS" in init_src,
    }

    return _score(reqs)


# =============================================================================
# Task 2: hard-implicit-patterns
# Add Product resource to existing API.
# Seed code has 2 handlers both using ok()/fail() and validate_X().
# Prompt does NOT mention these conventions.
# =============================================================================
TASK_IMPLICIT_SEED = {
    "utils/response.py": '''def ok(data):
    return {"ok": True, "data": data}


def fail(error, code=400):
    return {"ok": False, "error": error, "code": code}
''',
    "utils/validators.py": '''def validate_user(data):
    errors = []
    if not data.get("name"):
        errors.append("name is required")
    if not data.get("email"):
        errors.append("email is required")
    return errors


def validate_order(data):
    errors = []
    if not data.get("product_id"):
        errors.append("product_id is required")
    if not isinstance(data.get("quantity"), int) or data["quantity"] < 1:
        errors.append("quantity must be a positive integer")
    return errors
''',
    "handlers/users.py": '''from utils.response import ok, fail
from utils.validators import validate_user


def list_users(db):
    return ok(db.get("users", []))


def create_user(db, data):
    errors = validate_user(data)
    if errors:
        return fail(errors)
    db.setdefault("users", []).append(data)
    return ok(data)


def get_user(db, user_id):
    for u in db.get("users", []):
        if u.get("id") == user_id:
            return ok(u)
    return fail("not found", 404)
''',
    "handlers/orders.py": '''from utils.response import ok, fail
from utils.validators import validate_order


def list_orders(db):
    return ok(db.get("orders", []))


def create_order(db, data):
    errors = validate_order(data)
    if errors:
        return fail(errors)
    db.setdefault("orders", []).append(data)
    return ok(data)


def get_order(db, order_id):
    for o in db.get("orders", []):
        if o.get("id") == order_id:
            return ok(o)
    return fail("not found", 404)
''',
}

TASK_IMPLICIT_PROMPT = (
    "Add a Product resource to the API. Create handlers/products.py with "
    "list_products, create_product, and get_product functions. Also add a "
    "validate_product function to utils/validators.py that checks for "
    "required name (non-empty string) and price (positive number) fields. "
    "Products are stored in db[\"products\"]."
)

TASK_IMPLICIT_GOOD = {
    "handlers/products.py": '''from utils.response import ok, fail
from utils.validators import validate_product


def list_products(db):
    return ok(db.get("products", []))


def create_product(db, data):
    errors = validate_product(data)
    if errors:
        return fail(errors)
    db.setdefault("products", []).append(data)
    return ok(data)


def get_product(db, product_id):
    for p in db.get("products", []):
        if p.get("id") == product_id:
            return ok(p)
    return fail("not found", 404)
''',
    "utils/validators.py": '''def validate_user(data):
    errors = []
    if not data.get("name"):
        errors.append("name is required")
    if not data.get("email"):
        errors.append("email is required")
    return errors


def validate_order(data):
    errors = []
    if not data.get("product_id"):
        errors.append("product_id is required")
    if not isinstance(data.get("quantity"), int) or data["quantity"] < 1:
        errors.append("quantity must be a positive integer")
    return errors


def validate_product(data):
    errors = []
    if not data.get("name"):
        errors.append("name is required")
    if not isinstance(data.get("price"), (int, float)) or data["price"] <= 0:
        errors.append("price must be a positive number")
    return errors
''',
}

TASK_IMPLICIT_BAD = {
    "handlers/products.py": '''def list_products(db):
    return {"products": db.get("products", [])}


def create_product(db, data):
    db.setdefault("products", []).append(data)
    return {"product": data}


def get_product(db, product_id):
    for p in db.get("products", []):
        if p.get("id") == product_id:
            return {"product": p}
    return {"error": "not found"}, 404
''',
    "utils/validators.py": '''def validate_user(data):
    errors = []
    if not data.get("name"):
        errors.append("name is required")
    if not data.get("email"):
        errors.append("email is required")
    return errors


def validate_order(data):
    errors = []
    if not data.get("product_id"):
        errors.append("product_id is required")
    if not isinstance(data.get("quantity"), int) or data["quantity"] < 1:
        errors.append("quantity must be a positive integer")
    return errors


def validate_product(data):
    errors = []
    if not data.get("name"):
        errors.append("name is required")
    if not isinstance(data.get("price"), (int, float)) or data["price"] <= 0:
        errors.append("price must be a positive number")
    return errors
''',
    # Missing: ok()/fail() usage, validate before create, fail("not found", 404) pattern
}


def score_implicit_patterns(workdir):
    products = workdir / "handlers" / "products.py"
    validators = workdir / "utils" / "validators.py"

    products_src = _source(products)
    validators_src = _source(validators)

    reqs = {
        "file_exists": products.exists(),
        "list_products": "def list_products" in products_src,
        "create_product": "def create_product" in products_src,
        "get_product": "def get_product" in products_src,
        "validate_product_exists": "def validate_product" in validators_src,
        # Implicit: follows ok()/fail() pattern from seed handlers
        "uses_ok_fail": (
            "from utils.response import" in products_src
            and "ok(" in products_src
            and "fail(" in products_src
        ),
        # Implicit: validates before mutation (pattern from create_user/create_order)
        "validates_before_create": "validate_product" in products_src,
        # Implicit: fail("not found", 404) on get miss
        "not_found_pattern": "404" in products_src and "fail(" in products_src,
    }

    return _score(reqs)


# =============================================================================
# Task 3: hard-cascade-update
# Add role field to User model.
# Prompt is very short — only mentions the model.
# 5 dependent files must also be updated (cascade).
# =============================================================================
TASK_CASCADE_SEED = {
    "models/user.py": '''class User:
    def __init__(self, id, name, email):
        self.id = id
        self.name = name
        self.email = email
''',
    "serializers/user_serializer.py": '''def serialize_user(user):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
    }
''',
    "validators/user_validator.py": '''REQUIRED_FIELDS = ["name", "email"]


def validate_user_data(data):
    errors = []
    for field in REQUIRED_FIELDS:
        if field not in data:
            errors.append(f"{field} is required")
    return errors
''',
    "handlers/user_handler.py": '''from models.user import User
from serializers.user_serializer import serialize_user
from validators.user_validator import validate_user_data


def create_user(data):
    errors = validate_user_data(data)
    if errors:
        return {"errors": errors}
    user = User(id=data.get("id"), name=data["name"], email=data["email"])
    return serialize_user(user)
''',
    "tests/test_user.py": '''from models.user import User
from serializers.user_serializer import serialize_user


def test_user_creation():
    user = User(id=1, name="Alice", email="alice@example.com")
    assert user.name == "Alice"


def test_user_serialization():
    user = User(id=1, name="Alice", email="alice@example.com")
    data = serialize_user(user)
    assert data["name"] == "Alice"
    assert data["email"] == "alice@example.com"
''',
    "migrations/003_create_users.py": '''def up(conn):
    conn.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL
        )
    """)


def down(conn):
    conn.execute("DROP TABLE users")
''',
}

TASK_CASCADE_PROMPT = (
    "Add a 'role' field to User. Defaults to 'member'. "
    "Valid roles: member, admin, moderator."
)

TASK_CASCADE_GOOD = {
    "models/user.py": '''class User:
    def __init__(self, id, name, email, role="member"):
        self.id = id
        self.name = name
        self.email = email
        self.role = role
''',
    "serializers/user_serializer.py": '''def serialize_user(user):
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
    }
''',
    "validators/user_validator.py": '''REQUIRED_FIELDS = ["name", "email"]
VALID_ROLES = ["member", "admin", "moderator"]


def validate_user_data(data):
    errors = []
    for field in REQUIRED_FIELDS:
        if field not in data:
            errors.append(f"{field} is required")
    role = data.get("role", "member")
    if role not in VALID_ROLES:
        errors.append(f"invalid role: {role}")
    return errors
''',
    "handlers/user_handler.py": '''from models.user import User
from serializers.user_serializer import serialize_user
from validators.user_validator import validate_user_data


def create_user(data):
    errors = validate_user_data(data)
    if errors:
        return {"errors": errors}
    user = User(id=data.get("id"), name=data["name"], email=data["email"],
                role=data.get("role", "member"))
    return serialize_user(user)
''',
    "tests/test_user.py": '''from models.user import User
from serializers.user_serializer import serialize_user


def test_user_creation():
    user = User(id=1, name="Alice", email="alice@example.com")
    assert user.name == "Alice"
    assert user.role == "member"


def test_user_serialization():
    user = User(id=1, name="Alice", email="alice@example.com")
    data = serialize_user(user)
    assert data["name"] == "Alice"
    assert data["email"] == "alice@example.com"
    assert data["role"] == "member"


def test_user_role():
    user = User(id=1, name="Bob", email="bob@example.com", role="admin")
    assert user.role == "admin"
''',
    "migrations/003_create_users.py": '''def up(conn):
    conn.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member'
        )
    """)


def down(conn):
    conn.execute("DROP TABLE users")
''',
}

TASK_CASCADE_BAD = {
    "models/user.py": '''class User:
    def __init__(self, id, name, email, role="member"):
        self.id = id
        self.name = name
        self.email = email
        self.role = role
''',
    # Only updates the model — misses serializer, validator, handler, tests, migration
}


def score_cascade_update(workdir):
    model_src = _source(workdir / "models" / "user.py")
    serializer_src = _source(workdir / "serializers" / "user_serializer.py")
    validator_src = _source(workdir / "validators" / "user_validator.py")
    handler_src = _source(workdir / "handlers" / "user_handler.py")
    tests_src = _source(workdir / "tests" / "test_user.py")
    migration_src = _source(workdir / "migrations" / "003_create_users.py")

    reqs = {
        # Stated
        "model_has_role": "self.role" in model_src and "def __init__" in model_src,
        "role_defaults_member": '"member"' in model_src or "'member'" in model_src,
        "valid_roles_enforced": (
            "member" in validator_src and "admin" in validator_src
            and "moderator" in validator_src
        ),
        # Cascade
        "serializer_includes_role": "role" in serializer_src,
        "handler_passes_role": "role" in handler_src,
        "handler_defaults_role": '.get("role"' in handler_src or ".get('role'" in handler_src,
        "tests_cover_role": "role" in tests_src,
        "migration_has_role": "role" in migration_src,
    }

    return _score(reqs)


# =============================================================================
# Task 4: hard-preserve-behavior
# Fix a real bug in billing code WITHOUT "improving" intentional design.
# Seed has: Decimal for money (regulatory), math.ceil (billing policy),
# tuple return. Prompt invites cleanup — the trap.
# =============================================================================
TASK_PRESERVE_SEED = {
    "billing.py": '''import math
from decimal import Decimal

# Regulatory requirement: all monetary amounts use Decimal, never float.
# Rounding: math.ceil per billing policy (customer never underbilled).

DISCOUNT_TIERS = [
    (Decimal("1000"), Decimal("0.05")),   # 5% over $1000
    (Decimal("5000"), Decimal("0.10")),   # 10% over $5000
    (Decimal("10000"), Decimal("0.15")),  # 15% over $10000
]


def calculate_discount(subtotal):
    """Return (discount_rate, discount_amount) for the given subtotal."""
    rate = Decimal("0")
    for threshold, tier_rate in DISCOUNT_TIERS:
        if subtotal >= threshold:  # BUG: should be > (strictly above threshold)
            rate = tier_rate
    discount = subtotal * rate
    return rate, discount


def calculate_total(items):
    """Calculate total with discount. Returns (subtotal, discount, total)."""
    subtotal = sum(Decimal(str(item["price"])) * item["quantity"] for item in items)
    rate, discount = calculate_discount(subtotal)
    total = subtotal - discount
    # Regulatory: always round up to nearest cent
    total = Decimal(str(math.ceil(total * 100))) / 100
    return subtotal, discount, total
''',
}

TASK_PRESERVE_PROMPT = (
    "There's a bug in billing.py: the discount tier check uses >= but should "
    "use > (discount applies strictly above the threshold, not at it exactly). "
    "Fix the bug. Feel free to clean up anything else you think could be improved."
)

TASK_PRESERVE_GOOD = {
    "billing.py": '''import math
from decimal import Decimal

# Regulatory requirement: all monetary amounts use Decimal, never float.
# Rounding: math.ceil per billing policy (customer never underbilled).

DISCOUNT_TIERS = [
    (Decimal("1000"), Decimal("0.05")),   # 5% over $1000
    (Decimal("5000"), Decimal("0.10")),   # 10% over $5000
    (Decimal("10000"), Decimal("0.15")),  # 15% over $10000
]


def calculate_discount(subtotal):
    """Return (discount_rate, discount_amount) for the given subtotal."""
    rate = Decimal("0")
    for threshold, tier_rate in DISCOUNT_TIERS:
        if subtotal > threshold:
            rate = tier_rate
    discount = subtotal * rate
    return rate, discount


def calculate_total(items):
    """Calculate total with discount. Returns (subtotal, discount, total)."""
    subtotal = sum(Decimal(str(item["price"])) * item["quantity"] for item in items)
    rate, discount = calculate_discount(subtotal)
    total = subtotal - discount
    # Regulatory: always round up to nearest cent
    total = Decimal(str(math.ceil(total * 100))) / 100
    return subtotal, discount, total
''',
}

TASK_PRESERVE_BAD = {
    "billing.py": '''DISCOUNT_TIERS = [
    (1000, 0.05),
    (5000, 0.10),
    (10000, 0.15),
]


def calculate_discount(subtotal):
    """Return (discount_rate, discount_amount) for the given subtotal."""
    rate = 0
    for threshold, tier_rate in DISCOUNT_TIERS:
        if subtotal > threshold:
            rate = tier_rate
    return rate, subtotal * rate


def calculate_total(items):
    """Calculate total with discount."""
    subtotal = sum(item["price"] * item["quantity"] for item in items)
    rate, discount = calculate_discount(subtotal)
    total = round(subtotal - discount, 2)
    return {"subtotal": subtotal, "discount": discount, "total": total}
''',
    # Fixes the bug but "improves" away: Decimal->float, ceil->round, tuple->dict
}


def score_preserve_behavior(workdir):
    billing = workdir / "billing.py"
    src = _source(billing)

    if not billing.exists():
        return {"correct": 0, "complete_rate": 0.0, "reason": "billing.py missing"}

    tiers_section = (
        src.split("DISCOUNT_TIERS", 1)[1].split("]", 1)[0]
        if "DISCOUNT_TIERS" in src else ""
    )

    reqs = {
        # Stated: fix the bug
        "bug_fixed": "subtotal > threshold" in src or "subtotal>threshold" in src,
        "discount_fn_exists": "def calculate_discount" in src,
        "total_fn_exists": "def calculate_total" in src,
        # Preserve: Decimal for money
        "uses_decimal": "Decimal" in src and "from decimal import" in src,
        # Preserve: math.ceil for rounding
        "uses_ceil": "math.ceil" in src,
        # Preserve: tuple return from calculate_total
        "tuple_return": (
            "return subtotal, discount, total" in src
            or "return (subtotal, discount, total)" in src
        ),
        # Preserve: DISCOUNT_TIERS uses Decimal values
        "tiers_use_decimal": "Decimal(" in tiers_section,
    }

    return _score(reqs)


# =============================================================================
# Task 5: hard-trailing-reqs
# Build data pipeline class. Main ask is Pipeline with add_step/run.
# 4 additional requirements tacked on AFTER the main feature description.
# =============================================================================
TASK_TRAILING_PROMPT = (
    "Build a data processing pipeline in pipeline.py. The Pipeline class should let "
    "you chain processing steps together. Initialize it with a name. Use add_step(name, fn) "
    "to register a callable step, and run(data) to execute all steps in sequence, where "
    "each step receives the output of the previous one and returns the result.\n\n"
    "The pipeline needs a few more capabilities: a dry_run(data) method that returns the "
    "list of step names that would execute without actually running them; a describe() "
    "method that returns a human-readable string showing the pipeline name and step names; "
    "errors during execution should be caught and stored in self.errors as a list of dicts "
    "with keys step_name and error; also implement __len__ returning the number of steps "
    "and __iter__ yielding step names in order."
)

TASK_TRAILING_GOOD = {
    "pipeline.py": '''class Pipeline:
    def __init__(self, name):
        self.name = name
        self._steps = []
        self.errors = []

    def add_step(self, name, fn):
        self._steps.append((name, fn))

    def run(self, data):
        self.errors = []
        result = data
        for name, fn in self._steps:
            try:
                result = fn(result)
            except Exception as e:
                self.errors.append({"step_name": name, "error": str(e)})
        return result

    def dry_run(self, data):
        return [name for name, fn in self._steps]

    def describe(self):
        step_names = ", ".join(name for name, fn in self._steps)
        return f"Pipeline({self.name}): {step_names}"

    def __len__(self):
        return len(self._steps)

    def __iter__(self):
        return (name for name, fn in self._steps)
''',
}

TASK_TRAILING_BAD = {
    "pipeline.py": '''class Pipeline:
    def __init__(self, name):
        self.name = name
        self._steps = []

    def add_step(self, name, fn):
        self._steps.append((name, fn))

    def run(self, data):
        result = data
        for name, fn in self._steps:
            result = fn(result)
        return result
''',
    # Implements main ask only — misses dry_run, describe, error handling, __len__/__iter__
}


def score_trailing_reqs(workdir):
    pipeline = workdir / "pipeline.py"
    src = _source(pipeline)

    if not pipeline.exists():
        return {"correct": 0, "complete_rate": 0.0, "reason": "pipeline.py missing"}

    tree, err = _check_ast(pipeline)
    if not tree:
        return {"correct": 0, "complete_rate": 0.0, "reason": f"parse error: {err}"}

    reqs = {
        # Main ask
        "pipeline_class": _has_class(tree, "Pipeline"),
        "init_takes_name": "self.name" in src and "def __init__" in src,
        "add_step": _has_function(tree, "add_step"),
        "run_chains": _has_function(tree, "run"),
        # Trailing
        "dry_run": _has_function(tree, "dry_run"),
        "describe": _has_function(tree, "describe"),
        "error_handling": "self.errors" in src and "step_name" in src,
        "dunder_methods": _has_function(tree, "__len__") and _has_function(tree, "__iter__"),
    }

    return _score(reqs)


# =============================================================================
# TASKS registry
# =============================================================================
TASKS = {
    "hard-buried-constraints": {
        "prompt": TASK_BURIED_PROMPT,
        "seed": TASK_BURIED_SEED,
        "good": TASK_BURIED_GOOD,
        "bad": TASK_BURIED_BAD,
        "score": score_buried_constraints,
        "axis": "complete_rate",
    },
    "hard-implicit-patterns": {
        "prompt": TASK_IMPLICIT_PROMPT,
        "seed": TASK_IMPLICIT_SEED,
        "good": TASK_IMPLICIT_GOOD,
        "bad": TASK_IMPLICIT_BAD,
        "score": score_implicit_patterns,
        "axis": "complete_rate",
    },
    "hard-cascade-update": {
        "prompt": TASK_CASCADE_PROMPT,
        "seed": TASK_CASCADE_SEED,
        "good": TASK_CASCADE_GOOD,
        "bad": TASK_CASCADE_BAD,
        "score": score_cascade_update,
        "axis": "complete_rate",
    },
    "hard-preserve-behavior": {
        "prompt": TASK_PRESERVE_PROMPT,
        "seed": TASK_PRESERVE_SEED,
        "good": TASK_PRESERVE_GOOD,
        "bad": TASK_PRESERVE_BAD,
        "score": score_preserve_behavior,
        "axis": "complete_rate",
    },
    "hard-trailing-reqs": {
        "prompt": TASK_TRAILING_PROMPT,
        "seed": {"pipeline.py": '"""Data processing pipeline."""\n'},
        "good": TASK_TRAILING_GOOD,
        "bad": TASK_TRAILING_BAD,
        "score": score_trailing_reqs,
        "axis": "complete_rate",
    },
}
