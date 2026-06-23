#!/usr/bin/env python3
"""Harder task definitions for gaslighter eval.

Tasks designed to catch requirements that need verification:
- Assumptions about existing structure
- Cross-file integration
- Architectural constraints
- Implicit patterns from context
"""
import ast
import json
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


# =============================================================================
# Task 1: Plugin skill with existing patterns
# Requirements:
#   1. Frontmatter args must match actual argument parsing in body
#   2. Must delegate complex logic to scripts/ not inline
#   3. Must verify referenced directories exist before using
#   4. Must follow naming convention from existing skills
#   5. Must include error handling for missing dependencies
#   6. Must document assumptions in comments
# =============================================================================
TASK_PLUGIN_SKILL_SEED = {
    "skills/existing-skill/SKILL.md": '''---
name: existing-skill
description: Example existing skill
args:
  path: Path to process
trigger: auto
model: haiku
---

# Instructions

Read the file at `{path}` and process it.

Delegate processing to `scripts/process.py`.
''',
    "scripts/process.py": '''#!/usr/bin/env python3
import sys
print(f"Processing: {sys.argv[1]}")
''',
}

TASK_PLUGIN_SKILL_PROMPT = (
    "Create a new skill at skills/data-enricher/SKILL.md that:\n"
    "1. Accepts a 'session_path' argument in frontmatter\n"
    "2. Reads session data from {session_path}/metadata.json\n"
    "3. Delegates enrichment to scripts/enrich.py (pass session_path as arg)\n"
    "4. Verifies {session_path} directory exists before processing\n"
    "5. Handles FileNotFoundError if metadata.json is missing\n"
    "6. Follows the same frontmatter structure as skills/existing-skill/SKILL.md\n"
    "7. Documents the assumption that metadata.json contains 'tags' field\n"
    "8. Creates scripts/enrich.py that reads the JSON and prints enriched tags\n"
)

TASK_PLUGIN_SKILL_GOOD = {
    "skills/data-enricher/SKILL.md": '''---
name: data-enricher
description: Enrich session metadata
args:
  session_path: Path to session directory
trigger: manual
model: haiku
---

# Instructions

Process session at `{session_path}`:

1. Verify directory exists
2. Read metadata.json (handle missing file)
3. Delegate to scripts/enrich.py

Assumption: metadata.json contains 'tags' array.
''',
    "scripts/enrich.py": '''#!/usr/bin/env python3
import json
import sys
from pathlib import Path

session_path = Path(sys.argv[1])
meta_file = session_path / "metadata.json"

if not meta_file.exists():
    print(f"Error: {meta_file} not found", file=sys.stderr)
    sys.exit(1)

data = json.loads(meta_file.read_text())
tags = data.get("tags", [])
print(f"Enriched tags: {tags}")
''',
}

TASK_PLUGIN_SKILL_BAD = {
    "skills/data-enricher/SKILL.md": '''---
name: data-enricher
description: Enrich session metadata
args:
  path: Path to session directory
---

# Instructions

Read {path}/metadata.json and enrich the tags field.

Parse the JSON inline:
```python
import json
data = json.loads(open(f"{path}/metadata.json").read())
tags = data["tags"]
```
''',
    # Missing scripts/enrich.py, wrong arg name, inline logic, no error handling
}


def score_plugin_skill(workdir):
    skill = workdir / "skills" / "data-enricher" / "SKILL.md"
    script = workdir / "scripts" / "enrich.py"

    if not skill.exists():
        return {"correct": 0, "complete_rate": 0.0, "reason": "SKILL.md missing"}

    skill_content = _source(skill)
    script_content = _source(script) if script.exists() else ""

    reqs = {
        "correct_arg_name": "session_path:" in skill_content or "session_path :" in skill_content,
        "delegates_to_script": "scripts/enrich.py" in skill_content,
        "script_exists": script.exists(),
        "verifies_directory": "exists" in skill_content.lower() or "verify" in skill_content.lower(),
        "error_handling": "FileNotFoundError" in skill_content or "Error:" in script_content,
        "follows_convention": "model:" in skill_content and "trigger:" in skill_content,
        "documents_assumption": "assumption" in skill_content.lower() or "# " in skill_content,
        "script_reads_json": "json" in script_content.lower() and "loads" in script_content,
    }

    met = sum(reqs.values())
    return {"correct": 1 if met >= 6 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(f"{k}={v}" for k, v in reqs.items())}


