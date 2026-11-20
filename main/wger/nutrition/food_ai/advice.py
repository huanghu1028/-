"""
Next-meal advice based on the daily calorie goal and today's diary entries.

Pure logic, no database access: the view collects the inputs (current local
hour, goal, consumed nutrients, already-logged meal slots) and renders the
returned dict. Meal energy shares follow the common 30/40/30 split.
"""

# Standard Library
from dataclasses import dataclass

# wger
from wger.nutrition.food_ai.food_data import (
    FoodInfo,
    foods_with_tag,
)


@dataclass(frozen=True)
class MealSlot:
    key: str
    zh: str
    start: float
    end: float
    share: float


MEAL_SLOTS = (
    MealSlot('breakfast', '早餐', 5.0, 9.5, 0.30),
    MealSlot('lunch', '午餐', 11.0, 14.0, 0.40),
    MealSlot('dinner', '晚餐', 17.0, 20.5, 0.30),
)


def slot_for_log_hour(hour: float) -> str | None:
    """Which meal slot a diary entry belongs to, by its local hour."""
    if hour < 10.5:
        return 'breakfast'
    if hour < 15.5:
        return 'lunch'
    if hour < 21.0:
        return 'dinner'
    return None


def next_meal_slot(now_hour: float, logged_slots: set[str]) -> MealSlot | None:
    """The next main meal that has not been logged yet today."""
    for slot in MEAL_SLOTS:
        if now_hour < slot.end and slot.key not in logged_slots:
            return slot
    return None


def _pick(pool: list[FoodInfo], seed: int) -> FoodInfo:
    return pool[seed % len(pool)]


def _grams_for(food: FoodInfo, kcal_budget: float, max_factor: float = 1.5) -> int:
    """Portion size fitting the budget, capped at 1.5x the typical serving."""
    grams = kcal_budget / food.energy * 100
    grams = min(grams, food.serving * max_factor)
    return max(20, int(round(grams / 5) * 5))


def _suggestion(food: FoodInfo, grams: int, note: str) -> dict:
    return {
        'key': food.key,
        'zh': food.zh,
        'en': food.en,
        'grams': grams,
        'kcal': food.kcal_for(grams),
        'note': note,
    }


def build_advice(
    *,
    now_hour: float,
    goal: int,
    consumed: float,
    protein_consumed: float = 0,
    logged_slots: set[str] | None = None,
    protein_goal: int | None = None,
) -> dict:
    """
    Build the next-meal advice dict for the scan page.

    status is one of on_track, tight, over, closed. Suggestions are concrete
    foods with gram amounts sized to the remaining energy budget.
    """
    logged_slots = logged_slots or set()
    remaining = goal - consumed
    slot = next_meal_slot(now_hour, logged_slots)

    light_pool = foods_with_tag('light', max_energy=100)
    protein_pool = foods_with_tag('high_protein', max_energy=230)
    veg_pool = foods_with_tag('veg')
    staple_pool = foods_with_tag('staple')

    result = {
        'goal': goal,
        'consumed': round(consumed),
        'remaining': round(remaining),
        'slot_key': slot.key if slot else None,
        'slot_name': slot.zh if slot else None,
        'meal_budget': 0,
        'status': 'closed',
        'message': '',
        'suggestions': [],
        'protein_hint': None,
    }

    if slot is None:
        result['status'] = 'closed'
        if remaining >= 150:
            food = _pick(light_pool, int(now_hour))
            grams = _grams_for(food, min(remaining, 150))
            result['suggestions'] = [
                _suggestion(food, grams, '今日进食窗口已结束，如仍饥饿可少量加餐')
            ]
            result['message'] = (
                f'今日三餐已记录完毕，还剩 {round(remaining)} 千卡额度，建议尽量不加餐。'
            )
        else:
            result['message'] = '今日三餐已记录完毕，热量目标基本达成，建议不再进食，早点休息。'
        return result

    meal_target = round(goal * slot.share)
    meal_budget = max(0, min(meal_target, round(remaining)))
    result['meal_budget'] = meal_budget
    seed = int(now_hour) + int(slot.start)

    if consumed > goal:
        result['status'] = 'over'
        excess = round(consumed - goal)
        result['message'] = (
            f'今日已超出目标 {excess} 千卡，{slot.zh}建议尽量少吃，'
            '选择极低热量食物，并通过运动增加消耗。'
        )
        food = _pick(light_pool, seed)
        grams = _grams_for(food, 80)
        result['suggestions'] = [_suggestion(food, grams, '如仍饥饿，仅少量食用')]
    elif remaining < meal_target * 0.5:
        result['status'] = 'tight'
        result['message'] = (
            f'今日热量余额紧张（剩 {round(remaining)} 千卡），'
            f'{slot.zh}建议清淡为主，控制在 {meal_budget} 千卡以内。'
        )
        light = _pick(light_pool, seed)
        protein = _pick(protein_pool, seed)
        result['suggestions'] = [
            _suggestion(light, _grams_for(light, meal_budget * 0.4), '低热量 · 增加饱腹感'),
            _suggestion(protein, _grams_for(protein, meal_budget * 0.6), '高蛋白 · 保住肌肉'),
        ]
    else:
        result['status'] = 'on_track'
        result['message'] = (
            f'今日剩余 {round(remaining)} 千卡，{slot.zh}建议控制在 {meal_budget} 千卡左右，'
            '均衡搭配蛋白质、蔬菜和主食。'
        )
        protein = _pick(protein_pool, seed)
        veg = _pick(veg_pool, seed)
        suggestions = [
            _suggestion(protein, _grams_for(protein, meal_budget * 0.4), '优质蛋白'),
            _suggestion(veg, _grams_for(veg, meal_budget * 0.15), '蔬菜 · 膳食纤维'),
        ]
        if meal_budget >= 250:
            staple = _pick(staple_pool, seed)
            suggestions.append(
                _suggestion(staple, _grams_for(staple, meal_budget * 0.45), '主食 · 补充能量')
            )
        result['suggestions'] = suggestions

    if protein_goal and protein_consumed < protein_goal * 0.5 and result['status'] != 'over':
        result['protein_hint'] = '今日蛋白质摄入偏少，下一餐可优先选择鱼虾、鸡蛋或瘦肉。'

    return result
