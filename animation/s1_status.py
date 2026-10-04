from manim import *
from theme import *


class S1Status(Scene):
    def construct(self):
        self.camera.background_color = BG

        title = T("PAT", 64, INK, BOLD).to_edge(UP, buff=0.6)
        sub = T("Primitive Airborne Transaction", 24, MUTED).next_to(
            title, DOWN, buff=0.2
        )

        # Left card: backend / protocol (done)
        left = card(4.8, 2.8, BLUE)
        left_label = T("Backend / Protocol", 28, INK, BOLD).move_to(
            left.get_top() + DOWN * 0.6
        )
        tick = check(BLUE, 0.9).move_to(left.get_center() + DOWN * 0.1)
        left_status = T("COMPLETE", 22, BLUE, BOLD).move_to(
            left.get_bottom() + UP * 0.5
        )
        left_group = VGroup(left, left_label, tick, left_status)

        # Right card: PWA (next)
        right = card(4.8, 2.8, MUTED, fill=BG)
        right_label = T("PWA", 28, MUTED, BOLD).move_to(
            right.get_top() + DOWN * 0.6
        )
        pend = pending().move_to(right.get_center() + DOWN * 0.1)
        right_status = T("NEXT", 22, MUTED, BOLD).move_to(
            right.get_bottom() + UP * 0.5
        )
        right_group = VGroup(right, right_label, pend, right_status)

        cards = VGroup(left_group, right_group).arrange(RIGHT, buff=0.8)
        cards.move_to(DOWN * 0.4)

        caption = T("The backend is done. The PWA is next.", 30, INK).to_edge(
            DOWN, buff=0.6
        )

        # ~7 seconds total
        self.play(Write(title), run_time=1.0)
        self.play(FadeIn(sub, shift=UP * 0.2), run_time=0.5)

        self.play(FadeIn(left, left_label, left_status), run_time=0.7)
        self.play(Create(tick), run_time=0.6)

        self.play(FadeIn(right, right_label, right_status), run_time=0.7)
        self.play(Create(pend), run_time=0.8)

        self.play(FadeIn(caption, shift=UP * 0.2), run_time=0.6)
        self.wait(1.0)