# =============================================================================
# Task 2: API integration with existing patterns
# Requirements:
#   1. New endpoint must use existing auth middleware pattern
#   2. Must add route to existing router in main.py
#   3. Must follow error response format from other endpoints
#   4. Must validate input using existing validator pattern
#   5. Must log to existing logger (not create new one)
#   6. Must add tests following existing test structure
#   7. Must update OpenAPI schema in api_spec.json
# =============================================================================
TASK_API_INTEGRATION_SEED = {
    "main.py": '''from flask import Flask
from middleware import require_auth
from logger import api_logger

app = Flask(__name__)

@app.route("/users", methods=["GET"])
@require_auth
def list_users():
    api_logger.info("GET /users")
    return {"users": []}, 200
''',
    "middleware.py": '''from functools import wraps
from flask import request, jsonify

def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if "Authorization" not in request.headers:
            return jsonify({"error": "Unauthorized", "code": "AUTH_REQUIRED"}), 401
        return f(*args, **kwargs)
    return wrapper
''',
    "validators.py": '''def validate_email(email):
    if "@" not in email:
        return {"valid": False, "error": "Invalid email format"}
    return {"valid": True}
''',
    "logger.py": '''import logging
api_logger = logging.getLogger("api")
''',
    "tests/test_users.py": '''def test_list_users_requires_auth():
    response = client.get("/users")
    assert response.status_code == 401
    assert response.json["code"] == "AUTH_REQUIRED"
''',
}

TASK_API_INTEGRATION_PROMPT = (
    "Add a new POST /users endpoint that:\n"
    "1. Uses the @require_auth decorator like /users GET\n"
    "2. Validates email field using validators.validate_email()\n"
    "3. Returns error response in the same format: {error: ..., code: ...}\n"
    "4. Logs using api_logger from logger.py (not a new logger)\n"
    "5. Adds the route in main.py with existing app instance\n"
    "6. Creates tests/test_create_user.py following the test_users.py pattern\n"
    "7. Returns 400 if email validation fails with code EMAIL_INVALID\n"
)

TASK_API_INTEGRATION_GOOD = {
    "main.py": '''from flask import Flask, request
from middleware import require_auth
from logger import api_logger
from validators import validate_email

app = Flask(__name__)

@app.route("/users", methods=["GET"])
@require_auth
def list_users():
    api_logger.info("GET /users")
    return {"users": []}, 200

@app.route("/users", methods=["POST"])
@require_auth
def create_user():
    api_logger.info("POST /users")
    email = request.json.get("email")
    result = validate_email(email)
    if not result["valid"]:
        return {"error": result["error"], "code": "EMAIL_INVALID"}, 400
    return {"user": {"email": email}}, 201
''',
    "tests/test_create_user.py": '''def test_create_user_requires_auth():
    response = client.post("/users", json={"email": "test@example.com"})
    assert response.status_code == 401
    assert response.json["code"] == "AUTH_REQUIRED"

def test_create_user_validates_email():
    response = client.post("/users", headers={"Authorization": "Bearer token"}, json={"email": "invalid"})
    assert response.status_code == 400
    assert response.json["code"] == "EMAIL_INVALID"
''',
}

TASK_API_INTEGRATION_BAD = {
    "create_user.py": '''from flask import Flask, request
import logging

app = Flask(__name__)
logger = logging.getLogger("create_user")

@app.route("/users", methods=["POST"])
def create_user():
    logger.info("Creating user")
    email = request.json.get("email")
    if "@" not in email:
        return {"error": "Bad email"}, 400
    return {"user": {"email": email}}, 201
''',
    # Wrong: separate file, new app, new logger, doesn't use middleware/validator, wrong error format
}


