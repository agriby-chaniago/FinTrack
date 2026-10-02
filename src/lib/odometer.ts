// Rolling digits (PRD v0.22 P10): which digit each place of a new amount rolls from.
// Pure string work on display text; no arithmetic on money.
export type OdometerCell = { digit: true; from: number; to: number; place: number } | { digit: false; text: string };

const isDigit = (char: string) => char >= "0" && char <= "9";

/** Cells of `to`; each digit rolls from the digit in the same place (counted from the right) of `from`, or from 0. */
export function odometerCells(from: string, to: string): OdometerCell[] {
  const fromDigits = [...from].filter(isDigit);
  const chars = [...to];
  let place = chars.filter(isDigit).length;
  return chars.map((char) => {
    if (!isDigit(char)) return { digit: false, text: char };
    place -= 1;
    const previous = fromDigits[fromDigits.length - 1 - place];
    return { digit: true, from: previous === undefined ? 0 : Number(previous), to: Number(char), place };
  });
}
