# Corner Cup Café

A cozy, playable 3D café-management game built with Three.js, TypeScript, and Vite. Start alone at a neighborhood counter, make drinks and pastries, learn regulars’ routines, then use your earnings to stock the pantry, upgrade the shop, hire a visible team, and open a sunny new room.

## Run locally

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. For a production check:

```sh
npm run build
npm run preview
```

Requires Node.js 18 or newer. All game models and character animations are bundled under `public/models`; the game does not depend on remote model URLs or paid services. Third-party asset names, creators, source pages, and licenses are documented in [`public/models/CREDITS.md`](public/models/CREDITS.md).

## Play

Name your café, open the doors, and take control of your barista on the café floor. Guests walk in and take a seat when one is free, or wait near the entrance when the café is full. Select a ticket to see its complete order and patience. Walk to the matching glowing appliance marker and interact to prepare each item; finished drinks and pastries appear on your character’s serving tray. Carry the complete order to its seated or waiting guest and interact again to deliver it for sales and a tip. Group orders need every item. Check Supplies when stock is low, and clean after a rush. Between shifts, use Team, Shop, Supplies, and Menu to decide how the business grows.

The game introduces new recipes and guests gradually. Baristas and cooks make compatible items, servers deliver completed tickets, and hosts reset tables. Staff have finite shift capacity and recurring wages. Daily events are shown before each opening; the closing report explains orders, tips, satisfaction, rent, wages, and reputation. A small cash-flow cushion protects a struggling café from an unrecoverable loss.

Move with **WASD** or the **arrow keys**. Press **E** near a glowing appliance to prepare the selected order item, or near its guest to deliver a complete order. The ticket’s station and delivery buttons walk you to the relevant location; you still need to press **E** to perform the action. **Space** walks to the selected order’s next station, **Enter** walks to its guest when the ticket is ready, **1** selects the first ticket, **P** pauses/resumes, and **Esc** closes a panel. Phones and tablets show an on-screen directional pad and Interact button. Sound effects can be muted in Settings or from the top bar. Progress autosaves in this browser; **Settings → Start a new café** asks before replacing the save.

## Progression and cozy extras

- **Café levels and XP** from serving guests and closing shifts; level-ups grant cash and hearts.
- **17 multi-level upgrades**, gated by café level: espresso machine, seating, ambience, pantry, oven, clogs, street sign, burr grinder (drink prices), specials board (all prices), loyalty cards (XP), music nook (tips), Wi-Fi (walk-ins), window boxes (patience), awards shelf (reputation), staff training (teammate speed), bike delivery (daily income) and the sunroom. Most show up visibly in the café.
- **Decorate**: wall/floor palettes plus 14 heart-purchased decor items (reading corner, record cabinet, party bunting, glow sign, coat rack, garden corner and more).
- **Goals**: daily quests and 21 achievements. **Rewards**: daily gift with streak, plus a playtime treat basket that fills while you play.
- **Combo streaks** of quick serves boost tips. Guests path-find around furniture (A*), sit facing their table, and leave through the door.

## Project checks

```sh
npm run build
```
