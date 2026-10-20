import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import './style.css';

type Role = 'barista' | 'server' | 'cleaner' | 'cook';
type ItemState = 'waiting' | 'preparing' | 'ready';
type Recipe = { id: string; name: string; icon: string; price: number; station: string; ingredients: Record<string, number>; kind: 'drink' | 'food'; unlock?: number };
type DailyReport = { day: number; served: number; lost: number; revenue: number; tips: number; wages: number; rent: number; satisfaction: number; event: string; bonus: string; oldRep: number; newRep: number };
type CafeSave = {
  version: 1; name: string; cash: number; reputation: number; day: number; served: number;
  inventory: Record<string, number>; menu: string[]; upgrades: Record<string, number>;
  staff: { id: number; name: string; role: Role; skill: number }[]; nextStaffId: number; debt: number; loans: number; report: DailyReport | null;
  xp: number; hearts: number; achievements: string[]; quests: QuestState; streak: StreakState; chestSeconds: number; chestsOpened: number; bestCombo: number;
  custom: CustomState;
};
type Quest = { id: string; stat: string; label: string; icon: string; goal: number; progress: number; claimed: boolean; cash: number; hearts: number; xp: number };
type QuestState = { day: number; list: Quest[] };
type StreakState = { days: number; lastDate: string; claimedDate: string };
type CustomState = { wall: string; floor: string; counter: string; chairs: string; sign: string; decor: string[]; decorOff: string[] };
type OrderItem = { recipeId: string; state: ItemState; finishAt: number };
type Guest = { id: number; name: string; kind: string; patience: number; maxPatience: number; items: OrderItem[]; createdAt: number; mood: string };
type Worker = CafeSave['staff'][number] & { busyUntil: number; model: THREE.Group; mixer: THREE.AnimationMixer | null; pendingGuestId?: number; task?: 'serve' | 'clean' };
type CharacterActor = { root: THREE.Group; mixer: THREE.AnimationMixer | null; action: THREE.AnimationAction | null };
type GuestActor = CharacterActor & {
  guestId: number; exiting: boolean; exitAt: number; target: THREE.Vector3; seated: boolean; seatKey: string | null;
  path: THREE.Vector3[]; speed: number; settled: boolean; sitFacing: number; appear: number; leaving: boolean;
};
type Station = { id: string; label: string; position: THREE.Vector3; kinds: Recipe['kind'][] };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const BASE = import.meta.env.BASE_URL;
const modelUrl = (path: string) => `${BASE}models/${path}`;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
const money = (n: number) => '$' + Math.max(0, Math.floor(n)).toLocaleString();
const allRecipes: Recipe[] = [
  { id: 'coffee', name: 'House drip coffee', icon: '☕', price: 5, station: 'Brew bar', ingredients: { beans: 1, cups: 1 }, kind: 'drink' },
  { id: 'tea', name: 'Garden tea', icon: '🍵', price: 4, station: 'Tea kettle', ingredients: { tea: 1, cups: 1 }, kind: 'drink' },
  { id: 'croissant', name: 'Butter croissant', icon: '🥐', price: 5, station: 'Pastry case', ingredients: { pastries: 1 }, kind: 'food' },
  { id: 'muffin', name: 'Blueberry muffin', icon: '🧁', price: 5, station: 'Pastry case', ingredients: { pastries: 1 }, kind: 'food' },
  { id: 'espresso', name: 'Double espresso', icon: '☕', price: 6, station: 'Espresso machine', ingredients: { beans: 2, cups: 1 }, kind: 'drink', unlock: 2 },
  { id: 'latte', name: 'Vanilla oat latte', icon: '🥛', price: 8, station: 'Espresso machine', ingredients: { beans: 1, milk: 1, syrup: 1, cups: 1 }, kind: 'drink', unlock: 2 },
  { id: 'iced', name: 'Iced coffee', icon: '🧋', price: 7, station: 'Cold bar', ingredients: { beans: 1, milk: 1, ice: 1, cups: 1 }, kind: 'drink', unlock: 3 },
  { id: 'cookie', name: 'Chocolate cookie', icon: '🍪', price: 4, station: 'Pastry case', ingredients: { pastries: 1 }, kind: 'food', unlock: 3 },
  { id: 'cappuccino', name: 'Cappuccino', icon: '☕', price: 7, station: 'Espresso machine', ingredients: { beans: 1, milk: 1, cups: 1 }, kind: 'drink', unlock: 3 },
  { id: 'sandwich', name: 'Garden sandwich', icon: '🥪', price: 9, station: 'Kitchen', ingredients: { bread: 1 }, kind: 'food', unlock: 4 },
];
const recipeById = (id: string) => allRecipes.find(r => r.id === id)!;
const ingredientInfo: Record<string, { label: string; icon: string; cost: number }> = {
  beans: { label: 'Coffee beans', icon: '🫘', cost: 12 }, milk: { label: 'Oat milk', icon: '🥛', cost: 9 },
  tea: { label: 'Loose-leaf tea', icon: '🍃', cost: 8 }, pastries: { label: 'Pastry delivery', icon: '🥐', cost: 14 },
  cups: { label: 'Paper cups', icon: '🥤', cost: 6 }, syrup: { label: 'Vanilla syrup', icon: '🍯', cost: 8 },
  ice: { label: 'Ice', icon: '🧊', cost: 5 }, bread: { label: 'Fresh bread', icon: '🍞', cost: 10 },
};
let audioContext: AudioContext | null = null;
function beep(frequency: number, duration = 0.08, wave: OscillatorType = 'sine', volume = 0.025, glide = 0) {
  if (!soundEnabled) return;
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = wave; oscillator.frequency.value = frequency;
    if (glide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + glide), audioContext.currentTime + duration);
    gain.gain.value = volume; gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch {
    // Audio is an optional enhancement; gameplay remains fully usable when the browser blocks it.
  }
}
const roles: Record<Role, { label: string; icon: string; hire: number; wage: number; task: string }> = {
  barista: { label: 'Barista', icon: '☕', hire: 95, wage: 24, task: 'prepares drinks at the espresso bar' },
  server: { label: 'Floor server', icon: '🛎️', hire: 85, wage: 21, task: 'delivers ready orders and welcomes guests' },
  cleaner: { label: 'Host & cleaner', icon: '🧹', hire: 70, wage: 18, task: 'resets tables and keeps the room tidy' },
  cook: { label: 'Pastry cook', icon: '🥐', hire: 110, wage: 26, task: 'prepares pastries and kitchen orders' },
};
type UpgradeDef = { id: string; name: string; icon: string; prices: number[]; levelReq: number[]; effects: string[]; blurb: string };
const upgrades: UpgradeDef[] = [
  { id: 'machine', name: 'Espresso machine', icon: '⚙️', prices: [120, 240, 420], levelReq: [1, 3, 6], blurb: 'Faster drinks', effects: ['Every recipe is 25% quicker.', 'Twin-group machine: 38% quicker.', 'Master-barista rig: 50% quicker.'] },
  { id: 'seating', name: 'Dining nooks', icon: '🪑', prices: [80, 150, 260], levelReq: [1, 2, 4], blurb: 'More tables', effects: ['Two more tables (4 total).', 'Two more tables (6 total).', 'Two more tables (8 total).'] },
  { id: 'ambience', name: 'Cozy touches', icon: '🪴', prices: [55, 120, 200], levelReq: [1, 3, 5], blurb: 'Patience and tips', effects: ['Plants, warm lamps. Guests wait longer and tip a little more.', 'Hanging planters and candle glow. More patience and tips.', 'Fairy-lit atmosphere. The cosiest tips in town.'] },
  { id: 'storage', name: 'Pantry', icon: '📦', prices: [95, 170], levelReq: [1, 4], blurb: 'Bigger deliveries', effects: ['Supply deliveries bring 50% more.', 'Cold room: deliveries bring double.'] },
  { id: 'oven', name: 'Pastry oven', icon: '🥐', prices: [110, 230], levelReq: [2, 5], blurb: 'Pastries sell for more', effects: ['Pastries and sandwiches sell for 12% more.', 'Stone oven: 25% more, with a warm glow from the kitchen.'] },
  { id: 'shoes', name: 'Comfy clogs', icon: '👟', prices: [45, 90, 150], levelReq: [1, 2, 4], blurb: 'Walk faster', effects: ['You walk 10% faster.', 'You walk 20% faster.', 'You walk 30% faster.'] },
  { id: 'signage', name: 'Street sign', icon: '✨', prices: [60, 130, 220], levelReq: [1, 3, 6], blurb: 'More walk-ins', effects: ['A brighter storefront brings more guests.', 'A glowing sign draws a steady crowd.', 'A neighborhood landmark. Reputation grows faster.'] },
  { id: 'grinder', name: 'Burr grinder', icon: '🫘', prices: [90, 180, 320], levelReq: [2, 5, 9], blurb: 'Drinks sell for more', effects: ['Fresher grounds: drinks sell for 6% more.', 'Single-origin beans: drinks sell for 12% more.', 'Roast-your-own corner: drinks sell for 18% more.'] },
  { id: 'specials', name: 'Specials board', icon: '📝', prices: [70, 150, 280], levelReq: [2, 4, 8], blurb: 'Everything sells for more', effects: ['A chalk board of specials: all items sell 4% more.', 'Seasonal menu: all items sell 8% more.', 'Chef’s tasting card: all items sell 12% more.'] },
  { id: 'loyalty', name: 'Loyalty cards', icon: '🎟️', prices: [60, 140, 260], levelReq: [2, 5, 8], blurb: 'More XP per order', effects: ['Stamp cards: +15% XP from orders.', 'Punch-card perks: +30% XP from orders.', 'Regulars’ club: +45% XP from orders.'] },
  { id: 'music', name: 'Music nook', icon: '🎶', prices: [85, 200], levelReq: [3, 7], blurb: 'Happier tips', effects: ['A cozy record player: tips grow by 4%.', 'Live-music Fridays: tips grow by 8%.'] },
  { id: 'wifi', name: 'Free Wi-Fi', icon: '📶', prices: [75, 170], levelReq: [3, 6], blurb: 'More walk-ins', effects: ['Remote workers drop by: guests arrive 5% faster.', 'Co-working crowd: guests arrive 10% faster.'] },
  { id: 'windows', name: 'Window boxes', icon: '🌷', prices: [50, 120], levelReq: [2, 5], blurb: 'Calmer guests', effects: ['Flower boxes: guests wait 4s longer.', 'Blooming sills: guests wait 8s longer.'] },
  { id: 'awards', name: 'Awards shelf', icon: '🏅', prices: [130, 300], levelReq: [4, 9], blurb: 'Faster reputation', effects: ['Local awards: reputation grows a little faster.', 'Best-of-town trophy: reputation grows much faster.'] },
  { id: 'training', name: 'Staff training', icon: '🎓', prices: [100, 210, 380], levelReq: [3, 6, 10], blurb: 'Faster teammates', effects: ['Teammates work 10% faster.', 'Teammates work 20% faster.', 'Teammates work 30% faster.'] },
  { id: 'delivery', name: 'Bike delivery', icon: '🚲', prices: [110, 240], levelReq: [4, 8], blurb: 'Bonus income each day', effects: ['A courier bag earns $12 extra each shift.', 'Neighborhood delivery earns $28 extra each shift.'] },
  { id: 'expansion', name: 'Sunroom wing', icon: '🏡', prices: [320], levelReq: [3], blurb: 'A whole new room', effects: ['Builds a bright wing with 4 extra tables and room for a pastry cook.'] },
];
const upgradeById = (id: string) => upgrades.find(u => u.id === id)!;
const upLevel = (id: string) => Math.min(state.upgrades[id] || 0, upgradeById(id).prices.length);
const sunroomUnlocked = () => upLevel('expansion') > 0;

type Palette = { id: string; name: string; color: string; level: number };
const palettes: Record<'wall' | 'floor' | 'counter' | 'chairs' | 'sign', Palette[]> = {
  wall: [
    { id: 'oat', name: 'Oat cream', color: '#ecd9b8', level: 1 }, { id: 'sage', name: 'Sage', color: '#b9c9a6', level: 1 },
    { id: 'blush', name: 'Blush', color: '#e9bfb0', level: 2 }, { id: 'sky', name: 'Morning sky', color: '#b4cdd4', level: 3 },
    { id: 'butter', name: 'Butter', color: '#efd68a', level: 4 }, { id: 'plum', name: 'Dusty plum', color: '#b793a6', level: 6 },
  ],
  floor: [
    { id: 'oak', name: 'Honey oak', color: '#b98a5c', level: 1 }, { id: 'walnut', name: 'Walnut', color: '#7b583d', level: 1 },
    { id: 'ash', name: 'Pale ash', color: '#d9c096', level: 3 }, { id: 'cherry', name: 'Cherry', color: '#a45a40', level: 5 },
  ],
  counter: [
    { id: 'natural', name: 'Natural', color: '#ffffff', level: 1 }, { id: 'mint', name: 'Mint', color: '#bfe3d1', level: 2 },
    { id: 'rose', name: 'Rose', color: '#f4c6c2', level: 3 }, { id: 'denim', name: 'Denim', color: '#a9bddd', level: 4 },
    { id: 'butter', name: 'Butter', color: '#f6e39d', level: 5 },
  ],
  chairs: [
    { id: 'sage', name: 'Sage', color: '#aebfa0', level: 1 }, { id: 'clay', name: 'Clay', color: '#d9a98d', level: 1 },
    { id: 'oat', name: 'Oatmeal', color: '#eadfca', level: 2 }, { id: 'sky', name: 'Sky', color: '#a9c6d8', level: 3 },
    { id: 'berry', name: 'Berry', color: '#c98a9a', level: 5 },
  ],
  sign: [
    { id: 'forest', name: 'Forest', color: '#2b4a3f', level: 1 }, { id: 'terracotta', name: 'Terracotta', color: '#9a553d', level: 2 },
    { id: 'navy', name: 'Navy', color: '#2f4160', level: 3 }, { id: 'plum', name: 'Plum', color: '#5d3f58', level: 5 },
  ],
};
const palette = (kind: keyof typeof palettes, id: string) => palettes[kind].find(p => p.id === id) ?? palettes[kind][0];
type DecorDef = { id: string; name: string; icon: string; hearts: number; level: number; blurb: string };
const decorItems: DecorDef[] = [
  { id: 'rug', name: 'Entrance rug', icon: '🧶', hearts: 2, level: 1, blurb: 'A woven runner and doormat by the front door.' },
  { id: 'flowers', name: 'Table posies', icon: '🌼', hearts: 3, level: 2, blurb: 'A little pot of green on every table.' },
  { id: 'books', name: 'Bookshelves', icon: '📚', hearts: 4, level: 2, blurb: 'Two tall shelves of well-loved paperbacks.' },
  { id: 'art', name: 'Gallery wall', icon: '🖼️', hearts: 3, level: 3, blurb: 'Framed paintings along the back wall.' },
  { id: 'lights', name: 'String lights', icon: '💡', hearts: 4, level: 3, blurb: 'A warm strand of bulbs under the ceiling.' },
  { id: 'radio', name: 'Vintage radio', icon: '📻', hearts: 3, level: 4, blurb: 'A radio and speaker on the counter.' },
  { id: 'bear', name: 'Counter mascot', icon: '🧸', hearts: 5, level: 5, blurb: 'A plush bear that keeps an eye on the till.' },
  { id: 'hangers', name: 'Hanging planters', icon: '🌿', hearts: 6, level: 6, blurb: 'Trailing greenery from the ceiling beams.' },
  { id: 'coatrack', name: 'Coat rack', icon: '🧥', hearts: 2, level: 2, blurb: 'A place for neighbors to hang their jackets.' },
  { id: 'bunting', name: 'Party bunting', icon: '🎏', hearts: 3, level: 3, blurb: 'Cheerful paper flags strung across the room.' },
  { id: 'neon', name: 'Glow sign', icon: '✨', hearts: 4, level: 4, blurb: 'A softly glowing "Fresh Coffee" sign on the back wall.' },
  { id: 'lounge', name: 'Reading corner', icon: '🛋️', hearts: 6, level: 5, blurb: 'A sofa, side table and lamp by the window wall.' },
  { id: 'records', name: 'Record cabinet', icon: '🎶', hearts: 5, level: 7, blurb: 'A low cabinet with speakers for background tunes.' },
  { id: 'garden', name: 'Garden corner', icon: '🪴', hearts: 4, level: 8, blurb: 'A cluster of leafy plants by the window.' },
];
const decorById = (id: string) => decorItems.find(d => d.id === id)!;
const decorOn = (id: string) => state.custom.decor.includes(id) && !state.custom.decorOff.includes(id);

