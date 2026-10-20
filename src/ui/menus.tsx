// Menus and dialogs: title, pause, settings, controls, online, cheats, greeting picker,
// conversations, the finale and the boat-sank card.
import type { TargetedMouseEvent, TargetedSubmitEvent } from 'preact';

// The account form's email field takes focus when the form first appears, so typing (and Tab) works at once.
let focusedForm = false;
const focusOnce = (el: HTMLInputElement | null) => {
  if (!el) { focusedForm = false; return; }
  if (!focusedForm) { focusedForm = true; el.focus(); }
};
import { CHEATS_ENABLED } from '../input';
import { G, hasSave, dayNum, logged, loadGame, newGame, toast } from '../game';
import { SPECIES } from '../econ';
import { ROWS, ACTIONS, SET } from '../settings';
import { CHEATS } from '../cheats';
import { NET, EMOTES, HAD_ACCOUNT_KEY, account, deleteAccount, onlineCount, signOut, setName } from '../net';
import { voyageStarted } from '../telemetry';
import { PEOPLE, currentQuest } from '../story';
import type { NetForm, Talk as TalkState } from '../types';
import { Hint, Icon, Key, SetRow, byPointer, keyLabel, money } from './parts';
import { track } from '../analytics';

export const TITLE_ITEMS = () => [...(hasSave() ? ['CONTINUE'] : []), 'NEW VOYAGE', 'SETTINGS', 'CONTROLS', ...(NET.on ? ['ONLINE'] : [])];
export const PAUSE_ITEMS = ['RESUME', 'JOURNAL', ...(NET.on ? ['LEADERBOARD'] : []), 'SETTINGS', 'CONTROLS', ...(NET.on ? ['ONLINE'] : []), 'SAVE & QUIT'];

// Mouse picks go through the same input path as the keyboard: select the row, then press a key for main.js.
const press = (key: string) => { G.pressed.add(key); };

interface MenuProps { items: string[]; sel: number; onPick: (i: number) => void; setSel: (i: number) => void }
function Menu({ items, sel, onPick, setSel }: MenuProps) {
  return (
    <div class="menu">
      {items.map((s, i) => <button data-track={`menu-${s}`} class={'item' + (i === sel ? ' sel' : '')} onMouseMove={byPointer(() => setSel(i))} onClick={() => onPick(i)}>{s}</button>)}
    </div>
  );
}

export function Title() {
  return (
    <div class="center">
      <div class="logo">Bobber Run</div>
      <div class="tagline">Fish, sell, upgrade, and sail further</div>
      <div class="panel rivets menu-box">
        <Menu items={TITLE_ITEMS()} sel={G.titleSel || 0} setSel={i => { G.titleSel = i; }} onPick={i => { G.titleSel = i; press('Enter'); }} />
      </div>
      <AccountCta from="title" />
      <OnlineNow />
      <div class="hints-inline shadowed"><Hint k="ArrowUp" k2="ArrowDown" pad="D-pad">Choose</Hint><Hint k="Enter" pad="A">Select</Hint></div>
    </div>
  );
}
// "12 sailors online now" under the title menu, asked again every 20 s while the title is showing
let onlineNow: number | null = null, onlineAt = 0;
function OnlineNow() {
  if (!NET.on) return null;
  if (Date.now() - onlineAt > 20_000) { onlineAt = Date.now(); void onlineCount().then(n => { onlineNow = n; }); }
  return onlineNow ? <p class="online-now shadowed"><span class="dot online" />{onlineNow} {onlineNow === 1 ? 'sailor' : 'sailors'} online now</p> : null;
}
/** Signing in is the main thing to do online: a big button while you're a guest, your name once signed in. */
export function AccountCta({ from }: { from: 'title' | 'play' }) {
  if (!NET.on) return null;
  const p = NET.profile, go = () => { G.accountBack = from; G.mode = 'account'; track('sign_in_opened', { from }); };
  if (p && !p.guest) return from === 'title' ? <p class="cta-signed">Signed in as <b>{p.name}</b></p> : null;
  return from === 'title'
    ? <button data-track="sign-in-title" class="btn primary cta" onClick={go}>Sign in or make an account<span class="cta-sub">Keep your boat and catch on any device</span></button>
    : <button data-track="sign-in-dock" class="dock-btn cta-link" title="You are playing as a guest. Sign in to keep your boat on any device" onClick={go}>Sign in</button>;
}
/** Online players with a generated name are sent to pick their own before sailing on (once per session if they skip offline). */
export function forceName(): void {
  const p = NET.profile;
  if (G.mode !== 'play' || G.needName || !NET.authed || !p || p.chosen || p.admin || NET.busy) return;
  G.needName = true; G.accountBack = 'play'; G.mode = 'account';
}

