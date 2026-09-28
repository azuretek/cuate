// Pure: the scrub every free-text log field passes through. Order matters: tokens first, then contact details,
// then paths and URLs, then anything long enough to be a secret.
const RULES = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [/\b(?:tok|sk|pk|ghp|gho|ghs|xox[abp])_[A-Za-z0-9_-]{8,}/g, '[token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  [/\+?\d[\d\s().-]{7,}\d/g, '[number]'],
  [/\/(?:Users|home)\/[^/\s]+/g, '~'],
  [/[A-Za-z]:\\Users\\[^\\\s]+/g, '~'],
  [/([?&][^=\s&#]+=)[^&\s#]+/g, '$1[hidden]'],
  [/[A-Za-z0-9+/_-]{32,}={0,2}/g, '[long]'],
];

export function scrub(text, max = 300) {
  let s = String(text ?? '');
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  return s.length > max ? s.slice(0, max) + '\u2026' : s;
}
