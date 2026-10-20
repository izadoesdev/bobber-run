// Chat, like Roblox: press / to talk to everyone in your sea. The relay filters every line before anyone sees it,
// so blocked words arrive as ###. Click a name in the log to mute that sailor on this device.
import '../../styles/chat.css';
import { G } from '../game';
import { ONLINE, toggleMute, type ChatLine } from '../online';
import { relayChat, relayLive } from '../relay';
import { NET } from '../net';
import { track } from '../analytics';
import { AccountCta } from './menus';

const SHOW_MS = 20_000, MAX_LEN = 120;
let open = false, draft = '', focusNext = false;

const canChat = () => G.mode === 'play' && NET.authed;
// "/" opens the chat box while sailing; the game never sees that key press
addEventListener('keydown', e => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (open || typing || e.key !== '/' || !canChat()) return;
  e.preventDefault(); e.stopImmediatePropagation();
  open = true; focusNext = true;
}, { capture: true });

/** Open the chat box with some text already typed (e.g. "@Name " from a sailor's card). */
export function openChatWith(text: string): void { if (!canChat()) return; draft = text; open = true; focusNext = true; }

function send(): void {
  const text = draft.trim().slice(0, MAX_LEN);
  if (text && relayLive()) { relayChat(text); track('chat_sent', { length_bucket: text.length < 20 ? 'short' : text.length < 60 ? 'medium' : 'long' }); }
  draft = ''; open = false;
}

function Line({ l }: { l: ChatLine }) {
  if (l.id === 'sys') return <p class="chat-line sys">{l.text}</p>;
  return (
    <p class="chat-line">
      {l.admin && <b class="admin" title="Admin">★</b>}
      {l.id === 'me' ? <b class="me">{l.name}</b>
        : <button class="who" title={`Mute ${l.name}`} onClick={() => { toggleMute(l.name); ONLINE.note = `${l.name} is muted on this device`; }}>{l.name}</button>}
      <span>{l.text}</span>
    </p>
  );
}

const openChat = () => { if (canChat()) { open = true; focusNext = true; } };
export function Chat() {
  if (!canChat() && !open) return null;
  const now = Date.now(), lines = ONLINE.log.filter(l => open || now - l.at < SHOW_MS).slice(-8);
  return (
    <div class={'chat' + (open ? ' open' : '')}>
      {open && ONLINE.roster.length > 0 && <p class="chat-roster">In your sea: {ONLINE.roster.join(', ')}</p>}
      {lines.map(l => <Line key={`${l.id}${l.at}`} l={l} />)}
      {ONLINE.note && <p class="chat-note" onClick={() => { ONLINE.note = null; }}>{ONLINE.note}</p>}
      {open && (relayLive()
        ? <input class="chat-input" maxlength={MAX_LEN} value={draft} placeholder="Say something to your sea. Enter sends, Esc closes"
            ref={el => { if (el && focusNext) { focusNext = false; el.focus(); } }}
            onInput={e => { draft = e.currentTarget.value; }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } else if (e.key === 'Escape') { open = false; } }}
            onBlur={() => { open = false; }} />
        : <p class="chat-note">Chat needs the realtime server, which isn't connected right now</p>)}
      {!open && <div class="chat-bar">
        {relayLive() && <button class="btn small-btn chat-open" onClick={openChat}>Chat <kbd>/</kbd></button>}
        <AccountCta from="play" />
      </div>}
    </div>
  );
}