export function Pause() {
  return (
    <div class="center dim-bg">
      <div class="logo still">Paused</div>
      <div class="panel rivets menu-box">
        <Menu items={PAUSE_ITEMS} sel={G.pauseSel || 0} setSel={i => { G.pauseSel = i; }} onPick={i => { G.pauseSel = i; press('Enter'); }} />
      </div>
    </div>
  );
}

// a ten-step volume meter
const Volume = ({ v }: { v: number }) => (
  <div class="vol" title={`${v} of 10`}>{Array.from({ length: 10 }, (_, k) => <i class={k < v ? 'on' : ''} />)}</div>
);

export function Settings() {
  const sel = G.setSel || 1, cur = ROWS[sel];                    // row 0 is a section head
  // clicking the left part of a row steps the value down, the right part steps it up
  const stepByClick = (i: number) => (e: TargetedMouseEvent<HTMLDivElement>) => {
    G.setSel = i;
    const b = e.currentTarget.getBoundingClientRect();
    press(e.clientX < b.left + b.width * 0.7 ? 'ArrowLeft' : 'ArrowRight');
  };
  return (
    <div class="center dim-bg">
      <div class="panel rivets dialog">
        <h1>Settings</h1>
        <div class="scroll">
          {ROWS.map((r, i) => r.head !== undefined
            ? <div class="list-head caps">{r.head}</div>
            : (
              <SetRow sel={i === sel} onEnter={() => { G.setSel = i; }} onClick={stepByClick(i)}>
                <span>{r.label}</span>
                {r.type === 'slider'
                  ? <Volume v={Number(r.get())} />
                  : <span class="value"><Key k="ArrowLeft" />{r.get()}<Key k="ArrowRight" /></span>}
              </SetRow>
            ))}
          <SetRow cls="item center-t" sel={sel === ROWS.length} onEnter={() => { G.setSel = ROWS.length; }} onClick={() => { G.setSel = ROWS.length; press('Enter'); }}>Back</SetRow>
        </div>
        <p class="help">{cur?.help || ' '}</p>
        <footer class="foot">
          <span class="hints-inline"><Hint k="ArrowUp" k2="ArrowDown" pad="D-pad">Choose</Hint><Hint k="ArrowLeft" k2="ArrowRight">Change</Hint></span>
          <a class="small" href="/privacy.html" target="_blank" rel="noopener">Privacy</a>
          <Hint k="Escape" pad="B">Back</Hint>
        </footer>
      </div>
    </div>
  );
}