const questPool: { id: string; stat: string; icon: string; label: (g: number) => string; goal: (level: number) => number; cash: number }[] = [
  { id: 'serve', stat: 'served', icon: '🛎️', label: g => `Serve ${g} orders`, goal: l => 4 + Math.floor(l / 2), cash: 24 },
  { id: 'tips', stat: 'tips', icon: '💛', label: g => `Collect ${money(g)} in tips`, goal: l => 8 + l * 3, cash: 22 },
  { id: 'drinks', stat: 'drinks', icon: '☕', label: g => `Make ${g} drinks`, goal: l => 3 + Math.floor(l / 2), cash: 20 },
  { id: 'treats', stat: 'treats', icon: '🥐', label: g => `Plate ${g} pastries`, goal: l => 2 + Math.floor(l / 3), cash: 20 },
  { id: 'combo', stat: 'combo', icon: '🔥', label: g => `Reach a ×${g} service streak`, goal: l => Math.min(6, 3 + Math.floor(l / 4)), cash: 30 },
  { id: 'perfect', stat: 'perfect', icon: '🌟', label: () => 'Finish a day without losing a guest', goal: () => 1, cash: 36 },
];
const achievementDefs: { id: string; name: string; desc: string; icon: string; hearts: number; check: () => boolean }[] = [
  { id: 'first', name: 'First cup', desc: 'Serve your very first order.', icon: '☕', hearts: 1, check: () => state.served >= 1 },
  { id: 'regular', name: 'Friendly face', desc: 'Serve 25 orders.', icon: '🙂', hearts: 2, check: () => state.served >= 25 },
  { id: 'hundred', name: 'Neighborhood staple', desc: 'Serve 100 orders.', icon: '🏘️', hearts: 4, check: () => state.served >= 100 },
  { id: 'level3', name: 'Warming up', desc: 'Reach café level 3.', icon: '🌱', hearts: 2, check: () => levelInfo(state.xp).level >= 3 },
  { id: 'level6', name: 'Local favorite', desc: 'Reach café level 6.', icon: '🌳', hearts: 3, check: () => levelInfo(state.xp).level >= 6 },
  { id: 'level10', name: 'Beloved landmark', desc: 'Reach café level 10.', icon: '🏆', hearts: 6, check: () => levelInfo(state.xp).level >= 10 },
  { id: 'rep3', name: 'Rising star', desc: 'Reach 3.0★ reputation.', icon: '⭐', hearts: 3, check: () => state.reputation >= 3 },
  { id: 'team', name: 'Team spirit', desc: 'Have 3 teammates.', icon: '🤝', hearts: 2, check: () => state.staff.length >= 3 },
  { id: 'maxed', name: 'Top of the line', desc: 'Max out any upgrade.', icon: '🔧', hearts: 3, check: () => upgrades.some(u => (state.upgrades[u.id] || 0) >= u.prices.length) },
  { id: 'streak3', name: 'Creature of habit', desc: 'Visit three days in a row.', icon: '📅', hearts: 2, check: () => state.streak.days >= 3 },
  { id: 'streak7', name: 'Always open', desc: 'Visit seven days in a row.', icon: '🗓️', hearts: 5, check: () => state.streak.days >= 7 },
  { id: 'decor', name: 'Interior designer', desc: 'Own three decorations.', icon: '🛋️', hearts: 3, check: () => state.custom.decor.length >= 3 },
  { id: 'cash500', name: 'Piggy bank', desc: 'Hold $500 at once.', icon: '🐷', hearts: 2, check: () => state.cash >= 500 },
  { id: 'cash2000', name: 'Small business', desc: 'Hold $2,000 at once.', icon: '💰', hearts: 4, check: () => state.cash >= 2000 },
  { id: 'day5', name: 'Settled in', desc: 'Reach day 5.', icon: '🏡', hearts: 2, check: () => state.day >= 5 },
  { id: 'day15', name: 'Fixture of the street', desc: 'Reach day 15.', icon: '🌆', hearts: 4, check: () => state.day >= 15 },
  { id: 'chest3', name: 'Treat tradition', desc: 'Open 3 treat baskets.', icon: '🧺', hearts: 3, check: () => state.chestsOpened >= 3 },
  { id: 'rep4', name: 'Beloved by all', desc: 'Reach 4.0★ reputation.', icon: '🌟', hearts: 4, check: () => state.reputation >= 4 },
  { id: 'level15', name: 'Café legend', desc: 'Reach café level 15.', icon: '👑', hearts: 8, check: () => levelInfo(state.xp).level >= 15 },
  { id: 'decor6', name: 'Home sweet café', desc: 'Own six decorations.', icon: '🏠', hearts: 4, check: () => state.custom.decor.length >= 6 },
  { id: 'combo5', name: 'On a roll', desc: 'Reach a ×5 service streak.', icon: '🔥', hearts: 3, check: () => state.bestCombo >= 5 },
];
const CHEST_SECONDS = 150;
function levelInfo(xp: number) {
  let level = 1; let need = 90; let rest = Math.max(0, xp);
  while (rest >= need && level < 99) { rest -= need; level++; need = 90 + (level - 1) * 40; }
  return { level, into: rest, need };
}
const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000);
const dailyGifts = [
  { cash: 40, hearts: 1, label: '$40 and a heart' }, { cash: 55, hearts: 1, label: '$55 and a heart' }, { cash: 70, hearts: 2, label: '$70 and 2 hearts' },
  { cash: 90, hearts: 2, label: '$90 and 2 hearts' }, { cash: 110, hearts: 3, label: '$110 and 3 hearts' }, { cash: 140, hearts: 3, label: '$140 and 3 hearts' },
  { cash: 220, hearts: 6, label: '$220 and 6 hearts: weekly treat!' },
];
const guests = [
  { name: 'Maya', kind: 'Neighborhood regular', patience: 76, mood: 'knows her usual' },
  { name: 'Theo', kind: 'Morning commuter', patience: 52, mood: 'in a hurry' },
  { name: 'Ari', kind: 'Remote-work regular', patience: 90, mood: 'happy to linger' },
  { name: 'June', kind: 'Weekend explorer', patience: 72, mood: 'trying something new' },
  { name: 'The Parkers', kind: 'Little lunch group', patience: 76, mood: 'ordering for two' },
  { name: 'Sam', kind: 'Friendly neighbor', patience: 68, mood: 'loves a pastry' },
  { name: 'Riley', kind: 'Student on a budget', patience: 65, mood: 'counting coins' },
  { name: 'Noah', kind: 'Dog-walk stop', patience: 60, mood: 'needs a quick pick-me-up' },
];
const dailyEvents = [
  { title: 'A bright, ordinary morning', detail: 'A gentle start gives you time to learn the rhythm.' },
  { title: 'Rainy-day regulars', detail: 'More neighbors stop in, and the cozy café atmosphere earns extra tips.' },
  { title: 'Market-day foot traffic', detail: 'A busy street brings a few extra guests. Keep an eye on the queue.' },
  { title: 'Supplier thank-you', detail: 'A local delivery discount makes today’s restock 20% cheaper.' },
];
const freshSave = (): CafeSave => ({
  version: 1, name: 'Corner Cup Café', cash: 230, reputation: 1.0, day: 1, served: 0,
  inventory: { beans: 12, milk: 8, tea: 8, pastries: 12, cups: 20, syrup: 3, ice: 4, bread: 2 },
  menu: ['coffee', 'tea', 'croissant', 'muffin'], upgrades: Object.fromEntries(upgrades.map(upgrade => [upgrade.id, 0])), staff: [], nextStaffId: 1, debt: 0, loans: 0, report: null,
  xp: 0, hearts: 3, achievements: [], quests: { day: 0, list: [] }, streak: { days: 0, lastDate: '', claimedDate: '' }, chestSeconds: 0, chestsOpened: 0, bestCombo: 0,
  custom: { wall: 'oat', floor: 'oak', counter: 'natural', chairs: 'sage', sign: 'forest', decor: [], decorOff: [] },
});
function isDailyReport(value: unknown): value is DailyReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Record<string, unknown>;
  const numeric = ['day', 'served', 'lost', 'revenue', 'tips', 'wages', 'rent', 'satisfaction', 'oldRep', 'newRep'];
  return numeric.every(key => typeof report[key] === 'number' && Number.isFinite(report[key])) &&
    typeof report.event === 'string' && typeof report.bonus === 'string';
}

let saveWarning = '';
function loadSave(): CafeSave {
  try {
    const raw = localStorage.getItem('corner-cup-cafe-v1');
    if (!raw) return freshSave();
    const value = JSON.parse(raw) as Partial<CafeSave>;
    if (value.version !== 1 || typeof value.cash !== 'number' || !Number.isFinite(value.cash)) throw new Error('unrecognized save');
    const clean = freshSave();
    clean.name = typeof value.name === 'string' ? value.name.slice(0, 28) : clean.name;
    clean.cash = Math.max(0, value.cash);
    clean.reputation = typeof value.reputation === 'number' && Number.isFinite(value.reputation) ? clamp(value.reputation, 0.5, 5) : clean.reputation;
    clean.day = typeof value.day === 'number' && Number.isFinite(value.day) ? clamp(Math.floor(value.day), 1, 999) : 1;
    clean.served = typeof value.served === 'number' && Number.isFinite(value.served) ? Math.max(0, Math.floor(value.served)) : 0;
    clean.inventory = { ...clean.inventory, ...(value.inventory && typeof value.inventory === 'object' ? value.inventory : {}) };
    for (const key of Object.keys(clean.inventory)) clean.inventory[key] = Math.max(0, Math.floor(Number(clean.inventory[key]) || 0));
    clean.menu = Array.isArray(value.menu) ? value.menu.filter(id => allRecipes.some(r => r.id === id)) : clean.menu;
    if (!clean.menu.length) clean.menu = freshSave().menu;
    const savedUpgrades = value.upgrades && typeof value.upgrades === 'object' ? value.upgrades : {};
    clean.upgrades = Object.fromEntries(upgrades.map(upgrade => [upgrade.id, clamp(Math.floor(Number(savedUpgrades[upgrade.id]) || 0), 0, upgrade.prices.length)]));
    clean.report = isDailyReport(value.report) ? value.report : null;
    clean.staff = Array.isArray(value.staff) ? value.staff.filter(w => w && typeof w.name === 'string' && w.name.length < 30 && ['barista', 'server', 'cleaner', 'cook'].includes(w.role)).map(w => ({ id: Number(w.id) || 1, name: w.name, role: w.role, skill: clamp(Number(w.skill) || 1, 1, 3) })) : [];
    clean.nextStaffId = Math.max(clean.staff.length + 1, Number(value.nextStaffId) || 1);
    clean.debt = Math.max(0, Number(value.debt) || 0);
    clean.loans = Math.max(0, Number(value.loans) || 0);
    const num = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : fallback;
    clean.xp = Math.floor(num(value.xp));
    clean.hearts = Math.floor(num(value.hearts, clean.hearts));
    clean.chestSeconds = clamp(num(value.chestSeconds), 0, CHEST_SECONDS);
    clean.chestsOpened = Math.floor(num(value.chestsOpened));
    clean.bestCombo = Math.floor(num(value.bestCombo));
    clean.achievements = Array.isArray(value.achievements) ? value.achievements.filter(id => achievementDefs.some(a => a.id === id)) : [];
    const sv = value.streak as Partial<StreakState> | undefined;
    if (sv && typeof sv === 'object') clean.streak = { days: Math.floor(num(sv.days)), lastDate: typeof sv.lastDate === 'string' ? sv.lastDate.slice(0, 10) : '', claimedDate: typeof sv.claimedDate === 'string' ? sv.claimedDate.slice(0, 10) : '' };
    const qv = value.quests as Partial<QuestState> | undefined;
    if (qv && typeof qv === 'object' && Array.isArray(qv.list)) {
      clean.quests = { day: Math.floor(num(qv.day)), list: qv.list.filter(q => q && questPool.some(p => p.id === q.id)).slice(0, 3).map(q => {
        const def = questPool.find(p => p.id === q.id)!;
        return { id: def.id, stat: def.stat, label: String(q.label || '').slice(0, 60), icon: def.icon, goal: Math.max(1, Math.floor(num(q.goal, 1))), progress: Math.floor(num(q.progress)), claimed: q.claimed === true, cash: Math.floor(num(q.cash)), hearts: Math.floor(num(q.hearts)), xp: Math.floor(num(q.xp)) };
      }) };
    }
    const cv = value.custom as Partial<CustomState> | undefined;
    if (cv && typeof cv === 'object') {
      for (const kind of ['wall', 'floor', 'counter', 'chairs', 'sign'] as const) if (typeof cv[kind] === 'string' && palettes[kind].some(p => p.id === cv[kind])) clean.custom[kind] = cv[kind] as string;
      clean.custom.decor = Array.isArray(cv.decor) ? cv.decor.filter(id => decorItems.some(d => d.id === id)) : [];
      clean.custom.decorOff = Array.isArray(cv.decorOff) ? cv.decorOff.filter(id => decorItems.some(d => d.id === id)) : [];
    }
    return clean;
  } catch {
    saveWarning = 'Your old save could not be read, so a fresh café is ready. You can start over safely.';
    return freshSave();
  }
}
const state = loadSave();
const persist = () => {
  try { localStorage.setItem('corner-cup-cafe-v1', JSON.stringify(state)); }
  catch { toast('This browser could not save locally. Check your browser storage settings.', 'warning'); }
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f1ddbd');
scene.fog = new THREE.Fog('#f1ddbd', 26, 52);
const camera = new THREE.PerspectiveCamera(39, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0.2, 10.2, 16.7);
camera.lookAt(0, 1.15, -0.4);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.domElement.setAttribute('aria-label', 'Three-dimensional view of the Corner Cup café');
renderer.domElement.id = 'cafe-scene';
document.body.prepend(renderer.domElement);

const ambient = new THREE.HemisphereLight('#ffe9c4', '#8a6a4c', 1.25);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight('#ffe2b0', 2.1);
keyLight.position.set(-5, 11, 6);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1536, 1536);
keyLight.shadow.camera.left = -12; keyLight.shadow.camera.right = 12;
keyLight.shadow.camera.top = 13; keyLight.shadow.camera.bottom = -10;
keyLight.shadow.bias = -0.00025;
scene.add(keyLight);
const windowLight = new THREE.PointLight('#ffb865', 18, 18, 2);
windowLight.position.set(-3, 5.3, -3.5);
scene.add(windowLight);

const manager = new THREE.LoadingManager();
const gltfLoader = new GLTFLoader(manager);
const assets: Record<string, THREE.Group> = {};
let peopleModels: THREE.Group[] = [];
let peopleAnimations: THREE.AnimationClip[][] = [];
let assetReady = false;
let assetError = '';
const assetFiles: [string, string][] = [
  ['bar', 'furniture/kitchenBar.glb'], ['barEnd', 'furniture/kitchenBarEnd.glb'],
  ['chair', 'furniture/chairModernCushion.glb'], ['table', 'furniture/tableRound.glb'],
  ['coffeeMachine', 'furniture/kitchenCoffeeMachine.glb'], ['plant', 'furniture/pottedPlant.glb'],
  ['smallPlant', 'furniture/plantSmall1.glb'], ['lamp', 'furniture/lampRoundTable.glb'],
  ['coffeeCup', 'food/cup-coffee.glb'], ['teaCup', 'food/cup-tea.glb'],
  ['croissant', 'food/croissant.glb'], ['muffin', 'food/muffin.glb'],
  ['cookie', 'food/cookie-chocolate.glb'], ['cake', 'food/cake.glb'],
  ['cabinet', 'furniture/kitchenCabinet.glb'], ['cabinetDrawer', 'furniture/kitchenCabinetDrawer.glb'], ['sink', 'furniture/kitchenSink.glb'],
  ['fridge', 'furniture/kitchenFridge.glb'], ['toaster', 'furniture/toaster.glb'], ['blender', 'furniture/kitchenBlender.glb'],
  ['microwave', 'furniture/kitchenMicrowave.glb'], ['stool', 'furniture/stoolBar.glb'],
  ['bookcase', 'furniture/bookcaseOpen.glb'], ['bookcaseWide', 'furniture/bookcaseClosedWide.glb'], ['books', 'furniture/books.glb'],
  ['rugRect', 'furniture/rugRectangle.glb'], ['rugRound', 'furniture/rugRound.glb'], ['doormat', 'furniture/rugDoormat.glb'],
  ['floorLamp', 'furniture/lampSquareFloor.glb'], ['sideTable', 'furniture/sideTable.glb'], ['radio', 'furniture/radio.glb'], ['speaker', 'furniture/speaker.glb'],
  ['bear', 'furniture/bear.glb'], ['loungeSofa', 'furniture/loungeSofa.glb'], ['pillow', 'furniture/pillow.glb'], ['cabinetTv', 'furniture/cabinetTelevision.glb'], ['plant2', 'furniture/plantSmall2.glb'], ['plant3', 'furniture/plantSmall3.glb'],
  ['bench', 'furniture/benchCushion.glb'], ['trash', 'furniture/trashcan.glb'], ['coatRack', 'furniture/coatRack.glb'],
  ['mug', 'food/mug.glb'], ['saucer', 'food/cup-saucer.glb'], ['donut', 'food/donut-sprinkles.glb'], ['cupcake', 'food/cupcake.glb'],
  ['pie', 'food/pie.glb'], ['pancakes', 'food/pancakes.glb'], ['honey', 'food/honey.glb'], ['plate', 'food/plate.glb'], ['bread', 'food/loaf-baguette.glb'],
];
const characterFiles = 'abcdefghijklmnopqr'.split('').map(letter => `people/character-${letter}.glb`);
type LoadedModel = { scene: THREE.Group; animations: THREE.AnimationClip[] };
function loadGLB(path: string): Promise<LoadedModel> {
  return new Promise((resolve, reject) => gltfLoader.load(modelUrl(path), gltf => resolve({ scene: gltf.scene, animations: gltf.animations }), undefined, error => reject(new Error(`Could not load 3D model ${path}: ${String(error)}`))));
}
async function loadWorldAssets() {
  try {
    const loaded = await Promise.all([...assetFiles.map(([, path]) => loadGLB(path)), ...characterFiles.map(path => loadGLB(path))]);
    assetFiles.forEach(([id], i) => assets[id] = loaded[i].scene);
    const characters = loaded.slice(assetFiles.length);
    peopleModels = characters.map(model => model.scene);
    peopleAnimations = characters.map(model => model.animations);
    buildRoom();
    const person = addHuman(playerGroup, [PLAYER_START.x, 0, PLAYER_START.z], 17, 0);
    playerActor = { ...person, action: null };
    animatePerson(playerActor, 'idle');
    setCamera();
    assetReady = true;
    $('loading-label').textContent = 'Your café is ready.';
    $('begin-game').removeAttribute('disabled');
    $('asset-status').textContent = '';
    if (saveWarning) toast(saveWarning, 'warning');
    updateUI();
  } catch (error) {
    assetError = error instanceof Error ? error.message : 'The café 3D models could not be loaded.';
    $('loading-label').textContent = 'A 3D asset could not be loaded.';
    $('asset-status').textContent = `${assetError} Refresh after checking that the project is being served over HTTP.`;
    $('asset-status').classList.add('error');
  }
}

const roomGroup = new THREE.Group();
const tableGroup = new THREE.Group();
const decorGroup = new THREE.Group();
const workerGroup = new THREE.Group();
const guestGroup = new THREE.Group();
const playerGroup = new THREE.Group();
const stationMarkerGroup = new THREE.Group();
const rightWallGroup = new THREE.Group();
scene.add(roomGroup, tableGroup, decorGroup, workerGroup, guestGroup, playerGroup, stationMarkerGroup, rightWallGroup);
const workers: Worker[] = [];
const guestActors = new Map<number, GuestActor>();
let playerActor: CharacterActor | null = null;
let heldOrderGroup: THREE.Group | null = null;
let heldOrderKey = '';
let playerVelocity = new THREE.Vector3();
let playerMoveTarget: THREE.Vector3 | null = null;
let playerTask: { kind: 'prepare' | 'serve'; guestId: number; itemIndex?: number } | null = null;
const PLAYER_START = new THREE.Vector3(-1.8, 0, -1.0);
let playerPath: THREE.Vector3[] = [];
const SIT_DROP = 0.0;
const movementKeys = new Set<string>();
const occupiedSeats = new Set<string>();
const stationMarkers: THREE.Mesh[] = [];
const tableCenters: THREE.Vector3[] = [];
const stations: Station[] = [
  { id: 'brew', label: 'Espresso machine', position: new THREE.Vector3(-0.675, 0, -1.6), kinds: ['drink'] },
  { id: 'tea', label: 'Tea kettle', position: new THREE.Vector3(-2.0, 0, -1.6), kinds: ['drink'] },
  { id: 'pastry', label: 'Pastry case', position: new THREE.Vector3(2.025, 0, -1.6), kinds: ['food'] },
];
let seatSpots: { key: string; position: THREE.Vector3; facing: number; table: THREE.Vector3 }[] = [];
let guestsInShift: Guest[] = [];
let selectedGuestId: number | null = null;
let selectedItemIndex = 0;
let nextGuestId = 1;
let shiftActive = false;
let shiftStart = 0;
let nextArrival = 0;
let arrivals = 0;
let dailyTarget = 4;
let shiftRevenue = 0;
let shiftTips = 0;
let shiftServed = 0;
let shiftLost = 0;
let dirtyTables = 0;
let shiftPause = false;
let speed = 1;
let lastUpdate = 0;
let simulatedTime = 0;
let autoCloseTimer = 0;
let currentPanel = '';
let soundEnabled = true;
let toastTimer = 0;
let lastUiDraw = 0;
let pendingReport: DailyReport | null = state.report;
let orderMarkupKey = '';
let ticketMarkupKey = '';

