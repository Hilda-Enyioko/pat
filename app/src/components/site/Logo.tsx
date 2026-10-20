export function Logo({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="logo" onClick={onClick} aria-label="PAT, go to home">
      <img className="mk" src="/pat-mark.png" alt="" width={37} height={40} />
      <span className="wt">
        <span className="wm">PAT</span>
        <span className="tg">Primitive airborne transaction</span>
      </span>
    </button>
  );
}
