import { Injectable } from '@angular/core';
import { XNode } from './xml-model';

/**
 * XmlService – XML string ↔ XNode tree.
 * parse()     : parses XML into a tree (comments-um keep aagum)
 * serialize() : serializes the edited tree back into formatted XML
 */
@Injectable({ providedIn: 'root' })
export class XmlService {
  private counter = 0;

  parse(xml: string): XNode {
    // BOM irundha remove pannidu
    const clean = xml.replace(/^﻿/, '');
    const doc = new DOMParser().parseFromString(clean, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) {
      const msg = (err.textContent || 'Invalid XML').split('\n').find((l) => l.trim()) || 'Invalid XML';
      throw new Error(msg.trim());
    }
    return this.fromElement(doc.documentElement);
  }

  private fromElement(el: Element): XNode {
    const node: XNode = {
      id: ++this.counter,
      kind: 'element',
      tag: el.tagName,
      attrs: Array.from(el.attributes).map((a) => ({ name: a.name, value: a.value })),
      text: '',
      children: [],
      hasField: false,
    };

    let text = '';
    el.childNodes.forEach((c) => {
      if (c.nodeType === Node.ELEMENT_NODE) {
        node.children.push(this.fromElement(c as Element));
      } else if (c.nodeType === Node.COMMENT_NODE) {
        node.children.push({
          id: ++this.counter,
          kind: 'comment',
          tag: '#comment',
          attrs: [],
          text: c.nodeValue ?? '',
          children: [],
        });
      } else if (c.nodeType === Node.TEXT_NODE || c.nodeType === Node.CDATA_SECTION_NODE) {
        text += c.nodeValue ?? '';
      }
    });

    // when child elements exist, ignore whitespace-only text
    const hasElementChild = node.children.some((c) => c.kind === 'element');
    node.text = hasElementChild ? '' : text.trim();
    // A leaf gets a text field if it has text, or if it has no attributes at all.
    // Fixed here (at load) so erasing the text later never removes the field.
    node.hasField = !hasElementChild && (node.text !== '' || node.attrs.length === 0);
    return node;
  }

  /** `exclude` = nodes to leave out of the output (test cases the user removed / did not select). */
  serialize(root: XNode, exclude?: Set<object>): string {
    return '<?xml version="1.0" encoding="utf-8"?>\n' + this.write(root, 0, exclude) + '\n';
  }

  private write(n: XNode, depth: number, exclude?: Set<object>): string {
    const pad = '  '.repeat(depth);
    if (n.kind === 'comment') return `${pad}<!--${n.text}-->`;

    const attrs = n.attrs.map((a) => ` ${a.name}="${this.esc(a.value)}"`).join('');
    const kids = exclude && exclude.size ? n.children.filter((c) => !exclude.has(c)) : n.children;
    if (kids.length === 0 && n.children.length === 0) {
      if (!n.text) {
        return attrs ? `${pad}<${n.tag}${attrs}/>` : `${pad}<${n.tag}></${n.tag}>`;
      }
      return `${pad}<${n.tag}${attrs}>${this.esc(n.text)}</${n.tag}>`;
    }
    if (kids.length === 0) return `${pad}<${n.tag}${attrs}></${n.tag}>`;
    const inner = kids.map((c) => this.write(c, depth + 1, exclude)).join('\n');
    return `${pad}<${n.tag}${attrs}>\n${inner}\n${pad}</${n.tag}>`;
  }

  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
