import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { SKIP_ERROR_TOAST } from '@app/auth/skip-error-toast.context';
import { DishListResponse } from '@app/models/dishes/dish-list-response.model';
import { GroupInviteToken } from '@app/models/reservations/guest-invite.model';
import { Order } from '@app/models/orders/order.model';
import { API_BASE_URL } from '@app/shared/config/api-base-url.token';

/**
 * Додаткові дані для розширеного екрана Owner (дизайн з власного макета):
 * власне замовлення Owner, категорії страв і посилання-запрошення.
 * Усі запити тихі: якщо даних немає (демо-режим, ще немає order), екран просто їх не показує.
 */
@Injectable({
  providedIn: 'root',
})
export class GroupOrderReviewService {
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly http = inject(HttpClient);
  private readonly silent = { context: new HttpContext().set(SKIP_ERROR_TOAST, true) };

  /** Власний pre-order Owner (те, що він додав через меню). 404 — замовлення ще немає. */
  getOwnerOrder$(reservationId: string): Observable<Order> {
    return this.http.get<Order>(`${this.baseUrl}/orders/${encodeURIComponent(reservationId)}`, this.silent);
  }

  /** dishId → категорія з меню ("Appetizer", "Main course", "Dessert"). */
  getDishTypes$(): Observable<Map<string, string>> {
    return this.http
      .get<DishListResponse[]>(`${this.baseUrl}/dishes`, this.silent)
      .pipe(map((dishes) => new Map(dishes.map((dish) => [dish.id, dish.dishType]))));
  }

  getInviteToken$(reservationId: string): Observable<string> {
    return this.http
      .get<GroupInviteToken>(`${this.baseUrl}/reservations/${encodeURIComponent(reservationId)}/invite-token`, this.silent)
      .pipe(map((response) => response.token));
  }
}