const CONTROLS_HELP = 'Choose an action and press Enter to change its key. The WASD keys also steer.' + (CHEATS_ENABLED ? ' Press ` or F2 while sailing for the cheat console.' : '') + ' Gamepad: stick steers, A casts, X docks, Y opens the chart, B goes back.';
export function Controls() {
  const sel = G.ctlSel || 0;
  // rows past the actions: reset, then back
  const extraRow = (i: number, label: string) => (
    <SetRow cls="item center-t" sel={sel === i} onEnter={() => { G.ctlSel = i; }} onClick={() => { G.ctlSel = i; press('Enter'); }}>{label}</SetRow>
  );
  return (
    <div class="center dim-bg">
      <div class="panel rivets dialog">
        <h1>Controls</h1>
        <div class="scroll">
          {ACTIONS.map((a, i) => (
            <SetRow sel={i === sel} onEnter={() => { G.ctlSel = i; }} onClick={() => { G.ctlSel = i; press('Enter'); }}>
              <span>{a.label}</span>
              <span class="value">{G.rebinding === a.id
                ? <span class="gold">Press a key</span>
                : <><Key k={a.key} />{SET.binds[a.id] && <span class="muted small">default {keyLabel(a.key)}</span>}</>}</span>
            </SetRow>
          ))}
          {extraRow(ACTIONS.length, 'Reset to defaults')}
          {extraRow(ACTIONS.length + 1, 'Back')}
        </div>
        <p class="help">{G.rebinding ? 'Press the new key, or Esc to cancel.' : CONTROLS_HELP}</p>
        <footer class="foot">
          <span class="hints-inline"><Hint k="ArrowUp" k2="ArrowDown">Choose</Hint><Hint k="Enter">Change key</Hint></span>
          <Hint k="Escape" pad="B">Back</Hint>
        </footer>
      </div>
    </div>
  );
}

