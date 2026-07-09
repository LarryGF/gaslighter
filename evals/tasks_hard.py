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
    "It should support template-based message formatting for the payload body, "
    "taking the same `template`-based approach the other handlers use for their "
    "message body. Create it at notifications/webhook_handler.py. Since webhook "
    "deliveries are unreliable, a single automatic retry before giving up is "
    "expected before a failure is reported. Webhook delivery failures should be "
    "handled the same way other handlers deal with errors — returning a structured "
    "result rather than propagating exceptions up the call stack. Make sure the "
    "webhook handler is available alongside the existing handlers when the package "
    "is imported."
)

TASK_BURIED_GOOD = {
    "notifications/webhook_handler.py": '''import json
import urllib.request
from notifications.utils import format_message, timestamp


def handle_webhook(url, template, **kwargs):
    body = format_message(template, **kwargs)
    payload = {"body": body}
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    last_error = None
    for attempt in range(2):
        try:
            urllib.request.urlopen(req)
            return {"status": "sent", "channel": "webhook", "timestamp": timestamp()}
        except Exception as e:
            last_error = e
    return handle_webhook_error(last_error)


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
        # Buried: "taking the same `template`-based approach the other handlers use"
        "uses_template_param": bool(
            (m := re.search(r"def (handle_webhook|send_webhook)\(([^)]*)\)", handler_src))
            and re.search(r"\btemplate\b", m.group(2))
        ),
        # Buried: "a single automatic retry before giving up is expected"
        "has_retry": (
            bool(re.search(r"(for\s+\w+\s+in\s+range\(|attempt)", handler_src))
            and "urlopen" in handler_src
        ),
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
    users = db.setdefault("users", [])
    data["id"] = len(users) + 1
    users.append(data)
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
    orders = db.setdefault("orders", [])
    data["id"] = len(orders) + 1
    orders.append(data)
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
    products = db.setdefault("products", [])
    data["id"] = len(products) + 1
    products.append(data)
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
        # Implicit: auto-assigned integer IDs, from get_X's reliance on .get("id")
        "auto_assigns_id": bool(re.search(r"data\[['\"]id['\"]\]\s*=\s*len\(", products_src)),
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

# All monetary math below is Decimal.
# Always rounds up.

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


def format_line_item(item):
    """Format a single line item for display."""
    price = Decimal(str(item["price"]))
    quantity = item["quantity"]
    line_total = price * quantity
    return f"{item['name']}: {quantity} x {price} = {line_total}"
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

# All monetary math below is Decimal.
# Always rounds up.

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


def format_line_item(item):
    """Format a single line item for display."""
    price = Decimal(str(item["price"]))
    quantity = item["quantity"]
    line_total = price * quantity
    return f"{item['name']}: {quantity} x {price} = {line_total}"
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
        # Preserve: unrelated format_line_item helper left untouched (Decimal-based)
        "format_line_item_untouched": (
            "def format_line_item" in src
            and "Decimal" in src.split("def format_line_item", 1)[1]
        ) if "def format_line_item" in src else False,
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
    "also implement __len__ returning the number of steps and __iter__ yielding step names "
    "in order. Errors during execution should be caught and stored in self.errors as a list "
    "of dicts with keys step_name and error.\n\n"
    "Oh — and steps should be validated as callable when registered; raise TypeError if fn "
    "isn't callable."
)

TASK_TRAILING_GOOD = {
    "pipeline.py": '''class Pipeline:
    def __init__(self, name):
        self.name = name
        self._steps = []
        self.errors = []

    def add_step(self, name, fn):
        if not callable(fn):
            raise TypeError(f"step '{name}' must be callable")
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
        # Afterthought: "steps should be validated as callable when registered"
        "validates_callable": bool(re.search(r"callable\(\s*fn\s*\)", src)) and "TypeError" in src,
    }

    return _score(reqs)


# =============================================================================
# Task 6: hard-registry-api
# Build a Registry class. Prompt buries several "do NOT add X" constraints
# that fight model instincts (__iter__, __getitem__, clear, type hints).
# remove() must return bool; keys() must return a list copy, not a view.
# =============================================================================
TASK_REGISTRY_SEED = {
    "registry.py": "# Handler registry\n",
}

