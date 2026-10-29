# Bobber Run: what makes a small voyage enjoyable?

Design research and cleanup decisions, 29 October 2026. This is an explanation for contributors, not a feature specification or evidence that players have validated Bobber Run.

## Recommendation

**Make the existing voyage feel better before making it bigger.** Protect the loop: enjoy sailing → notice something interesting → make a deliberate catch or discovery → return with a story, a collection entry, or a useful upgrade.

Bobber Run already has many progression systems: rods, fitted boat parts, boat unlocks, harbour projects, contracts, optional stories, fleet income, islands, treasury, logbook mastery, and region access. Adding another progression track is less valuable than removing the moments when these systems give contradictory instructions or interrupt fishing.

A satisfying short session should not require buying a boat. A new species, a lighthouse visit, a prettier route home, or improving at a familiar fish can be a complete little voyage.

## Evidence and its limits

The comparison combines developer accounts, official updates, public player reviews, and a foundational motivation paper. These answer different questions:

- Developer interviews explain intentions, discarded mechanics, and production trade-offs. They are not independent measures of enjoyment.
- Player reviews reveal vocabulary, memorable experiences, and friction. The inspected reviews are selected anecdotes, not a representative survey.
- The motivation paper provides a useful framework, not a prediction that a particular Bobber Run feature will improve enjoyment or retention.

Steam review API requests for DREDGE, WEBFISHING, A Short Hike, and Dave the Diver returned HTML rather than usable JSON. No API review dataset was obtained. The usable direct player evidence was WEBFISHING's public Steam Community helpful-review page and six visible Metacritic user reviews. This selection is English-skewed, small, and influenced by site ordering. Older complaints describe the reviewer's experience at that time; they do not establish the current state of another game.

The sources below were retrieved on 29 October 2026. Research notes and downloaded text are local working artifacts under `/tmp/bobber-game-design-research/`; only the synthesis and source links belong in this repository.

## Comparisons

### DREDGE: a clear loop, purposeful tension, less busywork

Black Salt's development interview describes abandoning fuel management: manually buying cheap fuel felt like a meaningless transaction, while running out and moving slowly felt bad. Its replacement, time as a resource, supported that game's particular night-time tension. The developers also describe making fishing minigames optional and rejecting an aiming-heavy harpoon encounter that disrupted the game's established interaction style. [1]

The official v1.2.0 update added a Passive Mode selectable at any stage, alongside wildlife, photo mode, and camera/VFX controls. [2] The team's launch interview also discusses enjoyment of player interpretation, exploration, and unexpected encounters. [3]

**Application:** keep requirements readable, preserve accessible fishing options, and make it possible to take a break during a fight. Do not copy DREDGE's horror or time pressure just because both games have boats. Do not add fuel, spoilage, or repeated upkeep transactions without a demonstrated benefit to Bobber Run's intended mood.

### A Short Hike: reward the detour

Adam Robinson-Yu describes designing a tiny open world for freedom, peaceful exploration, and curiosity—even when a player heads opposite the obvious route. Off-path activities support the feeling of a summer getaway. He also explains how low-resolution art, outlines, and adjustable pixel size serve readability rather than merely nostalgia. [4]

**Application:** preserve the pixel-art sea and readable boat silhouettes. A cove or landmark should offer a different view, a local story, useful supplies, an encounter, or a distinctive fishing opportunity—not necessarily a new task list. The existing optional stories and lighthouse services already support this; their discoverability and tone deserve testing before more encounters are added.

### WEBFISHING: fishing creates room for expression and company

The inspected reviews praise relaxation, customization, collecting, instruments, and hanging out. A highly helpful Steam review recounts spontaneous social roleplay rather than a particularly valuable catch. Some Metacritic reviewers enjoy completion and unlocks; another finds the activity repetitive, and one explicitly raises wrist/RSI concerns about repeated clicking. [5][6] Contemporary coverage also frames the game as a fishing chatroom. [7]

Older Steam reviews raise save and online-safety concerns. These are reports, not independently verified current defects. The relevant lesson is to protect the player's progress and agency, not to repeat allegations or assume that copying multiplayer features recreates the same community.

**Application:** keep offline play complete and online participation optional. Existing boat paints, catches, sharing, and greetings provide expression without another mandatory progression system. Preserve hold/toggle/assisted reeling instead of introducing button mashing. Do not infer that all players want public chat, gambling, or competitive rankings.

### Dave the Diver: variety should reinforce the main activity

The director describes an early prototype in which fishing and restaurant work competed for attention. Separating them into day/night phases clarified the player's focus. Additional activities were intended to deepen the fishing/serving loop, rather than distract from it. [8] Reporting on the team's GDC session describes using character and humor to teach mechanics after conventional tutorials proved easy to ignore. [9]

