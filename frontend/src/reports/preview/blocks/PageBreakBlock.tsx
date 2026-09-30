/** The preview splits sheets at a page break (paginate.ts); on its own the block draws nothing. */
export function PageBreakBlock() {
  return <div data-block="page_break" aria-hidden="true" />;
}
