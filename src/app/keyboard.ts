/** True when a key press is going into a text field, so shortcuts should leave it alone. */
export function isTyping(event: KeyboardEvent) {
  const target = event.target;
  return target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]') !== null;
}