function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function flatTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b8895b'; g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 16; row++) {
    const y = row * 32;
    g.fillStyle = row % 2 ? '#c69869' : '#ae7d50'; g.fillRect(0, y, 512, 30);
    g.strokeStyle = 'rgba(65,40,25,.18)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y + 29); g.lineTo(512, y + 29); g.stroke();
    for (let x = (row % 2) * 72; x < 512; x += 140) { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 30); g.stroke(); }
  }
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(2, 1); return texture;
}
function signTexture(title: string, sub: string, width = 1024, height = 256, background = '#173a35') {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#e6c48b'; ctx.lineWidth = 10; ctx.strokeRect(14, 14, width - 28, height - 28);
  ctx.textAlign = 'center'; ctx.fillStyle = '#fff2d9'; ctx.font = '700 84px Georgia'; ctx.fillText(title, width / 2, height * 0.57);
  ctx.fillStyle = '#e7bd7e'; ctx.font = '500 34px sans-serif'; ctx.fillText(sub, width / 2, height * 0.82);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function textBoard(title: string, lines: string[], w = 512, h = 512) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#213b35'; ctx.fillRect(0, 0, w, h); ctx.strokeStyle = '#c5965c'; ctx.lineWidth = 18; ctx.strokeRect(8, 8, w - 16, h - 16);
  ctx.textAlign = 'center'; ctx.fillStyle = '#f7e8c8'; ctx.font = 'bold 38px Georgia'; ctx.fillText(title, w / 2, 74);
  ctx.textAlign = 'left'; ctx.font = '24px sans-serif';
  lines.forEach((line, i) => ctx.fillText(line, 38, 142 + i * 45));
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function addAsset(parent: THREE.Object3D, id: string, position: [number, number, number], height: number, options: { rotation?: number; tint?: string; scaleX?: number; footprint?: [number, number] } = {}) {
  const source = assets[id];
  if (!source) throw new Error(`Missing required café model: ${id}`);
  const model = source.clone(true);
  model.traverse(obj => { if ((obj as THREE.Mesh).isMesh) { const mesh = obj as THREE.Mesh; mesh.castShadow = true; mesh.receiveShadow = true; } });
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  const factor = height / Math.max(size.y, 0.001);
  model.scale.setScalar(factor);
  if (options.footprint) model.scale.set(factor * options.footprint[0] / Math.max(size.x * factor, 0.001), factor, factor * options.footprint[1] / Math.max(size.z * factor, 0.001));
  if (options.scaleX) model.scale.x *= options.scaleX;
  model.rotation.y = options.rotation || 0;
  model.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(model);
  const centre = scaled.getCenter(new THREE.Vector3());
  model.position.set(position[0] - centre.x, position[1] - scaled.min.y, position[2] - centre.z);
  if (options.tint) model.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const originalMaterial = mesh.material;
    const materialArray = Array.isArray(originalMaterial);
    const materials: THREE.Material[] = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
    const tinted = materials.map(material => {
      const copy = material.clone();
      if ('color' in copy && copy.color instanceof THREE.Color) copy.color.multiply(new THREE.Color(options.tint));
      return copy;
    });
    mesh.material = materialArray ? tinted : tinted[0];
  });
  parent.add(model);
  return model;
}
function addHuman(parent: THREE.Object3D, position: [number, number, number], modelIndex: number, facing = Math.PI): { root: THREE.Group; mixer: THREE.AnimationMixer | null } {
  const index = Math.abs(modelIndex) % peopleModels.length;
  const root = cloneSkinned(peopleModels[index]) as THREE.Group;
  root.traverse(obj => { if ((obj as THREE.Mesh).isMesh) { (obj as THREE.Mesh).castShadow = true; (obj as THREE.Mesh).receiveShadow = true; } });
  const bounds = new THREE.Box3().setFromObject(root);
  const factor = 1.62 / Math.max(bounds.getSize(new THREE.Vector3()).y, 0.001);
  root.scale.setScalar(factor);
  const scaledBounds = new THREE.Box3().setFromObject(root);
  root.position.set(position[0], position[1] - scaledBounds.min.y, position[2]);
  root.rotation.y = facing;
  root.userData.baseScale = factor;
  parent.add(root);
  const clips = peopleAnimations[index];
  const idleClip = clips.find(clip => /idle|stand|rest/i.test(clip.name)) ?? clips[0];
  const walkClip = clips.find(clip => /walk|run|move/i.test(clip.name));
  root.userData.idleClip = idleClip;
  root.userData.walkClip = walkClip;
  root.userData.sitClip = clips.find(clip => /sit|seated/i.test(clip.name));
  const mixer = clips.length ? new THREE.AnimationMixer(root) : null;
  if (mixer && idleClip) mixer.clipAction(idleClip).play();
  return { root, mixer };
}
function animatePerson(actor: CharacterActor, movement: 'idle' | 'walk' | 'sit') {
  if (!actor.mixer) return;
  const clip = (movement === 'sit' ? actor.root.userData.sitClip ?? actor.root.userData.idleClip : actor.root.userData[`${movement}Clip`]) as THREE.AnimationClip | undefined;
  if (!clip || actor.action?.getClip() === clip) return;
  actor.action?.fadeOut(0.16);
  actor.action = actor.mixer.clipAction(clip);
  actor.action.reset().fadeIn(0.16).play();
}
function material(color: string, roughness = 0.75, metalness = 0) { return new THREE.MeshStandardMaterial({ color, roughness, metalness }); }
function addLight(parent: THREE.Object3D, color: string, x: number, y: number, z: number, intensity = 1, radius = 3) {
  const light = new THREE.PointLight(color, intensity, radius, 2);
  light.position.set(x, y, z); parent.add(light); return light;
}
const BAR_X = [-3.375, -2.025, -0.675, 0.675, 2.025, 3.375];
const BAR_Z = -2.75;
const BAR_H = 1.0;
const BACK_H = 0.9;
const DOOR = new THREE.Vector3(-6.0, 0, 3.35);
const tableSlots: [number, number][] = [[-0.6, 0.5], [1.8, 0.5], [-0.6, 3.5], [1.8, 3.5], [-3.0, 0.5], [4.2, 0.5], [-3.0, 3.5], [4.2, 3.5]];
const sunroomSlots: [number, number][] = [[7.6, 0.5], [10.0, 0.5], [7.6, 3.5], [10.0, 3.5]];
const lobbySpots: [number, number][] = [[-5.2, 4.2], [-4.4, 4.25], [-5.2, 2.2], [-4.4, 2.25], [-5.2, 1.1], [-4.4, 1.15]];
type Obstacle = { x: number; z: number; r: number; seat?: string };
const obstacles: Obstacle[] = [];
const plantObstacles: Obstacle[] = [];
const steamPuffs: { sprite: THREE.Sprite; base: THREE.Vector3; offset: number; strength: number }[] = [];

function blockedAt(x: number, z: number, r = 0.28, ignoreSeat: string | null = null) {
  const maxX = sunroomUnlocked() ? 11.1 : 5.85;
  if (z < -2.0 || z > 4.7 || x > maxX) return true;
  if (x < -5.85 && (x < -6.7 || Math.abs(z - DOOR.z) > 0.6)) return true;
  if (Math.abs(x - 6.25) < 0.1 + r && !(sunroomUnlocked() && Math.abs(z) < 1.2)) return true;
  for (const list of [obstacles, plantObstacles]) {
    for (const o of list) {
      if (o.seat && o.seat === ignoreSeat) continue;
      if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + r) ** 2) return true;
    }
  }
  return false;
}
function clearLine(ax: number, az: number, bx: number, bz: number, r: number, ignoreSeat: string | null) {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.12);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (blockedAt(ax + (bx - ax) * t, az + (bz - az) * t, r, ignoreSeat)) return false;
  }
  return true;
}
const CELL = 0.25, GX0 = -7.0, GZ0 = -2.2, GW = 74, GH = 28;
function nearestOpen(x: number, z: number, r: number, ignoreSeat: string | null): [number, number] | null {
  const cx = clamp(Math.round((x - GX0) / CELL), 0, GW - 1), cz = clamp(Math.round((z - GZ0) / CELL), 0, GH - 1);
  let best: [number, number] | null = null; let bestD = Infinity;
  for (let dz = -8; dz <= 8; dz++) for (let dx = -8; dx <= 8; dx++) {
    const ix = cx + dx, iz = cz + dz;
    if (ix < 0 || iz < 0 || ix >= GW || iz >= GH) continue;
    const wx = GX0 + ix * CELL, wz = GZ0 + iz * CELL;
    const d = (wx - x) ** 2 + (wz - z) ** 2;
    if (d < bestD && !blockedAt(wx, wz, r, ignoreSeat)) { bestD = d; best = [ix, iz]; }
  }
  return best;
}
function findPath(from: THREE.Vector3, to: THREE.Vector3, ignoreSeat: string | null = null, r = 0.28): THREE.Vector3[] {
  const goalPoint = new THREE.Vector3(to.x, 0, to.z);
  if (clearLine(from.x, from.z, to.x, to.z, r, ignoreSeat)) return [goalPoint];
  const start = nearestOpen(from.x, from.z, r, ignoreSeat), goal = nearestOpen(to.x, to.z, r, ignoreSeat);
  if (!start || !goal) return [goalPoint];
  const key = (ix: number, iz: number) => iz * GW + ix;
  const open = new Map<number, boolean>();
  const isOpen = (ix: number, iz: number) => {
    if (ix < 0 || iz < 0 || ix >= GW || iz >= GH) return false;
    const k = key(ix, iz);
    let v = open.get(k);
    if (v === undefined) { v = !blockedAt(GX0 + ix * CELL, GZ0 + iz * CELL, r, ignoreSeat); open.set(k, v); }
    return v;
  };
  const g = new Map<number, number>(), parent = new Map<number, number>(), closed = new Set<number>();
  const heap: [number, number, number, number][] = [];
  const push = (item: [number, number, number, number]) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0]; const last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { let m = i; const l = 2 * i + 1, rr = l + 1; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (rr < heap.length && heap[rr][0] < heap[m][0]) m = rr; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const h = (ix: number, iz: number) => Math.hypot(ix - goal[0], iz - goal[1]);
  g.set(key(start[0], start[1]), 0); push([h(start[0], start[1]), 0, start[0], start[1]]);
  let found = false;
  while (heap.length) {
    const [, cost, ix, iz] = pop();
    const k = key(ix, iz);
    if (closed.has(k)) continue;
    closed.add(k);
    if (ix === goal[0] && iz === goal[1]) { found = true; break; }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = ix + dx, nz = iz + dz;
      if (!isOpen(nx, nz) || (dx && dz && (!isOpen(ix + dx, iz) || !isOpen(ix, iz + dz)))) continue;
      const nk = key(nx, nz), nc = cost + (dx && dz ? 1.414 : 1);
      if (nc < (g.get(nk) ?? Infinity)) { g.set(nk, nc); parent.set(nk, k); push([nc + h(nx, nz), nc, nx, nz]); }
    }
  }
  if (!found) return [goalPoint];
  const cells: THREE.Vector3[] = [];
  for (let k: number | undefined = key(goal[0], goal[1]); k !== undefined; k = parent.get(k)) cells.push(new THREE.Vector3(GX0 + (k % GW) * CELL, 0, GZ0 + Math.floor(k / GW) * CELL));
  cells.reverse();
  const points = [from.clone().setY(0), ...cells, goalPoint];
  const result: THREE.Vector3[] = [];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (next > anchor + 1 && !clearLine(points[anchor].x, points[anchor].z, points[next].x, points[next].z, r, ignoreSeat)) next--;
    result.push(points[next]); anchor = next;
  }
  return result;
}
function standNear(position: THREE.Vector3, outward: THREE.Vector3 | null, distance = 0.95): THREE.Vector3 {
  const base = outward && outward.lengthSq() > 0 ? Math.atan2(outward.x, outward.z) : Math.PI / 2;
  for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
    for (const d of [distance, distance + 0.35]) {
      const x = position.x + Math.sin(base + turn) * d, z = position.z + Math.cos(base + turn) * d;
      if (!blockedAt(x, z, 0.28)) return new THREE.Vector3(x, 0, z);
    }
  }
  return position.clone();
}

