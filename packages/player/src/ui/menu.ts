export interface MenuItem {
  value: string;
  label: string;
  /** Small text at the right of the row, such as a chapter's start time. */
  note?: string;
  checked?: boolean;
}

/** A pop-up list of choices opened by a button in the control bar. */
export class Menu {
  private items: MenuItem[] = [];

  constructor(
    private el: HTMLElement,
    private button: HTMLButtonElement,
    private title: string,
    private onSelect: (value: string) => void,
    private onOpen: () => void = () => undefined
  ) {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggle();
    });
    el.addEventListener('click', (event) => {
      const item = (event.target as Element).closest('button');
      if (item) {
        this.close();
        this.onSelect(item.dataset.value ?? '');
        this.button.focus();
      }
    });
    el.addEventListener('keydown', (event) => {
      // Keys typed in a menu belong to the menu, not to the player's shortcuts.
      event.stopPropagation();
      if (event.key === 'Escape') {
        this.close();
        this.button.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.move(event.key === 'ArrowDown' ? 1 : -1);
      }
    });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  setItems(items: MenuItem[]): void {
    this.items = items;
    this.el.replaceChildren();
    const title = document.createElement('div');
    title.className = 'menu-title';
    title.textContent = this.title;
    this.el.append(title);
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', String(item.checked === true));
      b.dataset.value = item.value;
      const label = document.createElement('span');
      label.textContent = item.label;
      b.append(label);
      if (item.note) {
        const note = document.createElement('span');
        note.className = 'item-note';
        note.textContent = item.note;
        b.append(note);
      }
      this.el.append(b);
    }
  }

  /** Mark one value as the current choice. */
  check(value: string): void {
    this.items = this.items.map((item) => ({ ...item, checked: item.value === value }));
    for (const b of this.buttons()) {
      b.setAttribute('aria-checked', String(b.dataset.value === value));
    }
  }

  open(): void {
    if (this.isOpen || this.items.length === 0) {
      return;
    }
    this.onOpen();
    this.el.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    const buttons = this.buttons();
    (buttons.find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons[0])?.focus();
  }

  close(): void {
    this.el.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.el.querySelectorAll('button'));
  }

  private move(step: number): void {
    const buttons = this.buttons();
    const root = this.el.getRootNode() as Document | ShadowRoot;
    const at = buttons.indexOf(root.activeElement as HTMLButtonElement);
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  }
}
