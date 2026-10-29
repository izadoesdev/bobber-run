import { useEffect, useRef } from 'preact/hooks';
import { G } from '../game/state';
import { closeEncounter, encounterActions, performEncounterAction } from '../game/encounters';
import { Icon, Key } from './parts';

export function EncounterDialog() {
  const encounter = G.encounter;
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); };
  }, []);
  if (!encounter) return null;
  const icon = encounter.kind === 'light' ? 'lantern' : encounter.kind === 'village' ? 'anchor' : 'map';
  return (
    <div class="center dim-bg">
      <div class="dialog paper encounter" role="dialog" aria-modal="true" aria-labelledby="encounter-title" ref={dialog}
        onKeyDown={event => {
          if (event.key !== 'Tab') return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
          const edge = event.shiftKey ? buttons[0] : buttons.at(-1);
          if (document.activeElement === edge) { event.preventDefault(); (event.shiftKey ? buttons.at(-1) : buttons[0])?.focus(); }
        }}>
        <header class="encounter-head">
          <Icon k={icon} size="l" />
          <div><span class="caps small muted">A stop along the coast</span><h1 id="encounter-title">{encounter.name}</h1></div>
        </header>
        <p class="encounter-about">{encounter.about}</p>
        <div class="encounter-actions">
          {encounterActions(encounter).map(action => (
            <section class="encounter-action" key={action.id}>
              <div class="grow"><b>{action.label}</b><p>{action.detail}</p>{action.why && <p class="why" id={`encounter-${action.id}-why`}>{action.why}</p>}</div>
              <button class="btn" disabled={!!action.why} aria-label={action.label}
                aria-describedby={action.why ? `encounter-${action.id}-why` : undefined}
                onClick={() => performEncounterAction(encounter.id, action.id)}>{action.why ? 'Collected' : action.id === 'stories' ? 'Read' : action.id === 'fish' ? 'Mark chart' : action.id === 'wait' ? 'Wait' : 'Collect'}</button>
            </section>
          ))}
        </div>
        <footer class="foot"><span class="muted small">Your progress is saved after collecting.</span><button class="btn" onClick={closeEncounter}>Back to sea<Key k="Escape" pad="B" /></button></footer>
      </div>
    </div>
  );
}
