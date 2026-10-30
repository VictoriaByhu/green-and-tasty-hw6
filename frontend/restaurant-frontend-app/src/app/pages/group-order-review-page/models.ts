import { DishShort } from '@app/models/group-orders/participant.model';

export type ReviewViewMode = 'guest' | 'dish';

export interface ReviewItem {
  dish: DishShort;
  quantity: number;
}

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

export interface MemberChip {
  key: string;
  name: string;
  ordered: boolean;
  joined: boolean;
}
