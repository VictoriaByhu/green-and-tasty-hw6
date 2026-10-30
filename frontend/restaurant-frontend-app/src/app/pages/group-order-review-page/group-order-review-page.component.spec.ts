import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { GroupOrderReviewService } from '@app/services/group-orders/group-order-review.service';
import { ToastService } from '@app/services/toast/toast.service';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { Order } from '@app/models/orders/order.model';
import { GroupOrderReviewPageComponent } from './group-order-review-page.component';

const caesar = { id: 'dish1', name: 'Caesar Salad', price: 180 };
const tomYum = { id: 'dish2', name: 'Tom Yum', price: 220 };
const SESSIONS: GroupSessionsResponse = {
  participants: [
    { id: 'owner', type: 'Owner', name: 'Owner', isSubmitted: false, total: 0, items: [] },
    { id: 'andrii', type: 'Guest', name: 'Andrii', isSubmitted: true, total: 360, items: [{ dish: caesar, quantity: 2 }] },
    { id: 'olena', type: 'Guest', name: 'Olena', isSubmitted: false, total: 0, items: [] },
  ],
  total: 360,
};
const INVITE = { GroupReservationId: 'grp-1', LocationAddress: 'Rustaveli Avenue 48', MaxGuestCount: 4, TableNumber: 2,
  StartTime: '2099-10-21T16:00:00Z', EndTime: '2099-10-21T17:30:00Z' } as GuestInvite;
const ORDER = { orderId: 'o1', reservationId: 'res-1', reservationAddress: '', reservationTime: '', status: 0,
  orderItems: [{ dish: tomYum, quantity: 1, state: 0 }] } as unknown as Order;

function buttonByText(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;
}

describe('GroupOrderReviewPageComponent', () => {
  let groupOrders: jasmine.SpyObj<GroupOrdersService>;
  let review: jasmine.SpyObj<GroupOrderReviewService>;

  function create() {
    TestBed.configureTestingModule({
      imports: [GroupOrderReviewPageComponent],
      providers: [
        provideRouter([]),
        { provide: GroupOrdersService, useValue: groupOrders },
        { provide: GroupOrderReviewService, useValue: review },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ reservationId: 'res-1' }) } } },
      ],
    });
    const fixture = TestBed.createComponent(GroupOrderReviewPageComponent);
    fixture.detectChanges();
    TestBed.tick();
    fixture.detectChanges();
    return { fixture, element: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    groupOrders = jasmine.createSpyObj<GroupOrdersService>('GroupOrdersService', [
      'getGroupInvite$', 'getSessions$', 'getOwnerSessionId$', 'getStatus$', 'submit$', 'removeSession$',
    ]);
    groupOrders.getGroupInvite$.and.returnValue(of(INVITE));
    groupOrders.getSessions$.and.returnValue(of(structuredClone(SESSIONS)));
    groupOrders.getOwnerSessionId$.and.returnValue(of('owner'));
    groupOrders.getStatus$.and.returnValue(of({ currentParticipants: 3, maxCapacity: 4, status: 'Open' as const }));

    review = jasmine.createSpyObj<GroupOrderReviewService>('GroupOrderReviewService', ['getOwnerOrder$', 'getDishTypes$', 'getInviteToken$']);
    review.getOwnerOrder$.and.returnValue(of(ORDER));
    review.getDishTypes$.and.returnValue(of(new Map([['dish1', 'Appetizer'], ['dish2', 'Main course']])));
    review.getInviteToken$.and.returnValue(of('tok'));
  });

  it('прогрес: «2 of 4 guests ordered» — Owner (свій order) + підтверджений гість', () => {
    const text = create().element.textContent ?? '';
    expect(text).toContain('2 of 4 guests ordered');
    expect(text).toContain('Table 2');
  });

  it('картка Owner показує власний pre-order з бекенду', () => {
    const text = create().element.textContent ?? '';
    expect(review.getOwnerOrder$).toHaveBeenCalledWith('res-1');
    expect(text).toContain('You · Host');
    expect(text).toContain('Tom Yum');
  });

  it('Grand Total = власне замовлення + підтверджені гості: $580', () => {
    const text = create().element.textContent ?? '';
    expect(text).toContain('Your order');
    expect(text).toContain('Guests’ orders (Andrii)');
    expect(text).toContain('$580.00');
  });

  it('гість без страв — жовта плашка «hasn’t picked any dishes yet»', () => {
    expect(create().element.textContent).toContain('Olena hasn’t picked any dishes yet');
  });

  it('By dish групує за категоріями з меню і показує «Ordered by»', () => {
    const { fixture, element } = create();
    buttonByText(element, 'By dish')?.click();
    fixture.detectChanges();
    const text = element.textContent ?? '';
    expect(text).toContain('Appetizers');
    expect(text).toContain('Main courses');
    expect(text).toContain('Ordered by');
  });

  it('меню ⋮ → Remove guest відкриває діалог видалення', () => {
    const { fixture, element } = create();
    element.querySelector<HTMLButtonElement>('[aria-label="Actions for Andrii"]')?.click();
    fixture.detectChanges();
    buttonByText(element, 'Remove guest')?.click();
    fixture.detectChanges();
    expect(element.querySelector('[role="dialog"]')?.textContent).toContain('Andrii');
  });

  it('без власного order (404) картка Owner бере страви owner-сесії', () => {
    review.getOwnerOrder$.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    expect(create().element.textContent).toContain('You haven’t added your own dishes yet');
  });
});
