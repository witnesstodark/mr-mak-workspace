"""The catalogue's parts. An Event names one sound the game needs and says how
to render it: a model function with keyword settings, a number of takes, a
loudness target, and whether it loops or is stereo. A project's catalogue is
a Python file that builds a list called EVENTS (see example_catalogue.py).
"""
import hashlib
import re
from dataclasses import dataclass, field
from typing import Callable, Optional


@dataclass
class Event:
    stem: str
    make: Callable
    takes: int
    target: float  # LUFS: max momentary for one-shots, integrated for loops
    describe: str
    params: dict = field(default_factory=dict)
    loop: bool = False
    channels: int = 1
    category: Optional[str] = None

    def __post_init__(self):
        if not re.fullmatch(r'[a-z0-9]+(_[a-z0-9]+)*', self.stem):
            raise ValueError('%s: stems are lower-case words joined by _' % self.stem)
        if self.channels not in (1, 2):
            raise ValueError('%s: channels is 1 or 2' % self.stem)
        if self.takes < 1:
            raise ValueError('%s: at least one take' % self.stem)
        self.target = float(self.target)
        self.params = dict(self.params or {})
        self.category = self.category or self.stem.split('_')[0]

    @property
    def measure(self):
        return 'integrated' if self.loop else 'momentary'

    def seed(self, take):
        """A number derived from the stem and take alone: adding, removing or
        reordering events never changes another event's sound, and a fourth
        take leaves the first three as they were."""
        digest = hashlib.sha256(('%s/%d' % (self.stem, take)).encode('utf-8')).digest()
        return int.from_bytes(digest[:4], 'little') >> 1

    def file_name(self, take):
        return '%s_%02d.wav' % (self.stem, take)

    def call(self):
        """The model call as text for the manifest; a score shows as its line count."""
        shown = []
        for key, value in self.params.items():
            if isinstance(value, str) and '\n' in value:
                shown.append('%s=<%d-line score>' % (key, value.strip().count('\n') + 1))
            else:
                shown.append('%s=%r' % (key, value))
        return '%s.%s(%s)' % (self.make.__module__, self.make.__name__, ', '.join(shown))


def check(events):
    """Problems a catalogue must not have: a stem used twice or an implausible target."""
    problems, seen = [], set()
    for e in events:
        if e.stem in seen:
            problems.append('%s appears twice' % e.stem)
        seen.add(e.stem)
        if not -60.0 <= e.target <= -6.0:
            problems.append('%s: a target of %.1f LUFS is outside -60 to -6' % (e.stem, e.target))
    return problems
