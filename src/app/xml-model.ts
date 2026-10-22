// ─────────────────────────────────────────────────────────────
//  xml-model.ts  –  XML tree model + naming/field helpers
// ─────────────────────────────────────────────────────────────

export interface XAttr {
  name: string;
  value: string;
}

/** One XML node: an element or a comment. */
export interface XNode {
  id: number;
  kind: 'element' | 'comment';
  tag: string;          // element name ('#comment' for comments)
  attrs: XAttr[];       // attributes, order preserved
  text: string;         // leaf text (comment content for comments)
  children: XNode[];    // child elements + comments
  /**
   * Decided ONCE when the file is parsed: does this leaf element get a text field?
   * It must not depend on the live text, otherwise erasing the text makes the field vanish.
   */
  hasField?: boolean;
}

export type FieldKind = 'toggle' | 'number' | 'secret' | 'text' | 'textarea';

/** "Pre_requisite" → "Pre requisite", "MCUFirmwareVersion" → "MCU Firmware Version" */
export function pretty(s: string): string {
  return s
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Human label in sentence case. Long ALL-CAPS words are lowered
 * ("REMOTE_ROOT" → "Remote root"), short acronyms stay ("ENABLE_MES" → "Enable MES").
 */
export function human(s: string): string {
  const words = pretty(s)
    .split(' ')
    .map((w) => (w.length > 3 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w.toLowerCase() : w));
  const out = words.join(' ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Best title for a node: Custom_Name > name > tag */
export function titleOf(n: XNode): string {
  const find = (re: RegExp) =>
    n.attrs.find((a) => re.test(a.name) && a.value.trim() !== '')?.value.trim();
  return human(find(/^custom[_-]?name$/i) ?? find(/^name$/i) ?? n.tag);
}

/** The "Enabled" attribute, if the node has one. */
export function enabledAttrOf(n: XNode): XAttr | undefined {
  return n.attrs.find((a) => /^enabled$/i.test(a.name));
}

export function isTrue(v: string): boolean {
  return v.trim().toLowerCase() === 'true';
}

/** Flip a boolean string but keep its casing style ("False" → "True", "false" → "true"). */
export function flipBool(prev: string, on: boolean): string {
  const cap = /^[A-Z]/.test(prev.trim());
  return on ? (cap ? 'True' : 'true') : cap ? 'False' : 'false';
}

/** Decide which control a value deserves. */
export function kindOf(label: string, value: string): FieldKind {
  if (/pass(word)?|pwd|secret|token|api[_-]?key/i.test(label)) return 'secret';
  const v = value.trim().toLowerCase();
  if (v === 'true' || v === 'false') return 'toggle';
  if (/^-?\d+(\.\d+)?$/.test(v)) return 'number';
  if (value.length > 70 || value.includes('\n')) return 'textarea';
  return 'text';
}

export function isElement(n: XNode): boolean {
  return n.kind === 'element';
}

// ───────────── "show only what is on" helpers ─────────────

/**
 * Is this element switched off?
 *  • Enabled="false" attribute, or
 *  • an off flag child: <Enabled>false</Enabled>, or <ENABLE_MES>false</ENABLE_MES> inside the MES section
 */
export function isDisabledNode(n: XNode): boolean {
  const a = enabledAttrOf(n);
  if (a && isOffValue(a.value)) return true;
  return n.children.some((c) => isFlagOf(n, c) && isOffValue(c.text));
}

/**
 * Snapshot taken when a file is loaded: every element or attribute that is already
 * "off" (disabled node, or a true/false flag set to false). Nothing is deleted from the XML –
 * these are only hidden from the form. Using a snapshot means an item the user switches off
 * later stays visible, so it can be switched back on.
 */
export function collectHidden(root: XNode): Set<object> {
  const hidden = new Set<object>();
  const falseFlag = (label: string, value: string) => kindOf(label, value) === 'toggle' && !isTrue(value);

  const visit = (n: XNode): void => {
    for (const a of n.attrs) {
      if (!/^enabled$/i.test(a.name) && falseFlag(a.name, a.value)) hidden.add(a);
    }
    for (const c of n.children) {
      if (c.kind !== 'element') continue;
      if (isDisabledNode(c)) { hidden.add(c); continue; }
      if (!c.children.length && !c.attrs.length && falseFlag(c.tag, c.text)) { hidden.add(c); continue; }
      visit(c);
    }
  };
  visit(root);
  return hidden;
}

/** How many editable fields are left in this node once hidden items are removed (name attrs don't count). */
export function visibleCount(n: XNode, hidden: Set<object>): number {
  if (n.kind !== 'element' || hidden.has(n)) return 0;
  const kids = n.children.filter((k) => k.kind === 'element');
  let c = n.attrs.filter(
    (a) => !/^enabled$/i.test(a.name) && !/^(custom[_-]?)?name$/i.test(a.name) && !hidden.has(a)
  ).length;
  if (!kids.length && n.hasField) c += 1;
  for (const k of kids) c += visibleCount(k, hidden);
  return c;
}

// ─────────────────────────────────────────────────────────────
//  On/off flag helpers (used by isDisabledNode)
// ─────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "false" / "0" / "no" / "off" */
export function isOffValue(v: string): boolean {
  return /^(false|0|no|off)$/i.test(v.trim());
}

/**
 * A child tag like <Enabled>true</Enabled> or <ENABLE_MES>false</ENABLE_MES> that acts as the
 * on/off switch of its parent. <EnableLogging> counts only when the parent is about "Logging".
 */
export function isFlagOf(parent: XNode, c: XNode): boolean {
  if (c.kind !== 'element' || c.children.length || c.attrs.length) return false;
  const v = c.text.trim().toLowerCase();
  if (v !== 'true' && v !== 'false') return false;
  const m = /^(?:is[_-]?)?enabled?(?:[_-]?(.+))?$/i.exec(c.tag);
  if (!m) return false;
  const rest = norm(m[1] ?? '');
  if (!rest) return true;
  if (rest.length < 2) return false;
  const names = parent.attrs.filter((a) => /^(custom[_-]?)?name$/i.test(a.name)).map((a) => a.value);
  return norm(parent.tag + ' ' + names.join(' ')).includes(rest);
}
