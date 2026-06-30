class Pipeline:
    def __init__(self, name):
        self.name = name
        self.steps = []
        self.errors = []

    def add_step(self, name, fn):
        self.steps.append((name, fn))
        return self

    def run(self, data):
        self.errors = []
        result = data
        for step_name, fn in self.steps:
            try:
                result = fn(result)
            except Exception as e:
                self.errors.append({
                    'step_name': step_name,
                    'error': e
                })
        return result

    def dry_run(self, data):
        return [name for name, fn in self.steps]

    def describe(self):
        step_names = ', '.join([name for name, fn in self.steps])
        return f"Pipeline '{self.name}' with steps: {step_names}"

    def __len__(self):
        return len(self.steps)

    def __iter__(self):
        return iter([name for name, fn in self.steps])
