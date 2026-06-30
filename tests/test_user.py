from models.user import User
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