**Application:** keep sailing and fishing uninterrupted by unrelated story queues or income receipts. Present market, fleet, and restoration decisions when players deliberately stop to read. Use short, contextual explanations in the existing prompts and journal; do not respond by adding a restaurant, more modal tutorials, or a succession of unrelated minigames.

### Motivation research: agency, competence, connection

Ryan, Rigby, and Przybylski's four studies associate enjoyment with perceived autonomy and competence, with relatedness also contributing in the multiplayer study. Intuitive controls were related to competence and enjoyment. The authors explicitly discuss limitations involving the sampled games, experimental play, new measures, and generalization. They did not establish broad long-term well-being benefits. [10]

**Application:** offer understandable choices, reliable controls, and feedback that explains how to improve. Let players explore without accepting every story. Connection may come from optional shared play, but the paper does not justify making Bobber Run dependent on multiplayer or maximizing hours played.

## Design rules for this game

1. **Sailing is part of the reward.** Preserve responsive movement, readable water, atmosphere, and room to look around.
2. **Difficulty is deliberate, not confusing.** A fish may require skill or equipment; the game should explain which one is missing.
3. **The player owns the pace.** Pause, accessible fishing options, optional stories, and a recoverable save matter more than a forced engagement loop.
4. **One useful next step beats several competing instructions.** HUD, journal, chart, and marker should agree.
5. **Progress should change what the player can enjoy.** A boat or upgrade should have an understandable use, not just a larger number.
6. **Surprise needs a stable world.** Wildlife and varied conditions can be surprising without visible population rerolls, duplicate catches, or unexplained disappearances.
7. **Add less than we remove.** Prefer clearer existing controls and copy over another permanent overlay.

## Cleanup implemented in this pass

### A real break during fishing

- Escape and touch Menu now open the pause menu during casting, waiting, a bite, and reeling.
- Controller Start uses a dedicated pause action, rather than pretending to be Enter. Holding Start does not repeatedly resume or activate the selected menu row.
- Resume preserves the current line. The game clock and fight progress remain unchanged while paused, and fishing assists can be changed before continuing.
- The pause menu explains that Save & Quit keeps the voyage, not an unfinished catch. A successful quit releases the line; a failed local write leaves the line and menu intact.
- The persistent save warning lives inside the scrolling pause panel instead of floating across its actions on a short phone screen.

This does not mean every global animation/timer stops, multiplayer peers pause, or an unfinished fight is serialized into a save. Background-tab auto-pause is not part of this change.

### Guidance that respects the actual catch requirements

- When no nearby unlogged species is currently landable, the guide can explain the rod, deck, sail, or Storm Keel preparation needed for a nearby unlogged school.
- Already-owned suitable boats, including built-in or stored fitted keels, are considered before a new purchase. Boats assigned to the fleet are described as recall-and-sail, not buy again.
- Locked boats and equipment lead through their harbour-project prerequisites. Shipyard destinations exclude locked waters.
- A full hold sends the Old One objective to market before the lair.
- Relevant rod/hold/keel changes, ownership additions, and fleet assignment changes invalidate the guidance cache without waiting for its periodic refresh.

This is guidance, not an automatic purchase or new restriction. Existing prices, catch rules, project costs, fish populations, and rewards are unchanged. Ambient wildlife targeting remains actor-based; this pass does not add a separate wildlife objective planner.

## Follow-up implemented: first catch → sale → upgrade

### Automated baseline, not a player study

Sixteen fresh offline voyages on the local Vite build used the real starter school, ordinary strike/reel rules, and successful catches without injecting coins, gear, or fishing assists. The harness accelerated simulation, dismissed the catch presentation, and moved directly to Alderhaven; it did **not** measure human reading time, navigation skill, or sailing time.

- All sixteen starter catches were Mackerel. On the first settled sale screen, coins ranged from **$65 to $316**, median **$82**, including the existing quest/milestone rewards, harbour gifts, and catch bonuses. Every sampled voyage could afford the existing **$50 Hold upgrade**. This is a small controlled sample, not a promise about every save or future balance configuration.
- All sixteen Market screens selected a disabled **Sell all** action after automatically selling the first catch. The detail still said **“Nothing in the hold yet”**; the sale receipt existed only as a short toast.
- Opening the Outfitter selected Oars, not Hold. Its help also incorrectly claimed speed upgrades carried between boats, contrary to the existing boat-fitted-parts behavior.

This supports clarifying the transaction and next choice before changing prices. It does not establish which upgrade unfamiliar players prefer or whether they find the loop enjoyable.

### Small changes, existing choices

