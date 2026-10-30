import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Participant } from '@app/models/group-orders/participant.model';

@Component({
  selector: 'app-participant-card',
  imports: [CurrencyPipe],
  templateUrl: './participant-card.component.html',
  styleUrl: './participant-card.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class ParticipantCardComponent {
  // що картка отримує ззовні — як параметр функції
  readonly participant = input.required<Participant>();
  // чи це власна картка Owner (participant.id === guestSessionId) — тоді «My Pre-Order»
  readonly isOwn = input(false);
  // чи показувати «Remove Guest» (лише гостям і лише поки група Open)
  readonly canRemove = input(false);
  // повідомляє сторінці, кого Owner хоче видалити
  readonly removeClick = output<Participant>();

  // рахується саме, коли змінюється participant
  readonly title = computed(() => {
    const person = this.participant();
    if (this.isOwn()) {
      return 'My Pre-Order';
    }
    return person.type === 'Owner' ? `Owner: ${person.name}` : `Guest: ${person.name}`;
  });
}
