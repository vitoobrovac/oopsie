import { searchText } from "./receipts";

const icons: [RegExp, string][] = [
  [/\b(?:pear|pears|birne|birnen|kruska|kruske)\b/, "🍐"],
  [/\b(?:apple|apples|apfel|applesauce|jabuka|jabuke)\b/, "🍎"],
  [/\b(?:banana|bananas|bananen)\b/, "🍌"],
  [/\b(?:orange|oranges|naranca|orangen)\b/, "🍊"],
  [/\b(?:strawberry|strawberries|erdbeeren)\b/, "🍓"],
  [/\b(?:grape|grapes|trauben)\b/, "🍇"],
  [/\b(?:lemon|lemons|zitrone)\b/, "🍋"],
  [/\b(?:tomato|tomatoes|tomaten)\b/, "🍅"],
  [/\b(?:carrot|carrots|karotten|mohren)\b/, "🥕"],
  [/\b(?:bread|toast|toastbrot|brot|bakery)\b/, "🍞"],
  [/\b(?:water|wasser|voda)\b/, "💧"],
  [/\b(?:coffee|kaffee|espresso)\b/, "☕"],
  [/\b(?:tea|tee|caj)\b/, "🍵"],
  [/\b(?:juice|saft|syrup|sirup|smoothie)\b/, "🧃"],
  [/\b(?:pudding|dessert|monte)\b/, "🍮"],
  [/\b(?:milk|milch|dairy|oatmilk|hafermilch)\b/, "🥛"],
  [/\b(?:cheese|kase|sir)\b/, "🧀"],
  [/\b(?:eggs|egg|eier)\b/, "🥚"],
  [/\b(?:chicken|huhn|piletina)\b/, "🍗"],
  [/\b(?:salad|salat|greens|lettuce)\b/, "🥬"],
  [/\b(?:drinks|beverages|getranke)\b/, "🥤"],
  [/\b(?:fruit|obst|voce)\b/, "🍏"],
  [/\b(?:vegetables|gemuse|povrce)\b/, "🥦"],
  [/\b(?:food|groceries|meat|pantry)\b/, "🍽️"],
];

export function productEmoji(...labels: string[]) {
  const text = searchText(labels.join(" "));
  return icons.find(([pattern]) => pattern.test(text))?.[1] ?? "🛒";
}