- A sale receipt remains readable in the Market for that port visit, including partial sales with reserved fish. It replaces the empty-hold dead end when everything has sold, without an extra simultaneous sale toast. Ferry travel, redocking, and a new voyage clear the old receipt; this is transient UI state, not a new saved progression flag.
- A captain on their sole Rowboat with no Hold upgrade or recorded upgrade purchase can choose **View Hold upgrade** from that receipt. It explains **4 → 6 fish for $50**, using the current capacity and catalog values. Viewing selects the existing Outfitter row without spending; buying requires a separate action and normal funds. Other tabs and Leave port remain available, and the story objective is not replaced with a mandatory purchase.
- Objective/shortcut tips and already-visible first-session tips stay out of fishing and catch presentations. Incidental discovery notices are suppressed there; warnings remain eligible to display. No new instruction queue or setting was added.
- Dockside toasts wrap within the viewport, including portrait phones at 150% UI scale. The receipt drops its large decorative coin. Short phone port headers use less space; decorative boat portraits yield when the port's content area is too short relative to the chosen text size. Enlarged desktop and landscape-phone regressions check actual reading height and fully visible receipt/comparison text, not just DOM presence or reachable buttons. Speed-upgrade help now correctly says the parts stay with the boat.

No prices, rewards, catch requirements, boats, or progression systems changed. In particular, the existing first-upgrade milestone still awards $20: a $50 purchase must not be misdiagnosed as a $30 price simply by observing the final coin counter.

## Follow-up implemented: returning to a voyage

A code and browser review of Continue → Journal → next action found retained chart state and lost navigation context. This is an automated/reviewer-led follow-up, not observation of players returning after a week.

- The existing title tagline describes the saved game day, boat, and logged species before Continue. It reads validated metadata without loading the voyage, writing a save, or advancing offline earnings. A changed save refreshes the summary; unreadable metadata keeps the generic tagline.
- The journal puts the shared next step ahead of decorative portraits and long conversation text. **Show on chart** is offered only for an actual guide location. Looking does not start sailing, replace an existing waypoint, buy anything, accept a story, or re-enable hidden objective markers.
- Closing that chart returns to the journal; a journal opened from pause still returns to pause. A fish chart returns to the same logbook entry instead of dropping into sailing. Ordinary charts return to sailing. New/continued voyages reset transient chart pan, zoom, filter, and return state without erasing learnt fish waters. Catch-location caching also checks the actual coordinates, so a new voyage with the same species and spot count cannot inherit the previous voyage's chart destination.
- Contextual native Back/Close, keyboard Tab/Enter, existing controller close input, and touch share that return behavior. The duplicate touch Close button is removed, and enlarged title, journal, and chart layouts prioritize readable text and reachable actions over decoration.

No additional onboarding popup, saved progression flag, permanent HUD widget, economy change, or mandatory destination was introduced. The hypothesis is that a recognizable save and reversible inspection make returning less confusing; whether unfamiliar or returning players actually understand and prefer this route still needs observation.

## Prioritized follow-up—player observation still pending

| Priority | Question | Smallest useful next step | Evidence to collect before expansion |
|---|---|---|---|
| Next | Do beginners understand their first useful upgrade? | Observe unfamiliar players using the revised receipt and optional upgrade route; the automated baseline above is not this observation. | Time spent navigating, mistaken purchases, and whether players can describe the upgrade's benefit. Do not rebalance prices from intuition alone. |
| Next | Does a sailing session feel spacious or noisy? | Observe whether the quieter catch presentation helps; review the remaining notice/objective/story layers with new and returning saves before removing more. | Which messages players notice, ignore, or mistake for an urgent obligation. |
| Next | Can players return after a week away? | Observe returning players using the revised saved summary → Journal → Show on chart → Back route; automated state/layout checks are complete, not this observation. | Whether they recover their goal and location without a fresh tutorial. |
| Later | Do regions feel different beyond fish lists? | Improve one existing route using its current wildlife, landmark, sound, and weather vocabulary. | Whether players recognize the area and voluntarily take a detour. Avoid procedural chores at every rock. |
| Later | Do boat choices feel expressive? | Test comprehension of existing role captions, previews, and built-in gear. | Whether players can choose between speed, capacity, quiet sails, and rough-water capability without reading every stat. |
| Later | Is a sightseeing/photo option worthwhile? | First test existing interface hiding and reduced-motion options for a scenic session. | Whether players actually want to capture or share a view. No new mode or photo quest yet. |
| Before broader online promotion | Is optional social play trustworthy? | Exercise cloud/local save recovery, mute/report behavior, disconnections, and clear offline return in staging. | Verified recovery and safety behavior, not competitor review anecdotes. |

**Not recommended now:** fuel meters, mandatory daily rewards, streak-loss pressure, another currency, more branded boats, mandatory stories, a second targeting overlay, or copying another game's full management layer.

