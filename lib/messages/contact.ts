const digitWords: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
};

export const contactWarning = "For your safety, contact details can't be shared in chat";

const separators = new Set([" ", "\t", "\n", "\r", "(", ")", ".", "-", "+"]);

function phoneRun(digits: string, splitAt: number | null): boolean {
  return (
    digits.length === 10 ||
    (digits.length === 11 && digits.startsWith("1")) ||
    (digits.length === 7 && splitAt === 3) ||
    (digits.length === 6 && splitAt === 3)
  );
}

function orderNumber(before: string, digits: string): boolean {
  const longOrder = digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
  if (!longOrder) return false;
  return /\b(?:order|pickup|confirmation|po)\b(?:[\s#:.-]*(?:number|no|num)\b)?[\s#:.-]*[a-z]{0,8}[\s#:.-]*$/i.test(
    before,
  );
}

export function containsContact(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/\(\s*at\s*\)/g, "@")
    .replace(/\s*\bat\b\s*/g, "@")
    .replace(/\(\s*dot\s*\)/g, ".")
    .replace(/\s*\bdot\b\s*/g, ".")
    .replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine)\b/g, (word) => digitWords[word] ?? word);
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(normalized)) return true;

  let digits = "";
  let sawSeparator = false;
  let splitAt: number | null = null;
  let before = "";
  const finish = () => {
    const found = phoneRun(digits, splitAt) && !orderNumber(before, digits);
    digits = "";
    sawSeparator = false;
    splitAt = null;
    return found;
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const ch = normalized[index] ?? "";
    if (ch >= "0" && ch <= "9") {
      if (digits.length === 0) before = normalized.slice(0, index);
      if (sawSeparator && splitAt === null) splitAt = digits.length;
      digits += ch;
      sawSeparator = false;
    } else if (separators.has(ch)) {
      if (digits.length > 0) sawSeparator = true;
    } else if (finish()) {
      return true;
    }
  }
  return finish();
}
