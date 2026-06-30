from notifications.email_handler import handle_email, handle_email_error
from notifications.sms_handler import handle_sms, handle_sms_error
from notifications.webhook_handler import handle_webhook, handle_webhook_error

HANDLERS = {
    "email": {"send": handle_email, "error": handle_email_error},
    "sms": {"send": handle_sms, "error": handle_sms_error},
    "webhook": {"send": handle_webhook, "error": handle_webhook_error},
}
