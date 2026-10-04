from manim import *
from theme import *


class S4Progress(Scene):
    def construct(self):
        self.camera.background_color = BG

        title = T("PAT PROGRESS", 40, INK, BOLD).to_edge(UP, buff=0.6)

        done = [
            "Anchor program",
            "Reservation mechanism",
            "PaymentIntent + signature verification",
            "Settlement flow",
            "Receipt rent decision",
            "Devnet end-to-end run",
        ]

        rows = []
        marks = []
        for s in done:
            mark = check(BLUE, 0.45)
            label = T(s, 30, INK)
            rows.append(VGroup(mark, label).arrange(RIGHT, buff=0.4))
            marks.append(mark)

        pend_mark = pending(MUTED, 0.2)
        pend_label = T("PWA", 30, MUTED, BOLD)
        pend_row = VGroup(pend_mark, pend_label).arrange(RIGHT, buff=0.4)

        board = VGroup(*rows, pend_row).arrange(
            DOWN, aligned_edge=LEFT, buff=0.3
        )
        board.move_to(DOWN * 0.5)

        # ~12 seconds
        self.play(Write(title), run_time=1.0)

        for row, mark in zip(rows, marks):
            label = row[1]
            self.play(FadeIn(label, shift=RIGHT * 0.15), Create(mark),
                      run_time=1.0)

        self.play(FadeIn(pend_row, shift=RIGHT * 0.15), run_time=0.8)
        self.play(Indicate(pend_row, color=BLUE, scale_factor=1.08),
                  run_time=1.0)
        self.wait(2.0)
