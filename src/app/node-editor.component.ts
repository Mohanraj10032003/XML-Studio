import { CommonModule } from '@angular/common';
import { Component, HostBinding, Input, OnInit } from '@angular/core';
import { FieldComponent } from './field.component';
import { XAttr, XNode, enabledAttrOf, flipBool, isTrue, titleOf } from './xml-model';

/**
 * NodeEditorComponent – recursive.
 *
 *  • Section (depth 0)       → big title, its attributes, then everything inside it
 *  • Group (has child tags)  → heading with a guide line on the left (shows nesting)
 *  • Row (leaf with attrs)   → one tinted row: value + its attributes + on/off switch
 *  • Simple (<Tag>text</Tag>)→ a single field, no box
 *  • Comment                 → read-only, shown only when "Show disabled items" is on
 *
 * Anything that was already off when the file was loaded (the `hiddenSet`) is not rendered
 * unless `showOff` is true. The XML itself is never changed by hiding.
 */
@Component({
  selector: 'app-node-editor',
  standalone: true,
  imports: [CommonModule, FieldComponent],
  template: `
    <div *ngIf="node.kind === 'comment'" class="note">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
      <div>
        <code>{{ node.text.trim() }}</code>
        <span>Comment. It will be preserved in the XML.</span>
      </div>
    </div>

    <div *ngIf="node.kind === 'element' && isSimple" class="simple" [class.off]="parentOff">
      <app-field [label]="node.tag" [(value)]="node.text"></app-field>
    </div>

    <section
      *ngIf="node.kind === 'element' && !isSimple"
      class="node"
      [class.top]="depth === 0"
      [class.row]="isRow"
      [class.group]="!isRow && depth > 0"
      [class.off]="isOff"
    >
      <header class="head">
        <h3>{{ title }}</h3>
        <span class="tag">&lt;{{ node.tag }}&gt;</span>
        <span class="pill" *ngIf="isOff && enabledAttr">Off</span>

        <label class="switch" *ngIf="enabledAttr as en">
          <input type="checkbox" role="switch" [checked]="isOn(en.value)" (change)="setEnabled(en, $any($event.target).checked)" [attr.aria-label]="title + ' on/off'" />
          <span class="track"><span class="thumb"></span></span>
          <span class="state">{{ isOn(en.value) ? 'On' : 'Off' }}</span>
        </label>
      </header>

      <div class="grid" *ngIf="showText || otherAttrs.length">
        <app-field *ngIf="showText" [label]="isLeaf && node.attrs.length ? 'Value' : node.tag" [(value)]="node.text"></app-field>
        <app-field *ngFor="let a of otherAttrs; trackBy: trackAttr" [label]="a.name" [(value)]="a.value"></app-field>
      </div>

      <div class="kids" *ngIf="visibleKids.length">
        <app-node-editor
          *ngFor="let c of visibleKids; trackBy: trackNode"
          [node]="c"
          [depth]="depth + 1"
          [parentOff]="isOff"
          [hiddenSet]="hiddenSet"
          [showOff]="showOff"
        ></app-node-editor>
      </div>

      <p class="empty" *ngIf="depth === 0 && isEmpty">No enabled items in this section.</p>
    </section>
  `,
  styles: [
    `
      :host { display: block; }
      :host(.wide) { grid-column: 1 / -1; }

      .node { transition: opacity .2s; }
      .node.off > .head h3, .node.off > .grid, .node.off > .kids { opacity: .55; }

      .head { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; min-width: 0; }
      h3 { margin: 0; font-weight: 600; font-size: 16px; letter-spacing: -.005em; }
      .tag {
        font-family: var(--mono); font-size: 12px; color: var(--ink-2);
        background: var(--field); padding: 2px 8px; border-radius: 7px;
      }
      .pill { font-size: 12px; font-weight: 600; color: var(--ink-2); border: 1px solid var(--rule); padding: 1px 9px; border-radius: 999px; }
      .head .switch { margin-left: auto; }

      .grid {
        display: grid; gap: 16px 20px; margin-top: 16px;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }
      .kids {
        display: grid; gap: 18px 20px; margin-top: 22px; align-items: start;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }
      .empty { margin: 22px 0 0; color: var(--ink-2); }

      /* section */
      .node.top h3 { font-family: var(--display); font-size: clamp(28px, 3.4vw, 40px); line-height: 1.05; font-weight: 700; letter-spacing: -.03em; }
      .node.top > .kids { margin-top: 32px; gap: 26px 20px; }

      /* group: the guide line shows nesting */
      .node.group { border-left: 2px solid var(--rule); padding-left: 22px; margin-left: 2px; }
      .node.group > .head h3 { font-size: 17px; }

      /* row: leaf that carries attributes */
      .node.row {
        background: var(--tint); border-radius: 16px; padding: 14px 18px 18px;
        --field: var(--sheet); --field-hover: var(--sheet);
      }
      .node.row > .head h3 { font-size: 15px; }
      .node.row .tag { background: var(--sheet); }

      .simple { transition: opacity .2s; }
      .simple.off { opacity: .55; }

      .note {
        display: flex; align-items: flex-start; gap: 12px; color: var(--ink-2);
        padding: 4px 0 4px 14px; border-left: 2px dashed var(--rule); font-size: 13px;
      }
      .note svg { flex-shrink: 0; margin-top: 3px; }
      .note code { display: block; font-family: var(--mono); font-size: 12.5px; color: var(--ink); word-break: break-all; }
      .note span { display: block; margin-top: 2px; }

      .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; flex-shrink: 0; }
      .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
      .track { width: 44px; height: 26px; border-radius: 999px; background: var(--rule); position: relative; transition: background .18s; }
      .thumb {
        position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
        background: #fff; transition: transform .2s cubic-bezier(.3, .9, .3, 1.2); box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
      }
      input:checked + .track { background: var(--accent); }
      input:checked + .track .thumb { transform: translateX(18px); }
      input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
      .state { font-size: 13.5px; color: var(--ink-2); min-width: 24px; }
    `,
  ],
})
export class NodeEditorComponent implements OnInit {
  @Input({ required: true }) node!: XNode;
  @Input() depth = 0;
  @Input() parentOff = false;
  /** Elements/attributes that were already off when the file was loaded. */
  @Input() hiddenSet: Set<object> = new Set();
  /** true → render the hidden ones too. */
  @Input() showOff = false;

