// Chat and the online dock, bottom left. Collapsed, the newest few lines float up and fade within seconds, under
// one small dock: who's online, a Chat button and, for guests, Sign in. Press / (or the button) to open the full log
// with an input; Esc, the close button or clicking away shuts it. Settings > Chat messages can keep the log out of
// sight (bubbles over boats only) or turn chat off. The relay filters every line before anyone sees it, so blocked
// words arrive as ###. Click a name in the open log to mute that sailor on this device.
import '../../styles/chat.css';
import { G } from '../game';
import { SET } from '../prefs';
import { ONLINE, toggleMute, type ChatLine } from '../online';
import { relayChat, relayLive } from '../relay';
import { NET } from '../net';
import { track } from '../analytics';
import { AccountCta } from './menus';

const FADE_MS = 9_000, MAX_LEN = 120;
let open = false, draft = '', focusNext = false;

const canChat = () => G.mode === 'play' && NET.authed;
// "/" opens the chat box while sailing; the game never sees that key press
addEventListener('keydown', e => {
  if (open && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeChat(); return; }   // Esc closes chat, not the game
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (open || typing || e.key !== '/' || !canChat()) return;
  e.preventDefault(); e.stopImmediatePropagation();
  openChat();
}, { capture: true });

// a click or tap anywhere outside the open panel closes it
addEventListener('pointerdown', e => { if (open && !(e.target instanceof Element && e.target.closest('.chat-panel'))) closeChat(); }, { capture: true });

/** Open the chat box with some text already typed (e.g. "@Name " from a sailor's card). */
export function openChatWith(text: string): void { if (!canChat()) return; draft = text; openChat(); }
function openChat(): void { if (canChat()) { open = true; focusNext = true; } }
const closeChat = () => { open = false; };

function send(): void {
  const text = draft.trim().slice(0, MAX_LEN);
  if (text && relayLive()) { relayChat(text); track('chat_sent', { length_bucket: text.length < 20 ? 'short' : text.length < 60 ? 'medium' : 'long' }); }
  draft = ''; open = false;
}

function Line({ l, live }: { l: ChatLine; live: boolean }) {
  if (l.id === 'sys') return <p class="chat-line sys">{l.text}</p>;
  return (
    <p class="chat-line">
      {l.admin && <b class="admin" title="Admin">★</b>}
      {l.id === 'me' || !live ? <b class={l.id === 'me' ? 'me' : 'name'}>{l.name}</b>
        : <button class="who" title={`Mute ${l.name}`} onPointerDown={e => e.preventDefault()} onClick={() => { toggleMute(l.name); ONLINE.note = `${l.name} is muted on this device`; }}>{l.name}</button>}
      <span>{l.text}</span>
    </p>
  );
}

/** "12 online · 3 nearby": everyone connected on the coast, and the sailors close enough to see. */
function onlineText(): string {
  if (NET.status === 'connecting') return 'Connecting';
  if (NET.status !== 'online') return 'Offline';
  const total = ONLINE.total, near = ONLINE.sailors.length;
  return total ? `${total} online${near ? ` · ${near} nearby` : ''}` : near ? `${near} nearby` : 'Online';
}

export function Chat() {
  if (G.mode !== 'play' || !NET.on) return null;
  const now = Date.now(), live = relayLive() && canChat();
  // collapsed: the last few lines while they're fresh, fading out; nothing at all with the log hidden
  const recent = open || SET.chat !== 'show' ? [] : ONLINE.log.filter(l => now - l.at < FADE_MS).slice(-3);
  return (
    <div class={'chat' + (open ? ' open' : '')}>
      {open ? (
        <div class="chat-panel">
          <header>
            <b>Chat</b>
            <span class="muted">{ONLINE.roster.length ? `In your sea: ${ONLINE.roster.join(', ')}` : onlineText()}</span>
            <button class="chat-x" aria-label="Close chat" onPointerDown={e => e.preventDefault()} onClick={closeChat}>×</button>
          </header>
          <div class="chat-log">{ONLINE.log.slice(-12).map(l => <Line key={`${l.id}${l.at}`} l={l} live />)}</div>
          {ONLINE.note && <p class="chat-note" onClick={() => { ONLINE.note = null; }}>{ONLINE.note}</p>}
          {relayLive()
            ? <input class="chat-input" maxlength={MAX_LEN} value={draft} placeholder="Say something. Enter sends, Esc closes"
                ref={el => { if (el && focusNext) { focusNext = false; el.focus(); } }}
                onInput={e => { draft = e.currentTarget.value; }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } else if (e.key === 'Escape') closeChat(); }}
                onBlur={closeChat} />
            : <p class="chat-note">Chat needs the realtime server, which isn't connected right now</p>}
        </div>
      ) : (
        <div class="chat-float" aria-live="polite">
          {recent.map(l => <div class="fade" key={`${l.id}${l.at}`} style={{ opacity: Math.min(1, (FADE_MS - (now - l.at)) / 1500) }}><Line l={l} live={false} /></div>)}
          {ONLINE.note && <p class="chat-note" onClick={() => { ONLINE.note = null; }}>{ONLINE.note}</p>}
        </div>
      )}
      {!open && (
        <div class="dock chip">
          <span class={'dot ' + NET.status} />
          <button class="dock-text" title="Leaderboard" onClick={() => { G.leadersBack = 'play'; G.mode = 'leaders'; }}>{onlineText()}</button>
          {live && <button class="dock-btn" onClick={openChat}>Chat<kbd>/</kbd></button>}
          <AccountCta from="play" />
        </div>
      )}
    </div>
  );
}