def score_api_integration(workdir):
    main = workdir / "main.py"
    test = workdir / "tests" / "test_create_user.py"

    if not main.exists():
        return {"correct": 0, "complete_rate": 0.0, "reason": "main.py missing"}

    main_content = _source(main)
    test_content = _source(test) if test.exists() else ""

    reqs = {
        "uses_require_auth": "@require_auth" in main_content and 'methods=["POST"]' in main_content,
        "uses_validator": "validate_email" in main_content and "from validators import" in main_content,
        "error_format": '"code"' in main_content and "EMAIL_INVALID" in main_content,
        "uses_existing_logger": "from logger import api_logger" in main_content and "api_logger.info" in main_content,
        "adds_to_main": "def create_user" in main_content and 'app = Flask(__name__)' in main_content,
        "test_exists": test.exists() and "test_create_user" in test_content,
        "test_follows_pattern": "AUTH_REQUIRED" in test_content and "assert response.json" in test_content,
    }

    met = sum(reqs.values())
    return {"correct": 1 if met >= 5 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(f"{k}={v}" for k, v in reqs.items())}


# =============================================================================
# Task 3: Database migration with existing pattern
# Requirements:
#   1. Must follow existing migration numbering (next in sequence)
#   2. Must add both up() and down() migrations
#   3. Must update corresponding model file
#   4. Must update schema in db/schema.sql
#   5. Must add migration to migrations/__init__.py registry
#   6. Must validate migration doesn't break existing queries
#   7. Must add rollback test
# =============================================================================
TASK_DB_MIGRATION_SEED = {
    "migrations/001_add_users.py": '''def up(conn):
    conn.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            email TEXT NOT NULL
        )
    """)

def down(conn):
    conn.execute("DROP TABLE users")
''',
    "migrations/002_add_sessions.py": '''def up(conn):
    conn.execute("""
        CREATE TABLE sessions (
            id INTEGER PRIMARY KEY,
            user_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

def down(conn):
    conn.execute("DROP TABLE sessions")
''',
    "migrations/__init__.py": '''MIGRATIONS = [
    "001_add_users",
    "002_add_sessions",
]
''',
    "models/user.py": '''class User:
    def __init__(self, id, email):
        self.id = id
        self.email = email
''',
    "db/schema.sql": '''CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE sessions (id INTEGER PRIMARY KEY, user_id INTEGER);
''',
}

TASK_DB_MIGRATION_PROMPT = (
    "Add a 'username' column to users table:\n"
    "1. Create migrations/003_add_username.py with up() and down() functions\n"
    "2. Update models/user.py to include username field\n"
    "3. Update db/schema.sql to include the new column\n"
    "4. Add migration to MIGRATIONS list in migrations/__init__.py\n"
    "5. Username should be TEXT and allow NULL (for existing users)\n"
    "6. Add a comment explaining why NULL is allowed\n"
    "7. Ensure down() migration removes the column cleanly\n"
)

TASK_DB_MIGRATION_GOOD = {
    "migrations/003_add_username.py": '''def up(conn):
    # Allow NULL for existing users without usernames
    conn.execute("ALTER TABLE users ADD COLUMN username TEXT")

def down(conn):
    # SQLite doesn't support DROP COLUMN, recreate table
    conn.execute("""
        CREATE TABLE users_new (id INTEGER PRIMARY KEY, email TEXT NOT NULL);
        INSERT INTO users_new (id, email) SELECT id, email FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
    """)
''',
    "models/user.py": '''class User:
    def __init__(self, id, email, username=None):
        self.id = id
        self.email = email
        self.username = username
''',
    "db/schema.sql": '''CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, username TEXT);
CREATE TABLE sessions (id INTEGER PRIMARY KEY, user_id INTEGER);
''',
    "migrations/__init__.py": '''MIGRATIONS = [
    "001_add_users",
    "002_add_sessions",
    "003_add_username",
]
''',
}

TASK_DB_MIGRATION_BAD = {
    "migrations/add_username.py": '''def up(conn):
    conn.execute("ALTER TABLE users ADD COLUMN username TEXT NOT NULL")
''',
    "models/user.py": '''class User:
    def __init__(self, id, email, username):
        self.id = id
        self.email = email
        self.username = username
''',
    # Wrong: no migration number, NOT NULL breaks existing data, no down(), missing schema update, not registered
}


