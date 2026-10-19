"""Design tokens. Each colour is a (light, dark) pair, which CustomTkinter
switches automatically with the appearance mode."""
import sys

BG = ("#F5F6F8", "#0E1014")
SURFACE = ("#FFFFFF", "#171A21")
SURFACE_ALT = ("#F0F2F5", "#1E222B")
BORDER = ("#E3E6EB", "#2A2F3A")
BORDER_STRONG = ("#C9CED6", "#3A4150")

TEXT = ("#111827", "#F3F4F6")
TEXT_MUTED = ("#6B7280", "#9CA3AF")
TEXT_FAINT = ("#9CA3AF", "#6B7280")

ACCENT = ("#4F46E5", "#6366F1")
ACCENT_HOVER = ("#4338CA", "#818CF8")
ACCENT_SOFT = ("#EEF2FF", "#1F2140")
ON_ACCENT = ("#FFFFFF", "#FFFFFF")

SUCCESS = ("#047857", "#34D399")
SUCCESS_SOFT = ("#ECFDF5", "#0F2A22")
DANGER = ("#B91C1C", "#F87171")
DANGER_SOFT = ("#FEF2F2", "#2D1416")

# Badge colours per file type, taken from the Office apps so they read at a glance.
KIND_COLORS = {"DOCX": ("#2B579A", "#5B8DEF"), "PPTX": ("#C43E1C", "#F0794F")}

RADIUS = 12
RADIUS_SM = 8
PAD = 20

if sys.platform == "win32":
    FONT_FAMILY = "Segoe UI"
elif sys.platform == "darwin":
    FONT_FAMILY = "SF Pro Text"
else:
    FONT_FAMILY = "Inter"


def font(size=13, weight="normal"):
    import customtkinter as ctk
    return ctk.CTkFont(family=FONT_FAMILY, size=size, weight=weight)
