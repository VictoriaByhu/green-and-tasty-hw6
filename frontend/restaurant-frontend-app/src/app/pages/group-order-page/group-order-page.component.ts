import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { EMPTY, Subject, Subscription, catchError, exhaustMap, finalize, forkJoin, interval, merge, switchMap } from 'rxjs';
import { ParticipantCardComponent } from '@app/components/group-orders/participant-card/participant-card.component';
import { GroupReservationStatus } from '@app/models/group-orders/group-status.model';
import { Participant } from '@app/models/group-orders/participant.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { ToastService } from '@app/services/toast/toast.service';
import { ModalComponent } from '@app/shared/custom-components/modal/modal.component';
import { consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';
import { LoadState } from './models';

/** Як часто підтягувати свіжі кошики, поки група Open. */
const SYNC_INTERVAL_MS = 15_000;

@Component({
  selector: 'app-group-order-page',
  imports: [ParticipantCardComponent, ModalComponent, CurrencyPipe, DatePipe],
  templateUrl: './group-order-page.component.html',
  styleUrl: './group-order-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class GroupOrderPageComponent {
  private readonly groupOrders = inject(GroupOrdersService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly reservationId = inject(ActivatedRoute).snapshot.paramMap.get('reservationId') ?? '';

  // ---------- стан ----------
  readonly loadState = signal<LoadState>('loading');
  readonly invite = signal<GuestInvite | null>(null);
  readonly participants = signal<Participant[]>([]);
  readonly ownerSessionId = signal('');
  readonly status = signal<GroupReservationStatus>('Open');
  readonly confirmOpen = signal(false);
  readonly submitting = signal(false);
  /** Час останнього успішного оновлення даних. */
  readonly lastUpdated = signal<Date | null>(null);
  /** Остання фонова синхронізація не вдалась — показуємо старі дані з поясненням. */
  readonly syncFailed = signal(false);
  /** Гість, якого Owner збирається видалити (відкритий діалог), або null. */
  readonly removeTarget = signal<Participant | null>(null);
  readonly removing = signal(false);

  private readonly refreshNow$ = new Subject<void>();
  private syncSubscription: Subscription | null = null;

  // ---------- похідні значення ----------
  /** Що піде в ресторан: лише підтверджені кошики, однакові страви — одним рядком. */
  readonly consolidated = computed(() => consolidatePreOrder(this.participants()));
  /** Grand Total — сума консолідованого замовлення, а НЕ total з API. */
  readonly grandTotal = computed(() => this.consolidated().total);
  readonly pendingCount = computed(() => this.participants().filter((person) => !person.isSubmitted).length);
  readonly pendingMessage = computed(() => {
    const count = this.pendingCount();
    const who = count === 1 ? '1 participant hasn’t' : `${count} participants haven’t`;
    return `${who} submitted their cart yet — their dishes won’t be included in the order`;
  });
  readonly hasAnyDishes = computed(() => this.participants().some((person) => person.items.length > 0));
  readonly isSubmitted = computed(() => this.status() !== 'Open');
  readonly statusLabel = computed(() => {
    switch (this.status()) {
      case 'Submitted':
        return 'Sent to Restaurant';
      case 'Closed':
        return 'Closed';
      default:
        return 'Collecting pre-orders';
    }
  });
  readonly canSubmit = computed(
    () => this.status() === 'Open' && this.consolidated().items.length > 0 && !this.submitting(),
  );
  readonly guestsLabel = computed(() => {
    const max = this.invite()?.MaxGuestCount ?? 0;
    return `${this.participants().length} of ${max} guests`;
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loadState.set('loading');

    this.groupOrders
      .getGroupInvite$(this.reservationId)
      .pipe(
        switchMap((invite) => {
          this.invite.set(invite);
          return forkJoin({
            sessions: this.groupOrders.getSessions$(invite.GroupReservationId),
            ownerSessionId: this.groupOrders.getOwnerSessionId$(this.reservationId),
            groupStatus: this.groupOrders.getStatus$(invite.GroupReservationId),
          });
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ({ sessions, ownerSessionId, groupStatus }) => {
          this.participants.set(sessions.participants);
          this.ownerSessionId.set(ownerSessionId);
          this.status.set(groupStatus.status);
          this.markUpdated();
          this.loadState.set('ready');
          this.startSync();
        },
        error: (error: HttpErrorResponse) => {
          this.loadState.set(error.status === 404 ? 'not-found' : 'error');
        },
      });
  }

  /** Кнопка Refresh — синхронізуватись зараз, не чекаючи таймера. */
  refresh(): void {
    this.refreshNow$.next();
  }

  /**
   * Фонова синхронізація: кожні 15 с (або по Refresh) тихо тягнемо кошики і статус.
   * Запускається один раз — повторний load() (Try again) другого таймера не створює.
   */
  private startSync(): void {
    if (this.syncSubscription || this.status() !== 'Open') {
      return;
    }

    this.syncSubscription = merge(interval(SYNC_INTERVAL_MS), this.refreshNow$)
      .pipe(
        // поки попередній запит не відповів, новий не стартує
        exhaustMap(() => this.fetchSilently()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ sessions, groupStatus }) => {
        this.participants.set(sessions.participants);
        this.status.set(groupStatus.status);
        this.markUpdated();
        if (groupStatus.status !== 'Open') {
          this.stopSync();
        }
      });
  }

  private fetchSilently() {
    const groupId = this.invite()?.GroupReservationId ?? '';
    return forkJoin({
      sessions: this.groupOrders.getSessions$(groupId, { silent: true }),
      groupStatus: this.groupOrders.getStatus$(groupId, { silent: true }),
    }).pipe(
      catchError(() => {
        // лишаємо останні дані, лише позначаємо, що оновити не вдалось
        this.syncFailed.set(true);
        return EMPTY;
      }),
    );
  }

  private stopSync(): void {
    this.syncSubscription?.unsubscribe();
    this.syncSubscription = null;
  }

  private markUpdated(): void {
    this.lastUpdated.set(new Date());
    this.syncFailed.set(false);
  }

  // ---------- Remove Guest ----------
  askRemove(person: Participant): void {
    this.removeTarget.set(person);
  }

  cancelRemove(): void {
    if (!this.removing()) {
      this.removeTarget.set(null);
    }
  }

  confirmRemove(): void {
    const person = this.removeTarget();
    const groupId = this.invite()?.GroupReservationId;
    if (!person || !groupId || this.removing()) {
      return;
    }

    this.removing.set(true);
    this.groupOrders
      .removeSession$(groupId, person.id)
      .pipe(
        finalize(() => {
          this.removing.set(false);
          this.removeTarget.set(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (sessions) => {
          // список і суми перераховуються самі — через ті самі computed()
          this.participants.set(sessions.participants);
          this.markUpdated();
          this.toast.success(`${person.name} was removed from the group`);
        },
        // помилку показує tokenInterceptor; список лишається як був
        error: () => undefined,
      });
  }

  openConfirm(): void {
    if (this.canSubmit()) {
      this.confirmOpen.set(true);
    }
  }

  closeConfirm(): void {
    if (!this.submitting()) {
      this.confirmOpen.set(false);
    }
  }

  submit(): void {
    const groupId = this.invite()?.GroupReservationId;
    // захист від подвійного кліку: поки запит іде, другий не відправляємо
    if (!groupId || this.submitting()) {
      return;
    }

    this.submitting.set(true);
    this.groupOrders
      .submit$(groupId, this.reservationId)
      .pipe(
        finalize(() => {
          this.submitting.set(false);
          this.confirmOpen.set(false);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.status.set('Submitted');
          this.stopSync();
          this.toast.success('Pre-order sent to the restaurant');
        },
        // toast з помилкою вже показує tokenInterceptor — тут не дублюємо
        error: () => undefined,
      });
  }
}