const textureCache = new Map<string, THREE.Texture>();
function cached(key: string, make: () => THREE.Texture) {
  let t = textureCache.get(key);
  if (!t) { t = make(); textureCache.set(key, t); }
  return t;
}
function woodTexture(base: string) {
  return cached('floor:' + base, () => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512;
    const g = c.getContext('2d')!;
    let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const color = new THREE.Color(base);
    for (let row = 0; row < 8; row++) {
      let x = -rand() * 220;
      while (x < 512) {
        const w = 150 + rand() * 170;
        const tint = color.clone().offsetHSL((rand() - 0.5) * 0.012, 0, (rand() - 0.5) * 0.07);
        g.fillStyle = '#' + tint.getHexString(); g.fillRect(x, row * 64, w, 64);
        g.strokeStyle = 'rgba(70,42,24,.22)'; g.lineWidth = 2; g.strokeRect(x, row * 64, w, 64);
        g.strokeStyle = 'rgba(255,240,210,.07)';
        for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(x + 6, row * 64 + 10 + i * 14 + rand() * 4); g.lineTo(x + w - 6, row * 64 + 12 + i * 14 + rand() * 6); g.stroke(); }
        x += w;
      }
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2.4); t.anisotropy = 4; return t;
  });
}
function wallTexture(base: string) {
  return cached('wall:' + base, () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 256;
    const g = c.getContext('2d')!;
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    const stripe = new THREE.Color(base).offsetHSL(0, 0, -0.035);
    g.fillStyle = '#' + stripe.getHexString();
    for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 32, 256);
    g.fillStyle = 'rgba(255,255,255,.06)';
    for (let i = 0; i < 700; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 2); return t;
  });
}
function paintingTexture(kind: number) {
  return cached('art:' + kind, () => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 320;
    const g = c.getContext('2d')!;
    const skies = ['#f3d9a8', '#cfe0d5', '#e8c2b4'];
    g.fillStyle = skies[kind % 3]; g.fillRect(0, 0, 256, 320);
    if (kind % 3 === 0) {
      g.fillStyle = '#e59a5c'; g.beginPath(); g.arc(128, 150, 62, 0, 7); g.fill();
      g.fillStyle = '#7e9c7f'; g.beginPath(); g.moveTo(0, 240); g.quadraticCurveTo(100, 170, 256, 250); g.lineTo(256, 320); g.lineTo(0, 320); g.fill();
      g.fillStyle = '#5b7b66'; g.beginPath(); g.moveTo(0, 280); g.quadraticCurveTo(150, 210, 256, 290); g.lineTo(256, 320); g.lineTo(0, 320); g.fill();
    } else if (kind % 3 === 1) {
      g.fillStyle = '#7c5a3f'; g.fillRect(118, 180, 20, 100);
      g.fillStyle = '#5f8f6b';
      for (const [x, y, r] of [[128, 150, 54], [92, 190, 40], [166, 190, 42]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
      g.fillStyle = '#c98f6c'; g.fillRect(70, 276, 116, 22);
    } else {
      g.fillStyle = '#fff3dc'; g.fillRect(70, 120, 116, 110);
      g.fillStyle = '#b9714d'; g.fillRect(70, 120, 116, 28);
      g.strokeStyle = '#7e4b34'; g.lineWidth = 8; g.beginPath(); g.arc(196, 176, 28, -1.5, 1.5); g.stroke();
      g.fillStyle = '#7e4b34'; g.fillRect(56, 232, 144, 14);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  });
}
function steamTexture() {
  return cached('steam', () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,.75)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  });
}
function addSteam(parent: THREE.Object3D, x: number, y: number, z: number, count = 4) {
  for (let i = 0; i < count; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTexture(), transparent: true, depthWrite: false, opacity: 0 }));
    sprite.scale.setScalar(0.22);
    parent.add(sprite);
    steamPuffs.push({ sprite, base: new THREE.Vector3(x, y, z), offset: i / count, strength: 1 });
  }
}
function signTextureStyled(title: string, sub: string, background: string) {
  return signTexture(title, sub, 1024, 256, background);
}
function createWindow(parent: THREE.Object3D, x: number, width: number) {
  const frame = material('#8a5c38', 0.55);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#ffe7b8', roughness: 0.14, transparent: true, opacity: 0.38, emissive: '#ffd79a', emissiveIntensity: 0.22 });
  box(parent, [width, 2.4, 0.06], [x, 3.05, -4.99], glass, false);
  box(parent, [0.1, 2.5, 0.2], [x - width / 2, 3.05, -4.93], frame);
  box(parent, [0.1, 2.5, 0.2], [x + width / 2, 3.05, -4.93], frame);
  box(parent, [width + 0.1, 0.12, 0.2], [x, 4.3, -4.93], frame);
  box(parent, [width + 0.3, 0.1, 0.34], [x, 1.8, -4.88], frame);
  const panes = Math.max(2, Math.round(width / 1.05));
  for (let i = 1; i < panes; i++) box(parent, [0.05, 2.4, 0.12], [x - width / 2 + (width / panes) * i, 3.05, -4.95], frame);
  box(parent, [width, 0.05, 0.12], [x, 3.05, -4.95], frame);
  // little sill planter so the ledge feels lived in
  const soil = material('#4d3727', 0.9);
  box(parent, [Math.min(width - 0.5, 1.5), 0.1, 0.16], [x, 1.9, -4.83], soil, false);
}
function wallMaterial() {
  return new THREE.MeshStandardMaterial({ map: wallTexture(palette('wall', state.custom.wall).color), roughness: 0.92 });
}
function buildRoom() {
  roomGroup.clear();
  steamPuffs.splice(0).forEach(p => p.sprite.removeFromParent());
  const custom = state.custom;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12.6, 10.2), new THREE.MeshStandardMaterial({ map: woodTexture(palette('floor', custom.floor).color), roughness: 0.78 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; roomGroup.add(floor);

  const wallMat = wallMaterial();
  const wainscot = material('#f3e7cf', 0.7);
  const trim = material('#8a5c38', 0.55);
  const wallColor = palette('wall', custom.wall).color;
  const lowerMat = material('#' + new THREE.Color(wallColor).offsetHSL(0, 0.04, -0.18).getHexString(), 0.8);
  const back = (x0: number, x1: number, y0: number, y1: number, mat: THREE.Material) => box(roomGroup, [x1 - x0, y1 - y0, 0.2], [(x0 + x1) / 2, (y0 + y1) / 2, -5.1], mat, false);
  back(-6.35, 6.35, 0, 1.8, lowerMat);
  back(-6.35, 6.35, 4.3, 5.3, wallMat);
  for (const [a, b] of [[-6.35, -5.475], [-1.225, 0.55], [3.65, 6.35]]) back(a, b, 1.8, 4.3, wallMat);
  box(roomGroup, [12.8, 0.1, 0.12], [0, 1.82, -4.98], wainscot);
  box(roomGroup, [12.8, 0.18, 0.28], [0, 5.3, -5.0], trim);
  box(roomGroup, [12.8, 0.14, 0.1], [0, 0.07, -4.98], wainscot);
  createWindow(roomGroup, -3.35, 4.25); createWindow(roomGroup, 2.1, 3.1);

  // left wall with a real front door opening
  box(roomGroup, [0.2, 5.3, 7.6], [-6.25, 2.65, -1.3], wallMat);
  box(roomGroup, [0.2, 5.3, 0.9], [-6.25, 2.65, 4.65], wallMat);
  box(roomGroup, [0.2, 3.0, 1.7], [-6.25, 3.8, 3.35], wallMat);
  box(roomGroup, [0.28, 2.3, 0.1], [-6.25, 1.15, 2.45], trim); box(roomGroup, [0.28, 2.3, 0.1], [-6.25, 1.15, 4.25], trim);
  box(roomGroup, [0.28, 0.12, 1.9], [-6.25, 2.34, 3.35], trim);
  const hours = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.26), new THREE.MeshBasicMaterial({ map: signTexture('OPEN', 'come on in', 256, 112, '#9a553d'), side: THREE.DoubleSide }));
  hours.position.set(-6.1, 2.7, 3.35); hours.rotation.y = Math.PI / 2; roomGroup.add(hours);
  box(roomGroup, [0.06, 0.55, 0.06], [-6.12, 2.52, 3.1], material('#6b4a33'), false);

  const outside = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 10.2), new THREE.MeshStandardMaterial({ color: '#b9a98f', roughness: 0.95 }));
  outside.rotation.x = -Math.PI / 2; outside.position.set(-8.05, 0, 0); outside.receiveShadow = true; roomGroup.add(outside);
  const exterior = new THREE.Group(); roomGroup.add(exterior);
  box(exterior, [38, 6, 0.3], [0, 3.6, -8.0], material('#e8d4ae'), false);
  box(exterior, [42, 0.2, 14], [0, -0.14, -11], material('#bba98a'), false);
  const hues = ['#d9b58f', '#b3c2a4', '#e3c2b2', '#c8b79a', '#a9bfb9', '#dfc27f', '#c99d83'];
  for (let i = 0; i < 8; i++) {
    const block = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.4 + (i % 3) * 0.6, 0.35), material(hues[i % hues.length]));
    block.position.set(-14 + i * 4.1, 1.2, -13.4); block.castShadow = true; exterior.add(block);
    for (let j = 0; j < 4; j++) box(exterior, [0.2, 0.28, 0.05], [-14.4 + i * 4.1 + (j % 2) * 0.68, 0.7 + Math.floor(j / 2) * 0.9, -13.17], material('#ffd68a', 0.35, 0.1), false);
  }

  // signs
  const signBoard = box(roomGroup, [3.6, 0.8, 0.07], [-0.4, 4.78, -4.9], material('#5e402b'));
  signBoard.castShadow = false;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.45, 0.68), new THREE.MeshBasicMaterial({ map: signTextureStyled(state.name.toUpperCase().slice(0, 16), 'COFFEE · TEA · SWEETS', palette('sign', custom.sign).color) }));
  sign.position.set(-0.4, 4.78, -4.86); roomGroup.add(sign);
  box(roomGroup, [1.6, 2.05, 0.08], [5.0, 3.1, -4.93], material('#6b4a33'));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.85), new THREE.MeshBasicMaterial({ map: textBoard('TODAY', ['House coffee  $5', 'Garden tea  $4', 'Fresh pastry  $5', 'Made with care ♡']) }));
  board.position.set(5.0, 3.1, -4.88); roomGroup.add(board);

  buildCounter();
  buildBackKitchen();
  addLight(roomGroup, '#ffd9a0', -2.5, 4.3, -2.2, 9, 8);
  addLight(roomGroup, '#ffd9a0', 2.5, 4.3, -2.2, 8, 7);
  addLight(roomGroup, '#ffe2b8', -3.8, 3.4, 3.2, 5, 7);
  roomGroup.add(new THREE.AmbientLight('#ffeed2', 0.22));
  refreshSideWall();
  refreshTables();
  refreshDecor();
  refreshExpansion();
  refreshWorkers();
  buildStationMarkers();
}
function buildCounter() {
  const tint = palette('counter', state.custom.counter).color;
  BAR_X.forEach(x => addAsset(roomGroup, 'bar', [x, 0, BAR_Z], BAR_H, { footprint: [1.35, 0.62], tint }));
  // brass foot rail and kick plate sit on the floor
  box(roomGroup, [8.1, 0.12, 0.05], [0, 0.06, BAR_Z + 0.33], material('#6b4a33'), false);
  const steel = material('#d8d9d0', 0.27, 0.6);
  const top = BAR_H;

  // tea kettle on the first tea bar
  const kettle = new THREE.Group(); kettle.position.set(-2.0, top, BAR_Z);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.3, 24), steel); body.position.y = 0.15; kettle.add(body);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 10), material('#e9e5d6', 0.24, 0.5)); lid.scale.y = 0.4; lid.position.y = 0.3; kettle.add(lid);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), material('#41312a')); knob.position.y = 0.34; kettle.add(knob);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 8, 18, Math.PI), material('#41312a', 0.4)); handle.position.y = 0.3; kettle.add(handle);
  const spout = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 12), steel); spout.position.set(0.2, 0.22, 0); spout.rotation.z = -Math.PI / 2 - 0.35; kettle.add(spout);
  const burner = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.03, 24), material('#3a3430', 0.7)); burner.position.y = 0.015; kettle.add(burner);
  kettle.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  roomGroup.add(kettle);
  addSteam(roomGroup, -1.78, top + 0.38, BAR_Z, 4);
  addAsset(roomGroup, 'saucer', [-2.6, top, BAR_Z + 0.05], 0.03, { footprint: [0.2, 0.2] });
  addAsset(roomGroup, 'teaCup', [-2.6, top + 0.03, BAR_Z + 0.05], 0.12);
  addAsset(roomGroup, 'honey', [-3.0, top, BAR_Z - 0.05], 0.16);
  addAsset(roomGroup, 'plate', [-3.5, top, BAR_Z + 0.03], 0.025, { footprint: [0.42, 0.42] });
  addAsset(roomGroup, 'pie', [-3.5, top + 0.025, BAR_Z + 0.03], 0.11);

  // espresso machine and cups
  addAsset(roomGroup, 'coffeeMachine', [-0.675, top, BAR_Z - 0.02], 0.5);
  addSteam(roomGroup, -0.55, top + 0.58, BAR_Z + 0.08, 3);
  [-1.15, -1.05].forEach((x, i) => addAsset(roomGroup, 'coffeeCup', [x, top, BAR_Z + 0.1 - i * 0.05], 0.12, { rotation: i }));
  if (upLevel('machine') >= 2) addAsset(roomGroup, 'coffeeMachine', [0.1, top, BAR_Z - 0.02], 0.5, { rotation: 0, tint: '#ffe9cf' });
  if (upLevel('machine') >= 3) addAsset(roomGroup, 'blender', [0.45, top, BAR_Z - 0.02], 0.3);
  [0.7, 0.88, 1.06].forEach((x, i) => addAsset(roomGroup, 'mug', [x, top, BAR_Z + 0.12 - (i % 2) * 0.1], 0.1, { rotation: i * 1.3 }));
  addAsset(roomGroup, 'plant2', [1.2, top, BAR_Z - 0.1], 0.26);
  if (decorOn('radio')) { addAsset(roomGroup, 'radio', [0.75, top, BAR_Z - 0.18], 0.2); addAsset(roomGroup, 'speaker', [1.15, top, BAR_Z - 0.15], 0.22); }

  // pastry case: base slab, glass and posts all rest on the counter top
  const caseX = 2.025;
  box(roomGroup, [1.2, 0.04, 0.5], [caseX, top + 0.02, BAR_Z], material('#8a5c38', 0.6));
  const glass = new THREE.MeshPhysicalMaterial({ color: '#fdf0d8', roughness: 0.1, transparent: true, opacity: 0.26, transmission: 0.2, side: THREE.DoubleSide });
  box(roomGroup, [1.2, 0.42, 0.5], [caseX, top + 0.25, BAR_Z], glass, false);
  const frame = material('#8a5c38', 0.55);
  for (const dx of [-0.6, 0.6]) for (const dz of [-0.25, 0.25]) box(roomGroup, [0.04, 0.44, 0.04], [caseX + dx, top + 0.26, BAR_Z + dz], frame);
  box(roomGroup, [1.24, 0.04, 0.54], [caseX, top + 0.48, BAR_Z], frame);
  const baseY = top + 0.04;
  addAsset(roomGroup, 'croissant', [caseX - 0.45, baseY, BAR_Z + 0.02], 0.1);
  addAsset(roomGroup, 'muffin', [caseX - 0.2, baseY, BAR_Z - 0.04], 0.12);
  addAsset(roomGroup, 'cookie', [caseX + 0.03, baseY, BAR_Z + 0.06], 0.04);
  addAsset(roomGroup, 'donut', [caseX + 0.25, baseY, BAR_Z - 0.02], 0.07);
  addAsset(roomGroup, 'cupcake', [caseX + 0.47, baseY, BAR_Z + 0.04], 0.13);
  if (upLevel('oven') >= 2) addAsset(roomGroup, 'cake', [caseX + 0.0, baseY, BAR_Z - 0.12], 0.12);
  const chalk = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.26), new THREE.MeshBasicMaterial({ map: signTexture('FRESH BAKED', 'from our little oven', 512, 160, '#8a5541') }));
  chalk.position.set(caseX, top + 0.64, BAR_Z + 0.02);
  const post = box(roomGroup, [0.03, 0.14, 0.03], [caseX, top + 0.57, BAR_Z + 0.02], material('#6b4a33'), false); post.castShadow = false;
  roomGroup.add(chalk);

  // far end: cake stand, bread and the mascot
  addAsset(roomGroup, 'plate', [3.1, top, BAR_Z], 0.03, { footprint: [0.4, 0.4] });
  addAsset(roomGroup, 'cake', [3.1, top + 0.03, BAR_Z], 0.14);
  addAsset(roomGroup, 'bread', [3.55, top, BAR_Z + 0.05], 0.12, { rotation: 0.4 });
  if (decorOn('bear')) addAsset(roomGroup, 'bear', [3.82, top, BAR_Z - 0.1], 0.36, { rotation: -0.25 });
}
function buildUpgradeExtras(z: number) {
  const wood = material('#6b4a33'); const gold = new THREE.MeshStandardMaterial({ color: '#e0b04a', metalness: 0.6, roughness: 0.3 });
  const grinder = upLevel('grinder');
  if (grinder >= 1) {
    box(roomGroup, [0.24, 0.34, 0.24], [-2.9, BACK_H + 0.17, z], material('#3b3029', 0.5));
    box(roomGroup, [0.2, 0.18, 0.2], [-2.9, BACK_H + 0.43, z], material('#a9d2d8', 0.2), false);
  }
  if (grinder >= 2) { box(roomGroup, [0.2, 0.3, 0.2], [-2.5, BACK_H + 0.15, z], material('#7a5a3c', 0.5)); }
  if (grinder >= 3) { addAsset(roomGroup, 'coffeeMachine', [-2.05, BACK_H, z], 0.45); addSteam(roomGroup, -2.05, BACK_H + 0.5, z, 2); }
  const specials = upLevel('specials');
  if (specials >= 1) {
    box(roomGroup, [1.02, 0.7, 0.05], [-4.35, 3.1, -4.95], wood);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.58), new THREE.MeshBasicMaterial({ map: signTexture("TODAY'S SPECIALS", specials >= 3 ? 'chef’s tasting card' : specials >= 2 ? 'seasonal menu' : 'ask us!', 512, 330, '#2d4a3f') }));
    board.position.set(-4.35, 3.1, -4.92); roomGroup.add(board);
  }
  const loyalty = upLevel('loyalty');
  if (loyalty >= 1) {
    for (let i = 0; i < loyalty * 2; i++) box(roomGroup, [0.12, 0.17, 0.015], [3.0 + i * 0.09, BAR_TOP_Y() + 0.1, BAR_Z + 0.35], material(['#d9776a', '#f0c27b', '#8fb08a'][i % 3]), false);
    box(roomGroup, [0.58, 0.03, 0.12], [3.25, BAR_TOP_Y() + 0.015, BAR_Z + 0.35], wood, false);
  }
  const music = upLevel('music');
  if (music >= 1) {
    addAsset(roomGroup, 'radio', [-3.45, BAR_TOP_Y(), BAR_Z], 0.28, { rotation: 0.1 });
    if (music >= 2) { addAsset(roomGroup, 'speaker', [-3.95, BAR_TOP_Y(), BAR_Z], 0.4); addAsset(roomGroup, 'speaker', [-2.95, BAR_TOP_Y(), BAR_Z], 0.4); }
  }
  const wifi = upLevel('wifi');
  if (wifi >= 1) {
    box(roomGroup, [0.3, 0.06, 0.2], [4.8, BACK_H + 1.2, -4.9], material('#2b2b30'));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), new THREE.MeshBasicMaterial({ color: '#7be08a' })); led.position.set(4.7, BACK_H + 1.2, -4.8); roomGroup.add(led);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2), new THREE.MeshBasicMaterial({ map: signTexture('FREE WI-FI', wifi >= 2 ? 'co-working welcome' : 'ask for the code', 256, 100, '#3d5a6b') }));
    sign.position.set(4.8, BACK_H + 1.45, -4.95); roomGroup.add(sign);
  }
  const windows = upLevel('windows');
  if (windows >= 1) {
    const colors = ['#e58fa0', '#f2c94c', '#f08a5d', '#b693e0'];
    const xs = windows >= 2 ? [-2.3, -0.8, 0.8, 2.3] : [-1.5, 1.5];
    xs.forEach((x, i) => {
      box(roomGroup, [0.9, 0.2, 0.22], [x, 1.55, -4.8], wood);
      for (let k = 0; k < 5; k++) {
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshStandardMaterial({ color: colors[(i + k) % colors.length], roughness: 0.7 }));
        bloom.position.set(x - 0.34 + k * 0.17, 1.72, -4.8); bloom.castShadow = false; roomGroup.add(bloom);
      }
    });
  }
  const awards = upLevel('awards');
  if (awards >= 1) {
    box(roomGroup, [1.1, 0.05, 0.22], [1.8, 3.0, -4.88], wood);
    for (let i = 0; i < awards * 2; i++) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.035, 0.14, 12), gold); cup.position.set(1.4 + i * 0.25, 3.1, -4.88); roomGroup.add(cup);
    }
  }
  const training = upLevel('training');
  if (training >= 1) {
    for (let i = 0; i < training; i++) {
      box(roomGroup, [0.34, 0.26, 0.03], [-1.0 + i * 0.44, 3.35, -4.95], wood);
      const cert = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.2), new THREE.MeshBasicMaterial({ color: '#f7ecd4' })); cert.position.set(-1.0 + i * 0.44, 3.35, -4.92); roomGroup.add(cert);
    }
  }
  const delivery = upLevel('delivery');
  if (delivery >= 1) {
    box(roomGroup, [0.5, 0.35, 0.4], [-5.7, 0.175, 4.45], material('#c9604f', 0.8));
    if (delivery >= 2) box(roomGroup, [0.5, 0.3, 0.4], [-5.7, 0.5, 4.45], material('#e0a24d', 0.8));
  }
}
const BAR_TOP_Y = () => BAR_H;
function buildBackKitchen() {
  const tint = palette('counter', state.custom.counter).color;
  const z = -4.45;
  for (let i = 0; i < 10; i++) {
    const x = -4.5 + i * 0.9;
    addAsset(roomGroup, i === 4 ? 'sink' : i % 3 === 1 ? 'cabinetDrawer' : 'cabinet', [x, 0, z], BACK_H, { footprint: [0.9, 0.8], tint, rotation: 0 });
  }
  addAsset(roomGroup, 'fridge', [4.5, 0, z], 1.95, { footprint: [0.95, 0.85] });
  addAsset(roomGroup, 'toaster', [-3.9, BACK_H, z], 0.2);
  addAsset(roomGroup, 'blender', [-4.45, BACK_H, z], 0.3);
  [-1.3, -1.1].forEach(x => addAsset(roomGroup, 'mug', [x, BACK_H, z + 0.05], 0.1));
  addAsset(roomGroup, 'plant3', [3.4, BACK_H, z - 0.1], 0.3);
  addAsset(roomGroup, 'books', [2.6, BACK_H, z], 0.12);
  if (upLevel('oven') >= 1) {
    addAsset(roomGroup, 'microwave', [0.45, BACK_H, z], 0.4, { footprint: [0.58, 0.42] });
    if (upLevel('oven') >= 2) {
      addLight(roomGroup, '#ffb36a', 0.45, 1.5, -3.8, 5, 4);
      addSteam(roomGroup, 0.45, BACK_H + 0.45, z, 3);
    }
  }
  buildUpgradeExtras(z);
  if (upLevel('storage') >= 1) {
    const crate = material('#b88a5a', 0.85);
    box(roomGroup, [0.6, 0.45, 0.5], [5.55, 0.225, -4.5], crate); box(roomGroup, [0.6, 0.45, 0.5], [5.55, 0.675, -4.5], material('#c79a66', 0.85));
    box(roomGroup, [0.5, 0.4, 0.45], [5.5, 1.1, -4.5], crate);
  }
  if (upLevel('storage') >= 2) addAsset(roomGroup, 'fridge', [5.65, 0, -3.5], 1.95, { footprint: [0.8, 0.85], rotation: -Math.PI / 2 });
  // coffee-sack stack along the wall
  const sack = material('#c4a67a', 0.95);
  const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.5, 14), sack); bag.position.set(-5.5, 0.25, -4.4); bag.castShadow = true; roomGroup.add(bag);
  const bag2 = bag.clone(); bag2.position.set(-5.5, 0.25, -3.9); roomGroup.add(bag2);
}
function refreshTables() {
  tableGroup.clear();
  tableCenters.length = 0; obstacles.length = 0; seatSpots = [];
  const slots = [...tableSlots.slice(0, 2 + upLevel('seating') * 2), ...(sunroomUnlocked() ? sunroomSlots : [])];
  const chairTint = palette('chairs', state.custom.chairs).color;
  slots.forEach(([x, z], i) => {
    const center = new THREE.Vector3(x, 0, z);
    tableCenters.push(center);
    obstacles.push({ x, z, r: 0.62 });
    addAsset(tableGroup, 'table', [x, 0, z], 0.78, { footprint: [1.1, 1.1], tint: i % 2 ? '#e8c394' : '#f1d3a8' });
    [-1, 1].forEach((side, j) => {
      const cz = z + side * 0.78;
      addAsset(tableGroup, 'chair', [x, 0, cz], 0.9, { footprint: [0.44, 0.44], rotation: side < 0 ? 0 : Math.PI, tint: chairTint });
      obstacles.push({ x, z: cz, r: 0.26, seat: `${i}:${j}` });
      seatSpots.push({ key: `${i}:${j}`, position: new THREE.Vector3(x, 0, cz), facing: side < 0 ? 0 : Math.PI, table: center });
    });
    if (upLevel('ambience') > 0) addAsset(tableGroup, i % 2 ? 'teaCup' : 'coffeeCup', [x - 0.22, 0.78, z + 0.1], 0.1, { rotation: i * 0.9 });
    if (decorOn('flowers')) addAsset(tableGroup, i % 2 ? 'plant2' : 'plant3', [x + 0.2, 0.78, z - 0.08], 0.2, { rotation: i });
    if (upLevel('ambience') >= 3) addAsset(tableGroup, 'saucer', [x + 0.24, 0.78, z + 0.18], 0.025, { footprint: [0.18, 0.18] });
  });
}
function seatOrWaitSpot(): { target: THREE.Vector3; seatKey: string | null; seated: boolean; facing: number } {
  const seat = seatSpots.find(spot => !occupiedSeats.has(spot.key));
  if (seat) {
    occupiedSeats.add(seat.key);
    return { target: seat.position.clone(), seatKey: seat.key, seated: true, facing: seat.facing };
  }
  const taken = new Set([...guestActors.values()].filter(a => !a.seated && !a.exiting).map(a => `${a.target.x.toFixed(2)},${a.target.z.toFixed(2)}`));
  const spot = lobbySpots.find(([x, z]) => !taken.has(`${x.toFixed(2)},${z.toFixed(2)}`)) ?? lobbySpots[taken.size % lobbySpots.length];
  return { target: new THREE.Vector3(spot[0], 0, spot[1]), seatKey: null, seated: false, facing: Math.PI / 2 };
}
function buildStationMarkers() {
  stationMarkerGroup.clear();
  stationMarkers.length = 0;
  for (const station of stations) {
    const marker = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 8, 36),
      new THREE.MeshStandardMaterial({ color: '#d8ad70', emissive: '#8c5b2d', emissiveIntensity: 0.22, transparent: true, opacity: 0.74 })
    );
    marker.rotation.x = Math.PI / 2;
    marker.position.copy(station.position).setY(0.035);
    marker.userData.stationId = station.id;
    stationMarkerGroup.add(marker);
    stationMarkers.push(marker);
  }
}
function stationForRecipe(recipe: Recipe) {
  if (recipe.station.toLowerCase().includes('tea')) return stations.find(station => station.id === 'tea')!;
  if (recipe.kind === 'food') return stations.find(station => station.id === 'pastry')!;
  return stations.find(station => station.id === 'brew')!;
}
function playerPosition() { return playerActor?.root.position ?? PLAYER_START; }
function movePlayerTo(target: THREE.Vector3, task: NonNullable<typeof playerTask>) {
  if (!playerActor || !shiftActive) return;
  selectedGuestId = task.guestId;
  playerTask = task;
  playerMoveTarget = target.clone();
  playerPath = findPath(playerPosition(), target);
  movementKeys.clear();
  updateUI();
}
function goToStation(guestId: number, itemIndex: number) {
  const item = getOrder(guestId)?.items[itemIndex];
  if (!item || item.state !== 'waiting') return;
  const station = stationForRecipe(recipeById(item.recipeId));
  movePlayerTo(station.position, { kind: 'prepare', guestId, itemIndex });
  toast(`Head to the ${station.label.toLowerCase()} and press E when the ring glows.`, 'good');
}
function goToGuest(guestId: number) {
  const guest = getOrder(guestId);
  const actor = guestActors.get(guestId);
  if (!guest || !actor || !selectedReady(guest)) return;
  const seat = seatSpots.find(spot => spot.key === actor.seatKey);
  const outward = seat ? actor.target.clone().sub(seat.table) : playerPosition().clone().sub(actor.root.position);
  movePlayerTo(standNear(actor.target, outward, 0.95), { kind: 'serve', guestId });
  toast(`Bring the finished order to ${guest.name} and press E nearby.`, 'good');
}
type NearbyInteraction = { kind: 'prepare'; station: Station; guest: Guest; itemIndex: number; distance: number } | { kind: 'serve'; guest: Guest; distance: number };
function nearbyInteraction(): NearbyInteraction | null {
  if (!playerActor || !shiftActive || shiftPause) return null;
  const position = playerPosition();
  const guestId = playerTask?.guestId ?? selectedGuestId;
  const guest = getOrder(guestId);
  const actor = guest ? guestActors.get(guest.id) : undefined;
  if (guest && actor && selectedReady(guest)) {
    const distance = position.distanceTo(actor.root.position);
    if (distance <= 1.5) return { kind: 'serve', guest, distance };
  }
  if (guest) {
    const preferredIndex = playerTask?.kind === 'prepare' && playerTask.guestId === guest.id ? playerTask.itemIndex : undefined;
    const items = preferredIndex === undefined ? guest.items.map((item, index) => ({ item, index })) : [{ item: guest.items[preferredIndex], index: preferredIndex }];
    for (const { item, index } of items) {
      if (!item || item.state !== 'waiting') continue;
      const station = stationForRecipe(recipeById(item.recipeId));
      const distance = position.distanceTo(station.position);
      if (distance <= 1.42) return { kind: 'prepare', station, guest, itemIndex: index, distance };
    }
  }
  return null;
}
function interact() {
  const interaction = nearbyInteraction();
  if (interaction?.kind === 'prepare') {
    prepareOrder(interaction.guest.id, interaction.itemIndex);
    playerTask = null; playerMoveTarget = null;
    return;
  }
  if (interaction?.kind === 'serve') {
    serveOrder(interaction.guest.id);
    playerTask = null; playerMoveTarget = null;
    return;
  }
  const destination = playerTask?.kind === 'prepare'
    ? stationForRecipe(recipeById(getOrder(playerTask.guestId)?.items[playerTask.itemIndex ?? -1]?.recipeId ?? 'coffee')).label
    : playerTask?.kind === 'serve' ? getOrder(playerTask.guestId)?.name : null;
  toast(destination ? `Walk closer to ${destination}.` : 'Move near a glowing station or a guest with a finished order, then press E.', 'warning');
}
function updateInteractionPrompt() {
  const prompt = $('interaction-prompt');
  const nearby = nearbyInteraction();
  const target = playerMoveTarget;
  if (!shiftActive) {
    prompt.classList.remove('visible');
    return;
  }
  if (shiftPause) {
    prompt.textContent = 'Shift paused · resume to move';
  } else if (nearby?.kind === 'prepare') {
    const name = recipeById(nearby.guest.items[nearby.itemIndex].recipeId).name;
    prompt.textContent = `E · ${nearby.station.label} — prepare ${name}`;
  } else if (nearby?.kind === 'serve') {
    prompt.textContent = `E · Deliver the order to ${nearby.guest.name}`;
  } else if (target) {
    prompt.textContent = playerTask?.kind === 'serve'
      ? `Walking to ${getOrder(playerTask.guestId)?.name ?? 'your guest'}…`
      : `Walking to the ${stations.find(station => station.position.equals(target))?.label ?? 'station'}…`;
  } else {
    prompt.textContent = 'WASD / arrows to move · E to interact';
  }
  prompt.classList.add('visible');
  stationMarkers.forEach(marker => {
    const station = stations.find(entry => entry.id === marker.userData.stationId);
    if (!station) return;
    const active = playerPosition().distanceTo(station.position) < 1.42;
    const markerMaterial = marker.material as THREE.MeshStandardMaterial;
    markerMaterial.color.set(active ? '#91bd87' : '#d8ad70');
    markerMaterial.emissiveIntensity = active ? 0.75 : 0.22;
    marker.scale.setScalar(active ? 1.2 : 1);
  });
}
function refreshDecor() {
  decorGroup.clear();
  plantObstacles.length = 0;
  const pot = (id: string, x: number, z: number, h: number) => { addAsset(decorGroup, id, [x, 0, z], h); plantObstacles.push({ x, z, r: 0.3 }); };
  pot('plant', -5.65, -1.55, 1.15);
  pot('smallPlant', 5.6, -1.6, 0.8);
  const level = upLevel('ambience');
  const beam = (z: number) => {
    box(decorGroup, [12.6, 0.2, 0.22], [0, 5.12, z], material('#7a5233', 0.7));
  };
  if (level >= 1) {
    pot('plant', -5.65, 4.3, 1.05);
    pot('plant', 5.55, 4.4, 1.1);
    beam(-0.9);
    for (const x of [-3.0, 1.2]) {
      box(decorGroup, [0.02, 0.9, 0.02], [x, 4.62, -0.9], material('#3a2d26'), false);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.36, 0.3, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#f0c27b', roughness: 0.4, emissive: '#ffb255', emissiveIntensity: 0.55, side: THREE.DoubleSide }));
      shade.position.set(x, 4.02, -0.9); shade.castShadow = false; decorGroup.add(shade);
      addLight(decorGroup, '#ffc983', x, 3.7, -0.9, 14, 6);
    }
  }
  if (level >= 2) {
    addAsset(decorGroup, 'floorLamp', [-5.85, 0, 0.0], 1.6); plantObstacles.push({ x: -5.85, z: 0, r: 0.2 });
    addLight(decorGroup, '#ffcf8c', -5.6, 1.7, 0, 5, 4);
    addAsset(decorGroup, 'floorLamp', [5.75, 0, 1.9], 1.6); plantObstacles.push({ x: 5.75, z: 1.9, r: 0.2 });
    addLight(decorGroup, '#ffcf8c', 5.5, 1.7, 1.9, 5, 4);
  }
  if (level >= 3) {
    for (const x of [-4.8, 4.2]) {
      box(decorGroup, [0.02, 0.9, 0.02], [x, 4.62, -0.9], material('#3a2d26'), false);
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.3, 0.26, 20, 1, true), new THREE.MeshStandardMaterial({ color: '#e9a977', roughness: 0.4, emissive: '#ff9d58', emissiveIntensity: 0.5, side: THREE.DoubleSide }));
      shade.position.set(x, 4.05, -0.9); decorGroup.add(shade);
    }
  }
  if (decorOn('coatrack')) { addAsset(decorGroup, 'coatRack', [-5.75, 0, 2.1], 1.7); plantObstacles.push({ x: -5.75, z: 2.1, r: 0.25 }); }
  if (decorOn('bunting')) {
    const colors = ['#d9776a', '#f0c27b', '#8fb08a', '#7fa6b8', '#c98fb0'];
    const n = 22;
    for (let i = 0; i <= n; i++) {
      const t = i / n; const x = -5.6 + t * 11.2;
      const y = 4.75 - Math.sin(t * Math.PI) * 0.35;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 3), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.8 }));
      flag.rotation.set(Math.PI, 0, 0); flag.position.set(x, y - 0.12, 2.3); flag.castShadow = false; decorGroup.add(flag);
    }
    const line = box(decorGroup, [11.2, 0.012, 0.012], [0, 4.62, 2.3], material('#5a4636'), false); line.castShadow = false;
  }
  if (decorOn('neon')) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.4), new THREE.MeshBasicMaterial({ map: signTexture('FRESH COFFEE', 'open late', 512, 140, '#7a2f3a') }));
    sign.position.set(4.3, 3.5, -4.93); decorGroup.add(sign);
    addLight(decorGroup, '#ff9a8a', 4.3, 3.4, -4.4, 6, 4);
  }
  if (decorOn('lounge')) {
    addAsset(decorGroup, 'loungeSofa', [-5.45, 0, 0.95], 0.85, { footprint: [0.95, 1.9], rotation: Math.PI / 2 });
    plantObstacles.push({ x: -5.45, z: 0.55, r: 0.45 }, { x: -5.45, z: 1.35, r: 0.45 });
    addAsset(decorGroup, 'sideTable', [-5.55, 0, 2.0], 0.5); plantObstacles.push({ x: -5.55, z: 2.0, r: 0.25 });
    addAsset(decorGroup, 'lamp', [-5.55, 0.5, 2.0], 0.3);
    addAsset(decorGroup, 'pillow', [-5.55, 0.45, 0.6], 0.2, { rotation: 0.5 });
  }
  if (decorOn('records')) {
    addAsset(decorGroup, 'cabinetTv', [5.7, 0, -0.5], 0.6, { footprint: [0.5, 1.2], rotation: -Math.PI / 2 }); plantObstacles.push({ x: 5.7, z: -0.5, r: 0.5 });
    addAsset(decorGroup, 'speaker', [5.7, 0.6, -0.95], 0.4); addAsset(decorGroup, 'speaker', [5.7, 0.6, -0.05], 0.4);
  }
  if (decorOn('garden')) {
    [[-4.2, 4.5, 'plant3', 0.7], [-3.6, 4.55, 'plant2', 0.5], [-4.7, 4.55, 'smallPlant', 0.6], [4.6, 4.5, 'plant', 1.0]].forEach(([x, z, id, h]) => addAsset(decorGroup, id as string, [x as number, 0, z as number], h as number));
    plantObstacles.push({ x: -4.2, z: 4.5, r: 0.5 }, { x: 4.6, z: 4.5, r: 0.3 });
  }
  if (decorOn('rug')) {
    addAsset(decorGroup, 'rugRect', [-5.0, 0, 3.35], 0.012, { footprint: [2.3, 1.15], rotation: Math.PI / 2 * 0, tint: '#e6b48d' });
    addAsset(decorGroup, 'doormat', [-5.95, 0, 3.35], 0.015, { footprint: [0.85, 0.95], rotation: Math.PI / 2 });
  }
  if (decorOn('books')) {
    for (const z of [2.95, 4.05]) {
      addAsset(decorGroup, 'bookcase', [5.9, 0, z], 1.9, { footprint: [1.05, 0.4], rotation: -Math.PI / 2 });
    }
    addAsset(decorGroup, 'books', [5.9, 1.9, 2.95], 0.16, { rotation: 1.2 });
    addAsset(decorGroup, 'plant2', [5.9, 1.9, 4.1], 0.3);
  }
  if (decorOn('art')) {
    [[-0.8, 3.1, 0], [-0.05, 3.1, 1], [6.0, 3.3, 2]].forEach(([x, y, k], i) => {
      if (i === 2) return;
      const w = 0.62, h = 0.8;
      box(decorGroup, [w + 0.12, h + 0.12, 0.05], [x, y, -4.96], material('#6b4a33'));
      const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: paintingTexture(k) }));
      art.position.set(x, y, -4.93); decorGroup.add(art);
    });
  }
  if (decorOn('lights')) {
    const bulbMat = new THREE.MeshStandardMaterial({ color: '#fff2cf', emissive: '#ffc66d', emissiveIntensity: 1.6 });
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24; points.push(new THREE.Vector3(-6.0 + t * 12, 4.9 - Math.sin(t * Math.PI) * 0.55 + (i % 2) * 0.0, -4.82)); }
    const cord = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, 0.012, 5), material('#2f2823'));
    decorGroup.add(cord);
    points.forEach((p, i) => { if (i % 2 === 0) { const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), bulbMat); bulb.position.copy(p).add(new THREE.Vector3(0, -0.07, 0)); decorGroup.add(bulb); } });
    for (const x of [-6.0, 6.0]) box(decorGroup, [0.06, 0.06, 0.08], [x, 4.9, -4.9], material('#3a2d26'), false);
    addLight(decorGroup, '#ffcf8c', 0, 4.4, -4.2, 6, 7);
  }
  if (decorOn('hangers')) {
    beam(-0.9);
    [[-1.0, 1.2], [3.0, 0.8], [-4.2, 1.0]].forEach(([x, len]) => {
      box(decorGroup, [0.02, len, 0.02], [x, 5.02 - len / 2, -0.9], material('#3a2d26'), false);
      addAsset(decorGroup, 'plant3', [x, 5.02 - len - 0.3, -0.9], 0.3);
    });
  }
}
function refreshExpansion() {
  const old = roomGroup.getObjectByName('sunroom');
  if (old) { roomGroup.remove(old); old.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); if (Array.isArray(o.material)) o.material.forEach(m => m.dispose()); else o.material.dispose(); } }); }
  if (!sunroomUnlocked()) { refreshSideWall(); setCamera(); return; }
  const wing = new THREE.Group(); wing.name = 'sunroom';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 10.2), new THREE.MeshStandardMaterial({ map: woodTexture(palette('floor', state.custom.floor).color), roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(8.9, 0, 0); floor.receiveShadow = true; wing.add(floor);
  const wallMat = wallMaterial();
  box(wing, [0.2, 5.3, 10.2], [11.55, 2.65, 0], wallMat);
  box(wing, [5.4, 1.2, 0.2], [8.9, 0.6, -5.1], material('#' + new THREE.Color(palette('wall', state.custom.wall).color).offsetHSL(0, 0.04, -0.18).getHexString(), 0.8), false);
  box(wing, [5.4, 0.18, 0.28], [8.9, 5.3, -5.0], material('#8a5c38', 0.55));
  createWingWindows(wing);
  addAsset(wing, 'bench', [8.9, 0, -4.45], 0.55, { footprint: [2.4, 0.6] });
  addAsset(wing, 'pillow', [8.2, 0.42, -4.5], 0.2, { rotation: 0.4 });
  addAsset(wing, 'pillow', [9.6, 0.42, -4.5], 0.2, { rotation: -0.3 });
  addAsset(wing, 'plant', [11.1, 0, -4.4], 1.2);
  addAsset(wing, 'plant', [11.1, 0, 4.3], 1.1);
  addAsset(wing, 'rugRound', [8.8, 0, 2.0], 0.012, { footprint: [3.4, 3.4], tint: '#e0b78c' });
  roomGroup.add(wing);
  addLight(wing, '#ffe2ae', 8.6, 4.4, 0, 15, 9);
  refreshSideWall();
  setCamera();
}
function refreshSideWall() {
  rightWallGroup.clear();
  const wall = wallMaterial();
  if (!sunroomUnlocked()) {
    box(rightWallGroup, [0.2, 5.3, 10.2], [6.25, 2.65, 0], wall);
    return;
  }
  box(rightWallGroup, [0.2, 5.3, 3.6], [6.25, 2.65, -3.3], wall);
  box(rightWallGroup, [0.2, 5.3, 3.6], [6.25, 2.65, 3.3], wall);
  box(rightWallGroup, [0.2, 2.3, 3.0], [6.25, 4.15, 0], wall);
  box(rightWallGroup, [0.26, 0.12, 3.1], [6.25, 3.0, 0], material('#8a5c38', 0.55));
  box(rightWallGroup, [0.26, 3.0, 0.1], [6.25, 1.5, -1.5], material('#8a5c38', 0.55));
  box(rightWallGroup, [0.26, 3.0, 0.1], [6.25, 1.5, 1.5], material('#8a5c38', 0.55));
}
function createWingWindows(parent: THREE.Group) {
  const glass = new THREE.MeshPhysicalMaterial({ color: '#ffe7b8', roughness: 0.16, transparent: true, opacity: 0.36, emissive: '#ffd79a', emissiveIntensity: 0.2 });
  box(parent, [3.7, 2.35, 0.06], [8.9, 3.1, -4.99], glass, false);
  const trim = material('#8a5c38', 0.55);
  for (const x of [7.0, 8.9, 10.8]) box(parent, [0.1, 2.5, 0.16], [x, 3.1, -4.93], trim);
  box(parent, [3.95, 0.12, 0.16], [8.9, 4.33, -4.93], trim);
  box(parent, [4.1, 0.1, 0.3], [8.9, 1.85, -4.88], trim);
}
function refreshWorkers() {
  workerGroup.clear(); workers.length = 0;
  const spots: [number, number, number][] = [[-1.4, 0, -3.35], [2.0, 0, -3.35], [0.5, 0, -3.35], [-2.6, 0, -3.35], [3.2, 0, -3.35]];
  state.staff.slice(0, 5).forEach((staff, i) => {
    const person = addHuman(workerGroup, spots[i], i + 3, 0);
    workers.push({ ...staff, busyUntil: 0, model: person.root, mixer: person.mixer });
  });
}
function currentEvent() { return dailyEvents[(state.day - 1) % dailyEvents.length]; }
function setCamera() {
  camera.aspect = innerWidth / innerHeight;
  camera.position.x = sunroomUnlocked() ? 1.9 : 0.2;
  const portrait = innerWidth / innerHeight < 0.9;
  camera.fov = portrait ? sunroomUnlocked() ? 78 : 68 : 39;
  camera.position.y = portrait ? sunroomUnlocked() ? 9 : 7.8 : sunroomUnlocked() ? 13.4 : 10.2;
  camera.position.z = portrait ? sunroomUnlocked() ? 13.6 : 11.5 : sunroomUnlocked() ? 22.8 : 16.7;
  camera.lookAt(sunroomUnlocked() ? 1.9 : 0.2, portrait ? 1.5 : 1.1, 0);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 680 ? 1.35 : 1.7));
}
addEventListener('resize', setCamera);

