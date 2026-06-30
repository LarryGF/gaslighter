import time


def format_message(template, **kwargs):
    return template.format(**kwargs)


def timestamp():
    return time.time()
