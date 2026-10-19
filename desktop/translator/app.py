"""DocTranslate desktop app."""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading
from tkinter import filedialog

import customtkinter as ctk

from . import theme as t
from .engine import (Progress, TranslationCancelled, TranslatorEngine,
                     count_segments, file_kind, find_tesseract)
from .languages import AUTO, name_of
from .widgets import Card, LanguagePicker

try:
    from tkinterdnd2 import DND_FILES, TkinterDnD
    _DND_BASES = (TkinterDnD.DnDWrapper,)
except Exception:  # drag and drop is a nice-to-have
    TkinterDnD = None
    _DND_BASES = ()

APP_NAME = "DocTranslate"
SETTINGS_PATH = os.path.join(os.path.expanduser("~"), ".doctranslate.json")


def _downloads():
    return os.path.join(os.path.expanduser("~"), "Downloads")


def _load_settings():
    try:
        with open(SETTINGS_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_settings(data):
    try:
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError:
        pass


def _short_path(path, limit=38):
    home = os.path.expanduser("~")
    if path.startswith(home):
        path = "~" + path[len(home):]
    return path if len(path) <= limit else "…" + path[-(limit - 1):]


def _middle_truncate(text, limit=42):
    if len(text) <= limit:
        return text
    keep = (limit - 1) // 2
    return text[:keep] + "…" + text[-keep:]


def _human_size(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _open_path(path, reveal=False):
    if sys.platform == "win32":
        if reveal:
            subprocess.run(["explorer", "/select,", os.path.normpath(path)])
        else:
            os.startfile(path)  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.run(["open", "-R", path] if reveal else ["open", path])
    else:
        subprocess.run(["xdg-open", os.path.dirname(path) if reveal else path])


class App(ctk.CTk, *_DND_BASES):
    def __init__(self):
        super().__init__()
        self.settings = _load_settings()
        ctk.set_appearance_mode(self.settings.get("appearance", "system"))

        self.title(APP_NAME)
        self.geometry("580x760")
        self.minsize(540, 720)
        self.configure(fg_color=t.BG)

        self.filepath = None
        self.output_dir = self.settings.get("output_dir") or _downloads()
        if not os.path.isdir(self.output_dir):
            self.output_dir = _downloads()
        self.tesseract = find_tesseract()
        self.events: queue.Queue = queue.Queue()
        self.cancel_event = threading.Event()
        self.last_result = None

        self._build_header()
        self._build_document_card()
        self._build_language_card()
        self._build_options_card()
        self._build_footer()
        self._enable_drag_and_drop()
        self._bind_keys()

        self._show_file(None)
        self._refresh()
        self.after(60, self._drain_events)

    # ------------------------------------------------------------------ layout
    def _build_header(self):
        head = ctk.CTkFrame(self, fg_color="transparent")
        head.pack(fill="x", padx=24, pady=(22, 14))
        text = ctk.CTkFrame(head, fg_color="transparent")
        text.pack(side="left")
        ctk.CTkLabel(text, text=APP_NAME, text_color=t.TEXT,
                     font=t.font(22, "bold")).pack(anchor="w")
        ctk.CTkLabel(text, text="Translate Word and PowerPoint files and keep their layout.",
                     text_color=t.TEXT_MUTED, font=t.font(13)).pack(anchor="w")

        self.theme_switch = ctk.CTkSegmentedButton(
            head, values=["Light", "Dark"], width=110, height=28,
            font=t.font(12), fg_color=t.SURFACE_ALT, selected_color=t.SURFACE,
            selected_hover_color=t.SURFACE, unselected_color=t.SURFACE_ALT,
            unselected_hover_color=t.BORDER, text_color=t.TEXT,
            command=self._set_theme)
        self.theme_switch.set("Dark" if ctk.get_appearance_mode() == "Dark" else "Light")
        self.theme_switch.pack(side="right", anchor="n", pady=4)

        # Footer is packed before the expanding content so it always keeps its space.
        self.footer = ctk.CTkFrame(self, fg_color="transparent")
        self.footer.pack(fill="x", side="bottom", padx=24, pady=(4, 22))
        self.content = ctk.CTkFrame(self, fg_color="transparent")
        self.content.pack(fill="both", expand=True, padx=24)

    def _build_document_card(self):
        card = Card(self.content, "1", "Document")
        card.pack(fill="x", pady=(0, 12))

        # Empty state: a drop zone.
        self.dropzone = ctk.CTkFrame(card.body, height=108, corner_radius=t.RADIUS_SM,
                                     border_width=2, border_color=t.BORDER_STRONG,
                                     fg_color=t.SURFACE_ALT)
        inner = ctk.CTkFrame(self.dropzone, fg_color="transparent")
        inner.place(relx=0.5, rely=0.5, anchor="center")
        ctk.CTkLabel(inner, text="↑", width=36, height=36, corner_radius=18,
                     fg_color=t.ACCENT_SOFT, text_color=t.ACCENT,
                     font=t.font(18, "bold")).pack()
        self.drop_title = ctk.CTkLabel(inner, text="Drop a .docx or .pptx file here",
                                       text_color=t.TEXT, font=t.font(13, "bold"))
        self.drop_title.pack(pady=(8, 0))
        row = ctk.CTkFrame(inner, fg_color="transparent")
        row.pack()
        ctk.CTkLabel(row, text="or", text_color=t.TEXT_MUTED, font=t.font(12)).pack(side="left")
        ctk.CTkButton(row, text="browse files", width=0, height=22, fg_color="transparent",
                      hover_color=t.ACCENT_SOFT, text_color=t.ACCENT, font=t.font(12, "bold"),
                      command=self.choose_file).pack(side="left", padx=2)
        for w in (self.dropzone, inner):
            w.bind("<Button-1>", lambda e: self.choose_file())
        self.dropzone.configure(cursor="hand2")

        # Filled state: a file row.
        self.file_row = ctk.CTkFrame(card.body, height=108, corner_radius=t.RADIUS_SM,
                                     border_width=1, border_color=t.BORDER, fg_color=t.SURFACE_ALT)
        self.file_row.pack_propagate(False)
        row = ctk.CTkFrame(self.file_row, fg_color="transparent")
        row.pack(fill="x", expand=True, padx=16)
        self.kind_badge = ctk.CTkLabel(row, text="DOCX", width=52, height=52, corner_radius=10,
                                       text_color=("#FFFFFF", "#FFFFFF"), font=t.font(12, "bold"))
        self.kind_badge.pack(side="left")
        info = ctk.CTkFrame(row, fg_color="transparent")
        info.pack(side="left", fill="x", expand=True, padx=14)
        self.file_name = ctk.CTkLabel(info, text="", anchor="w", text_color=t.TEXT,
                                      font=t.font(14, "bold"))
        self.file_name.pack(fill="x")
        self.file_meta = ctk.CTkLabel(info, text="", anchor="w", text_color=t.TEXT_MUTED,
                                      font=t.font(12))
        self.file_meta.pack(fill="x")
        self.remove_btn = ctk.CTkButton(row, text="Remove", width=70, height=30,
                                        fg_color="transparent", hover_color=t.BORDER,
                                        text_color=t.TEXT_MUTED, font=t.font(12),
                                        command=lambda: self._show_file(None))
        self.remove_btn.pack(side="right")
        self.change_btn = ctk.CTkButton(row, text="Change", width=70, height=30,
                                        fg_color=t.SURFACE, hover_color=t.BORDER,
                                        border_width=1, border_color=t.BORDER_STRONG,
                                        text_color=t.TEXT, font=t.font(12),
                                        command=self.choose_file)
        self.change_btn.pack(side="right", padx=(0, 6))

    def _build_language_card(self):
        card = Card(self.content, "2", "Languages")
        card.pack(fill="x", pady=(0, 12))
        row = ctk.CTkFrame(card.body, fg_color="transparent")
        row.pack(fill="x")
        row.grid_columnconfigure((0, 2), weight=1, uniform="lang")

        self.source_picker = LanguagePicker(row, "From", self.settings.get("source", AUTO),
                                            allow_auto=True, on_change=self._on_language)
        self.source_picker.grid(row=0, column=0, sticky="ew")
        self.swap_btn = ctk.CTkButton(row, text="⇄", width=36, height=40,
                                      corner_radius=t.RADIUS_SM, fg_color="transparent",
                                      hover_color=t.SURFACE_ALT, text_color=t.TEXT_MUTED,
                                      font=t.font(16), command=self._swap_languages)
        self.swap_btn.grid(row=0, column=1, padx=8, sticky="s")
        self.target_picker = LanguagePicker(row, "To", self.settings.get("target"),
                                            allow_auto=False, on_change=self._on_language)
        self.target_picker.grid(row=0, column=2, sticky="ew")

    def _build_options_card(self):
        card = Card(self.content, "3", "Options")
        card.pack(fill="x", pady=(0, 12))

        ocr = ctk.CTkFrame(card.body, fg_color="transparent")
        ocr.pack(fill="x")
        self.ocr_var = ctk.BooleanVar(value=False)
        text = ctk.CTkFrame(ocr, fg_color="transparent")
        text.pack(side="left", fill="x", expand=True)
        ctk.CTkLabel(text, text="Translate text inside images", anchor="w",
                     text_color=t.TEXT, font=t.font(13)).pack(fill="x")
        self.ocr_hint = ctk.CTkLabel(text, text="", anchor="w", justify="left",
                                     text_color=t.TEXT_MUTED, font=t.font(12))
        self.ocr_hint.pack(fill="x")
        self.ocr_switch = ctk.CTkSwitch(ocr, text="", variable=self.ocr_var, width=44,
                                        progress_color=t.ACCENT, button_color=("#FFFFFF", "#FFFFFF"),
                                        button_hover_color=("#FFFFFF", "#FFFFFF"),
                                        fg_color=t.BORDER_STRONG)
        self.ocr_switch.pack(side="right")

        ctk.CTkFrame(card.body, height=1, fg_color=t.BORDER).pack(fill="x", pady=14)

        out = ctk.CTkFrame(card.body, fg_color="transparent")
        out.pack(fill="x")
        text = ctk.CTkFrame(out, fg_color="transparent")
        text.pack(side="left", fill="x", expand=True)
        ctk.CTkLabel(text, text="Save to", anchor="w", text_color=t.TEXT,
                     font=t.font(13)).pack(fill="x")
        self.output_label = ctk.CTkLabel(text, text="", anchor="w",
                                         text_color=t.TEXT_MUTED, font=t.font(12))
        self.output_label.pack(fill="x")
        self.output_btn = ctk.CTkButton(out, text="Change", width=70, height=30,
                                        fg_color=t.SURFACE, hover_color=t.SURFACE_ALT,
                                        border_width=1, border_color=t.BORDER_STRONG,
                                        text_color=t.TEXT, font=t.font(12),
                                        command=self.choose_output_dir)
        self.output_btn.pack(side="right")

    def _build_footer(self):
        # Idle: hint + primary action.
        self.idle_panel = ctk.CTkFrame(self.footer, fg_color="transparent")
        self.hint = ctk.CTkLabel(self.idle_panel, text="", text_color=t.TEXT_MUTED,
                                 font=t.font(12))
        self.hint.pack(pady=(0, 8))
        self.start_btn = ctk.CTkButton(self.idle_panel, text="Translate document", height=46,
                                       corner_radius=t.RADIUS_SM, fg_color=t.ACCENT,
                                       hover_color=t.ACCENT_HOVER, text_color=t.ON_ACCENT,
                                       text_color_disabled=("#C7CAF5", "#5B5E9A"),
                                       font=t.font(14, "bold"), command=self.start)
        self.start_btn.pack(fill="x")

        # Running: status + progress + cancel.
        self.run_panel = ctk.CTkFrame(self.footer, fg_color=t.SURFACE, corner_radius=t.RADIUS,
                                      border_width=1, border_color=t.BORDER)
        top = ctk.CTkFrame(self.run_panel, fg_color="transparent")
        top.pack(fill="x", padx=18, pady=(16, 8))
        self.run_status = ctk.CTkLabel(top, text="", anchor="w", text_color=t.TEXT,
                                       font=t.font(13, "bold"))
        self.run_status.pack(side="left")
        self.run_percent = ctk.CTkLabel(top, text="", text_color=t.TEXT_MUTED, font=t.font(13))
        self.run_percent.pack(side="right")
        self.progress = ctk.CTkProgressBar(self.run_panel, height=8, corner_radius=4,
                                           fg_color=t.SURFACE_ALT, progress_color=t.ACCENT)
        self.progress.pack(fill="x", padx=18)
        bottom = ctk.CTkFrame(self.run_panel, fg_color="transparent")
        bottom.pack(fill="x", padx=18, pady=(10, 14))
        self.run_detail = ctk.CTkLabel(bottom, text="", anchor="w", text_color=t.TEXT_MUTED,
                                       font=t.font(12))
        self.run_detail.pack(side="left")
        self.cancel_btn = ctk.CTkButton(bottom, text="Cancel", width=80, height=30,
                                        fg_color="transparent", hover_color=t.SURFACE_ALT,
                                        border_width=1, border_color=t.BORDER_STRONG,
                                        text_color=t.TEXT, font=t.font(12), command=self.cancel)
        self.cancel_btn.pack(side="right")

        # Result: success or error banner with next steps.
        self.result_panel = ctk.CTkFrame(self.footer, corner_radius=t.RADIUS, border_width=1)
        head = ctk.CTkFrame(self.result_panel, fg_color="transparent")
        head.pack(fill="x", padx=18, pady=(16, 0))
        self.result_icon = ctk.CTkLabel(head, text="✓", width=28, height=28, corner_radius=14,
                                        text_color=("#FFFFFF", "#0E1014"), font=t.font(14, "bold"))
        self.result_icon.pack(side="left", anchor="n")
        text = ctk.CTkFrame(head, fg_color="transparent")
        text.pack(side="left", fill="x", expand=True, padx=12)
        self.result_title = ctk.CTkLabel(text, text="", anchor="w", text_color=t.TEXT,
                                         font=t.font(14, "bold"))
        self.result_title.pack(fill="x")
        self.result_body = ctk.CTkLabel(text, text="", anchor="w", justify="left",
                                        wraplength=430, text_color=t.TEXT_MUTED, font=t.font(12))
        self.result_body.pack(fill="x")
        self.result_actions = ctk.CTkFrame(self.result_panel, fg_color="transparent")
        self.result_actions.pack(fill="x", padx=18, pady=(12, 16))

    # ------------------------------------------------------------- behaviour
    def _enable_drag_and_drop(self):
        self.dnd = False
        if TkinterDnD is None:
            return
        try:
            self.TkdndVersion = TkinterDnD._require(self)
            self.drop_target_register(DND_FILES)
            self.dnd_bind("<<DropEnter>>", self._on_drag_enter)
            self.dnd_bind("<<DropLeave>>", self._on_drag_leave)
            self.dnd_bind("<<Drop>>", self._on_drop)
            self.dnd = True
        except Exception:
            pass

    def _bind_keys(self):
        mod = "Command" if sys.platform == "darwin" else "Control"
        self.bind(f"<{mod}-o>", lambda e: self.choose_file())
        self.bind("<Return>", lambda e: self.start() if self._ready() else None)

    def _on_drag_enter(self, event):
        if self._busy():
            return event.action
        self.dropzone.configure(border_color=t.ACCENT, fg_color=t.ACCENT_SOFT)
        self.drop_title.configure(text="Release to add file")
        return event.action

    def _on_drag_leave(self, event):
        self.dropzone.configure(border_color=t.BORDER_STRONG, fg_color=t.SURFACE_ALT)
        self.drop_title.configure(text="Drop a .docx or .pptx file here")
        return event.action

    def _on_drop(self, event):
        self._on_drag_leave(event)
        if self._busy():
            return event.action
        paths = self.tk.splitlist(event.data)
        if paths:
            self._select(paths[0])
        return event.action

    def choose_file(self):
        if self._busy():
            return
        path = filedialog.askopenfilename(
            title="Choose a document",
            filetypes=[("Word or PowerPoint", "*.docx *.pptx"),
                       ("Word document", "*.docx"), ("PowerPoint", "*.pptx")])
        if path:
            self._select(path)

    def _select(self, path):
        if not file_kind(path):
            self._show_file(None)
            self._show_error("That file type isn't supported",
                             "Choose a Word (.docx) or PowerPoint (.pptx) file. "
                             "Older .doc and .ppt files need to be re-saved in the new format first.")
            return
        self._show_file(path)

    def _show_file(self, path):
        self.filepath = path
        self._hide_result()
        if not path:
            self.file_row.pack_forget()
            self.dropzone.pack(fill="x")
        else:
            kind = file_kind(path)
            try:
                count = count_segments(path)
                unit = "paragraphs" if kind == "DOCX" else "text blocks"
                meta = f"{count} {unit} · {_human_size(os.path.getsize(path))}"
            except Exception:
                self._show_file(None)
                self._show_error("This file couldn't be opened",
                                 "It may be damaged, password-protected, or still open in Office.")
                return
            self.kind_badge.configure(text=kind, fg_color=t.KIND_COLORS[kind])
            self.file_name.configure(text=_middle_truncate(os.path.basename(path)))
            self.file_meta.configure(text=meta)
            self.dropzone.pack_forget()
            self.file_row.pack(fill="x")
        self._refresh()

    def choose_output_dir(self):
        folder = filedialog.askdirectory(title="Save translated files to",
                                         initialdir=self.output_dir)
        if folder:
            self.output_dir = folder
            self._persist()
            self._refresh()

    def _on_language(self, _value):
        self._persist()
        self._hide_result()
        self._refresh()

    def _swap_languages(self):
        src, dst = self.source_picker.value, self.target_picker.value
        if src == AUTO or not dst:
            return
        self.source_picker.set(dst, notify=False)
        self.target_picker.set(src)

    def _set_theme(self, value):
        ctk.set_appearance_mode(value.lower())
        self.settings["appearance"] = value.lower()
        _save_settings(self.settings)

    def _persist(self):
        self.settings.update(source=self.source_picker.value, target=self.target_picker.value,
                             output_dir=self.output_dir)
        _save_settings(self.settings)

    # -- state
    def _busy(self):
        return getattr(self, "worker", None) is not None and self.worker.is_alive()

    def _missing(self):
        if not self.filepath:
            return "Add a document to get started."
        if not self.target_picker.value:
            return "Choose a language to translate into."
        if self.source_picker.value == self.target_picker.value:
            return "Pick two different languages."
        return None

    def _ready(self):
        return not self._busy() and self._missing() is None

    def _refresh(self):
        busy = self._busy()
        missing = self._missing()
        if missing:
            self.hint.configure(text=missing, text_color=t.TEXT_MUTED)
        else:
            self.hint.configure(
                text=f"{'Any language' if self.source_picker.value == AUTO else name_of(self.source_picker.value)}"
                     f" → {name_of(self.target_picker.value)}",
                text_color=t.TEXT_MUTED)
        self.start_btn.configure(state="normal" if missing is None and not busy else "disabled")

        pptx = bool(self.filepath) and file_kind(self.filepath) == "PPTX"
        if not self.tesseract:
            hint, enabled = "Needs Tesseract OCR installed on this computer.", False
        elif self.filepath and not pptx:
            hint, enabled = "Available for PowerPoint files.", False
        else:
            hint, enabled = "Reads text in pictures and adds the translation to slide notes.", True
        self.ocr_hint.configure(text=hint)
        self.ocr_switch.configure(state="normal" if enabled and not busy else "disabled")
        if not enabled:
            self.ocr_var.set(False)

        self.output_label.configure(text=_short_path(self.output_dir))
        self.swap_btn.configure(state="disabled" if busy or self.source_picker.value == AUTO
                                or not self.target_picker.value else "normal")
        for w in (self.source_picker, self.target_picker):
            w.configure_state(not busy)
        for w in (self.change_btn, self.remove_btn, self.output_btn):
            w.configure(state="disabled" if busy else "normal")

        if busy:
            self.idle_panel.pack_forget()
            self.run_panel.pack(fill="x")
        else:
            self.run_panel.pack_forget()
            if not self.result_panel.winfo_manager():
                self.idle_panel.pack(fill="x")

    # -- run
    def start(self):
        if not self._ready():
            return
        self.cancel_event.clear()
        self._hide_result()
        self.progress.set(0)
        self.run_status.configure(text="Starting…")
        self.run_percent.configure(text="0%")
        self.run_detail.configure(text=f"Into {name_of(self.target_picker.value)}")
        self.cancel_btn.configure(state="normal", text="Cancel")

        engine = TranslatorEngine(
            target_lang=self.target_picker.value,
            source_lang=self.source_picker.value,
            enable_ocr=self.ocr_var.get(),
            on_progress=lambda p: self.events.put(("progress", p)),
            cancel_event=self.cancel_event,
        )
        self.worker = threading.Thread(target=self._run, args=(engine, self.filepath, self.output_dir),
                                       daemon=True)
        self.worker.start()
        self._refresh()

    def _run(self, engine, path, out_dir):
        # Runs off the UI thread. Tk isn't thread-safe, so everything goes
        # through the queue (v1 updated widgets from here directly).
        try:
            self.events.put(("done", engine.translate_file(path, out_dir)))
        except TranslationCancelled:
            self.events.put(("cancelled", None))
        except PermissionError:
            self.events.put(("error", ("Couldn't save the file",
                                       "The output folder isn't writable, or a file with that "
                                       "name is open in Office. Close it or pick another folder.")))
        except ConnectionError as exc:
            self.events.put(("error", ("Translation service unavailable", str(exc))))
        except Exception as exc:
            self.events.put(("error", ("Something went wrong", str(exc) or exc.__class__.__name__)))

    def cancel(self):
        self.cancel_event.set()
        self.cancel_btn.configure(state="disabled", text="Stopping…")

    def _drain_events(self):
        try:
            while True:
                kind, payload = self.events.get_nowait()
                if kind == "progress":
                    self._on_progress(payload)
                else:
                    self.worker.join(timeout=1)
                    self._refresh()
                    if kind == "done":
                        self._show_success(payload)
                    elif kind == "error":
                        self._show_error(*payload)
                    self._refresh()
        except queue.Empty:
            pass
        self.after(60, self._drain_events)

    def _on_progress(self, p: Progress):
        self.progress.set(p.fraction)
        self.run_status.configure(text=p.message)
        self.run_percent.configure(text=f"{round(p.fraction * 100)}%")

    # -- results
    def _hide_result(self):
        self.result_panel.pack_forget()
        if not self._busy():
            self.idle_panel.pack(fill="x")

    def _show_result(self, ok, title, body, actions):
        self.idle_panel.pack_forget()
        self.result_panel.configure(fg_color=t.SUCCESS_SOFT if ok else t.DANGER_SOFT,
                                    border_color=t.SUCCESS if ok else t.DANGER)
        self.result_icon.configure(text="✓" if ok else "!", fg_color=t.SUCCESS if ok else t.DANGER)
        self.result_title.configure(text=title)
        self.result_body.configure(text=body)
        for w in self.result_actions.winfo_children():
            w.destroy()
        for i, (label, cmd) in enumerate(actions):
            primary = i == 0
            ctk.CTkButton(self.result_actions, text=label, height=34, width=0,
                          corner_radius=t.RADIUS_SM,
                          fg_color=t.ACCENT if primary else t.SURFACE,
                          hover_color=t.ACCENT_HOVER if primary else t.SURFACE_ALT,
                          border_width=0 if primary else 1, border_color=t.BORDER_STRONG,
                          text_color=t.ON_ACCENT if primary else t.TEXT,
                          font=t.font(12, "bold" if primary else "normal"),
                          command=cmd).pack(side="left", padx=(0, 8))
        self.result_panel.pack(fill="x")

    def _show_success(self, result):
        self.last_result = result
        lines = [os.path.basename(result.output_path)]
        unit = "paragraphs" if result.output_path.lower().endswith(".docx") else "text blocks"
        detail = f"{result.segments} {unit} translated"
        if result.images_read:
            detail += f" · {result.images_read} images added to notes"
        lines.append(detail)
        if result.failed:
            lines.append(f"{result.failed} blocks couldn't be translated and were left as they were.")
        self._show_result(True, f"Translated into {name_of(self.target_picker.value)}",
                          "\n".join(lines), [
                              ("Open file", lambda: _open_path(result.output_path)),
                              ("Show in folder", lambda: _open_path(result.output_path, reveal=True)),
                              ("Translate another", self._reset),
                          ])

    def _show_error(self, title, body):
        actions = [("Try again", self.start)] if self.filepath and self._missing() is None else []
        actions.append(("Dismiss", self._hide_result))
        self._show_result(False, title, body, actions)

    def _reset(self):
        self._show_file(None)


def main():
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