function toast(message: string, style = 'good') {
  const node = $('toast');
  node.textContent = message; node.className = `toast visible ${style}`;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => { node.className = 'toast'; }, 3300);
}
function formatTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
function availableRecipes() { return allRecipes.filter(r => state.menu.includes(r.id)); }
function ingredientMissing(recipe: Recipe) {
  return Object.entries(recipe.ingredients).find(([key, count]) => (state.inventory[key] || 0) < count);
}
function customerName(index: number) { return guests[index % guests.length]; }
function createGuest() {
  const profile = customerName(Math.floor(Math.random() * guests.length));
  const menu = availableRecipes();
  const primary = menu[Math.floor(Math.random() * menu.length)];
  const group = profile.kind === 'Little lunch group' && state.day > 1 && menu.length > 2;
  const picks = group ? [primary, menu.filter(r => r.id !== primary.id)[Math.floor(Math.random() * (menu.length - 1))]] : [primary];
  const patience = Math.max(25, profile.patience + Math.min(24, upLevel('ambience') * 8) + upLevel('windows') * 4);
  const guest: Guest = {
    id: nextGuestId++, name: profile.name, kind: profile.kind, patience, maxPatience: patience,
    items: picks.map(r => ({ recipeId: r.id, state: 'waiting', finishAt: 0 })),
    createdAt: simulatedTime, mood: profile.mood,
  };
  guestsInShift.push(guest);
  const avatarIndex = arrivals % peopleModels.length;
  const spot = seatOrWaitSpot();
  const person = addHuman(guestGroup, [DOOR.x, 0, DOOR.z], avatarIndex, Math.PI / 2);
  person.root.scale.setScalar(0.01);
  const actor: GuestActor = {
    guestId: guest.id, root: person.root, mixer: person.mixer, action: null, exiting: false, exitAt: 0, target: spot.target, seated: spot.seated, seatKey: spot.seatKey,
    path: findPath(DOOR, spot.target, spot.seatKey), speed: 1.55, settled: false, sitFacing: spot.facing, appear: 0, leaving: false,
  };
  animatePerson(actor, 'walk');
  guestActors.set(guest.id, actor);
  arrivals++;
  if (selectedGuestId === null) selectedGuestId = guest.id;
  beep(620, 0.05, 'sine', 0.018, 110);
}
function getOrder(id: number | null) { return guestsInShift.find(g => g.id === id); }
function openOrderCount() { return guestsInShift.filter(g => g.items.some(i => i.state !== 'ready') || !g.items.length).length; }
function recipePrice(recipe: Recipe) { return Math.round(recipe.price * (recipe.kind === 'food' ? 1 + [0, 0.12, 0.25][upLevel('oven')] : 1 + upLevel('grinder') * 0.06) * (1 + upLevel('specials') * 0.04)); }
function totalOrderValue(guest: Guest) { return guest.items.reduce((total, item) => total + recipePrice(recipeById(item.recipeId)), 0); }
function selectedReady(guest: Guest) { return guest.items.length > 0 && guest.items.every(i => i.state === 'ready'); }
function selectGuest(id: number, index = 0) {
  selectedGuestId = id; selectedItemIndex = index;
  if (playerTask?.guestId !== id) { playerTask = null; playerMoveTarget = null; }
  refreshHeldOrder();
  updateUI();
}
function refreshHeldOrder() {
  const guest = getOrder(selectedGuestId);
  const key = guest ? `${guest.id}:${guest.items.map(item => item.state).join(',')}` : '';
  if (heldOrderKey === key || !playerActor) return;
  heldOrderKey = key;
  if (heldOrderGroup) playerActor.root.remove(heldOrderGroup);
  heldOrderGroup = null;
  if (!guest || !guest.items.some(item => item.state === 'ready')) return;
  const carry = new THREE.Group();
  carry.position.set(0.17, 0.72, 0.18);
  const tray = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.035, 24), material('#aa7547', 0.42));
  tray.position.y = 0.015; tray.castShadow = true; carry.add(tray);
  const readyItems = guest.items.filter(item => item.state === 'ready');
  readyItems.forEach((item, index) => {
    const recipe = recipeById(item.recipeId);
    const modelId = recipe.id === 'tea' ? 'teaCup'
      : ['croissant', 'muffin', 'cookie', 'cake'].includes(recipe.id) ? recipe.id
        : 'coffeeCup';
    addAsset(carry, modelId, [(index - (readyItems.length - 1) / 2) * 0.18, 0.04, 0], modelId === 'cookie' ? 0.11 : modelId === 'coffeeCup' || modelId === 'teaCup' ? 0.15 : 0.16);
  });
  playerActor.root.add(carry);
  heldOrderGroup = carry;
}
function prepareOrder(guestId: number, itemIndex: number, byWorker = false) {
  const guest = getOrder(guestId);
  const item = guest?.items[itemIndex];
  if (!shiftActive || !guest || !item || item.state !== 'waiting') return;
  const recipe = recipeById(item.recipeId);
  const missing = ingredientMissing(recipe);
  if (missing) {
    toast(`Out of ${ingredientInfo[missing[0]].label.toLowerCase()}. Refill supplies before preparing this order.`, 'warning');
    showPanel('supplies');
    return;
  }
  Object.entries(recipe.ingredients).forEach(([key, amount]) => state.inventory[key] -= amount);
  item.state = 'preparing';
  const equipmentFactor = [1, 0.75, 0.62, 0.5][upLevel('machine')];
  item.finishAt = simulatedTime + (byWorker ? 3.1 * (1 - 0.1 * upLevel('training')) : 1.7) * equipmentFactor;
  if (byWorker) {
    const worker = workers.find(w => w.role === (recipe.kind === 'food' ? 'cook' : 'barista') && w.busyUntil <= simulatedTime);
    if (worker) worker.busyUntil = item.finishAt + 0.4;
  } else {
    toast(`${recipe.icon} ${recipe.name} is on the ${recipe.station.toLowerCase()}.`, 'good');
    beep(420, 0.06, 'triangle', 0.024, 180);
  }
  persist();
  updateUI();
}
let combo = 0; let comboUntil = 0;
function serveOrder(guestId: number, byWorker = false) {
  const guest = getOrder(guestId);
  if (!guest || !selectedReady(guest)) return;
  const wait = simulatedTime - guest.createdAt;
  const speedBonus = Math.max(0, 1 - wait / (guest.maxPatience * 1.8));
  const eventBonus = currentEvent().title === 'Rainy-day regulars' ? 1 : 0;
  const base = totalOrderValue(guest);
  combo = simulatedTime <= comboUntil ? combo + 1 : 1;
  comboUntil = simulatedTime + 24;
  state.bestCombo = Math.max(state.bestCombo, combo);
  const comboBonus = Math.min(0.5, (combo - 1) * 0.1);
  const tip = Math.round(base * (0.08 + speedBonus * 0.2 + eventBonus * 0.08 + upLevel('ambience') * 0.05 + upLevel('music') * 0.04 + comboBonus));
  state.cash += base + tip; shiftRevenue += base; shiftTips += tip; shiftServed++; state.served++;
  state.reputation = clamp(state.reputation + (speedBonus > 0.4 ? 0.018 : -0.018) + upLevel('signage') * 0.008 + upLevel('awards') * 0.004, 0.5, 5);
  questStat('served', guest.items.length); questStat('tips', tip); questStat('combo', combo, true);
  addXp(Math.round((10 + guest.items.length * 4) * (1 + upLevel('loyalty') * 0.15)));
  dirtyTables++;
  const actor = guestActors.get(guest.id);
  if (actor) { actor.exiting = true; actor.exitAt = simulatedTime + 2.2; animatePerson(actor, 'walk'); }
  guestsInShift = guestsInShift.filter(g => g.id !== guest.id);
  if (selectedGuestId === guest.id) selectedGuestId = guestsInShift[0]?.id ?? null;
  selectedItemIndex = 0;
  toast(`${byWorker ? 'Your team' : 'Order served'} · ${money(base)} + ${money(tip)} tip${combo > 1 ? ` · ×${combo} streak` : ''}`, 'good');
  beep(760, 0.12, 'sine', 0.035, 330);
  persist(); updateUI();
  if (arrivals >= dailyTarget && guestsInShift.length === 0) {
    autoCloseTimer = 2.4;
  }
}
function cleanCafe(byWorker = false) {
  if (dirtyTables === 0) { toast('The tables are already sparkling.', 'good'); return; }
  dirtyTables = 0;
  toast(byWorker ? 'Your host has reset the tables.' : 'Fresh tablecloths, clean tables. Lovely.', 'good');
  if (!byWorker) beep(340, 0.08, 'sine', 0.025, 180);
  updateUI();
}
function ensureQuests() {
  if (state.quests.day === state.day && state.quests.list.length) return;
  const level = levelInfo(state.xp).level;
  const pool = [...questPool].sort(() => Math.random() - 0.5).slice(0, 3);
  state.quests = { day: state.day, list: pool.map(def => {
    const goal = def.goal(level);
    return { id: def.id, stat: def.stat, label: def.label(goal), icon: def.icon, goal, progress: 0, claimed: false, cash: def.cash + level * 2, hearts: 1, xp: 20 + level * 2 };
  }) };
}
function questStat(stat: string, amount: number, max = false) {
  for (const q of state.quests.list) if (q.stat === stat && !q.claimed) {
    const was = q.progress >= q.goal;
    q.progress = max ? Math.max(q.progress, amount) : q.progress + amount;
    if (!was && q.progress >= q.goal) { toast(`Goal complete: ${q.label}. Claim it in Goals.`, 'good'); beep(880, 0.15, 'sine', 0.03, 220); }
  }
}
function addXp(amount: number) {
  const before = levelInfo(state.xp).level;
  state.xp += amount;
  const after = levelInfo(state.xp).level;
  for (let l = before + 1; l <= after; l++) {
    const hearts = 1 + (l % 3 === 0 ? 1 : 0); const cash = 25 * l;
    state.hearts += hearts; state.cash += cash;
    toast(`Level ${l}! +${money(cash)} and ${hearts} 💗. New upgrades and styles may be unlocked.`, 'good');
    beep(660, 0.25, 'triangle', 0.04, 440);
  }
  checkAchievements();
}
function checkAchievements() {
  for (const a of achievementDefs) if (!state.achievements.includes(a.id) && a.check()) {
    state.achievements.push(a.id); state.hearts += a.hearts;
    toast(`Keepsake earned: ${a.name} · +${a.hearts} 💗`, 'good');
  }
}
function claimQuest(index: number) {
  const q = state.quests.list[index];
  if (!q || q.claimed || q.progress < q.goal) return;
  q.claimed = true; state.cash += q.cash; state.hearts += q.hearts;
  addXp(q.xp); persist(); renderPanel(); updateUI();
  toast(`Goal claimed · ${money(q.cash)} and ${q.hearts} 💗`, 'good');
}
function claimDaily() {
  const today = dateKey();
  if (state.streak.claimedDate === today) return;
  const diff = state.streak.lastDate ? dayDiff(state.streak.lastDate, today) : 99;
  state.streak.days = diff === 1 ? state.streak.days + 1 : 1;
  state.streak.lastDate = today; state.streak.claimedDate = today;
  const gift = dailyGifts[(state.streak.days - 1) % 7];
  state.cash += gift.cash; state.hearts += gift.hearts;
  addXp(15); persist(); renderPanel(); updateUI();
  toast(`Daily gift: ${gift.label}`, 'good'); beep(740, 0.2, 'triangle', 0.04, 300);
}
function claimChest() {
  if (state.chestSeconds < CHEST_SECONDS) return;
  const cash = 30 + levelInfo(state.xp).level * 8; const hearts = 1 + (state.chestsOpened % 3 === 2 ? 1 : 0);
  const keys = Object.keys(ingredientInfo); const key = keys[state.chestsOpened % keys.length];
  state.cash += cash; state.hearts += hearts; state.inventory[key] = (state.inventory[key] || 0) + 4;
  state.chestSeconds = 0; state.chestsOpened++;
  addXp(12); persist(); if (currentPanel) renderPanel(); updateUI();
  toast(`Treat basket: ${money(cash)}, ${hearts} 💗 and 4 ${ingredientInfo[key].label.toLowerCase()}.`, 'good'); beep(700, 0.2, 'triangle', 0.04, 350);
}
const rentCost = () => 18 + (sunroomUnlocked() ? 13 : 0) + upLevel('seating') * 4;
function dayGoal() { return 4 + Math.min(8, Math.floor((state.day - 1) / 2)); }
function startShift() {
  if (!assetReady || shiftActive) return;
  closePanel(); ensureQuests();
  workers.forEach(worker => { worker.busyUntil = 0; worker.pendingGuestId = undefined; worker.task = undefined; });
  shiftActive = true; shiftPause = false; shiftStart = simulatedTime; nextArrival = simulatedTime + 5.5;
  arrivals = 0; dailyTarget = dayGoal(); shiftRevenue = 0; shiftTips = 0; shiftServed = 0; shiftLost = 0; dirtyTables = 0; autoCloseTimer = 0;
  guestsInShift = []; selectedGuestId = null; currentPanel = '';
  playerMoveTarget = null; playerTask = null; playerVelocity.set(0, 0, 0); movementKeys.clear(); occupiedSeats.clear();
  if (playerActor) { playerActor.root.position.copy(PLAYER_START); playerActor.root.rotation.y = 0; }
  playerPath = [];
  refreshHeldOrder();
  $('intro').classList.add('hidden');
  $('main-ui').classList.remove('inactive');
  $('shift-note').textContent = `First goal: welcome ${dailyTarget} guests, make the right order and serve with a smile.`;
  createGuest(); nextArrival = simulatedTime + 6;
  toast(`Day ${state.day}: ${currentEvent().title}. ${currentEvent().detail}`, 'good');
  updateUI();
}
function finishShift() {
  if (!shiftActive || pendingReport) return;
  shiftActive = false; shiftPause = false;
  guestsInShift.forEach(g => {
    shiftLost++;
    const actor = guestActors.get(g.id);
    if (actor) { actor.exiting = true; actor.exitAt = simulatedTime + 1.1; animatePerson(actor, 'walk'); }
  });
  guestsInShift = []; selectedGuestId = null;
  guestActors.forEach(actor => guestGroup.remove(actor.root));
  guestActors.clear();
  occupiedSeats.clear(); playerTask = null; playerMoveTarget = null;
  const wages = state.staff.reduce((sum, w) => sum + roles[w.role].wage, 0);
  const rent = rentCost();
  const oldRep = state.reputation;
  const cleanliness = dirtyTables === 0 ? 1 : 0;
  const satisfaction = clamp(Math.round((shiftServed / Math.max(1, arrivals)) * 65 + cleanliness * 20 + state.reputation * 3), 0, 100);
  state.reputation = clamp(state.reputation + (satisfaction >= 75 ? 0.12 : satisfaction >= 45 ? 0.02 : -0.1), 0.5, 5);
  const event = currentEvent().title;
  const bonus = event === 'Supplier thank-you' ? '20% supplier discount' : event === 'Rainy-day regulars' ? 'Cozy-day tip bonus' : event === 'Market-day foot traffic' ? 'Extra street traffic' : 'A gentle opening shift';
  const delivery = [0, 12, 28][upLevel('delivery')];
  if (delivery) { state.cash += delivery; shiftRevenue += delivery; }
  const totalCosts = wages + rent;
  state.cash -= totalCosts;
  if (state.cash < 0) {
    const rescue = 160 - state.cash;
    state.cash = 160; state.debt += Math.ceil(rescue * 1.22); state.loans++;
    toast(`Cash-flow cushion used. ${money(Math.ceil(rescue * 1.22))} is due from the next shift.`, 'warning');
  } else if (state.debt > 0 && state.cash > 70) {
    const repayment = Math.min(state.debt, Math.floor((state.cash - 40) * 0.4));
    state.debt -= repayment; state.cash -= repayment;
  }
  addXp(20 + Math.round(satisfaction / 5));
  if (shiftLost === 0 && shiftServed > 0) questStat('perfect', 1);
  combo = 0;
  pendingReport = { day: state.day, served: shiftServed, lost: shiftLost, revenue: shiftRevenue, tips: shiftTips, wages, rent, satisfaction, event, bonus, oldRep, newRep: state.reputation };
  state.report = pendingReport;
  refreshExpansion(); refreshTables(); refreshDecor(); refreshWorkers(); persist();
  showPanel('report');
  updateUI();
}
function beginNextDay() {
  if (pendingReport) { pendingReport = null; state.report = null; state.day++; }
  startShift();
  if (sunroomUnlocked() && state.staff.length < 4) toast('The sunroom is open. A pastry cook can now be hired.', 'good');
  persist();
}
function showPanel(tab: string) {
  if (currentPanel === tab) { closePanel(); return; }
  currentPanel = tab;
  const panel = $('manager-panel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  renderPanel();
}
function closePanel() {
  currentPanel = '';
  $('manager-panel').classList.remove('open');
  $('manager-panel').setAttribute('aria-hidden', 'true');
}
function esc(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
function renderPanel() {
  const body = $('panel-body');
  const title = $('panel-title');
  const subtitle = $('panel-subtitle');
  const canPurchase = (price: number) => state.cash >= price;
  if (currentPanel === 'report' && pendingReport) {
    title.textContent = `Day ${pendingReport.day} · closing notes`; subtitle.textContent = 'A clear look at what worked today and what the café paid for.';
    const r = pendingReport;
    body.innerHTML = `<div class="report-score"><span>Guest happiness</span><strong>${r.satisfaction}%</strong><small>Reputation ${r.oldRep.toFixed(1)} → ${r.newRep.toFixed(1)} ★</small></div>
      <div class="report-grid"><div><small>Orders served</small><b>${r.served}</b></div><div><small>Guests left waiting</small><b>${r.lost}</b></div><div><small>Sales</small><b>${money(r.revenue)}</b></div><div><small>Tips</small><b>${money(r.tips)}</b></div><div><small>Team wages</small><b>−${money(r.wages)}</b></div><div><small>Rent & upkeep</small><b>−${money(r.rent)}</b></div></div>
      <p class="report-story">${esc(r.event)} · ${esc(r.bonus)}. ${r.satisfaction >= 75 ? 'Neighbors left smiling; the word is getting around.' : r.satisfaction >= 45 ? 'A steady shift. A little more help or a quicker station could make the next one smoother.' : 'The rush got away from us. Consider restocking, cleaning and adding a teammate before opening again.'}</p>
      ${state.debt > 0 ? `<div class="notice">Cash-flow cushion balance: <b>${money(state.debt)}</b>. We will repay it gradually from future shifts.</div>` : ''}
      <button class="primary wide" data-action="next-day">Open day ${state.day + 1} →</button>
      <button class="quiet wide" data-action="open-panel" data-panel="upgrades">Plan an upgrade first</button>`;
  } else if (currentPanel === 'staff') {
    title.textContent = 'Your people'; subtitle.textContent = 'Hire kind, capable teammates. Each shift shows their work in the café and on the wage sheet.';
    const cards = state.staff.map(w => `<div class="purchase-row"><div class="row-icon">${roles[w.role].icon}</div><div class="row-copy"><b>${esc(w.name)} · ${roles[w.role].label}</b><span>${roles[w.role].task}. ${money(roles[w.role].wage)} per shift.</span></div><button class="tiny-button" data-action="train" data-id="${w.id}" ${state.cash < 60 || w.skill >= 3 ? 'disabled' : ''}>Train · ${money(60)}</button></div>`).join('');
    const rolesToHire: Role[] = ['barista', 'server', 'cleaner'];
    if (sunroomUnlocked()) rolesToHire.push('cook');
    const hiring = rolesToHire.map(role => `<div class="purchase-row"><div class="row-icon">${roles[role].icon}</div><div class="row-copy"><b>${roles[role].label}</b><span>${roles[role].task}. Hire ${money(roles[role].hire)} · ${money(roles[role].wage)}/shift.</span></div><button class="tiny-button" data-action="hire" data-role="${role}" ${!canPurchase(roles[role].hire) ? 'disabled' : ''}>Hire</button></div>`).join('');
    body.innerHTML = `<h3>On the team <small>${state.staff.length}/5</small></h3>${cards || '<p class="empty-note">It’s just you for now. Your first teammate can take one job off your hands.</p>'}<h3>Meet a teammate</h3>${hiring}<div class="notice">Baristas handle drinks; pastry cooks handle food. Servers deliver complete orders. Staff have one job at a time, and wages are paid after each shift.</div>`;
  } else if (currentPanel === 'supplies') {
    title.textContent = 'Pantry & deliveries'; subtitle.textContent = 'Order a sensible amount before the rush. Storage keeps extra stock without waste.';
    const discount = currentEvent().title === 'Supplier thank-you' ? 0.8 : 1;
    const inventory = Object.entries(ingredientInfo).map(([key, item]) => {
      const qty = state.inventory[key] || 0; const cost = Math.ceil(item.cost * discount);
      const multiplier = [1, 1.5, 2][upLevel('storage')];
      return `<div class="supply-row"><span class="supply-name">${item.icon} ${item.label}</span><span class="stock-count">${qty} in pantry</span><button class="tiny-button" data-action="restock" data-id="${key}" data-price="${cost}" data-amount="${Math.round(6 * multiplier)}" ${!canPurchase(cost) ? 'disabled' : ''}>+${Math.round(6 * multiplier)} · ${money(cost)}</button></div>`;
    }).join('');
    body.innerHTML = `<div class="pantry-grid">${inventory}</div><div class="notice">One delivery fills six portions; pantry upgrade increases that to nine. Ingredients are spent only when a recipe is started. ${discount < 1 ? 'Today’s local supplier special is applied.' : ''}</div><button class="tiny-button" data-action="bundle" ${!canPurchase(56) ? 'disabled' : ''}>All-in delivery · ${money(56)}</button> <span class="small-copy">Restocks 4 portions of each ingredient.</span>`;
  } else if (currentPanel === 'upgrades') {
    title.textContent = 'Make the café yours'; subtitle.textContent = 'Every purchase changes the shop or the way it runs. Compare the price and effect first.';
    const cafeLevel = levelInfo(state.xp).level;
    const cards = upgrades.map(u => {
      const level = upLevel(u.id); const maxed = level >= u.prices.length;
      const price = maxed ? 0 : u.prices[level]; const need = maxed ? 0 : u.levelReq[level];
      const locked = !maxed && cafeLevel < need;
      const pips = u.prices.map((_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
      const next = maxed ? 'Fully upgraded.' : u.effects[level];
      return `<div class="purchase-row"><div class="row-icon">${u.icon}</div><div class="row-copy"><b>${u.name}</b><span class="pips">${pips}</span><span>${next}${locked ? ` <em>Needs café level ${need}.</em>` : ''}</span></div><button class="tiny-button" data-action="upgrade" data-id="${u.id}" ${maxed || locked || !canPurchase(price) ? 'disabled' : ''}>${maxed ? 'Maxed' : locked ? `Lv ${need}` : level ? `Level ${level + 1} · ${money(price)}` : money(price)}</button></div>`;
    }).join('');
    body.innerHTML = `${cards}<div class="notice">Cash at close: ${money(state.cash)}. Rent ${money(rentCost())}/shift${state.staff.length ? ` + wages ${money(state.staff.reduce((a, w) => a + roles[w.role].wage, 0))}` : ''}. A safety cushion prevents a cash shortfall from ending your run.</div>`;
  } else if (currentPanel === 'menu') {
    title.textContent = 'Menu & recipes'; subtitle.textContent = 'More choice attracts new guests, but uses more stock. Recipe unlocks follow café reputation.';
    const recipes = allRecipes.map(r => {
      const isOn = state.menu.includes(r.id); const unlocked = !r.unlock || state.reputation >= r.unlock;
      const req = Object.entries(r.ingredients).map(([key, n]) => `${ingredientInfo[key].icon} ${n}`).join(' · ');
      return `<div class="purchase-row"><div class="row-icon">${r.icon}</div><div class="row-copy"><b>${r.name} · ${money(r.price)}</b><span>${r.station} · ${req} ${unlocked ? '' : `· Unlocks at ${(r.unlock ?? 0).toFixed(1)} ★ reputation`}</span></div><button class="tiny-button" data-action="${isOn ? 'remove-menu' : 'add-menu'}" data-id="${r.id}" ${!unlocked || (!isOn && state.menu.length >= 8) ? 'disabled' : ''}>${isOn ? 'On menu' : unlocked ? 'Add' : 'Locked'}</button></div>`;
    }).join('');
    body.innerHTML = `${recipes}<div class="notice">Menu size ${state.menu.length}/8. Recipe stock is listed in Supplies; every order’s required ingredients are shown before you prepare it.</div>`;
  } else if (currentPanel === 'goals') {
    title.textContent = 'Goals & keepsakes'; subtitle.textContent = 'Little challenges that pay in cash, hearts and experience. New ones arrive each day.';
    const quests = state.quests.list.map((q, i) => {
      const done = q.progress >= q.goal;
      return `<div class="purchase-row quest ${done ? 'done' : ''}"><div class="row-icon">${q.icon}</div><div class="row-copy"><b>${esc(q.label)}</b><span class="mini-track"><i style="width:${Math.min(100, q.progress / q.goal * 100)}%"></i></span><span>${Math.min(q.progress, q.goal)} / ${q.goal} · ${money(q.cash)} · ${q.hearts}💗 · ${q.xp} XP</span></div><button class="tiny-button" data-action="claim-quest" data-id="${i}" ${!done || q.claimed ? 'disabled' : ''}>${q.claimed ? 'Claimed' : done ? 'Claim' : 'In progress'}</button></div>`;
    }).join('') || '<p class="empty-note">Open the café to get today’s goals.</p>';
    const badges = achievementDefs.map(a => {
      const got = state.achievements.includes(a.id);
      return `<div class="badge ${got ? 'earned' : ''}"><span>${got ? a.icon : '🔒'}</span><b>${a.name}</b><small>${a.desc}</small><i>${a.hearts}💗</i></div>`;
    }).join('');
    body.innerHTML = `<h3>Today’s goals</h3>${quests}<h3>Keepsakes <small>${state.achievements.length}/${achievementDefs.length}</small></h3><div class="badge-grid">${badges}</div>`;
  } else if (currentPanel === 'decor') {
    title.textContent = 'Decorate & personalize'; subtitle.textContent = 'Choose colors freely; spend hearts on decorations. New options unlock as the café levels up.';
    const level = levelInfo(state.xp).level;
    const kinds: [keyof typeof palettes, string][] = [['wall', 'Walls'], ['floor', 'Floor'], ['counter', 'Counter'], ['chairs', 'Chairs'], ['sign', 'Sign']];
    const swatches = kinds.map(([kind, label]) => `<div class="swatch-row"><b>${label}</b><div>${palettes[kind].map(p => `<button type="button" class="swatch ${state.custom[kind] === p.id ? 'selected' : ''}" style="--c:${p.color}" data-action="palette" data-kind="${kind}" data-id="${p.id}" title="${p.name}${p.level > level ? ` · level ${p.level}` : ''}" aria-label="${label}: ${p.name}" ${p.level > level ? 'disabled' : ''}>${p.level > level ? '🔒' : ''}</button>`).join('')}</div></div>`).join('');
    const items = decorItems.map(d => {
      const owned = state.custom.decor.includes(d.id); const on = decorOn(d.id); const locked = level < d.level;
      return `<div class="purchase-row"><div class="row-icon">${d.icon}</div><div class="row-copy"><b>${d.name}</b><span>${d.blurb}${locked ? ` <em>Needs café level ${d.level}.</em>` : ''}</span></div><button class="tiny-button" data-action="${owned ? 'decor-toggle' : 'decor-buy'}" data-id="${d.id}" ${!owned && (locked || state.hearts < d.hearts) ? 'disabled' : ''}>${owned ? (on ? 'Displayed' : 'Put out') : `${d.hearts} 💗`}</button></div>`;
    }).join('');
    body.innerHTML = `<h3>Colors</h3>${swatches}<h3>Decorations <small>${state.hearts} 💗 to spend</small></h3>${items}`;
  } else if (currentPanel === 'rewards') {
    title.textContent = 'Rewards & treats'; subtitle.textContent = 'Come back every day for gifts; keep the café open for a treat basket.';
    const today = dateKey(); const ready = state.streak.claimedDate !== today;
    const nextDays = ready ? (state.streak.lastDate && dayDiff(state.streak.lastDate, today) === 1 ? state.streak.days + 1 : 1) : state.streak.days;
    const cells = dailyGifts.map((g, i) => {
      const cur = (nextDays - 1) % 7 === i;
      const past = ready ? i < (nextDays - 1) % 7 : i <= (nextDays - 1) % 7;
      return `<div class="gift-cell ${past ? 'past' : ''} ${cur && ready ? 'current' : ''}"><small>Day ${i + 1}</small><span>${i === 6 ? '🎂' : '🎁'}</span><b>${g.label.split(':')[0]}</b></div>`;
    }).join('');
    const chestReady = state.chestSeconds >= CHEST_SECONDS;
    const li = levelInfo(state.xp);
    body.innerHTML = `<div class="reward-card"><div><b>Daily visit gift</b><span>${state.streak.days ? `${state.streak.days}-day streak` : 'Start a streak today'} · visit daily to climb the week.</span></div><button class="primary" data-action="claim-daily" ${ready ? '' : 'disabled'}>${ready ? 'Open today’s gift' : 'Back tomorrow'}</button></div><div class="gift-row">${cells}</div>
      <div class="reward-card"><div><b>Treat basket</b><span>Fills while the café is open (${Math.floor(state.chestSeconds)}s / ${CHEST_SECONDS}s). ${state.chestsOpened} opened so far.</span><span class="mini-track"><i style="width:${state.chestSeconds / CHEST_SECONDS * 100}%"></i></span></div><button class="primary" data-action="claim-chest" ${chestReady ? '' : 'disabled'}>${chestReady ? 'Open basket' : 'Filling…'}</button></div>
      <div class="notice">Café level ${li.level} · ${li.into}/${li.need} XP to the next. Level-ups give cash and hearts, and unlock upgrades, colors and decorations.</div>`;
  } else if (currentPanel === 'help') {
    title.textContent = 'A little café handbook'; subtitle.textContent = 'Everything you need for a lovely first shift.';
    body.innerHTML = `<div class="guide-list"><div><b>1 · Welcome</b><p>Each order card shows what a guest wants and how long they’ll wait. Select a guest to see the full ticket.</p></div><div><b>2 · Make it</b><p>Walk to the glowing appliance ring and press E to make the selected item. A group order needs every item made. Ingredients are deducted when prep starts.</p></div><div><b>3 · Serve & reset</b><p>Carry the finished order to the seated or waiting guest and press E nearby to deliver it for sales and a satisfaction-based tip. Clean between visits to protect your reputation.</p></div><div><b>4 · Grow</b><p>Use Supplies before you run out, hire staff for visible work, and purchase equipment or seating between shifts. The day report explains sales, tips and costs.</p></div><div><b>Movement & interaction</b><p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys to move · <kbd>E</kbd> interact · <kbd>Space</kbd> go to selected preparation station · <kbd>Enter</kbd> walk to a ready guest · <kbd>Esc</kbd> close · <kbd>P</kbd> pause. Touch controls appear on phones and tablets.</p></div><div><b>Keep your progress</b><p>Your café saves in this browser automatically. “New café” asks for confirmation before replacing your local save.</p></div></div>`;
  } else if (currentPanel === 'settings') {
    title.textContent = 'Settings & save'; subtitle.textContent = 'Your café is stored on this device. Sound is optional, and you can begin a new café whenever you like.';
    body.innerHTML = `<div class="setting-row"><span>Sound effects</span><button class="tiny-button" data-action="sound">${soundEnabled ? 'On' : 'Muted'}</button></div><div class="setting-row"><span>Shift speed</span><button class="tiny-button" data-action="speed">${speed === 1 ? 'Relaxed · 1×' : 'Busy · 2×'}</button></div><div class="notice">Walk the café floor with WASD or the arrow keys. Select an order to walk to its station; press E nearby to prepare, then deliver it to the guest. Touch controls are available on phones and tablets.</div><button class="danger wide" data-action="new-game">Start a new café…</button>`;
  } else {
    title.textContent = 'Café management'; subtitle.textContent = 'Pick a tab to plan your next step.';
    body.innerHTML = '<p>Choose staff, upgrades, supplies, or your menu.</p>';
  }
  body.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action || '', button.dataset)));
}
function handleAction(action: string, data: DOMStringMap) {
  if (action === 'next-day') { beginNextDay(); return; }
  if (action === 'open-panel') { showPanel(data.panel || ''); return; }
  if (action === 'hire') { hire(data.role as Role); return; }
  if (action === 'train') { train(Number(data.id)); return; }
  if (action === 'restock') { restock(data.id || '', Number(data.price), Number(data.amount)); return; }
  if (action === 'bundle') { buyBundle(); return; }
  if (action === 'upgrade') { buyUpgrade(data.id || ''); return; }
  if (action === 'add-menu') { toggleMenu(data.id || '', true); return; }
  if (action === 'remove-menu') { toggleMenu(data.id || '', false); return; }
  if (action === 'sound') { soundEnabled = !soundEnabled; renderPanel(); updateUI(); return; }
  if (action === 'speed') { speed = speed === 1 ? 2 : 1; renderPanel(); updateUI(); return; }
  if (action === 'new-game') { startNewGame(); return; }
  if (action === 'claim-quest') { claimQuest(Number(data.id)); return; }
  if (action === 'claim-daily') { claimDaily(); return; }
  if (action === 'claim-chest') { claimChest(); return; }
  if (action === 'palette') { const kind = data.kind as keyof typeof palettes; if (palettes[kind]?.some(p => p.id === data.id)) { state.custom[kind] = data.id!; buildRoom(); persist(); renderPanel(); toast('Freshly painted. Lovely.', 'good'); } return; }
  if (action === 'decor-buy') { const d = decorItems.find(x => x.id === data.id); if (d && !state.custom.decor.includes(d.id) && state.hearts >= d.hearts && levelInfo(state.xp).level >= d.level) { state.hearts -= d.hearts; state.custom.decor.push(d.id); buildRoom(); persist(); renderPanel(); updateUI(); toast(`${d.name} is now in the café.`, 'good'); } return; }
  if (action === 'decor-toggle') { const id = data.id || ''; state.custom.decorOff = state.custom.decorOff.includes(id) ? state.custom.decorOff.filter(x => x !== id) : [...state.custom.decorOff, id]; buildRoom(); persist(); renderPanel(); return; }
}
function hire(role: Role) {
  const def = roles[role];
  if (!def || (role === 'cook' && !sunroomUnlocked()) || state.staff.length >= 5 || state.cash < def.hire) { toast('That hire is not available with the current cash or shop size.', 'warning'); return; }
  const names = ['Jamie', 'Morgan', 'Casey', 'Alex', 'Robin'];
  const id = state.nextStaffId++;
  state.cash -= def.hire;
  state.staff.push({ id, name: names[(id - 1) % names.length], role, skill: 1 });
  refreshWorkers(); persist(); renderPanel(); updateUI();
  toast(`${names[(id - 1) % names.length]} joined the team as ${def.label.toLowerCase()}.`, 'good');
}
function train(id: number) {
  const member = state.staff.find(w => w.id === id);
  if (!member || member.skill >= 3 || state.cash < 60) return;
  state.cash -= 60; member.skill++; persist(); renderPanel(); updateUI();
  toast(`${member.name} completed role training · level ${member.skill}.`, 'good');
}
function restock(id: string, price: number, amount: number) {
  if (!ingredientInfo[id] || state.cash < price || !Number.isFinite(amount)) return;
  const eventDiscount = currentEvent().title === 'Supplier thank-you' ? 0.8 : 1;
  const actual = Math.ceil(ingredientInfo[id].cost * eventDiscount);
  if (state.cash < actual) { toast('There is not enough cash for that delivery.', 'warning'); return; }
  state.cash -= actual; state.inventory[id] = (state.inventory[id] || 0) + amount;
  persist(); renderPanel(); updateUI(); toast(`${ingredientInfo[id].label}: +${amount} in the pantry.`, 'good');
}
function buyBundle() {
  if (state.cash < 56) return;
  state.cash -= 56;
  for (const key of Object.keys(ingredientInfo)) state.inventory[key] = (state.inventory[key] || 0) + (key === 'cups' ? 10 : 4);
  persist(); renderPanel(); updateUI(); toast('The full delivery is in. The pantry looks healthy.', 'good');
}
function buyUpgrade(id: string) {
  const item = upgrades.find(u => u.id === id);
  if (!item) return;
  const level = upLevel(id);
  if (level >= item.prices.length) return;
  const price = item.prices[level];
  if (state.cash < price || levelInfo(state.xp).level < item.levelReq[level]) return;
  state.cash -= price; state.upgrades[id] = level + 1;
  buildRoom();
  addXp(18 + level * 8);
  persist(); renderPanel(); updateUI(); toast(`${item.name}${item.prices.length > 1 ? ` level ${level + 1}` : ''} installed. Take a look around the café.`, 'good');
}
function toggleMenu(id: string, add: boolean) {
  const r = allRecipes.find(recipe => recipe.id === id);
  if (!r || (r.unlock && state.reputation < r.unlock)) return;
  if (add && !state.menu.includes(id) && state.menu.length < 8) state.menu.push(id);
  if (!add) state.menu = state.menu.filter(x => x !== id);
  persist(); renderPanel(); updateUI();
  toast(add ? `${r.name} added to the menu.` : `${r.name} removed from the menu.`, 'good');
}
function startNewGame() {
  if (!confirm('Start a new café? This permanently replaces the saved café in this browser.')) return;
  try { localStorage.removeItem('corner-cup-cafe-v1'); }
  catch { toast('The saved café could not be cleared. Check this browser’s storage settings and try again.', 'warning'); return; }
  location.reload();
}

function fillActiveOrder() {
  const guest = getOrder(selectedGuestId);
  const pane = $('active-ticket');
  if (!guest) {
    if (ticketMarkupKey !== 'empty') {
      ticketMarkupKey = 'empty';
      pane.innerHTML = `<div class="ticket-empty"><div class="empty-cup">☕</div><b>Pick a ticket to get started</b><span>New guests appear at the front door. Their order and patience will show here.</span></div>`;
    }
    return;
  }
  const wait = clamp(guest.patience / guest.maxPatience, 0, 1);
  const allReady = selectedReady(guest);
  const actor = guestActors.get(guest.id);
  const markupKey = `${guest.id}:${guest.items.map(item => item.state).join(',')}:${allReady}:${actor?.seated ?? false}`;
  if (ticketMarkupKey === markupKey) {
    const bar = pane.querySelector<HTMLElement>('[data-ticket-bar]');
    const timer = pane.querySelector<HTMLElement>('[data-ticket-wait]');
    if (bar) { bar.style.width = `${wait * 100}%`; bar.classList.toggle('low', wait < 0.35); }
    if (timer) timer.textContent = `${Math.ceil(guest.patience)}s`;
    return;
  }
  const items = guest.items.map((item, index) => {
    const recipe = recipeById(item.recipeId);
    const missing = ingredientMissing(recipe);
    const status = item.state === 'ready' ? 'Ready on the counter' : item.state === 'preparing' ? 'In progress · almost ready' : `Make at ${recipe.station}`;
    return `<div class="ticket-item ${item.state}"><div class="item-icon">${recipe.icon}</div><div class="item-details"><b>${esc(recipe.name)}</b><small>${esc(recipe.station)} · ${money(recipe.price)}</small><small>${status}</small></div>${item.state === 'waiting' ? `<button class="tiny-button make-button" data-action="prepare" data-index="${index}" ${missing ? 'data-missing="true"' : ''}>Go make</button>` : item.state === 'preparing' ? '<span class="prep-spinner" aria-label="Preparing"></span>' : '<span class="ready-check">✓</span>'}</div>`;
  }).join('');
  const bad = wait < 0.35;
  const location = actor?.seated ? 'Seated at a table' : 'Waiting for a table';
  pane.innerHTML = `<div class="ticket-customer"><span class="avatar-dot">${guest.name.charAt(0)}</span><div><b>${esc(guest.name)}</b><small>${esc(guest.kind)} · ${location}</small></div><button class="tiny-close" data-action="deselect" aria-label="Close ticket">×</button></div><div class="patience"><div class="patience-label"><span>Patience</span><b data-ticket-wait>${Math.ceil(guest.patience)}s</b></div><div class="patience-track"><i data-ticket-bar class="${bad ? 'low' : ''}" style="width:${wait * 100}%"></i></div></div><div class="ticket-items">${items}</div><div class="ticket-total"><span>Order total</span><b>${money(totalOrderValue(guest))}</b></div>${allReady ? `<button class="primary wide" data-action="serve" data-id="${guest.id}">Walk over & deliver</button>` : `<p class="ticket-hint">Walk to the matching station, press E to prepare, then carry the finished order to ${esc(guest.name)}.</p>`}`;
  ticketMarkupKey = markupKey;
  pane.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'prepare') goToStation(guest.id, Number(button.dataset.index));
    else if (action === 'serve') goToGuest(guest.id);
    else if (action === 'deselect') { selectedGuestId = null; updateUI(); }
  }));
}
function updateUI() {
  refreshHeldOrder();
  $('cash-value').textContent = money(state.cash);
  $('day-value').textContent = String(state.day);
  $('rep-value').textContent = state.reputation.toFixed(1);
  $('served-value').textContent = String(state.served);
  $('staff-value').textContent = String(state.staff.length);
  $('pantry-count').textContent = String(Object.values(state.inventory).reduce((sum, n) => sum + n, 0));
  $('cafe-title').textContent = state.name;
  const li = levelInfo(state.xp);
  $('level-num').textContent = String(li.level);
  $('xp-bar').style.width = `${li.into / li.need * 100}%`;
  $('xp-text').textContent = `${li.into} / ${li.need} XP`;
  $('hearts-value').textContent = String(state.hearts);
  $('combo-chip').textContent = combo > 1 ? `🔥 ×${combo} streak · +${Math.min(50, (combo - 1) * 10)}% tips` : '';
  $('combo-chip').classList.toggle('visible', combo > 1);
  const chestReady = state.chestSeconds >= CHEST_SECONDS;
  $('chest-bar').style.width = `${state.chestSeconds / CHEST_SECONDS * 100}%`;
  $('chest-title').textContent = chestReady ? 'Treat basket ready!' : 'Treat basket';
  $('chest-button').classList.toggle('ready', chestReady);
  $('quest-tracker').innerHTML = `<b>Today’s goals</b>${state.quests.list.map(q => `<div class="${q.progress >= q.goal ? 'done' : ''}"><span>${q.claimed ? '✓' : q.icon}</span><small>${esc(q.label)}</small><em>${Math.min(q.progress, q.goal)}/${q.goal}</em></div>`).join('')}`;
  const claimable = state.quests.list.some(q => q.progress >= q.goal && !q.claimed);
  $('goals-dot').classList.toggle('on', claimable);
  $('rewards-dot').classList.toggle('on', chestReady || state.streak.claimedDate !== dateKey());
  const event = currentEvent();
  $('event-name').textContent = event.title;
  $('event-detail').textContent = event.detail;
  $('shift-clock').textContent = shiftActive ? formatTime(Math.max(0, 120 - (simulatedTime - shiftStart))) : 'CLOSED';
  $('shift-button-label').textContent = shiftActive ? 'Close shift & review' : pendingReport ? 'Next day' : 'Open today’s café';
  $('shift-button').setAttribute('aria-label', shiftActive ? 'Close the café shift and see the daily report' : pendingReport ? 'Open the next café day' : 'Open the café for today');
  $('shift-button').classList.toggle('is-open', shiftActive);
  $('pause-button').textContent = shiftPause ? '▶ Resume' : 'Ⅱ Pause';
  $<HTMLButtonElement>('pause-button').disabled = !shiftActive;
  $('mute-button').textContent = soundEnabled ? '♫ Sound on' : '♪ Sound off';
  const orders = $('order-list');
  const current = guestsInShift;
  const key = `${shiftActive}:${current.map(g => `${g.id}:${g.items.map(i => i.state).join(',')}`).join('|')}:${selectedGuestId ?? ''}`;
  if (orderMarkupKey !== key) {
    orders.innerHTML = current.map(guest => {
      const left = clamp(guest.patience / guest.maxPatience, 0, 1);
      const items = guest.items.map(item => recipeById(item.recipeId));
      const complete = selectedReady(guest);
      return `<button class="order-card ${guest.id === selectedGuestId ? 'selected' : ''}" data-order="${guest.id}" aria-label="${esc(guest.name)}: ${items.map(r => r.name).join(', ')}. ${Math.ceil(guest.patience)} seconds patience.">${guest.id === selectedGuestId ? '<span class="selected-marker" aria-hidden="true">›</span>' : ''}<span class="order-avatar">${guest.name.charAt(0)}</span><span class="order-copy"><b>${esc(guest.name)}${guest.kind === 'Little lunch group' ? ' · 2' : ''}</b><small>${items.map(r => `${r.icon} ${r.name}`).join(' + ')}</small><span class="patience-track"><i data-order-bar="${guest.id}" class="${left < 0.35 ? 'low' : ''}" style="width:${left * 100}%"></i></span></span><span class="order-badge" data-order-badge="${guest.id}">${complete ? '✓' : `${Math.ceil(guest.patience)}s`}</span></button>`;
    }).join('') || `<div class="orders-empty"><span>☀️</span><b>${shiftActive ? 'A quiet moment' : 'The café is closed'}</b><small>${shiftActive ? 'Take a breath. Your next neighbor is on the way.' : 'Open for the day when you’re ready.'}</small></div>`;
    orders.querySelectorAll<HTMLButtonElement>('button[data-order]').forEach(button => button.addEventListener('click', () => selectGuest(Number(button.dataset.order))));
    orderMarkupKey = key;
  }
  current.forEach(guest => {
    const left = clamp(guest.patience / guest.maxPatience, 0, 1);
    const bar = orders.querySelector<HTMLElement>(`[data-order-bar="${guest.id}"]`);
    const badge = orders.querySelector<HTMLElement>(`[data-order-badge="${guest.id}"]`);
    if (bar) { bar.style.width = `${left * 100}%`; bar.classList.toggle('low', left < 0.35); }
    if (badge) badge.textContent = selectedReady(guest) ? '✓' : `${Math.ceil(guest.patience)}s`;
  });
  fillActiveOrder();
  $('shift-note').textContent = shiftActive
    ? `Today's goal: ${Math.min(arrivals, dailyTarget)}/${dailyTarget} guests welcomed · ${shiftServed} orders served`
    : pendingReport ? `Day ${state.day} report is ready. Plan for tomorrow or open again.` : `The ${event.title.toLowerCase()} · Set up supplies, then open your doors.`;
  $('all-guest-count').textContent = `${guestsInShift.length} waiting`;
  $('clean-button').textContent = `🧽 Clean tables${dirtyTables ? ` · ${dirtyTables}` : ''}`;
  $<HTMLButtonElement>('clean-button').disabled = !shiftActive || dirtyTables === 0;
  document.querySelectorAll<HTMLButtonElement>('.manager-tab').forEach(button => button.classList.toggle('active', button.dataset.tab === currentPanel));
  if (assetError) $('asset-status').textContent = assetError;
}
function assignStaff() {
  if (!shiftActive) return;
  for (const worker of workers) {
    if (worker.busyUntil > simulatedTime) continue;
    if (worker.role === 'server') {
      if (worker.task === 'serve') {
        const guest = getOrder(worker.pendingGuestId ?? -1);
        worker.task = undefined; worker.pendingGuestId = undefined;
        if (guest && selectedReady(guest)) serveOrder(guest.id, true);
        continue;
      }
      const readyGuest = guestsInShift.find(g => selectedReady(g));
      if (readyGuest) {
        worker.task = 'serve'; worker.pendingGuestId = readyGuest.id;
        worker.busyUntil = simulatedTime + Math.max(1.1, 2.2 / worker.skill);
      }
      continue;
    }
    if (worker.role === 'cleaner' && worker.task === 'clean') {
      worker.task = undefined;
      if (dirtyTables > 0) cleanCafe(true);
      continue;
    }
    if (worker.role === 'cleaner' && dirtyTables > 0 && simulatedTime - shiftStart > 12) {
      worker.task = 'clean'; worker.busyUntil = simulatedTime + 2.5;
      continue;
    }
    if (worker.role !== 'barista' && worker.role !== 'cook') continue;
    const guest = guestsInShift.find(g => g.items.some(item => item.state === 'waiting' && recipeById(item.recipeId).kind === (worker.role === 'cook' ? 'food' : 'drink') && !ingredientMissing(recipeById(item.recipeId))));
    const itemIndex = guest?.items.findIndex(item => item.state === 'waiting' && recipeById(item.recipeId).kind === (worker.role === 'cook' ? 'food' : 'drink') && !ingredientMissing(recipeById(item.recipeId))) ?? -1;
    if (guest && itemIndex >= 0) prepareOrder(guest.id, itemIndex, true);
  }
}
function updateSimulation(dt: number) {
  if (!shiftActive || shiftPause) return;
  simulatedTime += dt * speed;
  if (combo && simulatedTime > comboUntil) combo = 0;
  state.chestSeconds = Math.min(CHEST_SECONDS, state.chestSeconds + dt);
  if (simulatedTime - shiftStart >= 120) { finishShift(); return; }
  if (arrivals < dailyTarget && simulatedTime >= nextArrival) {
    createGuest();
    const eventTraffic = (currentEvent().title === 'Market-day foot traffic' ? 4.2 : 6.3) * (1 - 0.06 * upLevel('signage')) * (1 - 0.05 * upLevel('wifi'));
    nextArrival = simulatedTime + eventTraffic;
  }
  for (const guest of guestsInShift) {
    guest.patience -= dt * speed;
    if (guest.patience <= 0) {
      shiftLost++; combo = 0;
      state.reputation = clamp(state.reputation - 0.04, 0.5, 5);
      const actor = guestActors.get(guest.id);
      if (actor) { actor.exiting = true; actor.exitAt = simulatedTime + 1.1; }
      if (selectedGuestId === guest.id) selectedGuestId = null;
      toast(`${guest.name} had to leave. Faster service or another teammate may help.`, 'warning');
    }
    guest.items.forEach(item => {
      if (item.state === 'preparing' && simulatedTime >= item.finishAt) { item.state = 'ready'; questStat(recipeById(item.recipeId).kind === 'drink' ? 'drinks' : 'treats', 1); beep(720, 0.05, 'sine', 0.018, 100); }
    });
  }
  guestsInShift = guestsInShift.filter(g => g.patience > 0);
  if (selectedGuestId !== null && !getOrder(selectedGuestId)) selectedGuestId = guestsInShift[0]?.id ?? null;
  assignStaff();
  if (arrivals >= dailyTarget && guestsInShift.length === 0 && autoCloseTimer <= 0) autoCloseTimer = 2.4;
  if (autoCloseTimer > 0) { autoCloseTimer -= dt * speed; if (autoCloseTimer <= 0) finishShift(); }
}
function stepAngle(current: number, target: number, maxStep: number) {
  const diff = ((target - current + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return current + clamp(diff, -maxStep, maxStep);
}
function setActorScale(actor: CharacterActor, amount: number) {
  actor.root.scale.setScalar((actor.root.userData.baseScale as number) * Math.max(0.01, amount));
}
function startLeaving(actor: GuestActor) {
  actor.leaving = true; actor.settled = false;
  if (actor.seatKey) occupiedSeats.delete(actor.seatKey);
  const from = actor.root.position.clone().setY(0);
  actor.root.position.y = 0;
  actor.path = findPath(from, DOOR, actor.seatKey);
  actor.seated = false; actor.speed = 1.75;
}
function updateActors(dt: number) {
  const playerPos = playerActor?.root.position;
  for (const [id, actor] of guestActors) {
    if (actor.exiting && !actor.leaving) startLeaving(actor);
    const pos = actor.root.position;
    if (!actor.leaving && actor.appear < 1) { actor.appear = Math.min(1, actor.appear + dt * 2.6); setActorScale(actor, actor.appear); }
    if (!actor.leaving && !actor.seated && !actor.path.length && actor.settled) {
      const seat = seatSpots.find(spot => !occupiedSeats.has(spot.key));
      if (seat) {
        occupiedSeats.add(seat.key);
        actor.seatKey = seat.key; actor.seated = true; actor.settled = false; actor.sitFacing = seat.facing;
        actor.target = seat.position.clone(); actor.path = findPath(pos.clone().setY(0), seat.position, seat.key);
      }
    }
    let moving = false;
    if (actor.path.length) {
      const next = actor.path[0];
      const dx = next.x - pos.x, dz = next.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.07) actor.path.shift();
      else {
        let vx = dx / dist, vz = dz / dist;
        const others: THREE.Vector3[] = [];
        for (const other of guestActors.values()) if (other !== actor && !other.seated) others.push(other.root.position);
        if (playerPos) others.push(playerPos);
        for (const o of others) {
          const ox = pos.x - o.x, oz = pos.z - o.z; const od = Math.hypot(ox, oz);
          if (od > 0.001 && od < 0.55) { vx += (ox / od) * (0.55 - od) * 2.2; vz += (oz / od) * (0.55 - od) * 2.2; }
        }
        const vl = Math.hypot(vx, vz) || 1;
        const step = Math.min(dist, actor.speed * dt);
        pos.x += (vx / vl) * step; pos.z += (vz / vl) * step;
        actor.root.rotation.y = stepAngle(actor.root.rotation.y, Math.atan2(vx, vz), dt * 9);
        moving = true;
      }
    }
    if (moving) {
      animatePerson(actor, 'walk');
      if (actor.action) actor.action.timeScale = clamp(actor.speed / 1.9, 0.6, 1.1);
    } else if (actor.leaving) {
      guestGroup.remove(actor.root); guestActors.delete(id);
      continue;
    } else if (actor.seated) {
      const target = actor.target;
      const lean = new THREE.Vector3(Math.sin(actor.sitFacing), 0, Math.cos(actor.sitFacing)).multiplyScalar(0.1);
      const sx = target.x + lean.x, sz = target.z + lean.z;
      pos.x += (sx - pos.x) * Math.min(1, dt * 7); pos.z += (sz - pos.z) * Math.min(1, dt * 7);
      pos.y += (SIT_DROP - pos.y) * Math.min(1, dt * 7);
      actor.root.rotation.y = stepAngle(actor.root.rotation.y, actor.sitFacing, dt * 8);
      if (Math.hypot(sx - pos.x, sz - pos.z) < 0.03) { actor.settled = true; animatePerson(actor, 'sit'); } else animatePerson(actor, 'walk');
    } else {
      actor.root.rotation.y = stepAngle(actor.root.rotation.y, actor.sitFacing, dt * 6);
      actor.settled = true;
      animatePerson(actor, 'idle');
    }
    if (actor.leaving && actor.path.length === 1 && Math.hypot(DOOR.x - pos.x, DOOR.z - pos.z) < 0.8) setActorScale(actor, Math.hypot(DOOR.x - pos.x, DOOR.z - pos.z) / 0.8);
    actor.mixer?.update(dt);
  }
  updatePlayer(dt);
  for (const worker of workers) worker.mixer?.update(dt);
}
function updatePlayer(dt: number) {
  if (!playerActor) return;
  const active = shiftActive && !shiftPause;
  const direction = new THREE.Vector3(
    Number(movementKeys.has('d') || movementKeys.has('arrowright')) - Number(movementKeys.has('a') || movementKeys.has('arrowleft')),
    0,
    Number(movementKeys.has('s') || movementKeys.has('arrowdown')) - Number(movementKeys.has('w') || movementKeys.has('arrowup')),
  );
  if (direction.lengthSq() > 1) direction.normalize();
  if (direction.lengthSq() > 0 && active) { playerMoveTarget = null; playerTask = null; playerPath = []; }
  if (playerPath.length && active) {
    const toNext = playerPath[0].clone().sub(playerPosition()); toNext.y = 0;
    const arrive = playerPath.length === 1 ? 0.12 : 0.28;
    if (toNext.length() < arrive) { playerPath.shift(); if (!playerPath.length) { playerMoveTarget = null; playerVelocity.multiplyScalar(0.25); } }
    else direction.copy(toNext.normalize());
  } else if (playerMoveTarget && active) playerMoveTarget = null;
  const topSpeed = 2.65 * (1 + 0.1 * upLevel('shoes'));
  const desired = active ? direction.multiplyScalar(topSpeed) : new THREE.Vector3();
  const blend = 1 - Math.exp(-dt * (desired.lengthSq() ? 9 : 10));
  playerVelocity.lerp(desired, blend);
  const pos = playerActor.root.position;
  const nextX = pos.x + playerVelocity.x * dt, nextZ = pos.z + playerVelocity.z * dt;
  const stuck = blockedAt(pos.x, pos.z, 0.24);
  if (stuck || !blockedAt(nextX, pos.z, 0.24)) pos.x = nextX; else playerVelocity.x = 0;
  if (stuck || !blockedAt(pos.x, nextZ, 0.24)) pos.z = nextZ; else playerVelocity.z = 0;
  const speedNow = Math.hypot(playerVelocity.x, playerVelocity.z);
  const moving = speedNow > 0.25;
  if (moving) playerActor.root.rotation.y = stepAngle(playerActor.root.rotation.y, Math.atan2(playerVelocity.x, playerVelocity.z), dt * 11);
  animatePerson(playerActor, moving ? 'walk' : 'idle');
  if (moving && playerActor.action) playerActor.action.timeScale = clamp(speedNow / 2.3, 0.7, 1.25);
  playerActor.mixer?.update(dt);
}
function animate(now: number) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - (lastUpdate || now)) / 1000, 0.06);
  lastUpdate = now;
  updateSimulation(dt);
  updateActors(dt);
  updateInteractionPrompt();
  const bob = Math.sin(now * 0.0015) * 0.012;
  const windowGlow = 1 + Math.sin(now * 0.00035) * 0.06;
  windowLight.intensity = 45 * windowGlow;
  for (const worker of workers) if (worker.busyUntil > simulatedTime) worker.model.position.y = bob;
  for (const puff of steamPuffs) {
    const t = ((now * 0.00028 + puff.offset) % 1);
    puff.sprite.position.set(puff.base.x + Math.sin(t * 6 + puff.offset * 9) * 0.04, puff.base.y + t * 0.5, puff.base.z);
    puff.sprite.scale.setScalar(0.12 + t * 0.24);
    (puff.sprite.material as THREE.SpriteMaterial).opacity = Math.sin(t * Math.PI) * 0.35 * puff.strength;
  }
  renderer.render(scene, camera);
  if (now - lastUiDraw > 220) {
    lastUiDraw = now;
    updateUI();
  }
}