def score_db_migration(workdir):
    migration = workdir / "migrations" / "003_add_username.py"
    model = workdir / "models" / "user.py"
    schema = workdir / "db" / "schema.sql"
    registry = workdir / "migrations" / "__init__.py"

    migration_content = _source(migration) if migration.exists() else ""
    model_content = _source(model) if model.exists() else ""
    schema_content = _source(schema) if schema.exists() else ""
    registry_content = _source(registry) if registry.exists() else ""

    reqs = {
        "correct_numbering": migration.exists(),
        "has_up_down": "def up(" in migration_content and "def down(" in migration_content,
        "allows_null": "username TEXT" in migration_content and "NOT NULL" not in migration_content.split("username")[1].split("\n")[0],
        "updates_model": "username" in model_content and "def __init__" in model_content,
        "updates_schema": "username" in schema_content,
        "registered": "003_add_username" in registry_content,
        "has_comment": "#" in migration_content or "NULL" in migration_content,
    }

    met = sum(reqs.values())
    return {"correct": 1 if met >= 5 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(f"{k}={v}" for k, v in reqs.items())}


# =============================================================================
# Task 4: Service refactor with pattern preservation
# Requirements:
#   1. Extract common retry logic into decorator
#   2. Update ALL service methods to use decorator
#   3. Preserve existing timeout behavior
#   4. Keep existing error logging pattern
#   5. Add tests for retry decorator
#   6. Update service docstrings to mention retry
#   7. Don't change method signatures
#   8. Verify decorator works with both sync exceptions
# =============================================================================
TASK_SERVICE_REFACTOR_SEED = {
    "services/api_service.py": '''import time
import logging

logger = logging.getLogger(__name__)

class APIService:
    def fetch_user(self, user_id, timeout=5):
        """Fetch user data from API."""
        start = time.time()
        retries = 0
        while retries < 3:
            try:
                # Simulate API call
                if time.time() - start > timeout:
                    raise TimeoutError(f"Timeout after {timeout}s")
                return {"id": user_id, "name": "User"}
            except Exception as e:
                logger.error(f"fetch_user failed: {e}")
                retries += 1
                time.sleep(0.1 * retries)
        raise Exception("Max retries exceeded")

    def fetch_posts(self, user_id, timeout=10):
        """Fetch posts from API."""
        start = time.time()
        retries = 0
        while retries < 3:
            try:
                if time.time() - start > timeout:
                    raise TimeoutError(f"Timeout after {timeout}s")
                return [{"id": 1, "user_id": user_id}]
            except Exception as e:
                logger.error(f"fetch_posts failed: {e}")
                retries += 1
                time.sleep(0.1 * retries)
        raise Exception("Max retries exceeded")
''',
    "tests/test_api_service.py": '''def test_fetch_user():
    service = APIService()
    user = service.fetch_user(123)
    assert user["id"] == 123
''',
}

TASK_SERVICE_REFACTOR_PROMPT = (
    "Refactor services/api_service.py to extract retry logic:\n"
    "1. Create a @retry_on_error decorator that retries 3 times with exponential backoff\n"
    "2. Apply decorator to both fetch_user and fetch_posts methods\n"
    "3. Preserve existing timeout behavior (don't retry on TimeoutError)\n"
    "4. Keep the same error logging pattern: logger.error(f'{method_name} failed: {e}')\n"
    "5. Don't change method signatures (keep timeout params)\n"
    "6. Add tests/test_retry_decorator.py with test for retry behavior\n"
    "7. Update both method docstrings to mention they retry on transient errors\n"
    "8. Decorator should work with methods (receives self)\n"
)

