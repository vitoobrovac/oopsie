import { searchText } from "./receipts";

const icons: [RegExp, string][] = [
  [/\b(?:gigbag|gig bag|instrument case)\b/, "🎒"],
  [/\b(?:guitar stand|bass stand|instrument stand|gs 2000)\b/, "🧍"],
  [/\b(?:instrument cable|guitar cable|bass cable|audio cable)\b/, "🔌"],
  [/\b(?:bass guitar|electric bass|yamaha trbx|guitar)\b/, "🎸"],
  [/\b(?:music|instruments)\b/, "🎵"],
  [/\b(?:pear|pears|birne|birnen|kruska|kruske)\b/, "🍐"],
  [/\b(?:apple|apples|apfel|applesauce|jabuka|jabuke)\b/, "🍎"],
  [/\b(?:banana|bananas|bananen)\b/, "🍌"],
  [/\b(?:orange|oranges|naranca|orangen)\b/, "🍊"],
  [/\b(?:strawberry|strawberries|erdbeeren)\b/, "🍓"],
  [/\b(?:grape|grapes|trauben)\b/, "🍇"],
  [/\b(?:lemon|lemons|zitrone)\b/, "🍋"],
  [/\b(?:tomato|tomatoes|tomaten)\b/, "🍅"],
  [/\b(?:avocado|avocados|avokado)\b/, "🥑"],
  [/\b(?:capsicum|bell pepper|paprika)\b/, "🫑"],
  [/\b(?:broccoli|brokkoli|brokula)\b/, "🥦"],
  [/\b(?:onion|onions|zwiebeln|luk)\b/, "🧅"],
  [/\b(?:pasta|penne|tjestenina)\b/, "🍝"],
  [/\b(?:rice|basmati|riza)\b/, "🍚"],
  [/\b(?:tuna|fish|tuna fish|tunjevina)\b/, "🐟"],
  [/\b(?:beef|mince|junetina)\b/, "🥩"],
  [/\b(?:olive oil|maslinovo ulje)\b/, "🫒"],
  [/\b(?:carrot|carrots|karotten|mohren)\b/, "🥕"],
  [/\b(?:bread|toast|toastbrot|brot|bakery)\b/, "🍞"],
  [/\b(?:water|wasser|voda)\b/, "💧"],
  [/\b(?:coffee|kaffee|espresso)\b/, "☕"],
  [/\b(?:tea|tee|caj)\b/, "🍵"],
  [/\b(?:juice|saft|syrup|sirup|smoothie)\b/, "🧃"],
  [/\b(?:pudding|dessert|monte)\b/, "🍮"],
  [/\b(?:milk|milch|oatmilk|hafermilch)\b/, "🥛"],
  [/\b(?:cheese|kase|sir)\b/, "🧀"],
  [/\b(?:eggs|egg|eier)\b/, "🥚"],
  [/\b(?:chicken|huhn|piletina)\b/, "🍗"],
  [/\b(?:salad|salat|greens|lettuce|spinach)\b/, "🥬"],
  [/\b(?:drinks|beverages|getranke)\b/, "🥤"],
  [/\b(?:fruit|obst|voce)\b/, "🍏"],
  [/\b(?:vegetables|gemuse|povrce)\b/, "🥦"],
  [/\b(?:food|groceries|meat|pantry)\b/, "🍽️"],
];

export function productEmoji(...labels: string[]) {
  const text = searchText(labels.join(" "));
  return icons.find(([pattern]) => pattern.test(text))?.[1] ?? "🛒";
}
