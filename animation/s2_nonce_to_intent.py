from manim import *
from theme import *


def build_intent_card():
    """PaymentIntent card: returns (body, title, fields)."""
    body = card(4.8, 4.4, BLUE, BG, 4)
    title = T("PaymentIntent", 30, BLUE, BOLD).move_to(
        body.get_top() + DOWN * 0.55
    )
    fields = VGroup(
        *[
            T(f, 24, INK)
            for f in ["payer", "merchant", "amount", "payment_id", "signature"]
        ]
    ).arrange(DOWN, aligned_edge=LEFT, buff=0.3)
    fields[4].set_color(BLUE)  # signature is the point of the design
    fields.move_to(body.get_center() + DOWN * 0.35)
    return body, title, fields


class S2NonceToIntent(Scene):
    def construct(self):
        self.camera.background_color = BG

        # ---------- Phase A: initial design (grey = old) ----------
        header = T("INITIAL DESIGN", 28, MUTED, BOLD).to_edge(UP, buff=0.6)

        nonce = flow_box("Durable Nonce", color=MUTED)
        offline = flow_box("Offline transaction", color=MUTED)
        bcast = flow_box("Broadcast later", color=MUTED)
        row = VGroup(nonce, offline, bcast).arrange(RIGHT, buff=1.0)
        row.move_to(UP * 0.3)

        arrows = VGroup(
            *[
                Arrow(a.get_right(), b.get_left(), buff=0.1,
                      color=MUTED, stroke_width=5)
                for a, b in [(nonce, offline), (offline, bcast)]
            ]
        )

        caption1 = T(
            "Preserve a transaction for later broadcast.", 26, INK
        ).to_edge(DOWN, buff=0.6)

        self.play(FadeIn(header), run_time=0.6)
        self.play(
            LaggedStart(
                FadeIn(nonce, shift=RIGHT * 0.2),
                FadeIn(offline, shift=RIGHT * 0.2),
                FadeIn(bcast, shift=RIGHT * 0.2),
                lag_ratio=0.5,
            ),
            LaggedStart(*[GrowArrow(a) for a in arrows], lag_ratio=0.6),
            run_time=2.0,
        )
        self.play(FadeIn(caption1, shift=UP * 0.2), run_time=0.6)
        self.wait(1.2)

        # ---------- Rethink beat ----------
        rethink = T("rethink", 28, BLUE, BOLD).next_to(header, DOWN, buff=0.35)
        self.play(FadeIn(rethink, scale=0.9), run_time=0.6)
        self.wait(0.4)

        # ---------- Phase B: current design (blue = current) ----------
        header2 = T("CURRENT DESIGN", 28, BLUE, BOLD).to_edge(UP, buff=0.6)

        body, title, fields = build_intent_card()
        intent = VGroup(body, title, fields).move_to(LEFT * 3.4 + DOWN * 0.2)
        head = VGroup(body, title)  # transform target for the nonce box

        chips = VGroup(
            flow_box("Signed offline", 4.4, 1.0),
            flow_box("Handed to merchant", 4.4, 1.0),
            flow_box("Settled when connected", 4.4, 1.0),
        ).arrange(DOWN, buff=0.9)
        chips.move_to(RIGHT * 3.6 + DOWN * 0.2)
        chip_arrows = VGroup(
            *[
                Arrow(a.get_bottom(), b.get_top(), buff=0.08,
                      color=BLUE, stroke_width=5)
                for a, b in [(chips[0], chips[1]), (chips[1], chips[2])]
            ]
        )

        caption2 = T(
            "Represent the offline payment as an explicit signed intent.",
            26, INK,
        ).to_edge(DOWN, buff=0.6)

        self.play(
            FadeOut(offline, bcast, arrows, caption1, rethink),
            ReplacementTransform(nonce, head),
            ReplacementTransform(header, header2),
            run_time=1.4,
        )
        self.play(
            LaggedStart(*[FadeIn(f, shift=RIGHT * 0.15) for f in fields],
                        lag_ratio=0.25),
            run_time=1.4,
        )
        self.play(
            LaggedStart(
                FadeIn(chips[0]), GrowArrow(chip_arrows[0]),
                FadeIn(chips[1]), GrowArrow(chip_arrows[1]),
                FadeIn(chips[2]),
                lag_ratio=0.4,
            ),
            run_time=2.2,
        )
        self.play(FadeIn(caption2, shift=UP * 0.2), run_time=0.6)
        self.wait(1.5)