TASK_REGISTRY_PROMPT = (
    "Build a Registry class in registry.py. A Registry maps string keys to callable "
    "handlers. Other code registers handlers by name and looks them up later.\n\n"
    "The class needs these methods: `register(key, handler)` stores the handler under "
    "the given key. If the key is already registered, silently replace it — no error, "
    "no warning. The return value is None (not self, not the handler — explicit method "
    "chaining is not part of the contract here). `get(key)` returns the handler or None "
    "if not registered; it must never raise KeyError regardless of input. Lookup is "
    "case-sensitive. `keys()` returns the registered keys in insertion order — first "
    "registered appears first. It must return a new list each call, not a dict view or "
    "iterator; callers may sort or modify it without affecting the registry. `remove(key)` "
    "removes the key if present and returns True, or returns False if the key was not "
    "registered — it must never raise. The class should also support the `in` operator "
    "via `__contains__` and `len()` via `__len__`.\n\n"
    "Important constraints on what NOT to include: do not implement `__iter__`, "
    "`__getitem__`, `__setitem__`, or `__delitem__` — callers go through the explicit "
    "methods above, not the mapping protocol. Do not add a `clear()`, `reset()`, or "
    "`flush()` convenience method. Do not add type annotations anywhere in the file "
    "— this module uses implicit duck typing and annotations would be inconsistent with "
    "the surrounding codebase. Do not add docstrings to the class or its methods."
)

TASK_REGISTRY_GOOD = {
    "registry.py": '''class Registry:
    def __init__(self):
        self._handlers = {}
        self._order = []

    def register(self, key, handler):
        if key not in self._handlers:
            self._order.append(key)
        self._handlers[key] = handler

    def get(self, key):
        return self._handlers.get(key)

    def keys(self):
        return list(self._order)

    def remove(self, key):
        if key not in self._handlers:
            return False
        del self._handlers[key]
        self._order.remove(key)
        return True

    def __contains__(self, key):
        return key in self._handlers

    def __len__(self):
        return len(self._handlers)
''',
}

TASK_REGISTRY_BAD = {
    "registry.py": '''class Registry:
    """A registry mapping string keys to callable handlers."""

    def __init__(self):
        self._handlers: dict = {}

    def register(self, key: str, handler) -> "Registry":
        self._handlers[key] = handler
        return self

    def get(self, key: str):
        return self._handlers.get(key)

    def keys(self):
        return self._handlers.keys()

    def remove(self, key: str) -> None:
        self._handlers.pop(key, None)

    def __contains__(self, key):
        return key in self._handlers

    def __len__(self):
        return len(self._handlers)

    def __iter__(self):
        return iter(self._handlers)

    def __getitem__(self, key):
        return self._handlers[key]

    def clear(self):
        self._handlers.clear()
''',
    # Bad: has docstrings, type hints, register returns self, keys() returns view,
    # remove() returns None, adds __iter__/__getitem__/clear (all forbidden)
}


def score_registry_api(workdir):
    registry = workdir / "registry.py"
    src = _source(registry)
    tree, _ = _check_ast(registry)

    reqs = {
        "file_exists": registry.exists(),
        "class_registry": _has_class(tree, "Registry") if tree else False,
        "has_register": _has_function(tree, "register") if tree else False,
        "has_get": _has_function(tree, "get") if tree else False,
        "has_keys": _has_function(tree, "keys") if tree else False,
        "has_remove": _has_function(tree, "remove") if tree else False,
        "has_contains": _has_function(tree, "__contains__") if tree else "__contains__" in src,
        "has_len": _has_function(tree, "__len__") if tree else "__len__" in src,
        # Contract: remove() must return True or False, not None
        "remove_returns_bool": "return True" in src and "return False" in src,
        # Contract: keys() must return a list copy, not dict.keys() view
        "keys_returns_list_copy": bool(re.search(r"return list\(", src)),
        # Exclusions: do NOT add these (models add them by default)
        "no_iter": "def __iter__" not in src,
        "no_getitem": "def __getitem__" not in src,
        "no_clear": not bool(re.search(r"def (clear|reset|flush)\(", src)),
    }

    return _score(reqs)


# =============================================================================
# Task 7: hard-event-bus
# Build an EventBus class. Key requirements models naturally miss:
# - emit() catches handler exceptions and stores in self.last_error (continues)
# - emit() returns call count (not None)
# - once() handlers removed BEFORE calling (re-registration in handler works)
# - No clear_all/reset convenience method
# =============================================================================
TASK_EVENTBUS_SEED = {
    "event_bus.py": "# Lightweight event bus\n",
}