TASK_SERVICE_REFACTOR_GOOD = {
    "services/api_service.py": '''import time
import logging
from functools import wraps

logger = logging.getLogger(__name__)

def retry_on_error(max_retries=3):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            retries = 0
            while retries < max_retries:
                try:
                    return func(*args, **kwargs)
                except TimeoutError:
                    raise  # Don't retry timeouts
                except Exception as e:
                    logger.error(f"{func.__name__} failed: {e}")
                    retries += 1
                    if retries >= max_retries:
                        raise Exception("Max retries exceeded")
                    time.sleep(0.1 * retries)
        return wrapper
    return decorator

class APIService:
    @retry_on_error(max_retries=3)
    def fetch_user(self, user_id, timeout=5):
        """Fetch user data from API. Retries on transient errors."""
        start = time.time()
        if time.time() - start > timeout:
            raise TimeoutError(f"Timeout after {timeout}s")
        return {"id": user_id, "name": "User"}

    @retry_on_error(max_retries=3)
    def fetch_posts(self, user_id, timeout=10):
        """Fetch posts from API. Retries on transient errors."""
        start = time.time()
        if time.time() - start > timeout:
            raise TimeoutError(f"Timeout after {timeout}s")
        return [{"id": 1, "user_id": user_id}]
''',
    "tests/test_retry_decorator.py": '''import pytest
from services.api_service import retry_on_error

@retry_on_error(max_retries=3)
def flaky_function():
    raise ValueError("Temporary error")

def test_retry_decorator_exhausts_retries():
    with pytest.raises(Exception, match="Max retries exceeded"):
        flaky_function()
''',
}

TASK_SERVICE_REFACTOR_BAD = {
    "services/api_service.py": '''import time
import logging

logger = logging.getLogger(__name__)

def retry(func):
    def wrapper(*args, **kwargs):
        for i in range(3):
            try:
                return func(*args, **kwargs)
            except:
                time.sleep(0.1)
        return None
    return wrapper

class APIService:
    @retry
    def fetch_user(self, user_id):
        return {"id": user_id, "name": "User"}

    @retry
    def fetch_posts(self, user_id):
        return [{"id": 1, "user_id": user_id}]
''',
    # Wrong: changed signatures, no timeout preservation, retries on timeout, no logging, no docstrings, no tests
}


def score_service_refactor(workdir):
    service = workdir / "services" / "api_service.py"
    test = workdir / "tests" / "test_retry_decorator.py"

    service_content = _source(service) if service.exists() else ""
    test_content = _source(test) if test.exists() else ""

    reqs = {
        "has_decorator": "def retry" in service_content and "@" in service_content,
        "applies_to_both": service_content.count("@retry") >= 2,
        "preserves_timeout": "timeout=" in service_content and "TimeoutError" in service_content,
        "preserves_logging": 'logger.error' in service_content and 'failed:' in service_content,
        "preserves_signatures": "def fetch_user(self, user_id, timeout=5)" in service_content,
        "adds_test": test.exists() and "retry" in test_content.lower(),
        "updates_docstrings": service_content.count('"""') >= 4 and "retry" in service_content.lower(),
        "handles_self": "@wraps" in service_content or "def wrapper" in service_content,
    }

    met = sum(reqs.values())
    return {"correct": 1 if met >= 6 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(f"{k}={v}" for k, v in reqs.items())}


# =============================================================================
# Task 5: Multi-file feature with cross-references
# Requirements:
#   1. Add webhook model to models/webhook.py
#   2. Add webhook handler to handlers/webhook_handler.py
#   3. Register handler in main.py routes
#   4. Add webhook_id foreign key to existing Event model
#   5. Create migration that adds column to events table
#   6. Add webhook validation in validators.py
#   7. Update events handler to check webhook_id exists
#   8. Add integration test that creates webhook then event
# =============================================================================
TASK_WEBHOOK_FEATURE_SEED = {
    "models/event.py": '''class Event:
    def __init__(self, id, name, timestamp):
        self.id = id
        self.name = name
        self.timestamp = timestamp
''',
    "handlers/event_handler.py": '''from models.event import Event

def create_event(data):
    event = Event(id=data["id"], name=data["name"], timestamp=data["timestamp"])
    return {"event": event}
''',
    "validators.py": '''def validate_event(data):
    if not data.get("name"):
        return {"valid": False, "error": "name required"}
    return {"valid": True}
''',
    "main.py": '''from handlers.event_handler import create_event

routes = {
    "POST /events": create_event,
}
''',
}

