from notifications.utils import format_message, timestamp


def handle_sms(phone, template, **kwargs):
    body = format_message(template, **kwargs)
    return {"status": "sent", "channel": "sms", "timestamp": timestamp()}


def handle_sms_error(error):
    return {"status": "error", "error": str(error), "timestamp": timestamp()}
