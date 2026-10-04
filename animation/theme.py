"""PAT animation theme definitions and reusable layout components."""

from manim import Circle, DashedVMobject, RoundedRectangle, Text, VGroup, VMobject

# PAT palette
BLUE = "#007AFF"
BG = "#FFFFFF"
LIGHT = "#F4F4F4"
INK = "#111111"
MUTED = "#8A8A8E"
GREEN = "#34C759"
RED = "#FF3B30"

# DejaVu Sans ships with most WSL installs, so it renders without extra setup.
# Swap for "Inter" etc. later if you install the font.
FONT = "DejaVu Sans"


def T(s, size=32, color=INK, weight="NORMAL"):
    """Text with the PAT font. Never use Tex: it needs LaTeX."""
    return Text(s, font=FONT, font_size=size, color=color, weight=weight)


def card(width, height, color=BLUE, fill=LIGHT, stroke=3):
    """Draw a rounded container card."""
    return RoundedRectangle(
        corner_radius=0.2,
        width=width,
        height=height,
        stroke_color=color,
        stroke_width=stroke,
        fill_color=fill,
        fill_opacity=1,
    )


def check(color=BLUE, scale=1.0):
    """Drawn checkmark, so we don't depend on a font having the glyph."""
    mark = VMobject(color=color, stroke_width=10)
    mark.set_points_as_corners(
        [[-0.35, 0.0, 0], [-0.1, -0.28, 0], [0.4, 0.3, 0]]
    )
    return mark.scale(scale)


def pending(color=MUTED, radius=0.3):
    """Dashed circle meaning 'not done yet'."""
    return DashedVMobject(
        Circle(radius=radius, color=color, stroke_width=5), num_dashes=12
    )


def flow_box(label, w=3.6, h=1.3, color=BLUE, fill=LIGHT, text_color=INK):
    """Rounded box with a bold label that auto-shrinks to fit."""
    r = card(w, h, color, fill)
    t = T(label, 24, text_color, "BOLD")
    if t.width > w - 0.4:
        t.scale_to_fit_width(w - 0.4)
    t.move_to(r)
    return VGroup(r, t)
