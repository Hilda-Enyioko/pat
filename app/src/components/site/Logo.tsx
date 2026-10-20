// Placeholder wordmark until the final PAT logo lands; swap the inner markup here only.
export function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="logo" onClick={onClick} aria-label="PAT, go to home">
      <span className="wm">PAT</span>
      <span className="tg">Primitive airborne transaction</span>
    </button>
  );
}