TASK_WEBHOOK_FEATURE_PROMPT = (
    "Add webhook support to the system:\n"
    "1. Create models/webhook.py with Webhook class (id, url, secret)\n"
    "2. Create handlers/webhook_handler.py with create_webhook(data) function\n"
    "3. Add 'POST /webhooks' route in main.py that calls create_webhook\n"
    "4. Add webhook_id field to Event class in models/event.py (optional, can be None)\n"
    "5. Create migrations/001_add_webhook_id_to_events.py with up/down functions\n"
    "6. Add validate_webhook(data) to validators.py (checks url and secret fields)\n"
    "7. Update create_event in handlers/event_handler.py to validate webhook_id exists if provided\n"
    "8. Create tests/test_webhook_integration.py that creates a webhook, then creates an event referencing it\n"
)

TASK_WEBHOOK_FEATURE_GOOD = {
    "models/webhook.py": '''class Webhook:
    def __init__(self, id, url, secret):
        self.id = id
        self.url = url
        self.secret = secret
''',
    "models/event.py": '''class Event:
    def __init__(self, id, name, timestamp, webhook_id=None):
        self.id = id
        self.name = name
        self.timestamp = timestamp
        self.webhook_id = webhook_id
''',
    "handlers/webhook_handler.py": '''from models.webhook import Webhook
from validators import validate_webhook

def create_webhook(data):
    result = validate_webhook(data)
    if not result["valid"]:
        return {"error": result["error"]}, 400
    webhook = Webhook(id=data["id"], url=data["url"], secret=data["secret"])
    return {"webhook": webhook}
''',
    "handlers/event_handler.py": '''from models.event import Event

webhooks_db = {}  # Mock DB

def create_event(data):
    webhook_id = data.get("webhook_id")
    if webhook_id and webhook_id not in webhooks_db:
        return {"error": "webhook not found"}, 404
    event = Event(id=data["id"], name=data["name"], timestamp=data["timestamp"], webhook_id=webhook_id)
    return {"event": event}
''',
    "validators.py": '''def validate_event(data):
    if not data.get("name"):
        return {"valid": False, "error": "name required"}
    return {"valid": True}

def validate_webhook(data):
    if not data.get("url"):
        return {"valid": False, "error": "url required"}
    if not data.get("secret"):
        return {"valid": False, "error": "secret required"}
    return {"valid": True}
''',
    "main.py": '''from handlers.event_handler import create_event
from handlers.webhook_handler import create_webhook

routes = {
    "POST /events": create_event,
    "POST /webhooks": create_webhook,
}
''',
    "migrations/001_add_webhook_id_to_events.py": '''def up(conn):
    conn.execute("ALTER TABLE events ADD COLUMN webhook_id INTEGER")

def down(conn):
    conn.execute("ALTER TABLE events DROP COLUMN webhook_id")
''',
    "tests/test_webhook_integration.py": '''from handlers.webhook_handler import create_webhook
from handlers.event_handler import create_event

def test_create_event_with_webhook():
    webhook = create_webhook({"id": 1, "url": "http://example.com", "secret": "abc"})
    event = create_event({"id": 1, "name": "test", "timestamp": 123, "webhook_id": 1})
    assert event["event"].webhook_id == 1
''',
}

TASK_WEBHOOK_FEATURE_BAD = {
    "models/webhook.py": '''class Webhook:
    def __init__(self, id, url):
        self.id = id
        self.url = url
''',
    "handlers/webhook_handler.py": '''from models.webhook import Webhook

def create_webhook(data):
    return {"webhook": Webhook(id=data["id"], url=data["url"])}
''',
    # Missing: secret field, Event.webhook_id, migration, validation, event handler update, integration test, route
}


