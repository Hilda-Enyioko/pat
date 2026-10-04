from manim import *
from theme import *


def cross(color=RED, scale=1.0):
    g = VGroup(
        Line([-0.3, -0.3, 0], [0.3, 0.3, 0]),
        Line([-0.3, 0.3, 0], [0.3, -0.3, 0]),
    )
    g.set_color(color).set_stroke(width=10)
    return g.scale(scale)


def party(name, desc, x):
    body = card(4.8, 2.4, MUTED, BG, 4)
    title = T(name, 30, INK, BOLD).move_to(body.get_top() + DOWN * 0.55)
    sub = T(desc, 24, MUTED).move_to(body.get_bottom() + UP * 0.55)
    group = VGroup(body, title, sub).move_to([x, -1.4, 0])
    return group, body, sub


class S3ReceiptRent(Scene):
    def construct(self):
        self.camera.background_color = BG

        header = T("RECEIPT RENT", 28, BLUE, BOLD).to_edge(UP, buff=0.5)

        # Top row: PAYMENT -> Receipt Account (requires rent)
        payment = flow_box("PAYMENT", 3.0, 1.2)
        r_body = card(4.2, 1.5, BLUE, LIGHT)
        r_title = T("Receipt Account", 26, INK, BOLD).move_to(
            r_body.get_center() + UP * 0.25
        )
        r_sub = T("requires rent", 22, BLUE).move_to(
            r_body.get_center() + DOWN * 0.3
        )
        receipt = VGroup(r_body, r_title, r_sub)

        row = VGroup(payment, receipt).arrange(RIGHT, buff=1.1)
        row.move_to([0, 2.2, 0])
        row.shift(LEFT * receipt.get_center()[0])  # receipt centered on x=0
        row_arrow = Arrow(
            payment.get_right(), receipt.get_left(),
            buff=0.1, color=BLUE, stroke_width=5,
        )

        who = T("WHO PAYS?", 26, INK, BOLD).move_to([0, 0.5, 0])

        merchant, m_body, m_sub = party("Merchant", "operational burden", -3.4)
        payer, p_body, p_sub = party("Payer", "explicit cost", 3.4)

        a_left = Arrow(
            receipt.get_bottom(), merchant.get_top(),
            buff=0.1, color=MUTED, stroke_width=5,
        )
        a_right = Arrow(
            receipt.get_bottom(), payer.get_top(),
            buff=0.1, color=MUTED, stroke_width=5,
        )

        x_mark = cross(RED, 0.9).move_to(m_body.get_center())
        tick = check(BLUE, 0.9).move_to(p_body.get_center())

        caption = VGroup(
            T("The payer funds the receipt rent.", 24, INK, BOLD),
            T("Merchants pre-fund nothing, and the cost is explicit.", 24, INK),
        ).arrange(DOWN, buff=0.12).to_edge(DOWN, buff=0.35)

        # ~14 seconds
        self.play(FadeIn(header), run_time=0.5)
        self.play(FadeIn(payment, shift=RIGHT * 0.2), run_time=0.6)
        self.play(GrowArrow(row_arrow), FadeIn(receipt), run_time=1.0)
        self.wait(0.8)

        self.play(FadeIn(who, scale=0.9), run_time=0.5)
        self.play(
            GrowArrow(a_left), GrowArrow(a_right),
            FadeIn(merchant), FadeIn(payer),
            run_time=1.2,
        )
        self.wait(0.8)

        # The decision: dim the merchant, light up the payer
        self.play(
            merchant.animate.set_opacity(0.4),
            a_left.animate.set_opacity(0.3),
            Create(x_mark),
            run_time=0.8,
        )
        self.play(
            p_body.animate.set_stroke(color=BLUE, width=6),
            p_sub.animate.set_color(BLUE),
            a_right.animate.set_color(BLUE),
            Create(tick),
            run_time=0.9,
        )
        self.wait(0.5)
        self.play(FadeIn(caption, shift=UP * 0.2), run_time=0.6)
        self.wait(2.0)