document.querySelectorAll<HTMLButtonElement>('.manager-tab').forEach(button => button.addEventListener('click', () => showPanel(button.dataset.tab || '')));
$('panel-close').addEventListener('click', closePanel);
$('shift-button').addEventListener('click', () => {
  if (pendingReport) beginNextDay();
  else if (shiftActive) finishShift();
  else startShift();
});
$('pause-button').addEventListener('click', () => { shiftPause = !shiftPause; updateUI(); toast(shiftPause ? 'Shift paused.' : 'Back to the floor.', 'good'); });
$('clean-button').addEventListener('click', () => cleanCafe());
$('manager-panel').addEventListener('click', event => { if (event.target === $('manager-panel')) closePanel(); });
$<HTMLInputElement>('intro-name').value = state.name;
$<HTMLInputElement>('intro-name').addEventListener('change', () => { const name = $<HTMLInputElement>('intro-name').value.trim().slice(0, 28); if (name) { state.name = name; persist(); updateUI(); } else $<HTMLInputElement>('intro-name').value = state.name; });
$('begin-game').addEventListener('click', () => {
  const name = $<HTMLInputElement>('intro-name').value.trim().slice(0, 28);
  state.name = name || 'Corner Cup Café'; $<HTMLInputElement>('intro-name').value = state.name; persist(); startShift();
});
$('chest-button').addEventListener('click', () => { if (state.chestSeconds >= CHEST_SECONDS) claimChest(); else showPanel('rewards'); });
$('intro-help').addEventListener('click', () => showPanel('help'));
$('pause-button').addEventListener('dblclick', () => showPanel('settings'));
$('help-button').addEventListener('click', () => showPanel('help'));
$('mute-button').addEventListener('click', () => { soundEnabled = !soundEnabled; $('mute-button').textContent = soundEnabled ? '♫ Sound' : '♪ Muted'; $('mute-button').setAttribute('aria-label', soundEnabled ? 'Mute sound effects' : 'Turn on sound effects'); if (currentPanel === 'settings') renderPanel(); });
$('settings-button').addEventListener('click', () => showPanel('settings'));
$('clean-button').title = 'Clean tables to keep guests comfortable and protect your reputation.';
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { closePanel(); return; }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
    if (shiftActive) { event.preventDefault(); movementKeys.add(key); }
    return;
  }
  if (key === 'e') { if (!event.repeat && shiftActive) interact(); return; }
  if (event.target instanceof HTMLButtonElement) return;
  if (event.key.toLowerCase() === 'p' && shiftActive) { shiftPause = !shiftPause; updateUI(); }
  if (event.key === '1' && guestsInShift.length) selectGuest(guestsInShift[0].id);
  if (event.code === 'Space' && shiftActive && selectedGuestId !== null) {
    event.preventDefault();
    const guest = getOrder(selectedGuestId);
    const index = guest?.items.findIndex(item => item.state === 'waiting') ?? -1;
    if (guest && index >= 0) goToStation(guest.id, index);
  }
  if (event.key === 'Enter' && shiftActive && selectedGuestId !== null) goToGuest(selectedGuestId);
});
document.addEventListener('keyup', event => movementKeys.delete(event.key.toLowerCase()));
addEventListener('blur', () => movementKeys.clear());
document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach(button => {
  const direction = button.dataset.move!;
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (shiftActive) { movementKeys.add(direction); button.setPointerCapture(event.pointerId); }
  });
  const stop = () => movementKeys.delete(direction);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('lostpointercapture', stop);
});
$('touch-interact').addEventListener('click', interact);
setInterval(persist, 9000);
addEventListener('beforeunload', persist);
ensureQuests(); checkAchievements();
{
  const li = levelInfo(state.xp);
  $('intro-progress').innerHTML = `<span>Level ${li.level}</span><span>${state.streak.days}-day streak</span><span>${state.hearts} 💗</span>${state.streak.claimedDate !== dateKey() ? '<span class="gift">🎁 Daily gift waiting</span>' : ''}`;
}
updateUI();
if (pendingReport) {
  $('intro').classList.add('hidden');
  $('main-ui').classList.remove('inactive');
  showPanel('report');
}
loadWorldAssets();
requestAnimationFrame(animate);
