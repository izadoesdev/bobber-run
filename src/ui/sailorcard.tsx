// Click (or tap) another sailor's boat for a small card: wave, chat to them, follow them, or mute them.
// Following keeps re-aiming the autopilot at a spot just behind their boat; steering yourself, setting your own
// course, or a fish on the line ends it.
import { G } from '../game';
import { BOATS } from '../econ';
import { ONLINE, isMuted, toggleMute } from '../online';
import { sendEmote } from '../net';
import { setCourse, dropCourse, courseTarget } from '../game/autopilot';
import { onBoatClick } from './touch';
import { openChatWith } from './chat';
import { track } from '../analytics';

const BEHIND = 28, LEAD_S = 1.2, FOLLOW_EVERY_MS = 300;
let cardUid: string | null = null, following: string | null = null, aim: { x: number; y: number } | null = null, timer = 0;

onBoatClick(uid => { cardUid = uid; track('sailor_card_opened', {}); });

const sailor = (uid: string | null) => ONLINE.sailors.find(s => s.uid === uid) ?? null;
function stopFollowing(): void {
  if (!following) return;
  following = null; aim = null; clearInterval(timer); dropCourse();
}
function follow(uid: string): void {
  stopFollowing();
  following = uid; track('sailor_followed', {});
  timer = window.setInterval(() => {
    const s = sailor(following), mine = courseTarget();
    // they left, a fish took the line, or the player set their own course: stop
    if (!s || G.mode !== 'play' || (mine && aim && Math.hypot(mine.x - aim.x, mine.y - aim.y) > 1)) return stopFollowing();
    const L = BOATS.find(b => b.id === s.id)?.L ?? 14;
    // aim where they will be shortly, so the autopilot doesn't ease off behind a moving boat
    const x = s.x + s.vx * LEAD_S - Math.cos(s.a) * (BEHIND + L / 2), y = s.y + s.vy * LEAD_S - Math.sin(s.a) * (BEHIND + L / 2);
    if (setCourse(x, y, true)) aim = courseTarget(); else if (G.fish && G.fish.st !== 'cast' && G.fish.st !== 'wait') stopFollowing();
  }, FOLLOW_EVERY_MS);
}
// steering by hand takes the helm back
addEventListener('keydown', e => {
  if (following && /^(Arrow(Up|Down|Left|Right)|[wasdWASD])$/.test(e.key) && !(e.target instanceof HTMLInputElement)) stopFollowing();
});

export function SailorCard() {
  const s = sailor(cardUid);
  if (!s) { if (cardUid) cardUid = null; return following ? <p class="follow-chip">Following a sailor <button class="btn small-btn" onClick={stopFollowing}>Stop</button></p> : null; }
  const boat = BOATS.find(b => b.id === s.id)?.name ?? 'boat', d = Math.round(Math.hypot(s.x - G.boat.x, s.y - G.boat.y) / 10);
  const muted = isMuted(s.name), isFollowed = following === s.uid;
  return (
    <div class="sailor-card panel">
      <header><b>{s.name}</b><span class="muted small">{boat}, {d} m away</span>
        <button class="btn small-btn" aria-label="Close" onClick={() => { cardUid = null; }}>×</button></header>
      <div class="row">
        <button class="btn" onClick={() => { sendEmote(0); cardUid = null; }}>Wave</button>
        <button class="btn" onClick={() => { openChatWith(`@${s.name} `); cardUid = null; }}>Chat</button>
        <button class="btn" onClick={() => { if (isFollowed) stopFollowing(); else follow(s.uid); cardUid = null; }}>{isFollowed ? 'Stop following' : 'Follow'}</button>
        <button class="btn" onClick={() => { toggleMute(s.name); }}>{muted ? 'Unmute' : 'Mute'}</button>
      </div>
    </div>
  );
}
