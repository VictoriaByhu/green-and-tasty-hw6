import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DestroyRef } from '@angular/core';
import { Participant } from '@app/models/group-orders/participant.model';
import { Order } from '@app/models/orders/order.model';
import { GroupOrderReviewService } from '@app/services/group-orders/group-order-review.service';
import { ToastService } from '@app/services/toast/toast.service';
import { ModalComponent } from '@app/shared/custom-components/modal/modal.component';
import { consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';
import { GroupOrderPageComponent } from '../group-order-page/group-order-page.component';
import { DishGroup, DishOrderer, DishRow, MemberChip, ReviewItem, ReviewViewMode } from './models';

@Component({
  selector: 'app-group-order-review-page',
  imports: [ModalComponent, CurrencyPipe, DatePipe, RouterLink],
  templateUrl: './group-order-review-page.component.html',
  styleUrl: './group-order-review-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
  host: { '(document:keydown.escape)': 'closeMenu()' },
})
export class GroupOrderReviewPageComponent extends GroupOrderPageComponent {
  private readonly review = inject(GroupOrderReviewService);
  private readonly toastService = inject(ToastService);
  private readonly destroy = inject(DestroyRef);
  readonly reservationKey = inject(ActivatedRoute).snapshot.paramMap.get('reservationId') ?? '';

  readonly viewMode = signal<ReviewViewMode>('guest');
  readonly collapsed = signal<ReadonlySet<string>>(new Set());
  readonly openMenuId = signal<string | null>(null);
  readonly activityOpen = signal(false);
  readonly ownerOrder = signal<Order | null>(null);
  readonly dishTypes = signal<Map<string, string>>(new Map());

  readonly guests = computed(() =>
    this.participants().filter((person) => person.type === 'Guest' && person.id !== this.ownerSessionId()),
  );
  private readonly ownerSession = computed(() =>
    this.participants().find((person) => person.id === this.ownerSessionId() || person.type === 'Owner'),
  );

  readonly ownerItems = computed<ReviewItem[]>(() => {
    const order = this.ownerOrder();
    if (order?.orderItems?.length) {
      return order.orderItems.map((item) => ({ dish: item.dish, quantity: item.quantity }));
    }
    return this.ownerSession()?.items ?? [];
  });
  readonly ownerTotal = computed(() => sumItems(this.ownerItems()));
  readonly ownerOrdered = computed(() => this.ownerItems().length > 0);

  readonly submittedGuests = computed(() => this.guests().filter((guest) => guest.isSubmitted));
  readonly guestsTotal = computed(() => consolidatePreOrder(this.guests()).total);
  readonly reviewGrandTotal = computed(() => this.ownerTotal() + this.guestsTotal());
  readonly submittedGuestNames = computed(() => this.submittedGuests().map((guest) => guest.name).join(', '));

  readonly seats = computed(() => Math.max(this.invite()?.MaxGuestCount ?? 0, this.guests().length + 1));
  readonly orderedCount = computed(() => (this.ownerOrdered() ? 1 : 0) + this.submittedGuests().length);
  readonly pendingGuests = computed(() => this.guests().filter((guest) => !guest.isSubmitted));
  readonly dishesCount = computed(
    () =>
      countItems(this.ownerItems()) +
      this.submittedGuests().reduce((sum, guest) => sum + countItems(guest.items), 0),
  );
  readonly chips = computed<MemberChip[]>(() => {
    const chips: MemberChip[] = [{ key: 'host', name: 'You', ordered: this.ownerOrdered(), joined: true }];
    for (const guest of this.guests()) {
      chips.push({ key: guest.id, name: guest.name, ordered: guest.isSubmitted, joined: true });
    }
    for (let seat = chips.length; seat < this.seats(); seat++) {
      chips.push({ key: `seat-${seat}`, name: 'Not joined', ordered: false, joined: false });
    }
    return chips;
  });

  readonly startsIn = computed(() => {
    this.lastUpdated();
    const start = this.invite()?.StartTime;
    if (!start) return '';
    const minutes = Math.round((new Date(start).getTime() - Date.now()) / 60_000);
    if (minutes <= 0) return 'Started';
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days >= 1) return `Starts in ${days}d ${hours % 24}h`;
    return hours > 0 ? `Starts in ${hours}h ${minutes % 60}m` : `Starts in ${minutes}m`;
  });

  readonly dishGroups = computed<DishGroup[]>(() => {
    const rows = new Map<string, DishRow>();
    const add = (items: ReviewItem[], orderer: DishOrderer) => {
      for (const item of items) {
        const row = rows.get(item.dish.id) ?? { dish: item.dish, quantity: 0, total: 0, orderedBy: [] };
        row.quantity += item.quantity;
        row.total += item.dish.price * item.quantity;
        if (!row.orderedBy.some((existing) => existing.name === orderer.name)) {
          row.orderedBy.push(orderer);
        }
        rows.set(item.dish.id, row);
      }
    };
    add(this.ownerItems(), { name: 'You', isHost: true, isSubmitted: true });
    for (const guest of this.guests()) {
      add(guest.items, { name: guest.name, isHost: false, isSubmitted: guest.isSubmitted });
    }

    const groups = new Map<string, DishRow[]>();
    for (const row of rows.values()) {
      const title = categoryTitle(this.dishTypes().get(row.dish.id));
      groups.set(title, [...(groups.get(title) ?? []), row]);
    }
    return [...groups.entries()].map(([title, groupRows]) => ({
      title,
      rows: groupRows,
      total: groupRows.reduce((sum, row) => sum + row.total, 0),
    }));
  });
  readonly emptyGuests = computed(() => this.guests().filter((guest) => guest.items.length === 0));

  constructor() {
    super();
    effect(() => {
      if (this.lastUpdated()) {
        untracked(() => this.loadOwnerOrder());
      }
    });
    this.review
      .getDishTypes$()
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({ next: (types) => this.dishTypes.set(types), error: () => undefined });
  }

  setView(mode: ReviewViewMode): void {
    this.viewMode.set(mode);
  }

  isCollapsed(id: string): boolean {
    return this.collapsed().has(id);
  }

  toggle(id: string): void {
    const next = new Set(this.collapsed());
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.collapsed.set(next);
  }

  readonly allCollapsed = computed(() => {
    const ids = ['host', ...this.guests().map((guest) => guest.id)];
    return ids.every((id) => this.collapsed().has(id));
  });

  toggleAll(): void {
    this.collapsed.set(
      this.allCollapsed() ? new Set() : new Set(['host', ...this.guests().map((guest) => guest.id)]),
    );
  }

  toggleMenu(id: string): void {
    this.openMenuId.set(this.openMenuId() === id ? null : id);
  }

  closeMenu(): void {
    this.openMenuId.set(null);
  }

  removeFromMenu(guest: Participant): void {
    this.closeMenu();
    this.askRemove(guest);
  }

  copyInviteLink(): void {
    this.closeMenu();
    this.review
      .getInviteToken$(this.reservationKey)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({
        next: (token) => {
          const link = `${window.location.origin}/join/${token}`;
          navigator.clipboard
            .writeText(link)
            .then(() => this.toastService.success('Invite link copied'))
            .catch(() => this.toastService.info(link, 'Invite link'));
        },
        error: () => this.toastService.error('Couldn’t get the invite link'),
      });
  }

  initial(name: string): string {
    return name.charAt(0).toUpperCase();
  }

  itemsLabel(items: ReviewItem[]): string {
    const count = countItems(items);
    return `${count} ${count === 1 ? 'item' : 'items'}`;
  }

  dishNames(items: ReviewItem[]): string {
    return items.map((item) => item.dish.name).join(', ');
  }

  private loadOwnerOrder(): void {
    this.review
      .getOwnerOrder$(this.reservationKey)
      .pipe(takeUntilDestroyed(this.destroy))
      .subscribe({ next: (order) => this.ownerOrder.set(order), error: () => this.ownerOrder.set(null) });
  }
}

function sumItems(items: ReviewItem[]): number {
  return items.reduce((sum, item) => sum + item.dish.price * item.quantity, 0);
}

function countItems(items: ReviewItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

function categoryTitle(dishType: string | undefined): string {
  switch ((dishType ?? '').toLowerCase()) {
    case 'appetizer':
      return 'Appetizers';
    case 'main course':
      return 'Main courses';
    case 'dessert':
      return 'Desserts';
    default:
      return 'Dishes';
  }
}