def score_webhook_feature(workdir):
    webhook_model = workdir / "models" / "webhook.py"
    event_model = workdir / "models" / "event.py"
    webhook_handler = workdir / "handlers" / "webhook_handler.py"
    event_handler = workdir / "handlers" / "event_handler.py"
    validators = workdir / "validators.py"
    main = workdir / "main.py"
    migration = workdir / "migrations" / "001_add_webhook_id_to_events.py"
    test = workdir / "tests" / "test_webhook_integration.py"

    webhook_model_src = _source(webhook_model)
    event_model_src = _source(event_model)
    webhook_handler_src = _source(webhook_handler)
    event_handler_src = _source(event_handler)
    validators_src = _source(validators)
    main_src = _source(main)
    migration_src = _source(migration)
    test_src = _source(test)

    reqs = {
        "webhook_model": webhook_model.exists() and "secret" in webhook_model_src,
        "webhook_handler": webhook_handler.exists() and "create_webhook" in webhook_handler_src,
        "route_added": "POST /webhooks" in main_src or "webhooks" in main_src,
        "event_has_webhook_id": "webhook_id" in event_model_src and "def __init__" in event_model_src,
        "migration_exists": migration.exists() and "webhook_id" in migration_src,
        "validator_added": "validate_webhook" in validators_src,
        "event_handler_validates": "webhook_id" in event_handler_src and (
            "not found" in event_handler_src or
            "exists" in event_handler_src or
            "invalid" in event_handler_src or
            "validate_webhook" in event_handler_src
        ),
        "integration_test": test.exists() and "webhook" in test_src and "event" in test_src,
    }

    met = sum(reqs.values())
    return {"correct": 1 if met >= 6 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(f"{k}={v}" for k, v in reqs.items())}


# =============================================================================
# Task 6: Error handling standardization
# Requirements:
#   1. Update all 3 handler files to use same error format
#   2. Extract error formatting to utils/errors.py
#   3. All errors must include: code, message, timestamp
#   4. Update existing error returns (don't add new ones)
#   5. Preserve existing status codes
#   6. Add error code constants (AUTH_FAILED, NOT_FOUND, etc)
#   7. Add tests that verify error format
#   8. Don't change happy path returns
# =============================================================================
TASK_ERROR_STANDARDIZATION_SEED = {
    "handlers/auth.py": '''def login(credentials):
    if not credentials.get("password"):
        return {"error": "Bad password"}, 401
    return {"token": "abc123"}
''',
    "handlers/users.py": '''def get_user(user_id):
    if user_id not in users_db:
        return {"error": "User not found"}, 404
    return {"user": users_db[user_id]}

def update_user(user_id, data):
    if not data.get("email"):
        return {"msg": "Email required"}, 400
    return {"user": data}

users_db = {}
''',
    "handlers/posts.py": '''def create_post(data):
    if len(data.get("title", "")) < 5:
        return {"error": "Title too short"}, 400
    return {"post": data}
''',
}

TASK_ERROR_STANDARDIZATION_PROMPT = (
    "Standardize error responses across all handlers:\n"
    "1. Create utils/errors.py with format_error(code, message) function\n"
    "2. format_error returns dict with: code, message, timestamp (use time.time())\n"
    "3. Add error code constants: AUTH_FAILED, NOT_FOUND, VALIDATION_ERROR\n"
    "4. Update all error returns in handlers/auth.py, handlers/users.py, handlers/posts.py\n"
    "5. Keep existing HTTP status codes (401, 404, 400)\n"
    "6. Don't change successful return values (keep existing {token:...}, {user:...}, {post:...})\n"
    "7. Create tests/test_error_format.py that validates error structure\n"
    "8. All 4 error cases (login, get_user, update_user, create_post) must use format_error\n"
)

TASK_ERROR_STANDARDIZATION_GOOD = {
    "utils/errors.py": '''import time

AUTH_FAILED = "AUTH_FAILED"
NOT_FOUND = "NOT_FOUND"
VALIDATION_ERROR = "VALIDATION_ERROR"

def format_error(code, message):
    return {
        "code": code,
        "message": message,
        "timestamp": time.time()
    }
''',
    "handlers/auth.py": '''from utils.errors import format_error, AUTH_FAILED

def login(credentials):
    if not credentials.get("password"):
        return format_error(AUTH_FAILED, "Bad password"), 401
    return {"token": "abc123"}
''',
    "handlers/users.py": '''from utils.errors import format_error, NOT_FOUND, VALIDATION_ERROR

users_db = {}

def get_user(user_id):
    if user_id not in users_db:
        return format_error(NOT_FOUND, "User not found"), 404
    return {"user": users_db[user_id]}

def update_user(user_id, data):
    if not data.get("email"):
        return format_error(VALIDATION_ERROR, "Email required"), 400
    return {"user": data}
''',
    "handlers/posts.py": '''from utils.errors import format_error, VALIDATION_ERROR

def create_post(data):
    if len(data.get("title", "")) < 5:
        return format_error(VALIDATION_ERROR, "Title too short"), 400
    return {"post": data}
''',
    "tests/test_error_format.py": '''from utils.errors import format_error, VALIDATION_ERROR

def test_error_format_structure():
    err = format_error(VALIDATION_ERROR, "Test error")
    assert "code" in err
    assert "message" in err
    assert "timestamp" in err
    assert err["code"] == VALIDATION_ERROR
''',
}