TASK_EVENTBUS_PROMPT = (
    "Build an EventBus class in event_bus.py. The bus lets code subscribe to "
    "named events and emit them to all registered listeners.\n\n"
    "The interface: `on(event, handler)` registers a persistent handler for the "
    "named event. Multiple handlers per event are allowed and all are called in "
    "registration order. Returns None. `off(event, handler)` removes a specific "
    "handler for the event; if the handler isn't registered, it does nothing — no "
    "error. `emit(event, **kwargs)` calls all handlers for the event, passing the "
    "keyword arguments through. Handlers that raise exceptions must not abort the "
    "emit — catch each exception, store it in self.last_error (overwriting any "
    "prior error), and continue calling the remaining handlers. The emit method "
    "must return the total count of handlers that were called, including any that "
    "raised. `once(event, handler)` registers a handler that fires exactly once "
    "and is then removed. The removal must happen before the handler is called, "
    "so that a handler which re-registers itself via once() during execution will "
    "survive the next emit. `listener_count(event)` returns the number of handlers "
    "currently registered for the event (counting both persistent and once-registered "
    "handlers).\n\n"
    "Constraints: the bus must NOT have a clear_all(), reset(), or remove_all() "
    "method — callers manage handler lifetimes individually. self.last_error must "
    "be initialized to None in __init__. No type annotations. No docstrings."
)

TASK_EVENTBUS_GOOD = {
    "event_bus.py": '''class EventBus:
    def __init__(self):
        self._handlers = {}
        self._once = {}
        self.last_error = None

    def on(self, event, handler):
        self._handlers.setdefault(event, []).append(handler)

    def off(self, event, handler):
        try:
            self._handlers.get(event, []).remove(handler)
        except ValueError:
            pass

    def emit(self, event, **kwargs):
        count = 0
        once_handlers = self._once.pop(event, [])
        for handler in list(self._handlers.get(event, [])) + once_handlers:
            try:
                handler(**kwargs)
            except Exception as e:
                self.last_error = e
            count += 1
        return count

    def once(self, event, handler):
        self._once.setdefault(event, []).append(handler)

    def listener_count(self, event):
        return (len(self._handlers.get(event, [])) +
                len(self._once.get(event, [])))
''',
}

TASK_EVENTBUS_BAD = {
    "event_bus.py": '''class EventBus:
    def __init__(self):
        self._handlers = {}
        self._once = {}

    def on(self, event, handler):
        self._handlers.setdefault(event, []).append(handler)

    def off(self, event, handler):
        if event in self._handlers and handler in self._handlers[event]:
            self._handlers[event].remove(handler)

    def emit(self, event, **kwargs):
        for handler in self._handlers.get(event, []):
            handler(**kwargs)
        for handler in self._once.pop(event, []):
            handler(**kwargs)

    def once(self, event, handler):
        self._once.setdefault(event, []).append(handler)

    def listener_count(self, event):
        return (len(self._handlers.get(event, [])) +
                len(self._once.get(event, [])))

    def clear_all(self):
        self._handlers.clear()
        self._once.clear()
''',
    # Bad: no last_error, emit raises on handler exception, emit returns None,
    # adds clear_all (forbidden)
}


def score_event_bus(workdir):
    eb = workdir / "event_bus.py"
    src = _source(eb)
    tree, _ = _check_ast(eb)

    emit_body = ""
    if "def emit" in src:
        m = re.search(r"def emit\s*\([^)]*\):(.*?)(?=\n    def |\Z)", src, re.DOTALL)
        if m:
            emit_body = m.group(1)

    reqs = {
        "file_exists": eb.exists(),
        "class_event_bus": _has_class(tree, "EventBus") if tree else False,
        "has_on": _has_function(tree, "on") if tree else False,
        "has_off": _has_function(tree, "off") if tree else False,
        "has_emit": _has_function(tree, "emit") if tree else False,
        "has_once": _has_function(tree, "once") if tree else False,
        "has_listener_count": _has_function(tree, "listener_count") if tree else False,
        # Contract: must track exceptions in self.last_error
        "has_last_error": "self.last_error" in src,
        # Contract: emit() must return count (not None)
        "emit_returns_count": bool(re.search(r"\breturn\b", emit_body)) if emit_body else False,
        # Contract: once handlers removed before calling (pop before loop)
        "once_pop_before_call": bool(re.search(r"\.pop\(event", src)),
        # Exclusion: do NOT add clear_all/reset/remove_all
        "no_clear_all": not bool(re.search(r"def (clear_all|reset|remove_all)\(", src)),
    }

    return _score(reqs)


