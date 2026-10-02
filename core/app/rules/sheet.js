// Pure: when a press on a sheet's backdrop is a second way back, the same leaving the page's top strip asks for.
//
// It is a return only when the press both STARTS and ENDS on the backdrop itself. A press that starts inside the
// card and is released over the backdrop (a selection dragged past the edge, a finger that slides off the panel) is
// not a return: the reader began a gesture on the page, so letting go outside it must not throw that page away.
export function backdropReturns(startsOnBackdrop, endsOnBackdrop) {
  return startsOnBackdrop === true && endsOnBackdrop === true;
}
