// Output redaction — last-line-of-defence against accidental token
// leakage in formatted MCP tool responses.
//
// Why this exists even though SKILL files / varMap never contain raw
// secrets: upstream APIs occasionally echo the Authorization header in
// error bodies (or log lines that get included in error messages), and
// step output strings make their way into formatComposedResult()
// markdown. We scan that output for known token shapes and replace
// them with "***".
//
// This is NOT cryptographic redaction. It's a heuristic safety net —
// tokens with no recognisable prefix (custom internal services) WILL
// pass through. The framework's primary defence remains:
//   1. SKILL frontmatter cannot contain literal secrets (validate)
//   2. varMap never receives ResolvedAuth (tools dereference profile-ref
//      directly, never bind into the template engine)

interface PatternEntry {
  /** Short label for diagnostics (e.g. "OpenAI sk- token"). */
  label: string;
  /** Pattern with /g flag for replace-all + reusable test. */
  re: RegExp;
}

const PATTERN_ENTRIES: readonly PatternEntry[] = [
  // Authorization header values (Bearer / Basic) — the most common leak
  // vector when an upstream API echoes a request header in an error.
  {
    label: "Authorization header",
    re: /(Authorization:\s*)(Bearer|Basic)(\s+)(\S+)/gi,
  },
  { label: "OpenAI sk- token", re: /\bsk-[A-Za-z0-9_\-]{20,}\b/g },
  { label: "GitHub PAT (ghp_)", re: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { label: "GitHub OAuth (gho_)", re: /\bgho_[A-Za-z0-9]{20,}\b/g },
  { label: "GitHub user (ghu_)", re: /\bghu_[A-Za-z0-9]{20,}\b/g },
  { label: "GitHub server (ghs_)", re: /\bghs_[A-Za-z0-9]{20,}\b/g },
  { label: "GitHub refresh (ghr_)", re: /\bghr_[A-Za-z0-9]{20,}\b/g },
  { label: "Slack token (xox*)", re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { label: "AWS access key (AKIA)", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "AWS session key (ASIA)", re: /\bASIA[0-9A-Z]{16}\b/g },
  // Bare Bearer / Basic tokens occurring without the "Authorization:" prefix
  // (e.g. "Bearer eyJhbGciOi..." in a free-floating log line).
  {
    label: "bare Bearer/Basic token",
    re: /\b(Bearer|Basic)(\s+)([A-Za-z0-9_\-\.=]{20,})\b/g,
  },
];

const PATTERNS: readonly RegExp[] = PATTERN_ENTRIES.map((e) => e.re);

/**
 * Replace recognisable token patterns in `text` with "***". Returns the
 * input string unchanged when no patterns match.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of PATTERNS) {
    out = out.replace(re, (...args) => {
      // Branch by capture-group count: only the Authorization-header
      // and bare-Bearer patterns have prefix groups we want to keep.
      const groups = args.slice(1, -2) as string[];
      if (groups.length === 4) {
        // (prefix)(scheme)(ws)(token) → preserve prefix + scheme
        const [prefix, scheme, ws, _token] = groups;
        return `${prefix ?? ""}${scheme ?? ""}${ws ?? ""}***`;
      }
      if (groups.length === 3) {
        // (scheme)(ws)(token)
        const [scheme, ws, _token] = groups;
        return `${scheme ?? ""}${ws ?? ""}***`;
      }
      return "***";
    });
  }
  return out;
}

/**
 * Predicate: does `text` contain anything that looks like a recognisable
 * token? Useful for tests and for validateSkillMode's literal-secret
 * scan.
 */
export function containsLikelySecret(text: string): boolean {
  return findLiteralSecret(text) !== null;
}

/**
 * Find the first matching literal-secret pattern in `text`. Returns
 * `null` when no pattern matches; otherwise returns a short label
 * identifying which pattern fired (e.g. "OpenAI sk- token") so callers
 * can produce a precise diagnostic without leaking the matched value.
 *
 * The returned object DOES NOT contain the matched substring — only
 * the pattern label. This keeps validation error messages safe to log.
 */
export function findLiteralSecret(text: string): { label: string } | null {
  if (!text) return null;
  for (const entry of PATTERN_ENTRIES) {
    entry.re.lastIndex = 0;
    const matched = entry.re.test(text);
    entry.re.lastIndex = 0;
    if (matched) return { label: entry.label };
  }
  return null;
}
