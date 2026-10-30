import { DishShort } from '@app/models/group-orders/participant.model';

export type ReviewViewMode = 'guest' | 'dish';

/** Рядок страви в картці учасника або в групі By dish. */
export interface ReviewItem {
  dish: DishShort;
  quantity: number;
}

/** Хто з учасників замовив страву (чипи «Ordered by»). */
export interface DishOrderer {
  name: string;
  isHost: boolean;
  isSubmitted: boolean;
}

export interface DishRow {
  dish: DishShort;
  quantity: number;
  total: number;
  orderedBy: DishOrderer[];
}

export interface DishGroup {
  title: string;
  rows: DishRow[];
  total: number;
}

/** Чип у блоці прогресу: You, гості, ще не приєднані місця. */
export interface MemberChip {
  key: string;
  name: string;
  ordered: boolean;
  joined: boolean;
}