// online status, captain name and accounts. Form fields keep their text in G.netForm, so the
// per-frame redraw never wipes what you are typing.
/** After signing in or making an account: sail on with the (possibly just loaded) save. */
function enterGame(loaded: boolean): void {
  if (loaded || G.accountBack === 'title') {
    if (hasSave()) loadGame(); else newGame();
    voyageStarted(loaded || hasSave() ? 'continue' : 'new');
  }
  G.mode = 'play';
}
const hadAccount = (): boolean => { try { return !!localStorage.getItem(HAD_ACCOUNT_KEY); } catch { return false; } };
export function Online() {
  const p = NET.profile;
  const f: NetForm = (G.netForm ||= { name: null, email: '', pass: '', show: false, mode: hadAccount() ? 'signIn' : 'signUp' });
  if (f.uid !== (p?.userId ?? null)) { f.uid = p?.userId ?? null; f.name = null; }   // a different account: forget a half-typed name
  const say = (msg: string, bad = false) => { G.netMsg = { msg, bad }; };
  const saveName = async () => {
    const r = await setName(f.name ?? p?.name ?? '');
    if (!r.ok) { say(r.why, true); return; }
    f.name = null; say(`Your captain name is now ${r.name}`);
    if (NET.profile && r.name) NET.profile = { ...NET.profile, name: r.name, chosen: true };   // don't wait for the server's copy, or the prompt comes back
    if (G.needName) { G.needName = false; G.netMsg = null; G.mode = G.accountBack || 'play'; }
  };
  // read the fields themselves: password managers often fill them without an input event
  const submit = async (e: TargetedSubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget), email = String(data.get('email') ?? ''), pass = String(data.get('password') ?? '');
    f.email = email; f.pass = pass;
    say(f.mode === 'signUp' ? 'Making your account...' : 'Signing in...');
    const r = await account(f.mode, email.trim(), pass);
    if (!r.ok) { say(r.why, true); return; }
    f.pass = ''; G.netMsg = null;
    enterGame(!!r.loaded);
    if (r.msg) toast(r.msg, 'good');                    // the screen closes, so say how it went out on the water
  };
  // deleting takes two presses within a few seconds
  const arming = !!f.delAt && Date.now() - f.delAt < 5000;
  const removeAccount = async () => {
    if (!arming) { f.delAt = Date.now(); say('This erases your account, cloud save and captain name. World records and chat history stay. Press again to delete', true); return; }
    f.delAt = undefined;
    const r = await deleteAccount();
    if (r.ok) say(r.msg ?? ''); else say(r.why, true);
  };
  const onEnter = (fn: () => void) => (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); fn(); } };
  const setMode = (mode: NetForm['mode']) => () => { f.mode = mode; G.netMsg = null; };
  const status = NET.status !== 'online'
    ? (NET.status === 'connecting' ? 'Connecting to the server...' : 'Offline. The game still works, just without online features.')
    : p?.guest ? 'You are sailing as a guest. Make an account to keep your save on any device.'
    : `Signed in as ${p?.email || 'a sailor'}. Your save follows you to any device.`;
  return (
    <div class="center dim-bg"><div class="panel rivets dialog online">
      <h1>{G.needName ? 'Choose your captain name' : 'Online'}</h1>
      {G.needName && <p class="good">Other sailors see this name over your boat and in chat. Pick your own to start sailing.</p>}
      <p class="row"><span class={'dot ' + NET.status} />{status}</p>
      {NET.authed && (
        <div class="form-row">
          <label class="caps" for="net-name">Captain</label>
          <input id="net-name" maxlength={18} autocomplete="off" value={f.name ?? p?.name ?? ''}
            onInput={e => { f.name = e.currentTarget.value; }} onKeyDown={onEnter(saveName)} />
          <button data-track="name-save" class="btn" disabled={f.name === null || f.name === p?.name} onClick={saveName}>Save name</button>
        </div>
      )}
      {(NET.busy || (NET.authed && p?.guest)) && (
        <form class="account-box" onSubmit={submit}>
          <div class="seg">
            <button data-track="mode-sign-up" type="button" class={'seg-btn' + (f.mode === 'signUp' ? ' on' : '')} onClick={setMode('signUp')}>Make an account</button>
            <button data-track="mode-sign-in" type="button" class={'seg-btn' + (f.mode === 'signIn' ? ' on' : '')} onClick={setMode('signIn')}>I have an account</button>
          </div>
          <div class="form-grid">
            <label class="caps" for="net-email">Email</label>
            <input id="net-email" name="email" ref={focusOnce} type="email" autocomplete="username" value={f.email}
              onInput={e => { f.email = e.currentTarget.value; }} />
            <label class="caps" for="net-pass">Password</label>
            <span class="row">
              {/* the cast: Preact's per-type input typings can't express a type that toggles on one element */}
              <input id="net-pass" name="password" type={(f.show ? 'text' : 'password') as 'text'} autocomplete={f.mode === 'signUp' ? 'new-password' : 'current-password'} value={f.pass}
                onInput={e => { f.pass = e.currentTarget.value; }} />
              <button data-track="password-show" type="button" class="btn small-btn" onClick={() => { f.show = !f.show; }} aria-label={f.show ? 'Hide password' : 'Show password'}>{f.show ? 'Hide' : 'Show'}</button>
            </span>
            <span /><span class="muted small">{f.mode === 'signUp' ? 'At least 8 characters. Your current progress moves to the new account.' : 'Signing in loads the save stored on that account.'}</span>
            <span /><button data-track="account-submit" type="submit" class="btn primary" disabled={NET.busy}>{NET.busy ? 'Working...' : f.mode === 'signUp' ? 'Make account' : 'Sign in'}</button>
          </div>
        </form>
      )}
      {NET.authed && p && !p.guest && !NET.busy && (
        <p class="row">
          <button data-track="sign-out" class="btn" disabled={NET.busy} onClick={async () => { const r = await signOut(); if (r.ok) say('Signed out. You are sailing as a guest again'); else say(r.why, true); }}>Sign out</button>
          <button data-track="account-delete" class={'btn' + (arming ? ' danger' : '')} disabled={NET.busy} onClick={removeAccount}>{arming ? 'Press again to delete' : 'Delete account'}</button>
        </p>
      )}
      {G.netMsg && <p class={G.netMsg.bad ? 'why left' : 'good'}>{G.netMsg.msg}</p>}
      <p class="help">Online you share the sea with every other sailor. Greet them (G), chat (/), compare world records in the logbook, and give to the coastwide fund in Alderhaven's Harbour tab. <a href="/privacy.html" target="_blank" rel="noopener">Privacy</a></p>
      {!(G.needName && NET.authed) && <footer class="foot"><span /><button data-track="account-back" class="btn" onClick={() => { G.needName = false; G.mode = G.accountBack || 'play'; }}>Back<Key k="Escape" pad="B" /></button></footer>}
    </div></div>
  );
}

