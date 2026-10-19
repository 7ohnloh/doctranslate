from googletrans import LANGUAGES

AUTO = "auto"

# Shown first in the picker. Picked for the team's day-to-day work in Singapore;
# edit freely.
SUGGESTED = ["en", "zh-cn", "ms", "ta", "zh-tw", "ja", "ko", "id", "vi", "th"]

NAMES = {code: name.title() for code, name in LANGUAGES.items()}
NAMES[AUTO] = "Detect language"

ALL_CODES = sorted(LANGUAGES, key=lambda c: NAMES[c])


def name_of(code):
    return NAMES.get(code, code)