## A small playtest plan

Recruit a few unfamiliar players across keyboard and touch, plus returning players with progressed saves. This is qualitative observation, not a representative study or a retention experiment.

1. Ask new players to explore, catch something, sell it, and choose what to do next. Do not explain the interface first.
2. Interrupt one fishing attempt and ask them to take a break, change a fishing preference if desired, and resume.
3. Use a progressed save with a nearby equipment-gated species. Ask what prevents that catch and how they would prepare.
4. Let them choose a detour or continue toward Alderhaven. Notice whether curiosity or an obligation drove the choice.
5. Ask them to stop when they feel finished. Ask what was satisfying, what felt like work, and what they would do next time.

Record confusion, unnecessary inputs, unwanted interruptions, perceived pressure, comfort, and the player's own explanation of their next choice. A longer session is not automatically a better session. Keep any recordings opt-in and separate from production analytics.

## Verification

`e2e/comfort.spec.ts` covers pause/resume through all four fishing stages, unchanged fight state during a ten-second simulated pause, real landing after resuming, changing Easy reel mid-fight, save failure/quit/continue, simulated controller Start, and the equipment/full-hold guidance cases.

The initial browser run reproduced all four targeted failures before the first implementation. A later phone run exposed the save-warning overlap; that partial run was not counted as passing. Current suite counts and release-validation limitations are recorded in [POLISH_AUDIT.md](POLISH_AUDIT.md).

`e2e/first-voyage.spec.ts` adds sixteen configured checks for real starter-school catch → sale → deliberate purchase → reload, persistent/partial receipts, reserved fish, insufficient funds, stale/ferry/new-voyage cleanup, simulated controller A, correct fitted-parts copy, portrait action/toast bounds, and desktop/landscape reading space at 150% scale. The first tests reproduced the missing receipt, competing catch guidance, and incorrect speed help; subsequent screenshot-led regressions reproduced dockside-toast overflow and collapsed reading areas at enlarged text sizes.

`e2e/returning-voyage.spec.ts` adds twenty-two configured checks for read-only/refreshing saved summaries, paused optional-story preservation, chart-state reset and replaced catch locations, logbook/journal/pause returns, unchanged voyage state while inspecting, hidden-marker preferences, missing destinations, native keyboard and simulated-controller actions, and actual enlarged text/hit bounds. Five pure metadata regressions cover invalid values, removed-boat fallback, and day boundaries. The title was also checked locally in Harbour, Pixel, and Plain at 150% UI scale across desktop and both phone orientations.

Automation checks correctness, not whether this is fun. Physical controllers, physical phones, assistive technology, cross-browser behavior, and live-backend recovery still need their own validation.

## Sources

1. Chris Kerr, Game Developer, **Trawling in the deep: How Black Salt Games made spooky fishing RPG, Dredge** (2023): https://www.gamedeveloper.com/design/trawling-in-the-deep-how-black-salt-games-made-spooky-fishing-rpg-i-dredge-i-
2. Black Salt Games, **DREDGE Update: v1.2.0—Wildlife Photo Mode**: https://www.blacksaltgames.com/games/dredge-update-v-1-2-0-wildlife-photo-mode/
3. Black Salt Games, **DREDGE launch interview with development team**: https://www.blacksaltgames.com/dredge-launch-interview-with-development-team/
4. Adam Robinson-Yu, PlayStation Blog, **Crafting a tiny open world: A look behind the scenes at the creation of A Short Hike** (2021): https://blog.playstation.com/2021/08/05/crafting-a-tiny-open-world-a-look-behind-the-scenes-at-the-creation-of-a-short-hike/
5. **WEBFISHING Steam Community reviews**, inspected helpful/all-time English page: https://steamcommunity.com/app/3146520/reviews/?browsefilter=toprated&filterLanguage=english&p=1
6. **WEBFISHING Metacritic user reviews**, six visible reviews: https://www.metacritic.com/game/webfishing/user-reviews/
7. PC Gamer, **Here's an adorable, cozy little multiplayer chatroom fishing game**: https://www.pcgamer.com/games/heres-an-adorable-cozy-little-multiplayer-chatroom-fishing-game/
8. Joel Couture, Game Developer, **Dave the Diver** developer interview: https://www.gamedeveloper.com/design/dave-the-diver
9. Inven Global, **[GDC24] Blending Humor and Gameplay: Insights from Dave the Diver's Session**: https://www.invenglobal.com/articles/18786/gdc24-blending-humor-and-gameplay-insights-from-dave-the-divers-session
10. Ryan, Rigby & Przybylski, **The Motivational Pull of Video Games: A Self-Determination Theory Approach** (2006), DOI `10.1007/s11031-006-9051-8`: https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf
