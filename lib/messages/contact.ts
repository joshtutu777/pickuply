const emailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const phonePattern =
  /\+1\d{10}|\d{3}[^\d]\d{3}[^\d]\d{4}|(^|[^\d])\d{10}([^\d]|$)|(^|[^\d])\d{3}[-.\s]\d{4}([^\d]|$)/;

export function containsContact(value: string): boolean {
  return emailPattern.test(value) || phonePattern.test(value);
}
