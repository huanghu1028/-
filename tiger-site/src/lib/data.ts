// 静态数据层：动作库 / 分类 / 食物成分表（构建期导出，随站点分发）。
export type Exercise = {
  id: number; name: string; name_en: string; category: number;
  muscles: number[]; muscles_secondary: number[]; equipment: number[];
  description: string; description_lang: string; images: string[];
};
export type Taxonomy = {
  categories: { id: number; name: string; name_en: string }[];
  equipment: { id: number; name: string; name_en: string }[];
  muscles: { id: number; name: string; name_en: string; is_front: boolean }[];
};
export type Food = { name: string; cat: string; kcal: number; protein: number; fat: number; carb: number; hint?: string };

let exercisesPromise: Promise<Exercise[]> | null = null;
let taxonomyPromise: Promise<Taxonomy> | null = null;
let foodsPromise: Promise<{ note: string; foods: Food[] }> | null = null;

async function loadJson<T>(path: string): Promise<T> {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error(`数据加载失败：${path}`);
  return resp.json() as Promise<T>;
}

export const loadExercises = () => (exercisesPromise ??= loadJson<Exercise[]>("/data/exercises.json"));
export const loadTaxonomy = () => (taxonomyPromise ??= loadJson<Taxonomy>("/data/taxonomy.json"));
export const loadFoods = () => (foodsPromise ??= loadJson<{ note: string; foods: Food[] }>("/data/foods.json"));

export function exerciseById(list: Exercise[], id: number): Exercise | undefined {
  return list.find((e) => e.id === id);
}

export function nameOf(map: { id: number; name: string }[], id: number): string {
  return map.find((m) => m.id === id)?.name ?? `#${id}`;
}

// 每 100g 成分按克数缩放，保留 1 位小数。
export function scaleFood(food: Food, grams: number) {
  const k = grams / 100;
  const r1 = (n: number) => Math.round(n * k * 10) / 10;
  return { kcal: r1(food.kcal), protein: r1(food.protein), fat: r1(food.fat), carb: r1(food.carb) };
}