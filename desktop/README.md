# DocTranslate — desktop (v2)

> The desktop step of the project. The current version is the web app in [`/web`](../web); see the [main README](../README.md) for the full story.

A desktop tool that translates Word (`.docx`) and PowerPoint (`.pptx`) files while keeping their layout and formatting.

I built the first version as an internal tool during my internship so the team could translate documents without copying text into a browser. This repo is the redesigned version (v2): the UI is rebuilt and the bugs the original shipped with are fixed.

## Features

- **Drag and drop** a document, or browse for one. The file type is detected automatically.
- **File preview** before translating: type, name, size, and how many text blocks will be translated.
- **Searchable language picker** with suggested languages at the top, plus automatic source-language detection.
- **Keeps formatting.** Fonts, sizes, bold and colours are kept, in body text, tables, headers, footers and grouped shapes.
- **Text in images (OCR)** for PowerPoint. Text inside pictures is read and its translation added to the slide notes.
- **Live progress** with a running count and a Cancel button.
- **Clear outcomes.** Success shows *Open file* / *Show in folder* / *Translate another*. Errors explain what happened and what to do next.
- **Never overwrites:** output is saved as `Original name (zh-cn).docx`, `… 2.docx`, and so on.
- Light and dark mode. Your languages, output folder and theme are remembered.

## Redesign: v1 → v2

| | v1 | v2 |
|---|---|---|
| Choosing a file | Pick "DOCX/PPTX" from a dropdown, *then* choose the file | Drop or browse; type is detected |
| Language selection | Unsearchable list of 100+ items formatted `Chinese (Simplified) (zh-cn)` | Search box, suggested languages, Detect option, swap button |
| Source language | Always English, whatever the document's language | Auto-detect, or choose one |
| Validation | Modal error pop-ups after clicking Start | Button stays disabled with an inline hint saying what's missing |
| Progress | Bare bar, no text, no cancel | "Translating 29 of 48 text blocks", percentage, Cancel |
| Result | Modal showing a file path | Inline panel with next actions |
| Output | Always `~/Downloads/translated_<lang>.docx`, overwritten every run | Chosen folder, named after the source file, never overwritten |
| Formatting | Lost: whole paragraphs reset to default style | Kept |
| OCR | Ran, but the result was thrown away | Translation added to slide notes; switch explains when it's unavailable |
| Stability | Updated Tk widgets from a worker thread | Thread-safe UI updates through a queue |
| Speed | 2 API calls per text block (detect + translate) | 1 call, with caching for repeated text |
| Build size | 124 MB single `.exe` (built from a data-science environment) | Built from a minimal virtual environment |

### Design decisions

- **One screen, three steps.** The flow is linear (document → languages → options), so the cards are numbered and stacked in that order. The primary action is always at the bottom, in the same place.
- **Prevent errors rather than report them.** v1 let you click Start and then complained. v2 disables the button and says exactly what's missing, so you never see an error dialog in the happy path.
- **The footer shows state.** The same area turns from *Translate* into *progress*, then *result*, so you don't have to look elsewhere for feedback.
- **Disabled controls explain themselves.** The OCR switch tells you *why* it's off (not a PowerPoint file, or Tesseract not installed) rather than greying out silently.
- **Errors in plain language.** "Couldn't save the file: it's open in Office" instead of a Python stack trace.

## Running it

Requires Python 3.9+.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

Translation uses the free Google Translate endpoint through [`googletrans`](https://pypi.org/project/googletrans/), so an internet connection is needed.

**OCR (optional):** install [Tesseract](https://github.com/tesseract-ocr/tesseract). On Windows the app finds it in `C:\Program Files\Tesseract-OCR` automatically. On macOS, run `brew install tesseract`.

## Building a Windows .exe

```bat
pip install -r requirements-dev.txt
build.bat
```

The app is written to `dist\DocTranslate\`.

## Project structure

```
main.py                  entry point
translator/
  engine.py              document parsing + translation (no UI code)
  app.py                 the window and its states
  widgets.py             Card and the searchable LanguagePicker
  theme.py               colour, radius and type tokens (light/dark pairs)
  languages.py           language names and suggested list
```

## Limitations

- `googletrans` is an unofficial client and can be rate-limited on very large documents. The engine retries and keeps the original text for any block that still fails, then reports how many.
- When a paragraph mixes styles (e.g. one bold word), the translated sentence takes on the style of its first run, because word order changes between languages.