TASK_ERROR_STANDARDIZATION_BAD = {
    "utils/errors.py": '''def format_error(message):
    return {"error": message}
''',
    "handlers/auth.py": '''from utils.errors import format_error

def login(credentials):
    if not credentials.get("password"):
        return format_error("Bad password"), 401
    return {"token": "abc123"}
''',
    # Missing: timestamp, code constants, updates to users.py and posts.py, tests
}


def score_error_standardization(workdir):
    errors_util = workdir / "utils" / "errors.py"
    auth = workdir / "handlers" / "auth.py"
    users = workdir / "handlers" / "users.py"
    posts = workdir / "handlers" / "posts.py"
    test = workdir / "tests" / "test_error_format.py"

    errors_src = _source(errors_util)
    auth_src = _source(auth)
    users_src = _source(users)
    posts_src = _source(posts)
    test_src = _source(test)

    reqs = {
        "has_format_error": "def format_error" in errors_src,
        "has_timestamp": "timestamp" in errors_src and "time" in errors_src,
        "has_constants": "AUTH_FAILED" in errors_src and "NOT_FOUND" in errors_src,
        "updates_auth": "format_error" in auth_src and "AUTH_FAILED" in auth_src,
        "updates_users": "format_error" in users_src and users_src.count("format_error") >= 2,
        "updates_posts": "format_error" in posts_src,
        "preserves_status_codes": ", 401" in auth_src and ", 404" in users_src and ", 400" in posts_src,
        "has_test": test.exists() and "timestamp" in test_src,
    }

    met = sum(reqs.values())
    return {"correct": 1 if met >= 6 else 0, "complete_rate": round(met / len(reqs), 2),
            "reason": ", ".join(f"{k}={v}" for k, v in reqs.items())}


# =============================================================================
# TASKS registry
# =============================================================================
TASKS = {
    "hard-api-integration": {
        "prompt": TASK_API_INTEGRATION_PROMPT,
        "seed": TASK_API_INTEGRATION_SEED,
        "good": TASK_API_INTEGRATION_GOOD,
        "bad": TASK_API_INTEGRATION_BAD,
        "score": score_api_integration,
        "axis": "complete_rate",
    },
    "hard-db-migration": {
        "prompt": TASK_DB_MIGRATION_PROMPT,
        "seed": TASK_DB_MIGRATION_SEED,
        "good": TASK_DB_MIGRATION_GOOD,
        "bad": TASK_DB_MIGRATION_BAD,
        "score": score_db_migration,
        "axis": "complete_rate",
    },
    "hard-service-refactor": {
        "prompt": TASK_SERVICE_REFACTOR_PROMPT,
        "seed": TASK_SERVICE_REFACTOR_SEED,
        "good": TASK_SERVICE_REFACTOR_GOOD,
        "bad": TASK_SERVICE_REFACTOR_BAD,
        "score": score_service_refactor,
        "axis": "complete_rate",
    },
    "hard-webhook-feature": {
        "prompt": TASK_WEBHOOK_FEATURE_PROMPT,
        "seed": TASK_WEBHOOK_FEATURE_SEED,
        "good": TASK_WEBHOOK_FEATURE_GOOD,
        "bad": TASK_WEBHOOK_FEATURE_BAD,
        "score": score_webhook_feature,
        "axis": "complete_rate",
    },
    "hard-error-standardization": {
        "prompt": TASK_ERROR_STANDARDIZATION_PROMPT,
        "seed": TASK_ERROR_STANDARDIZATION_SEED,
        "good": TASK_ERROR_STANDARDIZATION_GOOD,
        "bad": TASK_ERROR_STANDARDIZATION_BAD,
        "score": score_error_standardization,
        "axis": "complete_rate",
    },
}