// pick a greeting
export function EmotePick() {
  const sel = G.emoteSel || 0;
  return (
    <div class="emote-pick panel">
      <div class="caps">Greet nearby sailors</div>
      {EMOTES.map((m, i) => (
        <SetRow sel={i === sel} onEnter={() => { G.emoteSel = i; }} onClick={() => { G.emoteSel = i; press('Enter'); }}>
          <span class="key">{i + 1}</span><span>{m}</span>
        </SetRow>
      ))}
    </div>
  );
}

// a conversation: portrait, name, one line at a time
export function Talk({ t }: { t: TalkState }) {
  const [who, text] = t.lines[t.i], person = PEOPLE[who];
  return (
    <div class="talk-wrap" onClick={() => press(' ')}>
      <div class="talk panel rivets">
        <div class="portrait"><Icon k={who} size="xl" /></div>
        <div class="grow">
          <div class="row"><span class="title gold">{person.name}</span><span class="muted small">{person.role}</span></div>
          <p class="line">{text}</p>
        </div>
        <div class="talk-foot"><span class="muted small">{t.i + 1}/{t.lines.length}</span><Hint k=" " pad="A">Next</Hint><Hint k="Escape" pad="B">Skip</Hint></div>
      </div>
    </div>
  );
}

export function Cheats() {
  return (
    <div class="center dim-bg"><div class="panel rivets dialog cheats">
      <h1>Cheats</h1>
      <div class={'cheat-input' + (G.cheatErr ? ' err' : '')}>{G.cheatBuf || ''}<span class="caret" /></div>
      <p class="help">{G.cheatErr ? 'That code does not exist. Try one of these:' : 'Type a code and press Enter.'}</p>
      <div class="scroll"><dl class="facts">{CHEATS.map(c => <><dt class="code" onClick={() => { G.cheatBuf = c.code; }}>{c.code}</dt><dd>{c.what}</dd></>)}</dl></div>
      <footer class="foot"><Hint k="Enter">Use code</Hint><Hint k="Escape">Close</Hint></footer>
    </div></div>
  );
}

export function Finale() {
  return (
    <div class="center dim-bg"><div class="panel rivets dialog finale">
      <div class="logo still">The Grand Harbour</div>
      <p>Lanterns hang over every quay. The Old One watches from the harbour gate, and boats come from all along the coast to sell their catch in Alderhaven.</p>
      {!currentQuest() && <p>At the end of the quay, Nell sits with her feet over the water, telling anyone who will listen about her grandchild.</p>}
      <p class="gold">You are Harbourmaster now.</p>
      <dl class="facts">
        <dt>Days at sea</dt><dd>{dayNum()}</dd><dt>Fish caught</dt><dd>{G.stats.caught}</dd>
        <dt>Species logged</dt><dd>{logged()} of {SPECIES.length}</dd><dt>Coins earned</dt><dd>{money(G.earned)}</dd>
        <dt>Ships owned</dt><dd>{G.owned.length}</dd>
      </dl>
      <p class="muted">The sea goes on. Keep fishing, fill the logbook, and grow your fleet.</p>
      <footer class="foot"><span /><button data-track="keep-sailing" class="btn primary" onClick={() => { G.mode = 'play'; }}>Keep sailing<Key k="Enter" pad="A" /></button></footer>
    </div></div>
  );
}

export function Sunk() {
  return (
    <div class="sunk"><div class="panel rivets sunk-card">
      <h1>Your boat sank</h1><p>{G.sunkMsg}.</p><p class="muted">Your hull has been repaired to 75%.</p>
    </div></div>
  );
}
