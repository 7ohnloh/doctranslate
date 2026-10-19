"""Reusable widgets built on CustomTkinter."""
from __future__ import annotations

import customtkinter as ctk

from . import theme as t
from .languages import ALL_CODES, AUTO, SUGGESTED, name_of


class Card(ctk.CTkFrame):
    """A surface with a small step label and title, e.g. "1  Document"."""

    def __init__(self, master, step: str, title: str, **kw):
        super().__init__(master, fg_color=t.SURFACE, corner_radius=t.RADIUS,
                         border_width=1, border_color=t.BORDER, **kw)
        head = ctk.CTkFrame(self, fg_color="transparent")
        head.pack(fill="x", padx=t.PAD, pady=(16, 10))
        ctk.CTkLabel(head, text=step, width=22, height=22, corner_radius=11,
                     fg_color=t.ACCENT_SOFT, text_color=t.ACCENT,
                     font=t.font(11, "bold")).pack(side="left")
        ctk.CTkLabel(head, text=title, text_color=t.TEXT,
                     font=t.font(14, "bold")).pack(side="left", padx=(10, 0))
        self.body = ctk.CTkFrame(self, fg_color="transparent")
        self.body.pack(fill="x", padx=t.PAD, pady=(0, 18))


class LanguagePicker(ctk.CTkFrame):
    """A select box that opens a searchable list.

    The list is an in-window overlay rather than a Toplevel: borderless Toplevels
    can't reliably take keyboard focus on macOS, and the search field needs it.
    """

    def __init__(self, master, label: str, value: str, allow_auto: bool,
                 on_change=None, **kw):
        super().__init__(master, fg_color="transparent", **kw)
        self.value = value
        self.allow_auto = allow_auto
        self.on_change = on_change
        self._overlay = None

        ctk.CTkLabel(self, text=label, text_color=t.TEXT_MUTED,
                     font=t.font(12)).pack(anchor="w", pady=(0, 4))
        self.button = ctk.CTkButton(
            self, text=self._button_text(), anchor="w", height=40,
            corner_radius=t.RADIUS_SM, border_width=1, border_color=t.BORDER_STRONG,
            fg_color=t.SURFACE, hover_color=t.SURFACE_ALT, text_color=t.TEXT,
            font=t.font(13), command=self.toggle)
        self.button.pack(fill="x")

    def _button_text(self):
        if not self.value:
            return "Choose a language   ▾"
        return f"{name_of(self.value)}   ▾"

    def set(self, value, notify=True):
        self.value = value
        self.button.configure(text=self._button_text(),
                              text_color=t.TEXT if value else t.TEXT_MUTED)
        if notify and self.on_change:
            self.on_change(value)

    def configure_state(self, enabled: bool):
        self.button.configure(state="normal" if enabled else "disabled")

    # -- overlay
    def toggle(self):
        if self._overlay and self._overlay.winfo_manager():
            self.close()
        else:
            self.open()

    def open(self):
        root = self.winfo_toplevel()
        if self._overlay is None:
            self._overlay = _LanguageList(root, self)
        x = self.button.winfo_rootx() - root.winfo_rootx()
        y = self.button.winfo_rooty() - root.winfo_rooty() + self.button.winfo_height() + 6
        width = max(self.button.winfo_width(), 260)
        height = min(330, root.winfo_height() - y - 16)
        self._overlay.show(x, y, width, height)

    def close(self):
        if self._overlay:
            self._overlay.hide()


class _LanguageList(ctk.CTkFrame):
    def __init__(self, root, picker: LanguagePicker):
        super().__init__(root, fg_color=t.SURFACE, corner_radius=t.RADIUS,
                         border_width=1, border_color=t.BORDER_STRONG)
        self.picker = picker
        self.root = root

        self.query = ctk.StringVar()
        self.query.trace_add("write", lambda *_: self._filter())
        self.search = ctk.CTkEntry(self, textvariable=self.query, height=36,
                                   placeholder_text="Search languages",
                                   corner_radius=t.RADIUS_SM, border_width=1,
                                   border_color=t.BORDER, fg_color=t.SURFACE_ALT,
                                   text_color=t.TEXT, font=t.font(13))
        self.search.pack(fill="x", padx=8, pady=(8, 4))
        # "break" stops the window-level Enter shortcut from starting a translation.
        self.search.bind("<Return>", lambda e: (self._pick_first(), "break")[1])
        self.search.bind("<Escape>", lambda e: (self.hide(), "break")[1])

        self.list = ctk.CTkScrollableFrame(self, fg_color="transparent",
                                           scrollbar_button_color=t.BORDER_STRONG)
        self.list.pack(fill="both", expand=True, padx=4, pady=(0, 6))

        self.headers = {
            "suggested": self._header("Suggested"),
            "all": self._header("All languages"),
        }
        codes = ([AUTO] if picker.allow_auto else []) + SUGGESTED
        self.suggested_rows = [(c, self._row(c)) for c in codes]
        self.all_rows = [(c, self._row(c)) for c in ALL_CODES]
        self.empty = ctk.CTkLabel(self.list, text="No languages match.",
                                  text_color=t.TEXT_MUTED, font=t.font(12))
        self._filter()

    def _header(self, text):
        return ctk.CTkLabel(self.list, text=text.upper(), anchor="w",
                            text_color=t.TEXT_FAINT, font=t.font(10, "bold"))

    def _row(self, code):
        return ctk.CTkButton(self.list, text=name_of(code), anchor="w", height=30,
                             corner_radius=6, fg_color="transparent",
                             hover_color=t.SURFACE_ALT, text_color=t.TEXT,
                             font=t.font(13), command=lambda c=code: self._pick(c))

    def _filter(self):
        q = self.query.get().strip().lower()
        for w in self.list.winfo_children():
            w.pack_forget()
        self._matches = []
        if not q:
            self.headers["suggested"].pack(fill="x", padx=8, pady=(6, 2))
            for code, row in self.suggested_rows:
                self._show_row(code, row)
            self.headers["all"].pack(fill="x", padx=8, pady=(10, 2))
            for code, row in self.all_rows:
                self._show_row(code, row)
            return
        for code, row in self.all_rows:
            if q in name_of(code).lower() or q == code:
                self._show_row(code, row)
        if not self._matches:
            self.empty.pack(pady=16)

    def _show_row(self, code, row):
        selected = code == self.picker.value
        row.configure(text=("✓  " if selected else "    ") + name_of(code),
                      fg_color=t.ACCENT_SOFT if selected else "transparent",
                      text_color=t.ACCENT if selected else t.TEXT)
        row.pack(fill="x", padx=2)
        self._matches.append(code)

    def _pick_first(self):
        if self._matches:
            self._pick(self._matches[0])

    def _pick(self, code):
        self.hide()
        self.picker.set(code)

    def show(self, x, y, width, height):
        self.query.set("")
        self._filter()
        self.configure(width=width, height=height)  # CTk widgets reject size in place()
        self.place(x=x, y=y)
        self.lift()
        self.list._parent_canvas.yview_moveto(0)
        self.after(10, self.search.focus_set)
        self._click_binding = self.root.bind("<Button-1>", self._on_root_click, add="+")

    def hide(self):
        self.place_forget()
        if getattr(self, "_click_binding", None):
            self.root.unbind("<Button-1>", self._click_binding)
            self._click_binding = None

    def _on_root_click(self, event):
        # Close when clicking anywhere outside the list or its own button.
        w = event.widget
        while w is not None:
            if w in (self, self.picker.button) or str(w).startswith(str(self)):
                return
            w = getattr(w, "master", None)
        self.hide()