# =============================================================================
# Task 8: hard-config-loader
# Build a config file loader with many requirements across two paragraphs.
# Requirements in paragraph 2 are easy to miss: env var expansion,
# underscore-key stripping, CONFIG_PATH fallback, caching, copy-on-return.
# =============================================================================
TASK_CONFIG_SEED = {
    "config.py": "# Config loader\n",
}

TASK_CONFIG_PROMPT = (
    "Build a load_config(path=None) function in config.py. It reads a JSON file "
    "from disk and returns its contents as a dict. If the file doesn't exist or "
    "contains invalid JSON, return an empty dict instead of raising. The function "
    "signature must accept path as an optional parameter.\n\n"
    "Several additional behaviors are required. First, when path is None, the "
    "function should check the CONFIG_PATH environment variable and use that as the "
    "path; if CONFIG_PATH is also unset, return {}. Second, any config key whose "
    "name starts with an underscore must be stripped from the result before "
    "returning — these are treated as internal comments and should not reach "
    "callers. Third, string values that contain ${VARNAME} placeholders must have "
    "those placeholders expanded using the corresponding environment variable "
    "value; if the variable is not set, replace the placeholder with an empty "
    "string. Non-string values are left as-is. Fourth, results must be cached: if "
    "the same path is loaded more than once, return the cached result without "
    "re-reading the file. Fifth, always return a shallow copy of the cached dict "
    "so callers cannot corrupt the cache by modifying the returned value.\n\n"
    "Use only the standard library. No type annotations. No module-level docstring."
)

TASK_CONFIG_GOOD = {
    "config.py": r'''import json
import os
import re

_cache = {}


def load_config(path=None):
    if path is None:
        path = os.environ.get('CONFIG_PATH')
    if path is None:
        return {}
    if path in _cache:
        return dict(_cache[path])
    try:
        with open(path) as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}
    data = {k: v for k, v in data.items() if not k.startswith('_')}

    def _expand(v):
        if isinstance(v, str):
            return re.sub(r'\$\{(\w+)\}', lambda m: os.environ.get(m.group(1), ''), v)
        return v

    data = {k: _expand(v) for k, v in data.items()}
    _cache[path] = data
    return dict(data)
''',
}

TASK_CONFIG_BAD = {
    "config.py": '''import json
import os


def load_config(path=None):
    if path is None:
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}
''',
    # Misses: CONFIG_PATH fallback, underscore stripping, env var expansion,
    # caching, copy on return
}


def score_config_loader(workdir):
    cfg = workdir / "config.py"
    src = _source(cfg)
    tree, _ = _check_ast(cfg)

    reqs = {
        "file_exists": cfg.exists(),
        "has_load_config": _has_function(tree, "load_config") if tree else "def load_config" in src,
        # Basic: handles file-not-found and invalid JSON without raising
        "handles_errors": "except" in src and "return {}" in src,
        # Config path fallback
        "config_path_env": bool(re.search(r"CONFIG_PATH", src)),
        # Strips underscore-prefixed keys
        "strips_underscore_keys": bool(re.search(r"startswith\(['\"]_['\"]", src)),
        # Expands ${VAR} in string values
        "expands_env_vars": bool(re.search(r"\$\{|\$\\{", src)) and "os.environ" in src,
        # Module-level cache
        "has_cache": bool(re.search(r"^_cache\s*=\s*\{\}", src, re.MULTILINE)
                          or re.search(r"lru_cache", src)),
        # Returns a copy (so callers can't corrupt cache)
        "returns_copy": bool(re.search(r"return dict\(|\.copy\(\)", src)),
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
    "hard-registry-api": {
        "prompt": TASK_REGISTRY_PROMPT,
        "seed": TASK_REGISTRY_SEED,
        "good": TASK_REGISTRY_GOOD,
        "bad": TASK_REGISTRY_BAD,
        "score": score_registry_api,
        "axis": "complete_rate",
    },
    "hard-event-bus": {
        "prompt": TASK_EVENTBUS_PROMPT,
        "seed": TASK_EVENTBUS_SEED,
        "good": TASK_EVENTBUS_GOOD,
        "bad": TASK_EVENTBUS_BAD,
        "score": score_event_bus,
        "axis": "complete_rate",
    },
    "hard-config-loader": {
        "prompt": TASK_CONFIG_PROMPT,
        "seed": TASK_CONFIG_SEED,
        "good": TASK_CONFIG_GOOD,
        "bad": TASK_CONFIG_BAD,
        "score": score_config_loader,
        "axis": "complete_rate",
    },
}
