/** formatMoney separates the amount and ₼ with a no-break space; tests write a normal space. */
export function nb(text: string): string {
  return text.replace(/ ₼/g, ' ₼');
}
