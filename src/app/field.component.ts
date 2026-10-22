import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FieldKind, flipBool, human, isTrue, kindOf } from './xml-model';

/**
 * FieldComponent – one value, one control.
 * The control type (toggle / number / password / text / textarea) is decided once
 * on init, so typing "1" in a text box never swaps the input under the cursor.
 */
@Component({
  selector: 'app-field',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="field" [class.wide]="kind === 'textarea'">
      <label class="lbl" [attr.for]="uid" [title]="label">{{ human(label) }}</label>

      <ng-container [ngSwitch]="kind">
        <label *ngSwitchCase="'toggle'" class="switch">
          <input type="checkbox" role="switch" [id]="uid" [checked]="on" (change)="toggle($any($event.target).checked)" />
          <span class="track"><span class="thumb"></span></span>
          <span class="state">{{ on ? 'On' : 'Off' }}</span>
        </label>

        <textarea
          *ngSwitchCase="'textarea'"
          [id]="uid"
          rows="3"
          [value]="value"
          (input)="set($any($event.target).value)"
        ></textarea>

        <div *ngSwitchCase="'secret'" class="secret">
          <input
            [id]="uid"
            [type]="reveal ? 'text' : 'password'"
            autocomplete="off"
            [value]="value"
            (input)="set($any($event.target).value)"
          />
          <button type="button" class="reveal" (click)="reveal = !reveal">{{ reveal ? 'Hide' : 'Show' }}</button>
        </div>

        <input
          *ngSwitchCase="'number'"
          [id]="uid"
          type="text"
          inputmode="decimal"
          class="num"
          [value]="value"
          (input)="set($any($event.target).value)"
        />

        <input *ngSwitchDefault [id]="uid" type="text" [value]="value" (input)="set($any($event.target).value)" />
      </ng-container>
    </div>
  `,
  styles: [
    `
      :host { display: contents; }
      .field { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
      .field.wide { grid-column: 1 / -1; }
      .lbl { font-size: 12.5px; font-weight: 500; color: var(--ink-2); }

      input[type='text'], input[type='password'], textarea {
        width: 100%; padding: 10px 13px; border-radius: 11px; border: 1px solid transparent;
        background: var(--field); color: var(--ink); font: inherit; font-size: 14.5px; outline: none;
        transition: background .15s, border-color .15s, box-shadow .15s;
      }
      input:hover, textarea:hover { background: var(--field-hover); }
      input[type='text']:focus, input[type='password']:focus, textarea:focus {
        background: var(--sheet); border-color: var(--accent); box-shadow: 0 0 0 4px var(--accent-soft);
      }
      textarea { resize: vertical; line-height: 1.5; min-height: 76px; }
      .num { font-variant-numeric: tabular-nums; }

      .secret { position: relative; }
      .secret input { padding-right: 62px; }
      .reveal {
        position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
        border: none; background: none; color: var(--accent); font-size: 13px; font-weight: 600;
        padding: 6px 8px; border-radius: 8px; cursor: pointer;
      }
      .reveal:hover { background: var(--accent-soft); }

      .switch { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; width: fit-content; min-height: 41px; }
      .switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
      .track { width: 44px; height: 26px; border-radius: 999px; background: var(--rule); position: relative; transition: background .18s; flex-shrink: 0; }
      .thumb {
        position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%;
        background: #fff; transition: transform .2s cubic-bezier(.3, .9, .3, 1.2); box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
      }
      input:checked + .track { background: var(--accent); }
      input:checked + .track .thumb { transform: translateX(18px); }
      input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
      .state { font-size: 14px; color: var(--ink-2); }
    `,
  ],
})
export class FieldComponent implements OnInit {
  private static n = 0;

  @Input() label = '';
  @Input() value = '';
  @Output() valueChange = new EventEmitter<string>();

  kind: FieldKind = 'text';
  reveal = false;
  uid = 'f' + FieldComponent.n++;
  human = human;

  ngOnInit(): void {
    this.kind = kindOf(this.label, this.value);
  }

  get on(): boolean {
    return isTrue(this.value);
  }

  toggle(on: boolean): void {
    this.valueChange.emit(flipBool(this.value, on));
  }

  set(v: string): void {
    this.valueChange.emit(v);
  }
}
