from manim import *
from theme import *

REPO = ""  # e.g. "github.com/<you>/pat"; leave empty to hide


class S5Next(Scene):
    def construct(self):
        self.camera.background_color = BG

        # ---------- Part A: PWA steps ----------
        title = T("NEXT: THE PWA", 36, BLUE, BOLD).to_edge(UP, buff=0.5)

        steps = [
            "Connect wallet",
            "Reserve capacity",
            "Create PaymentIntent",
            "Offline payment",
            "QR transfer",
            "Settlement",
        ]
        rows = VGroup()
        for i, s in enumerate(steps, 1):
            badge = Circle(radius=0.24, color=BLUE, fill_color=BLUE,
                           fill_opacity=1, stroke_width=0)
            num = T(str(i), 20, WHITE, BOLD).move_to(badge)
            rows.add(
                VGroup(VGroup(badge, num), T(s, 28, INK)).arrange(
                    RIGHT, buff=0.35
                )
            )
        rows.arrange(DOWN, aligned_edge=LEFT, buff=0.22)

        panel = card(6.6, 5.0, BLUE, LIGHT)
        rows.move_to(panel)
        board = VGroup(panel, rows).move_to(UP * 0.1)

        caption = T(
            "Now I get to build the part users actually see.", 26, INK
        ).to_edge(DOWN, buff=0.4)

        # ---------- Part B: tagline ----------
        pat = T("PAT", 80, INK, BOLD)
        tag = VGroup(
            T("Reserve while connected.", 30, INK),
            T("Spend while disconnected.", 30, INK),
            T("Settle when reconnected.", 30, BLUE, BOLD),
        ).arrange(DOWN, buff=0.25)
        built = T("Built on Solana", 22, MUTED)
        end = VGroup(pat, tag, built).arrange(DOWN, buff=0.5)
        if REPO:
            end.add(T(REPO, 20, MUTED))
            end.arrange(DOWN, buff=0.4)
        end.move_to(ORIGIN)

        # ~10 seconds
        self.play(FadeIn(title), FadeIn(panel), run_time=0.6)
        self.play(
            LaggedStart(*[FadeIn(r, shift=RIGHT * 0.15) for r in rows],
                        lag_ratio=0.35),
            run_time=2.4,
        )
        self.play(FadeIn(caption, shift=UP * 0.2), run_time=0.6)
        self.wait(0.8)

        self.play(FadeOut(title, board, caption), run_time=0.6)
        self.play(Write(pat), run_time=0.7)
        self.play(
            LaggedStart(*[FadeIn(t, shift=UP * 0.15) for t in tag],
                        lag_ratio=0.5),
            run_time=1.8,
        )
        self.play(FadeIn(built), *( [FadeIn(end[3])] if REPO else [] ),
                  run_time=0.5)
        self.wait(1.2)
