import { CommonModule } from '@angular/common';
import { Component, HostListener } from '@angular/core';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { NodeEditorComponent } from './node-editor.component';
import { XNode, collectHidden, enabledAttrOf, human, isTrue, titleOf, visibleCount } from './xml-model';
import { XmlService } from './xml.service';

interface NavGroup {
  label: string;
  items: XNode[];
}

type Theme = 'light' | 'dark';

/** new = DiagCAM New Key (from template)   ecn = upload an existing key / XML and update it */
type Mode = 'new' | 'ecn';

/** DiagCAM template lives in src/assets – replace that file to change what "DiagCAM New Key" starts from. */
const TEMPLATE_URL = 'assets/diagcam-template.xml';
const TEMPLATE_FILE = 'ApplicationConfig.xml';
const TC_TAG = 'Testcase';
const GROUP_LABELS: Record<string, string> = { Testcase: 'Test cases', Pre_requisite: 'Pre-requisites' };

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, NodeEditorComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  // ── sign in ──
  authed = false;
  loginUser = '';
  loginPass = '';
  loginReveal = false;
  loginBusy = false;
  loginError = '';
  private fails = 0;
  private lockUntil = 0;

  // ── which path the user chose ──
  mode: Mode | null = null;
  loadingTemplate = false;

  // ── loaded document ──
  root: XNode | null = null;
  fileName = '';
  originalText = '';
  private baseline = '';
  activeId: number | null = null;
  query = '';

  /** Test cases (node ids) that go into the key. Unticked ones are left out of the output. */
  included = new Set<number>();

  /** Items that were already off when the file was loaded (hidden from the form, kept in the XML). */
  hidden = new Set<object>();
  showOff = false;

  // ── theme ──
  theme: Theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

  // ── upload state ──
  dragOver = false;
  error = '';

  // ── export state ──
  showConfirm = false; // "are these the test cases you want?" dialog
  showPreview = false;
  busy = false;
  toast = '';
  private toastTimer: any;

  titleOf = titleOf;

  constructor(private xml: XmlService, private crypto: CryptoService, private auth: AuthService) {
    this.authed = this.auth.isLoggedIn;
  }

  // ───────────── sign in / out ─────────────
  get userName(): string {
    return this.auth.user;
  }

  get userInitial(): string {
    return (this.userName.charAt(0) || '?').toUpperCase();
  }

  async signIn(): Promise<void> {
    if (this.loginBusy) return;
    const wait = Math.ceil((this.lockUntil - Date.now()) / 1000);
    if (wait > 0) {
      this.loginError = `Too many attempts. Try again in ${wait}s.`;
      return;
    }
    if (!this.loginUser.trim() || !this.loginPass) {
      this.loginError = 'Enter your username and password.';
      return;
    }
    this.loginBusy = true;
    this.loginError = '';
    try {
      if (await this.auth.login(this.loginUser, this.loginPass)) {
        this.authed = true;
        this.loginPass = '';
        this.fails = 0;
      } else if (++this.fails >= 5) {
        this.fails = 0;
        this.lockUntil = Date.now() + 30_000;
        this.loginError = 'Too many attempts. Try again in 30s.';
      } else {
        this.loginError = 'Incorrect username or password.';
      }
    } catch (e: any) {
      this.loginError = `Could not check the credentials. ${e?.message ?? ''}`.trim();
    } finally {
      this.loginBusy = false;
    }
  }

  signOut(): void {
    this.auth.logout();
    this.closeFile();
    this.authed = false;
    this.loginUser = '';
    this.loginPass = '';
    this.loginError = '';
  }

  // ───────────── theme ─────────────
  setTheme(t: Theme): void {
    this.theme = t;
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('xmlstudio-theme', t);
    } catch {
      /* storage blocked – theme still applies for this visit */
    }
  }

  // ───────────── home: choose a path ─────────────
  /** DiagCAM New Key → load the template straight into the editor, nothing ticked yet. */
  async startNew(): Promise<void> {
    this.error = '';
    this.loadingTemplate = true;
    try {
      const res = await fetch(TEMPLATE_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      this.mode = 'new';
      this.load(text, TEMPLATE_FILE);
      if (!this.root) this.mode = null; // template failed to parse – message is already in `error`
      else window.scrollTo({ top: 0 });
    } catch (e: any) {
      this.mode = null;
      this.error = `Could not load the DiagCAM template. ${e?.message ?? ''}`.trim();
    } finally {
      this.loadingTemplate = false;
    }
  }

  /** ECN → show the upload screen. */
  startEcn(): void {
    this.error = '';
    this.mode = 'ecn';
  }

  get modeLabel(): string {
    return this.mode === 'new' ? 'DiagCAM New Key' : this.mode === 'ecn' ? 'ECN' : '';
  }

  // ───────────── upload (ECN) ─────────────
  onPick(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) this.readFile(f);
    input.value = ''; // lets the same file be picked again
  }

  onDrop(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver = false;
    const f = ev.dataTransfer?.files?.[0];
    if (f) this.readFile(f);
  }

  onDragOver(ev: DragEvent): void {
    ev.preventDefault();
    this.dragOver = true;
  }

  private async readFile(file: File): Promise<void> {
    this.error = '';
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.key') || lowerName.endsWith('.enc')) {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const prefix = new TextDecoder().decode(bytes.slice(0, 7));
      if (prefix === 'EXMLv1:') {
        this.error = 'This file uses the previous XML Studio encryption format. It is not compatible with the internal application key format. Please create a new key file with this updated version.';
        return;
      }
      try {
        const plain = this.crypto.decryptCompatible(buffer);
        this.load(plain, file.name.replace(/\.(key|enc)$/i, '.xml'));
      } catch (e: any) {
        this.error = e?.message ?? 'Unable to decode this key file.';
      }
      return;
    }
    const text = await file.text();
    this.load(text, file.name);
  }

  private load(text: string, name: string): void {
    try {
      this.root = this.xml.parse(text);
      // ECN: every test case in the uploaded key starts ticked (untick = remove).  New key: nothing ticked.
      this.included = new Set(this.mode === 'new' ? [] : this.testcases.map((n) => n.id));
      this.baseline = this.xml.serialize(this.outTree!);
      this.hidden = collectHidden(this.root);
      this.showOff = false;
      this.originalText = text;
      this.fileName = name;
      this.activeId = null;
      this.query = '';
      this.error = '';
    } catch (e: any) {
      this.root = null;
      this.error = `This is not valid XML. ${e?.message ?? ''}`.trim();
    }
  }

  reset(): void {
    if (!this.originalText) return;
    this.load(this.originalText, this.fileName);
    this.flash('Changes reset');
  }

  closeFile(): void {
    this.root = null;
    this.mode = null;
    this.fileName = '';
    this.originalText = '';
    this.included = new Set<number>();
    this.showConfirm = false;
    this.showPreview = false;
    this.error = '';
  }

  // ───────────── test case selection ─────────────
  isTc(n: XNode): boolean {
    return n.kind === 'element' && n.tag === TC_TAG;
  }

  /** Every <Testcase> in the document, ticked or not, in file order. */
  get testcases(): XNode[] {
    return this.root ? this.root.children.filter((c) => this.isTc(c)) : [];
  }

  get totalTc(): number {
    return this.testcases.length;
  }

  /** Ticked test cases = what goes into the key. */
  get selectedTestcases(): XNode[] {
    return this.testcases.filter((n) => this.included.has(n.id));
  }

  /** Unticked test cases (shown in the confirm dialog for ECN so removals are explicit). */
  get removedTestcases(): XNode[] {
    return this.testcases.filter((n) => !this.included.has(n.id));
  }

  isIncluded(n: XNode): boolean {
    return this.included.has(n.id);
  }

  toggleInclude(n: XNode): void {
    this.included.has(n.id) ? this.included.delete(n.id) : this.included.add(n.id);
    this.error = '';
  }

  includeGroup(items: XNode[], on: boolean): void {
    for (const n of items) if (this.isTc(n)) on ? this.included.add(n.id) : this.included.delete(n.id);
    this.error = '';
  }

  includeAll(on: boolean): void {
    this.includeGroup(this.testcases, on);
  }

  isTcGroup(g: NavGroup): boolean {
    return !!g.items.length && this.isTc(g.items[0]);
  }

  includedIn(g: NavGroup): number {
    return g.items.filter((n) => this.included.has(n.id)).length;
  }

  /** The tree that is actually saved: root minus the unticked test cases. */
  private get outTree(): XNode | null {
    if (!this.root) return null;
    return { ...this.root, children: this.root.children.filter((c) => !(this.isTc(c) && !this.included.has(c.id))) };
  }

  // ───────────── navigation ─────────────
  /** Every top-level section, hidden or not. */
  private get allSections(): XNode[] {
    if (!this.root) return [];
    const kids = this.root.children.filter((c) => c.kind === 'element');
    const list: XNode[] = [];
    // attributes on the root tag get their own section (same attr objects, so edits carry over)
    if (this.root.attrs.length) list.push({ ...this.root, children: [], text: '', hasField: false });
    list.push(...kids);
    return list.length ? list : [this.root];
  }

  /**
   * Sections the user should see: switched-off ones and ones with nothing left to edit are skipped.
   * Test cases are always listed, because each one needs its tick box.
   */
  get sections(): XNode[] {
    const all = this.allSections;
    if (this.showOff) return all;
    return all.filter((s) => this.isTc(s) || (!this.hidden.has(s) && visibleCount(s, this.hidden) > 0));
  }

  /** Sections matching the search box, grouped by tag name in order of first appearance. */
  get groups(): NavGroup[] {
    const q = this.query.trim().toLowerCase();
    const map = new Map<string, NavGroup>();
    for (const s of this.sections) {
      if (q && !(titleOf(s).toLowerCase().includes(q) || s.tag.toLowerCase().includes(q))) continue;
      const g = map.get(s.tag) ?? { label: GROUP_LABELS[s.tag] ?? human(s.tag), items: [] };
      g.items.push(s);
      map.set(s.tag, g);
    }
    return [...map.values()];
  }

  get current(): XNode | null {
    const s = this.sections;
    return s.find((n) => n.id === this.activeId) ?? s[0] ?? null;
  }

  /** ngFor over a one-item list so the editor is rebuilt whenever the section changes. */
  get currentList(): XNode[] {
    const c = this.current;
    return c ? [c] : [];
  }

  get hiddenCount(): number {
    return this.hidden.size;
  }

  select(n: XNode): void {
    this.activeId = n.id;
  }

  isOff(n: XNode): boolean {
    const en = enabledAttrOf(n);
    return !!en && !isTrue(en.value);
  }

  // ───────────── status ─────────────
  get dirty(): boolean {
    const t = this.outTree;
    return !!t && this.xml.serialize(t) !== this.baseline;
  }

  get fileSize(): string {
    const kb = new Blob([this.originalText]).size / 1024;
    return kb < 1 ? '<1 KB' : `${kb.toFixed(1)} KB`;
  }

  // ───────────── export ─────────────
  get preview(): string {
    const t = this.outTree;
    return t ? this.xml.serialize(t) : '';
  }

  /** "Generate key" button: first ask the user to confirm the test cases that will go in. */
  requestKey(): void {
    if (this.totalTc && !this.selectedTestcases.length) {
      this.error = 'Tick at least one test case on the left to generate the key.';
      return;
    }
    this.error = '';
    this.showConfirm = true;
    setTimeout(() => document.getElementById('dlg-ok')?.focus(), 30);
  }

  async confirmGenerate(): Promise<void> {
    this.showConfirm = false;
    await this.downloadEncrypted();
  }

  @HostListener('document:keydown.escape')
  closeDialogs(): void {
    this.showConfirm = false;
    this.showPreview = false;
  }

  async downloadEncrypted(): Promise<void> {
    const tree = this.outTree;
    if (!tree) return;
    this.busy = true;
    this.error = '';
    try {
      const keyBytes = this.crypto.encryptCompatible(this.xml.serialize(tree));
      this.save(keyBytes, this.baseName + '.key', 'application/octet-stream');
      this.flash('Key file generated');
    } catch (e: any) {
      this.error = 'Could not create the key file. ' + (e?.message ?? e);
    } finally {
      this.busy = false;
    }
  }

  downloadPlain(): void {
    const tree = this.outTree;
    if (!tree) return;
    this.save(this.xml.serialize(tree), this.baseName + '.xml');
    this.flash('Plain XML downloaded');
  }

  private get baseName(): string {
    return (this.fileName || 'config.xml').replace(/\.(key|enc|xml)$/i, '');
  }

  private save(content: string | Uint8Array, name: string, mimeType = 'text/plain;charset=utf-8'): void {
    const blobPart = content instanceof Uint8Array ? new Blob([content.slice().buffer], { type: mimeType }) : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blobPart);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private flash(msg: string): void {
    this.toast = msg;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (this.toast = ''), 2800);
  }

  trackNode = (_: number, n: XNode) => n.id;
  trackGroup = (_: number, g: NavGroup) => g.label;
}