  private isHid(x: object): boolean {
    return !this.showOff && this.hiddenSet.has(x);
  }

  /** Nested, no children, no attributes → one compact field. */
  get isSimple(): boolean {
    return (
      this.depth > 0 &&
      this.node.kind === 'element' &&
      this.node.attrs.length === 0 &&
      this.node.children.length === 0
    );
  }

  /** Leaf that carries attributes (e.g. <ModuleName Enabled Port>…</ModuleName>). */
  get isRow(): boolean {
    return this.depth > 0 && this.isLeaf && this.node.attrs.length > 0;
  }

  /** Groups, rows and long values take the full width; short simple fields share a row. */
  @HostBinding('class.wide')
  get wide(): boolean {
    return !this.isSimple || this.longText;
  }

  /** Remembered from first render so the layout does not jump while the user is typing. */
  private longText = false;

  ngOnInit(): void {
    this.longText = this.node.text.length > 70 || this.node.text.includes('\n');
  }

  get title(): string {
    return titleOf(this.node);
  }

  get enabledAttr(): XAttr | undefined {
    return enabledAttrOf(this.node);
  }

  get otherAttrs(): XAttr[] {
    const list = this.node.attrs.filter((a) => !/^enabled$/i.test(a.name) && !this.isHid(a));
    if (this.showOff) return list;
    // name="…" is an identifier (already the title), not an input – hide it unless it's all there is
    const rest = list.filter((a) => !/^name$/i.test(a.name));
    const hasOther =
      rest.length > 0 || !!this.node.hasField || this.node.children.some((c) => c.kind === 'element' && !this.isHid(c));
    return hasOther ? rest : list;
  }

  /** Children to render: hidden elements are skipped, and comments only show in "show off" mode. */
  get visibleKids(): XNode[] {
    return this.node.children.filter((c) => (c.kind === 'comment' ? this.showOff : !this.isHid(c)));
  }

  get isLeaf(): boolean {
    return !this.node.children.some((c) => c.kind === 'element');
  }

  /** Show a text input for leaves – but not for attribute-only tags like <Report width="2700"/>. */
  get showText(): boolean {
    if (!this.isLeaf || this.node.children.length) return false;
    return !!this.node.hasField;
  }

  get isEmpty(): boolean {
    return !this.showText && !this.otherAttrs.length && !this.visibleKids.length;
  }

  get isOff(): boolean {
    const en = this.enabledAttr;
    return this.parentOff || (!!en && !isTrue(en.value));
  }

  isOn = isTrue;

  setEnabled(a: XAttr, on: boolean): void {
    a.value = flipBool(a.value, on);
  }

  trackAttr = (_: number, a: XAttr) => a.name;
  trackNode = (_: number, n: XNode) => n.id;
}
